/**
 * react-native-svg's Windows vcxproj pins SDK 10.0 (→ latest kit) and UAP globals before UseFabric is set.
 * Patched on every npm ci so LarpLess (10.0.22621 Composition) can reference RNSVG.winmd.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vcxproj = join(root, 'node_modules', 'react-native-svg', 'windows', 'RNSVG', 'RNSVG.vcxproj');

let text;
try {
  text = readFileSync(vcxproj, 'utf8');
} catch {
  process.exit(0);
}

const sdk = '10.0.22621.0';
let next = text.replace(
  /<WindowsTargetPlatformVersion>10\.0<\/WindowsTargetPlatformVersion>/g,
  `<WindowsTargetPlatformVersion>${sdk}</WindowsTargetPlatformVersion>`,
);
next = next.replace(
  /<WindowsTargetPlatformVersion>10\.0\.0\.0<\/WindowsTargetPlatformVersion>/g,
  `<WindowsTargetPlatformVersion>${sdk}</WindowsTargetPlatformVersion>`,
);

if (next !== text) {
  writeFileSync(vcxproj, next);
  console.log('patch-rnsvg-windows: pinned WindowsTargetPlatformVersion to', sdk);
}
