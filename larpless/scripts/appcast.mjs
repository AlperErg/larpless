#!/usr/bin/env node
// Adds (or replaces) one release in the Sparkle appcast that the Mac app checks for updates
// (SUFeedURL in macos/Focusline-macOS/Info.plist → https://larpless.app/appcast.xml, served from
// site/public/appcast.xml). Called by scripts/release-mac.sh after the DMG is notarized and signed.
//
//   node scripts/appcast.mjs --app <LarpLess.app> --dmg <LarpLess-x.y.z.dmg> --signature <base64 EdDSA>
//                            [--url <download URL>] [--feed <appcast.xml>]
//
// Before writing, it checks the signature against the app's own SUPublicEDKey, so a release signed with
// the wrong private key (which every installed copy would reject) never reaches the feed.
import { createPublicKey, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/AlperErg/larpless';
const here = dirname(fileURLToPath(import.meta.url));

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) fail(`bad argument: ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  for (const k of ['app', 'dmg', 'signature']) if (!out[k]) fail(`--${k} is required`);
  return out;
}

function fail(message) {
  console.error(`appcast: ${message}`);
  process.exit(1);
}

function plist(app, key) {
  return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, join(app, 'Contents/Info.plist')], {
    encoding: 'utf8',
  }).trim();
}

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Checks a Sparkle EdDSA signature (base64) of `file` against a raw 32-byte base64 public key. */
export function signatureMatches(file, signature, publicKey) {
  const raw = Buffer.from(publicKey, 'base64');
  if (raw.length !== 32) return false;
  // SubjectPublicKeyInfo for Ed25519: a fixed 12-byte prefix, then the raw key.
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  return verify(null, readFileSync(file), key, Buffer.from(signature, 'base64'));
}

/** The appcast with `item` for `version` first, replacing any item already there for that version. */
export function upsertItem(xml, version, item) {
  const items = [...xml.matchAll(/[ \t]*<item>[\s\S]*?<\/item>\n?/g)].map((m) => m[0]);
  const kept = items.filter((it) => !it.includes(`<sparkle:version>${escape(version)}</sparkle:version>`));
  const end = xml.search(/[ \t]*<\/channel>/);
  const first = xml.search(/[ \t]*<item>/);
  const head = xml.slice(0, first >= 0 && first < end ? first : end);
  return head + item + kept.join('') + xml.slice(end);
}

const EMPTY = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>LarpLess</title>
    <link>https://larpless.app/appcast.xml</link>
    <description>LarpLess for macOS updates. Written by larpless/scripts/appcast.mjs; don't edit by hand.</description>
    <language>en</language>
  </channel>
</rss>
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = args();
  const feed = a.feed ?? join(here, '../../site/public/appcast.xml');
  const version = plist(a.app, 'CFBundleVersion');
  const shortVersion = plist(a.app, 'CFBundleShortVersionString');
  const minSystem = plist(a.app, 'LSMinimumSystemVersion');
  const publicKey = plist(a.app, 'SUPublicEDKey');
  if (!publicKey) fail('the app has no SUPublicEDKey, so it would never accept an update.');
  if (!signatureMatches(a.dmg, a.signature, publicKey)) {
    fail("the DMG's EdDSA signature doesn't match the app's SUPublicEDKey (wrong private key?).");
  }
  const url = a.url ?? `${REPO}/releases/download/v${shortVersion}/LarpLess-${shortVersion}.dmg`;
  const item = `    <item>
      <title>LarpLess ${escape(shortVersion)}</title>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <sparkle:version>${escape(version)}</sparkle:version>
      <sparkle:shortVersionString>${escape(shortVersion)}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>${escape(minSystem)}</sparkle:minimumSystemVersion>
      <sparkle:fullReleaseNotesLink>${REPO}/releases/tag/v${escape(shortVersion)}</sparkle:fullReleaseNotesLink>
      <enclosure url="${escape(url)}" length="${statSync(a.dmg).size}" type="application/octet-stream" sparkle:edSignature="${escape(a.signature)}"/>
    </item>
`;
  const xml = existsSync(feed) ? readFileSync(feed, 'utf8') : EMPTY;
  writeFileSync(feed, upsertItem(xml, version, item));
  console.log(`${feed}: LarpLess ${shortVersion} → ${url}`);
}
