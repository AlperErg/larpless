#!/bin/bash
# Builds LarpLess-<version>.dmg for testers: a Release build signed with the Developer ID certificate,
# in a signed disk image that Apple has notarized, with the ticket stapled so Gatekeeper opens it.
#
#   scripts/release-mac.sh                 build, sign, notarize and staple
#   scripts/release-mac.sh --no-notarize   build and sign only (to check the build; Gatekeeper will refuse it)
#
# Output: macos/build/release/LarpLess-<version>.dmg (gitignored). The version comes from package.json.
#
# Notarization needs a notarytool profile in your keychain, created once (it asks for an app-specific
# password, made at account.apple.com → Sign-In and Security → App-Specific Passwords):
#   xcrun notarytool store-credentials larpless-notary --apple-id <your Apple ID> --team-id P74N9B6V54
# Set NOTARY_PROFILE to use a profile with another name.
set -euo pipefail

cd "$(dirname "$0")/.."
export LANG=en_US.UTF-8   # CocoaPods' scripts in the build need it

TEAM=P74N9B6V54
PROFILE="${NOTARY_PROFILE:-larpless-notary}"
NOTARIZE=1
[ "${1:-}" = "--no-notarize" ] && NOTARIZE=0

VERSION=$(node -p "require('./package.json').version")
OUT=macos/build/release
DERIVED="$OUT/DerivedData"
APP="$DERIVED/Build/Products/Release/LarpLess.app"
DMG="$OUT/LarpLess-$VERSION.dmg"

step() { printf '\n==> %s\n' "$1"; }
fail() { printf 'release-mac: %s\n' "$1" >&2; exit 1; }

# The certificate, by hash: several "Developer ID Application" identities can exist on one Mac.
IDENTITY=$(security find-identity -v -p codesigning | awk -v team="($TEAM)" '/Developer ID Application/ && index($0, team) { print $2; exit }')
[ -n "$IDENTITY" ] || fail "no Developer ID Application certificate for team $TEAM in the keychain."

if [ "$NOTARIZE" = 1 ] && ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  fail "no notarytool profile '$PROFILE'. Create it once with:
  xcrun notarytool store-credentials $PROFILE --apple-id <your Apple ID> --team-id $TEAM
or run with --no-notarize to only build and sign."
fi

if grep -q "HOSTED_SUPABASE: { url: ''" src/config.ts; then
  echo "note: HOSTED_SUPABASE is empty, so Friends in this build works only with 'Use your own server'."
fi

step "Building LarpLess $VERSION (Release)"
rm -rf "$OUT"
mkdir -p "$OUT"
if ! xcodebuild -workspace macos/Focusline.xcworkspace -scheme Focusline-macOS -configuration Release \
  -derivedDataPath "$DERIVED" build >"$OUT/xcodebuild.log" 2>&1; then
  grep -E "error:|\*\* BUILD FAILED" "$OUT/xcodebuild.log" | tail -20 >&2 || true
  fail "the Release build failed. Full log: $OUT/xcodebuild.log"
fi

step "Checking the app"
built=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")
[ "$built" = "$VERSION" ] || fail "the app says version $built, package.json says $VERSION."
codesign --verify --deep --strict "$APP" || fail "the app's signature doesn't verify."
details=$(codesign -dv --verbose=2 "$APP" 2>&1)
grep -q "Authority=Developer ID Application" <<<"$details" || fail "the app isn't signed with a Developer ID certificate."
grep -q "runtime" <<<"$details" || fail "the app doesn't use the hardened runtime, which notarization requires."
grep -q "Timestamp=" <<<"$details" || fail "the app's signature has no secure timestamp, which notarization requires."
echo "signed by $(grep -m1 'Authority=Developer ID' <<<"$details" | cut -d= -f2), hardened runtime, timestamped"

step "Making the disk image"
STAGE="$OUT/dmg"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/LarpLess.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "LarpLess $VERSION" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null
rm -rf "$STAGE"
codesign --force --sign "$IDENTITY" --timestamp "$DMG"
codesign --verify "$DMG"

if [ "$NOTARIZE" = 0 ]; then
  step "Done (not notarized)"
  echo "$DMG"
  echo "Gatekeeper will refuse this image until it's notarized: run without --no-notarize."
  exit 0
fi

step "Notarizing (usually a few minutes)"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait --output-format json >"$OUT/notary.json" \
  || fail "the submission failed. Response: $OUT/notary.json"
status=$(node -p "require('./$OUT/notary.json').status")
id=$(node -p "require('./$OUT/notary.json').id")
if [ "$status" != "Accepted" ]; then
  xcrun notarytool log "$id" --keychain-profile "$PROFILE" "$OUT/notary-log.json" >/dev/null 2>&1 || true
  fail "Apple returned '$status'. Its log explains why: $OUT/notary-log.json"
fi

step "Stapling the ticket"
xcrun stapler staple "$DMG" >/dev/null
xcrun stapler validate "$DMG" >/dev/null
spctl --assess --type open --context context:primary-signature "$DMG" || fail "Gatekeeper still rejects the image."

step "Done"
echo "$DMG"
shasum -a 256 "$DMG"
