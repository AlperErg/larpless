#!/usr/bin/env node
/**
 * Writes src/legal/acknowledgements.json: the copyright and licence notices of everything third-party that
 * ships in the app. The Acknowledgements page (Settings, and LarpLess → Acknowledgements… on macOS) shows it.
 *
 *   node scripts/acknowledgements.mjs           regenerate the file
 *   node scripts/acknowledgements.mjs --check   exit 1 when the committed file is out of date (CI)
 *
 * Run it after changing npm dependencies, pods, fonts, models or vendored code. Sources:
 *   - JavaScript: the packages Metro actually bundles for macOS and Windows (release bundles, read from their
 *     source maps), not the whole dependency tree, most of which is build tooling that never ships.
 *   - macOS native: the acknowledgements CocoaPods writes on `pod install` (so run that first), and
 *     vendored code under macos/vendor/.
 *   - Fonts, models and the Windows build's native libraries (NuGet packages and what react-native-windows
 *     compiles in): EXTRAS below, with licence texts kept in licenses/. Update their versions by hand.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/legal/acknowledgements.json');
const PODS_PLIST = join(ROOT, 'macos/Pods/Target Support Files/Pods-Focusline-macOS/Pods-Focusline-macOS-acknowledgements.plist');
const PODFILE_LOCK = join(ROOT, 'macos/Podfile.lock');
const PLATFORMS = ['macos', 'windows'];

/**
 * Bundled by hand rather than through npm or CocoaPods, or downloaded by the app at onboarding (the models).
 * `notice` goes above the licence text.
 */
const EXTRAS = [
  {
    group: 'Fonts',
    name: 'Inter',
    version: '4.001',
    license: 'OFL-1.1',
    notice: 'Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)',
    file: 'licenses/OFL-1.1.txt',
  },
  {
    group: 'Fonts',
    name: 'Instrument Serif',
    version: '1.000',
    license: 'OFL-1.1',
    notice: 'Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif)',
    file: 'licenses/OFL-1.1.txt',
  },
  {
    group: 'Models',
    name: 'Ultralytics YOLO11n',
    license: 'AGPL-3.0',
    notice:
      'Webcam presence and phone detection: yolo11n.mlpackage (macOS) and yolo11n.onnx (Windows), by Ultralytics.\n' +
      'Licensed under the GNU Affero General Public License v3.0 (https://ultralytics.com/license).\n' +
      'Source: https://github.com/ultralytics/ultralytics',
    file: 'licenses/AGPL-3.0.txt',
  },
  {
    group: 'Models',
    name: 'Qwen3-VL 2B',
    license: 'Apache-2.0',
    notice:
      'Screen classification: qwen3-vl:2b, by the Qwen team (Alibaba Cloud). Not bundled: Ollama downloads it at onboarding.\n' +
      'Source: https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct',
    file: 'licenses/Apache-2.0.txt',
  },
  {
    group: 'Native libraries',
    name: 'ONNX Runtime',
    version: '1.22.1',
    license: 'MIT',
    notice:
      'https://github.com/microsoft/onnxruntime\n' +
      'The licences of the libraries it includes ship with the app as ThirdPartyNotices-onnxruntime.txt, next to\n' +
      'LarpLess.exe, and are at https://github.com/microsoft/onnxruntime/blob/v1.22.1/ThirdPartyNotices.txt',
    file: 'licenses/MIT-onnxruntime.txt',
    platforms: ['windows'],
  },
  // Windows NuGet packages and the C++ libraries react-native-windows compiles into Microsoft.ReactNative.dll.
  // Versions follow windows/LarpLess/obj/project.assets.json and react-native-windows' external/*/cgmanifest.json.
  // The Windows App SDK and VCLibs are framework packages Windows installs, not files in the app.
  {
    group: 'Native libraries',
    name: 'Hermes',
    version: '0.0.0-2608.12001-35d34796',
    license: 'MIT',
    notice: 'JavaScript engine (Microsoft.JavaScript.Hermes): hermes.dll and hermes-icu.dll. https://github.com/microsoft/hermes-windows',
    file: 'licenses/NOTICE-hermes.txt',
    platforms: ['windows'],
  },
  {
    group: 'Native libraries',
    name: 'Microsoft Edge WebView2 SDK',
    version: '1.0.3179.45',
    license: 'BSD-3-Clause',
    notice: 'Microsoft.Web.WebView2.Core.dll, loaded by react-native-windows.',
    file: 'licenses/BSD-3-Clause-webview2.txt',
    platforms: ['windows'],
  },
  {
    group: 'Native libraries',
    name: 'Folly',
    version: 'ad90720',
    license: 'Apache-2.0',
    notice: 'Copyright (c) Meta Platforms, Inc. and affiliates. Built into Microsoft.ReactNative.dll. https://github.com/facebook/folly',
    file: 'licenses/Apache-2.0-folly.txt',
    platforms: ['windows'],
  },
  {
    group: 'Native libraries',
    name: 'fmt',
    version: '0c9fce2',
    license: 'MIT',
    notice: 'Built into Microsoft.ReactNative.dll. https://github.com/fmtlib/fmt',
    file: 'licenses/MIT-fmt.txt',
    platforms: ['windows'],
  },
  {
    group: 'Native libraries',
    name: 'fast_float',
    version: '77cc847',
    license: 'MIT',
    notice: 'Built into Microsoft.ReactNative.dll; also available under Apache-2.0 or BSL-1.0. https://github.com/fastfloat/fast_float',
    file: 'licenses/MIT-fast_float.txt',
    platforms: ['windows'],
  },
  {
    group: 'Native libraries',
    name: 'VC++ runtime forwarders',
    version: '1.0.2-rc',
    license: 'MIT',
    notice: 'Microsoft.VCRTForwarders.140: the *_app.dll forwarders next to LarpLess.exe. https://github.com/microsoft/vcrt-forwarders',
    file: 'licenses/MIT-vcrt-forwarders.txt',
    platforms: ['windows'],
  },
  {
    group: 'Native libraries',
    name: 'mediaremote-adapter',
    version: upstreamCommit('macos/vendor/mediaremote-adapter/UPSTREAM.txt'),
    license: 'BSD-3-Clause',
    notice: 'https://github.com/ungive/mediaremote-adapter',
    file: 'macos/vendor/mediaremote-adapter/LICENSE',
    platforms: ['macos'],
  },
];

