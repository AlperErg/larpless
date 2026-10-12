// FLKeychain: the twin of Native/Keychain/FLKeychain.swift (KeychainApi).
// Windows has no per-app Keychain, so each item is a DPAPI-encrypted file (current-user scope) under
// %LOCALAPPDATA%\LarpLess\Secrets, named by the hex of its key. That keeps the Supabase session out of
// AsyncStorage's plain JSON and unreadable from a copied disk or backup. Values are never logged.
#pragma once

#include <NativeModules.h>

#include <wincrypt.h>
#include <dpapi.h>
#include <shlobj.h>

#include <optional>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "crypt32.lib")

namespace LarpLess {

namespace Keychain {

inline std::wstring Dir() {
  PWSTR base{nullptr};
  std::wstring dir;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &base))) {
    dir = std::wstring{base} + L"\\LarpLess\\Secrets";
  }
  CoTaskMemFree(base);
  return dir;
}

// Empty when %LOCALAPPDATA% can't be found.
inline std::wstring PathFor(std::string const &key) {
  static constexpr wchar_t kHex[] = L"0123456789abcdef";
  const std::wstring dir{Dir()};
  if (dir.empty()) return {};
  std::wstring name;
  for (const unsigned char c : key) {
    name += kHex[c >> 4];
    name += kHex[c & 15];
  }
  return dir + L"\\" + name + L".bin";
}

// nullopt when the file doesn't exist; an empty vector with `failed` set on a read error.
inline std::optional<std::vector<BYTE>> ReadAll(std::wstring const &path, bool &failed) {
  const HANDLE file{CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                FILE_ATTRIBUTE_NORMAL, nullptr)};
  if (file == INVALID_HANDLE_VALUE) {
    const DWORD error{GetLastError()};
    if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND) failed = true;
    return std::nullopt;
  }
  std::vector<BYTE> data;
  LARGE_INTEGER size{};
  if (!GetFileSizeEx(file, &size) || size.QuadPart > 1 << 20) {
    failed = true;
  } else {
    data.resize(static_cast<size_t>(size.QuadPart));
    DWORD read{0};
    if (!data.empty() && (!ReadFile(file, data.data(), static_cast<DWORD>(data.size()), &read, nullptr) ||
                          read != data.size())) {
      failed = true;
    }
  }
  CloseHandle(file);
  return data;
}

// Writes a temp file and moves it over the old one, so a crash never leaves half a value.
inline bool WriteAll(std::wstring const &path, BYTE const *data, DWORD size) {
  const std::wstring dir{Dir()};
  if (dir.empty()) return false;
  const int made{SHCreateDirectoryExW(nullptr, dir.c_str(), nullptr)};
  if (made != ERROR_SUCCESS && made != ERROR_ALREADY_EXISTS && made != ERROR_FILE_EXISTS) return false;
  const std::wstring temp{path + L".tmp"};
  const HANDLE file{CreateFileW(temp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL,
                                nullptr)};
  if (file == INVALID_HANDLE_VALUE) return false;
  DWORD written{0};
  const bool ok{WriteFile(file, data, size, &written, nullptr) && written == size};
  CloseHandle(file);
  if (!ok || !MoveFileExW(temp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING)) {
    DeleteFileW(temp.c_str());
    return false;
  }
  return true;
}

} // namespace Keychain

REACT_MODULE(FLKeychain)
struct FLKeychain {
  using JSValue = winrt::Microsoft::ReactNative::JSValue;
  using ReactError = winrt::Microsoft::ReactNative::ReactError;
  template <typename T>
  using ReactPromise = winrt::Microsoft::ReactNative::ReactPromise<T>;

  // Resolves the value, or null when there is no such item.
  REACT_METHOD(GetItem, L"getItem")
  void GetItem(std::string &&key, ReactPromise<JSValue> &&result) noexcept {
    std::thread([key = std::move(key), result = std::move(result)]() mutable noexcept {
      const std::wstring path{Keychain::PathFor(key)};
      bool failed{path.empty()};
      const auto data{failed ? std::nullopt : Keychain::ReadAll(path, failed)};
      if (failed) {
        result.Reject(ReactError{"E_KEYCHAIN", "couldn't read the item", {}});
        return;
      }
      if (!data) {
        result.Resolve(JSValue{nullptr});
        return;
      }
      DATA_BLOB in{static_cast<DWORD>(data->size()), const_cast<BYTE *>(data->data())};
      DATA_BLOB out{};
      if (!CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &out)) {
        result.Reject(ReactError{"E_KEYCHAIN", "couldn't decrypt the item", {}});
        return;
      }
      std::string value{reinterpret_cast<char const *>(out.pbData), out.cbData};
      SecureZeroMemory(out.pbData, out.cbData);
      LocalFree(out.pbData);
      result.Resolve(JSValue{std::move(value)});
    }).detach();
  }

  REACT_METHOD(SetItem, L"setItem")
  void SetItem(std::string &&key, std::string &&value, ReactPromise<void> &&result) noexcept {
    std::thread([key = std::move(key), value = std::move(value), result = std::move(result)]() mutable noexcept {
      const std::wstring path{Keychain::PathFor(key)};
      DATA_BLOB in{static_cast<DWORD>(value.size()), reinterpret_cast<BYTE *>(value.data())};
      DATA_BLOB out{};
      if (path.empty() ||
          !CryptProtectData(&in, L"LarpLess", nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &out)) {
        result.Reject(ReactError{"E_KEYCHAIN", "couldn't encrypt the item", {}});
        return;
      }
      const bool ok{Keychain::WriteAll(path, out.pbData, out.cbData)};
      LocalFree(out.pbData);
      SecureZeroMemory(value.data(), value.size());
      if (ok) {
        result.Resolve();
      } else {
        result.Reject(ReactError{"E_KEYCHAIN", "couldn't write the item", {}});
      }
    }).detach();
  }

  // No-op when there is no such item.
  REACT_METHOD(RemoveItem, L"removeItem")
  void RemoveItem(std::string &&key, ReactPromise<void> &&result) noexcept {
    std::thread([key = std::move(key), result = std::move(result)]() mutable noexcept {
      const std::wstring path{Keychain::PathFor(key)};
      if (path.empty()) {
        result.Reject(ReactError{"E_KEYCHAIN", "couldn't find the item folder", {}});
        return;
      }
      if (DeleteFileW(path.c_str()) || GetLastError() == ERROR_FILE_NOT_FOUND ||
          GetLastError() == ERROR_PATH_NOT_FOUND) {
        result.Resolve();
      } else {
        result.Reject(ReactError{"E_KEYCHAIN", "couldn't remove the item", {}});
      }
    }).detach();
  }
};

} // namespace LarpLess
