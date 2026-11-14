#!/bin/sh
# Re-signs the helpers inside the embedded Sparkle.framework with the app's own identity.
# Sparkle ships them ad-hoc signed; notarization needs every executable signed with the Developer ID
# certificate, the hardened runtime and a secure timestamp. CocoaPods' embed phase only signs the
# framework's top level, so this runs after it (and before Xcode signs the app itself).
#
# LarpLess isn't sandboxed, so Sparkle's XPC services (only for sandboxed apps) are removed.
set -eu

FW="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}/Sparkle.framework"
if [ ! -d "${FW}" ]; then
  echo "error: Sparkle.framework isn't embedded at ${FW} (run pod install)" >&2
  exit 1
fi
V="${FW}/Versions/B"

rm -rf "${V}/XPCServices" "${FW}/XPCServices"

SIGN="${EXPANDED_CODE_SIGN_IDENTITY:-}"
if [ -z "${SIGN}" ] || [ "${SIGN}" = "-" ]; then
  SIGN="-"
fi

TIMESTAMP="--timestamp=none"
case "${EXPANDED_CODE_SIGN_IDENTITY_NAME:-}" in
  "Developer ID Application"*) TIMESTAMP="--timestamp" ;;
esac

codesign --force --sign "${SIGN}" "${TIMESTAMP}" --options runtime "${V}/Autoupdate"
codesign --force --sign "${SIGN}" "${TIMESTAMP}" --options runtime "${V}/Updater.app"
codesign --force --sign "${SIGN}" "${TIMESTAMP}" --options runtime "${FW}"