/**
 * Meta's monorepo packages that publish no licence file of their own. Their repositories carry the same MIT
 * text and copyright holder as react-native's LICENSE (facebook/metro included), so that file stands in.
 */
const LICENSE_FROM = [
  [/^@react-native\//, 'react-native'],
  [/^@react-native-macos\//, 'react-native-macos'],
  [/^metro-/, 'react-native'],
];

/** CocoaPods' licence names, as SPDX ids. Some podspecs mislabel the text they ship; the text wins. */
const POD_LICENSE = {
  DoubleConversion: 'BSD-3-Clause',
  SocketRocket: 'BSD-3-Clause',
  glog: 'BSD-3-Clause',
  // Tri-licensed upstream; the pod only ships the Apache text.
  fast_float: 'Apache-2.0',
};
const LICENSE_NAMES = { 'Apache License, Version 2.0': 'Apache-2.0', 'Boost Software License': 'BSL-1.0' };

const GROUP_ORDER = ['Fonts', 'Models', 'JavaScript', 'Native libraries'];

function upstreamCommit(file) {
  const m = readFileSync(join(ROOT, file), 'utf8').match(/^commit:\s*([0-9a-f]{7})/m);
  if (!m) throw new Error(`no commit line in ${file}`);
  return m[1];
}

/** LF line endings, no trailing spaces, no blank lines at either end. */
function cleanText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}\n${log}`))));
  });
}

/** Directories of the npm packages in a release bundle for `platform`. */
async function bundledPackages(platform, dir) {
  const map = join(dir, `${platform}.map`);
  await run(join(ROOT, 'node_modules/.bin/react-native'), [
    'bundle',
    '--platform', platform,
    '--dev', 'false',
    '--minify', 'false',
    '--entry-file', 'index.js',
    '--bundle-output', join(dir, `${platform}.js`),
    '--sourcemap-output', map,
  ]);
  const roots = new Set();
  for (const source of JSON.parse(readFileSync(map, 'utf8')).sources) {
    const i = source.lastIndexOf('node_modules/');
    if (i < 0) continue;
    const parts = source.slice(i + 'node_modules/'.length).split('/');
    roots.add(source.slice(0, i) + 'node_modules/' + parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/'));
  }
  return roots;
}

function licenseFile(dir) {
  const name = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  return name ? join(dir, name) : null;
}

function npmNotice(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  let file = licenseFile(dir);
  if (!file) {
    const stand = LICENSE_FROM.find(([re]) => re.test(pkg.name));
    if (stand) file = licenseFile(join(ROOT, 'node_modules', stand[1]));
  }
  if (!file) throw new Error(`${pkg.name} has no licence file: add it to LICENSE_FROM or EXTRAS`);
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type;
  if (!license) throw new Error(`${pkg.name} declares no licence in package.json`);
  return { name: pkg.name, version: pkg.version, license, text: cleanText(readFileSync(file, 'utf8')) };
}

async function javascriptNotices() {
  const dir = mkdtempSync(join(tmpdir(), 'larpless-ack-'));
  try {
    const perPlatform = await Promise.all(PLATFORMS.map((p) => bundledPackages(p, dir)));
    const byKey = new Map();
    perPlatform.forEach((roots, i) => {
      for (const root of roots) {
        const notice = npmNotice(root);
        const key = `${notice.name}@${notice.version}`;
        const seen = byKey.get(key) ?? { ...notice, platforms: new Set() };
        seen.platforms.add(PLATFORMS[i]);
        byKey.set(key, seen);
      }
    });
    return [...byKey.values()].map(({ platforms, ...n }) => ({
      ...n,
      ...(platforms.size < PLATFORMS.length ? { platforms: [...platforms].sort() } : null),
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Resolved versions from the PODS: block (DEPENDENCIES below it lists the requested ranges). */
function podVersions() {
  const pods = readFileSync(PODFILE_LOCK, 'utf8').split(/\n\n/)[0];
  const versions = {};
  for (const m of pods.matchAll(/^ {2}- ([^\s/]+) \(([^)]+)\)/gm)) versions[m[1]] = m[2];
  return versions;
}

function podNotices() {
  if (!existsSync(PODS_PLIST)) throw new Error(`${relative(ROOT, PODS_PLIST)} is missing: run pod install in macos/ first`);
  const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', PODS_PLIST], { encoding: 'utf8' }));
  const versions = podVersions();
  return plist.PreferenceSpecifiers.filter((s) => s.Title && s.License && s.FooterText).map((s) => ({
    name: s.Title,
    version: versions[s.Title],
    license: POD_LICENSE[s.Title] ?? LICENSE_NAMES[s.License] ?? s.License,
    text: cleanText(s.FooterText),
    platforms: ['macos'],
  }));
}

function extraNotice({ group, notice, file, ...rest }) {
  const body = cleanText(readFileSync(join(ROOT, file), 'utf8'));
  return { group, ...rest, text: notice ? `${notice}\n\n${body}` : body };
}

async function build() {
  const notices = [
    ...EXTRAS.map(extraNotice),
    ...(await javascriptNotices()).map((n) => ({ group: 'JavaScript', ...n })),
    ...podNotices().map((n) => ({ group: 'Native libraries', ...n })),
  ];
  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || (a.version ?? '').localeCompare(b.version ?? '');
  const groups = GROUP_ORDER.map((title) => ({
    title,
    notices: notices
      .filter((n) => n.group === title)
      .map(({ group, ...n }) => n)
      .sort(byName),
  }));
  return `${JSON.stringify({ generatedBy: 'scripts/acknowledgements.mjs', groups }, null, 2)}\n`;
}

const label = (n) => `${n.name}${n.version ? ` ${n.version}` : ''}`;

function describeChanges(before, after) {
  const flat = (json) => {
    const m = new Map();
    for (const g of JSON.parse(json).groups) for (const n of g.notices) m.set(label(n), JSON.stringify(n));
    return m;
  };
  const a = flat(before);
  const b = flat(after);
  const lines = [];
  for (const k of b.keys()) if (!a.has(k)) lines.push(`  + ${k}`);
  for (const k of a.keys()) if (!b.has(k)) lines.push(`  - ${k}`);
  for (const [k, v] of b) if (a.has(k) && a.get(k) !== v) lines.push(`  ~ ${k}`);
  return lines.join('\n');
}

const check = process.argv.includes('--check');
const next = await build();
const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;

if (check) {
  if (current === next) {
    console.log('acknowledgements: up to date');
  } else {
    console.error(`acknowledgements: ${relative(ROOT, OUT)} is out of date. Run node scripts/acknowledgements.mjs and commit it.`);
    if (current) console.error(describeChanges(current, next));
    process.exit(1);
  }
} else {
  writeFileSync(OUT, next);
  const count = JSON.parse(next).groups.reduce((sum, g) => sum + g.notices.length, 0);
  console.log(`acknowledgements: wrote ${count} notices to ${relative(ROOT, OUT)}`);
}
