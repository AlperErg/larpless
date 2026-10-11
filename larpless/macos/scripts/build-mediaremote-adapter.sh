#!/bin/sh
# Builds MediaRemoteAdapter.framework and copies it, plus the perl launcher,
# into the app Resources. /usr/bin/perl loads the framework; a Developer ID app
# cannot call MediaRemote itself since macOS 15.4.
set -eu

ROOT="${SRCROOT}/vendor/mediaremote-adapter"
OUT="${DERIVED_FILE_DIR}/mediaremote-adapter"
DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"

if ! command -v cmake >/dev/null 2>&1; then
  echo "error: cmake is required to build MediaRemoteAdapter.framework (brew install cmake)" >&2
  exit 1
fi

ARCH_LIST="$(printf '%s' "${ARCHS:-arm64}" | tr ' ' ';')"

cmake -S "${ROOT}" -B "${OUT}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="${ARCH_LIST}" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-14.0}"
cmake --build "${OUT}" --target MediaRemoteAdapter --config Release

FW="$(find "${OUT}" -type d -name MediaRemoteAdapter.framework | head -1)"
if [ -z "${FW}" ]; then
  echo "error: MediaRemoteAdapter.framework was not produced" >&2
  exit 1
fi

mkdir -p "${DEST}"
rm -rf "${DEST}/MediaRemoteAdapter.framework"
cp -R "${FW}" "${DEST}/MediaRemoteAdapter.framework"
cp "${ROOT}/bin/mediaremote-adapter.pl" "${DEST}/mediaremote-adapter.pl"
chmod +x "${DEST}/mediaremote-adapter.pl"

SIGN="${EXPANDED_CODE_SIGN_IDENTITY:-}"
if [ -z "${SIGN}" ] || [ "${SIGN}" = "-" ]; then
  SIGN="-"
fi
codesign --force --sign "${SIGN}" --timestamp=none "${DEST}/MediaRemoteAdapter.framework"
