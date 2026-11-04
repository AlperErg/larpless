/**
 * One version everywhere: package.json (shown in Settings → About and sent with feedback), the Mac
 * app (MARKETING_VERSION in the Xcode project, read by Info.plist) and the Windows package manifest.
 * The Xcode project is committed and none of the build scripts rewrite it, so a rebuild keeps it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_VERSION } from '../../src/ui/lib/links';

const root = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const pkg = JSON.parse(read('package.json')) as { version: string };

describe('app version', () => {
  it('is a plain x.y.z', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('the Mac app uses it for every build configuration', () => {
    const project = read('macos/Focusline.xcodeproj/project.pbxproj');
    const versions = [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set([pkg.version]));
    expect(read('macos/Focusline-macOS/Info.plist')).toMatch(/<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/);
  });

  it('the Windows package uses it, with the fourth part 0', () => {
    const manifest = read('windows/LarpLess.Package/Package.appxmanifest');
    expect(manifest).toMatch(new RegExp(`<Identity[^>]*Version="${pkg.version.replace(/\./g, '\\.')}\\.0"`));
  });
});
