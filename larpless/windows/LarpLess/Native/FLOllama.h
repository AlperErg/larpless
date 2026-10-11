// FLOllama: the twin of Native/Ollama/FLOllama.swift (OllamaHostApi).
// Finds, opens and restarts Ollama so it runs without llama.cpp's RAM prompt cache. Ollama >= 0.30 runs models in
// llama-server, which keeps up to 8 GiB of old prompts in RAM (~340 MB per LarpLess screenshot, never reused). The
// only switch is LLAMA_ARG_CACHE_RAM=0 in Ollama's environment when it starts, so LarpLess opens Ollama itself.
// On Windows the tray app (%LOCALAPPDATA%\Programs\Ollama\ollama app.exe) spawns `ollama.exe serve`, which spawns
// the llama-server runners; all of them inherit the tray app's environment.
//
// LarpLess is a packaged (MSIX) full-trust app: a direct child would inherit its package identity (AppData
// virtualization, killed on redeploy), so Ollama is started through cmd.exe `start` with the desktop-app breakaway
// policy, which puts cmd's children outside the package.
//
// Process environments are read (PEB) only to look up LLAMA_ARG_CACHE_RAM and to carry a user's OLLAMA_/LLAMA_ and
// proxy settings across a restart. Values are never logged or sent to JS.
#pragma once

#include <NativeModules.h>

// winsock2 + ws2ipdef before iphlpapi: the IPv6 owner-pid TCP table is only declared with _WS2IPDEF_.
#include <winsock2.h>
#include <ws2ipdef.h>
#include <iphlpapi.h>

#include <appmodel.h>
#include <shlobj.h>
#include <tlhelp32.h>
#include <userenv.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <iterator>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "userenv.lib")

// WinBase.h only defines these for NTDDI_WIN10_RS2+.
#ifndef PROCESS_CREATION_DESKTOP_APP_BREAKAWAY_ENABLE_PROCESS_TREE
#define PROCESS_CREATION_DESKTOP_APP_BREAKAWAY_ENABLE_PROCESS_TREE 0x01
#endif
#ifndef PROC_THREAD_ATTRIBUTE_DESKTOP_APP_POLICY
#define PROC_THREAD_ATTRIBUTE_DESKTOP_APP_POLICY ProcThreadAttributeValue(18, FALSE, TRUE, FALSE)
#endif

namespace LarpLess {

namespace OllamaHost {

constexpr wchar_t kAppExe[]{L"ollama app.exe"};
constexpr wchar_t kCliExe[]{L"ollama.exe"};
constexpr wchar_t kCacheVar[]{L"LLAMA_ARG_CACHE_RAM"};
constexpr unsigned kPort{11434};
constexpr size_t kMaxEnvBytes{1024 * 1024};

using EnvList = std::vector<std::wstring>; // "NAME=value" entries

struct Proc {
  DWORD pid{0};
  DWORD parent{0};
  std::wstring exe;
};

struct Server {
  DWORD pid{0};
  bool fromApp{false};
};

struct Failure {
  char const *code;
  char const *message;
};
using Outcome = std::optional<Failure>; // nullopt = success

// Set once LarpLess has opened Ollama in this process lifetime (that instance runs with the cache off).
inline std::atomic<bool> g_launchedByUs{false};
// launch() / restart() never overlap; g_completed counts the ones that succeeded.
inline std::mutex g_busy;
inline std::atomic<uint64_t> g_completed{0};

// Statuses, pids and counts only: never environment values.
inline void Log(std::string const &message) {
  const std::string line{"[FLOllama] " + message + "\n"};
  OutputDebugStringA(line.c_str());
}

inline bool IEquals(std::wstring_view a, std::wstring_view b) {
  if (a.size() != b.size()) return false;
  if (a.empty()) return true;
  return CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(), static_cast<int>(b.size()), TRUE) ==
         CSTR_EQUAL;
}

inline bool IStartsWith(std::wstring_view s, std::wstring_view prefix) {
  return s.size() >= prefix.size() && IEquals(s.substr(0, prefix.size()), prefix);
}

inline bool FileExists(std::wstring const &path) {
  const DWORD attributes{GetFileAttributesW(path.c_str())};
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

inline std::wstring Join(std::wstring dir, wchar_t const *name) {
  if (!dir.empty() && dir.back() != L'\\' && dir.back() != L'/') dir += L'\\';
  return dir + name;
}

inline bool HasOllama(std::wstring const &dir) {
  return !dir.empty() && (FileExists(Join(dir, kAppExe)) || FileExists(Join(dir, kCliExe)));
}

// --- install location ---

inline std::wstring RegString(HKEY root, wchar_t const *subkey, wchar_t const *value) {
  DWORD bytes{0};
  if (RegGetValueW(root, subkey, value, RRF_RT_REG_SZ, nullptr, nullptr, &bytes) != ERROR_SUCCESS ||
      bytes < sizeof(wchar_t)) {
    return {};
  }
  std::wstring text(bytes / sizeof(wchar_t), L'\0');
  if (RegGetValueW(root, subkey, value, RRF_RT_REG_SZ, nullptr, text.data(), &bytes) != ERROR_SUCCESS) return {};
  text.resize(wcsnlen(text.c_str(), text.size()));
  return text;
}

// InstallLocation of an HKCU uninstall entry whose DisplayName starts with "Ollama".
inline std::wstring UninstallLocation() {
  HKEY root{nullptr};
  if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", 0, KEY_READ,
                    &root) != ERROR_SUCCESS) {
    return {};
  }
  std::wstring found;
  for (DWORD key = 0; key < 4096; ++key) {
    wchar_t name[256]{};
    DWORD nameLength = ARRAYSIZE(name);
    const LSTATUS status{RegEnumKeyExW(root, key, name, &nameLength, nullptr, nullptr, nullptr, nullptr)};
    if (status == ERROR_NO_MORE_ITEMS) break;
    if (status != ERROR_SUCCESS) continue;
    if (!IStartsWith(RegString(root, name, L"DisplayName"), L"Ollama")) continue;
    const std::wstring location{RegString(root, name, L"InstallLocation")};
    if (HasOllama(location)) {
      found = location;
      break;
    }
  }
  RegCloseKey(root);
  return found;
}

// %LOCALAPPDATA%\Programs\Ollama (FOLDERID_UserProgramFiles), else the uninstall entry's InstallLocation.
inline std::wstring InstallDir() {
  static constexpr GUID kUserProgramFiles{0x5cd7aee2, 0x2219, 0x4a67, {0xb8, 0x5d, 0x6c, 0x9c, 0xe1, 0x56, 0x60, 0xcb}};
  PWSTR folder{nullptr};
  const HRESULT hr{SHGetKnownFolderPath(kUserProgramFiles, 0, nullptr, &folder)};
  std::wstring dir;
  if (SUCCEEDED(hr) && folder) dir = Join(folder, L"Ollama");
  CoTaskMemFree(folder); // required whether or not the call succeeded
  if (HasOllama(dir)) return dir;
  if (std::wstring location{UninstallLocation()}; !location.empty()) return location;
  return dir;
}

// --- processes ---

inline std::vector<Proc> Processes() {
  std::vector<Proc> out;
  const winrt::file_handle snapshot{CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)};
  if (!snapshot) return out;
  PROCESSENTRY32W entry{};
  entry.dwSize = static_cast<DWORD>(sizeof(entry));
  for (BOOL ok = Process32FirstW(snapshot.get(), &entry); ok; ok = Process32NextW(snapshot.get(), &entry)) {
    Proc proc;
    proc.pid = entry.th32ProcessID;
    proc.parent = entry.th32ParentProcessID;
    proc.exe = entry.szExeFile;
    out.push_back(std::move(proc));
  }
  return out;
}

inline bool IsApp(Proc const &proc) {
  return IEquals(proc.exe, kAppExe);
}

inline std::optional<ULONGLONG> CreatedAt(HANDLE process) {
  FILETIME created{}, exited{}, kernel{}, user{};
  if (!process || !GetProcessTimes(process, &created, &exited, &kernel, &user)) return std::nullopt;
  return (static_cast<ULONGLONG>(created.dwHighDateTime) << 32) | created.dwLowDateTime;
}

inline std::optional<ULONGLONG> CreatedAtPid(DWORD pid) {
  const winrt::handle process{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)};
  if (!process) return std::nullopt;
  return CreatedAt(process.get());
}

// True when `child`'s parent is a running `ollama app.exe` that is older than the child (guards pid reuse).
inline bool IsAppChild(std::vector<Proc> const &procs, Proc const &child) {
  for (auto const &candidate : procs) {
    if (candidate.pid != child.parent || !IsApp(candidate)) continue;
    const auto parentAt{CreatedAtPid(candidate.pid)};
    const auto childAt{CreatedAtPid(child.pid)};
    return !parentAt || !childAt || *parentAt <= *childAt;
  }
  return false;
}

inline unsigned PortOf(DWORD networkOrder) {
  return ((networkOrder & 0xFFu) << 8) | ((networkOrder >> 8) & 0xFFu);
}

// The pid that owns the LISTENING TCP socket on 11434 (IPv4 or IPv6), if any.
inline std::optional<DWORD> ListenerPid() {
  for (const ULONG family : {static_cast<ULONG>(AF_INET), static_cast<ULONG>(AF_INET6)}) {
    DWORD size{0};
    std::vector<BYTE> buffer;
    DWORD status{ERROR_INSUFFICIENT_BUFFER};
    for (int attempt = 0; attempt < 5 && status == ERROR_INSUFFICIENT_BUFFER; ++attempt) {
      buffer.resize(size);
      status = GetExtendedTcpTable(buffer.empty() ? nullptr : buffer.data(), &size, FALSE, family,
                                   TCP_TABLE_OWNER_PID_LISTENER, 0);
    }
    if (status != NO_ERROR || buffer.empty()) continue;
    if (family == static_cast<ULONG>(AF_INET)) {
      auto const *table{reinterpret_cast<MIB_TCPTABLE_OWNER_PID const *>(buffer.data())};
      for (DWORD i = 0; i < table->dwNumEntries; ++i) {
        if (PortOf(table->table[i].dwLocalPort) == kPort && table->table[i].dwOwningPid != 0) {
          return table->table[i].dwOwningPid;
        }
      }
    } else {
      auto const *table{reinterpret_cast<MIB_TCP6TABLE_OWNER_PID const *>(buffer.data())};
      for (DWORD i = 0; i < table->dwNumEntries; ++i) {
        if (PortOf(table->table[i].dwLocalPort) == kPort && table->table[i].dwOwningPid != 0) {
          return table->table[i].dwOwningPid;
        }
      }
    }
  }
  return std::nullopt;
}

// Who serves 11434: Ollama's tray app ('app') or anything else ('other').
inline std::optional<Server> FindServer(std::vector<Proc> const &procs) {
  const auto listener{ListenerPid()};
  if (!listener) return std::nullopt;
  Server server;
  server.pid = *listener;
  for (auto const &proc : procs) {
    if (proc.pid == *listener) {
      server.fromApp = IsAppChild(procs, proc);
      break;
    }
  }
  return server;
}

// --- environments ---

inline std::wstring_view EnvName(std::wstring_view entry) {
  const size_t eq{entry.find(L'=', 1)}; // hidden "=C:=C:\..." entries start with '='
  return eq == std::wstring_view::npos ? entry : entry.substr(0, eq);
}

// Complete NUL-terminated entries up to the empty string that ends a block.
inline EnvList ParseEnvironment(wchar_t const *data, size_t count) {
  EnvList out;
  size_t start{0};
  for (size_t i = 0; i < count; ++i) {
    if (data[i] != L'\0') continue;
    if (i == start) break;
    out.emplace_back(data + start, i - start);
    start = i + 1;
  }
  return out;
}

inline EnvList ParseBlock(wchar_t const *block) {
  if (!block) return {};
  size_t count{0};
  while (block[count] != L'\0' || block[count + 1] != L'\0') ++count;
  return ParseEnvironment(block, count + 2);
}

inline std::optional<std::wstring> EnvValue(EnvList const &env, std::wstring_view name) {
  for (auto const &entry : env) {
    const std::wstring_view key{EnvName(entry)};
    if (key.size() < entry.size() && IEquals(key, name)) return entry.substr(key.size() + 1);
  }
  return std::nullopt;
}

inline void SetVar(EnvList &env, std::wstring_view name, std::wstring_view value) {
  env.erase(std::remove_if(env.begin(), env.end(), [name](std::wstring const &entry) { return IEquals(EnvName(entry), name); }),
            env.end());
  std::wstring entry{name};
  entry += L'=';
  entry += value;
  env.push_back(std::move(entry));
}

inline void SetEntry(EnvList &env, std::wstring const &entry) {
  const std::wstring_view name{EnvName(entry)};
  if (name.size() >= entry.size()) return;
  SetVar(env, name, std::wstring_view{entry}.substr(name.size() + 1));
}

inline bool ReadRemote(HANDLE process, ULONG_PTR address, void *out, SIZE_T size) {
  SIZE_T copied{0};
  return ReadProcessMemory(process, reinterpret_cast<LPCVOID>(address), out, size, &copied) && copied == size;
}

// Another process's environment via its PEB (x64 / ARM64 layout); nullopt when it can't be read.
inline std::optional<EnvList> ProcessEnvironment(DWORD pid) {
#if defined(_WIN64)
  using QueryFn = LONG(NTAPI *)(HANDLE, ULONG, PVOID, ULONG, PULONG);
  static const QueryFn query{[]() -> QueryFn {
    const HMODULE ntdll{GetModuleHandleW(L"ntdll.dll")};
    return ntdll ? reinterpret_cast<QueryFn>(GetProcAddress(ntdll, "NtQueryInformationProcess")) : nullptr;
  }()};
  if (!query) return std::nullopt;
  const winrt::handle process{OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid)};
  if (!process) return std::nullopt;

  struct BasicInfo { // PROCESS_BASIC_INFORMATION
    PVOID reserved1;
    PVOID peb;
    PVOID reserved2[2];
    ULONG_PTR uniqueProcessId;
    PVOID reserved3;
  } info{};
  ULONG length{0};
  if (query(process.get(), 0 /* ProcessBasicInformation */, &info, static_cast<ULONG>(sizeof(info)), &length) < 0 ||
      !info.peb) {
    return std::nullopt;
  }
  // PEB.ProcessParameters @ 0x20; RTL_USER_PROCESS_PARAMETERS.Environment @ 0x80, EnvironmentSize @ 0x3F0.
  ULONG_PTR params{0}, envAddress{0}, envSize{0};
  if (!ReadRemote(process.get(), reinterpret_cast<ULONG_PTR>(info.peb) + 0x20, &params, sizeof(params)) || !params ||
      !ReadRemote(process.get(), params + 0x80, &envAddress, sizeof(envAddress)) || !envAddress) {
    return std::nullopt;
  }
  if (!ReadRemote(process.get(), params + 0x3F0, &envSize, sizeof(envSize))) envSize = 0;

  std::vector<wchar_t> block;
  if (envSize >= 2 * sizeof(wchar_t) && envSize <= kMaxEnvBytes) {
    block.resize(envSize / sizeof(wchar_t));
    if (!ReadRemote(process.get(), envAddress, block.data(), block.size() * sizeof(wchar_t))) block.clear();
  }
  if (block.empty()) {
    // Unknown size: read up to each page end until the block's double NUL (never straddles an unmapped page).
    constexpr ULONG_PTR kPage{4096};
    ULONG_PTR at{envAddress};
    while (block.size() * sizeof(wchar_t) < kMaxEnvBytes) {
      const size_t chars{static_cast<size_t>((kPage - (at % kPage)) / sizeof(wchar_t))};
      if (chars == 0) break;
      std::vector<wchar_t> part(chars);
      if (!ReadRemote(process.get(), at, part.data(), chars * sizeof(wchar_t))) break;
      block.insert(block.end(), part.begin(), part.end());
      at += chars * sizeof(wchar_t);
      bool ended{false};
      for (size_t i = 1; i < block.size(); ++i) {
        if (block[i] == L'\0' && block[i - 1] == L'\0') {
          ended = true;
          break;
        }
      }
      if (ended) break;
    }
    if (block.empty()) return std::nullopt;
  }
  return ParseEnvironment(block.data(), block.size());
#else
  (void)pid;
  return std::nullopt;
#endif
}

// llama.cpp reads LLAMA_ARG_CACHE_RAM as MiB: unset means its 8 GiB default, 0 turns the cache off
// (same mapping as promptCache() in FLOllama.swift).
inline char const *PromptCache(std::optional<std::wstring> const &value) {
  if (!value) return "default";
  std::wstring_view v{*value};
  while (!v.empty() && (v.front() == L' ' || v.front() == L'\t')) v.remove_prefix(1);
  while (!v.empty() && (v.back() == L' ' || v.back() == L'\t')) v.remove_suffix(1);
  if (v.empty()) return "default";
  size_t i{0};
  if (v[0] == L'+' || v[0] == L'-') i = 1;
  if (i == v.size()) return "custom";
  bool zero{true};
  for (; i < v.size(); ++i) {
    if (v[i] < L'0' || v[i] > L'9') return "custom";
    if (v[i] != L'0') zero = false;
  }
  return zero ? "off" : "custom";
}

// The user's fresh environment (user + system variables, as a new Explorer launch would get), falling back to
// LarpLess's own.
inline EnvList FreshEnvironment() {
  EnvList env;
  HANDLE token{nullptr};
  if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_IMPERSONATE, &token)) {
    void *block{nullptr};
    if (CreateEnvironmentBlock(&block, token, FALSE) && block) {
      env = ParseBlock(static_cast<wchar_t const *>(block));
      DestroyEnvironmentBlock(block);
    }
    CloseHandle(token);
  }
  if (env.empty()) {
    if (wchar_t *own{GetEnvironmentStringsW()}) {
      env = ParseBlock(own);
      FreeEnvironmentStringsW(own);
    }
  }
  return env;
}

// Sorted by name (case-insensitive, ordinal), UTF-16, double-NUL terminated: the CreateProcess block format.
inline std::vector<wchar_t> EnvironmentBlock(EnvList env) {
  std::sort(env.begin(), env.end(), [](std::wstring const &a, std::wstring const &b) {
    const std::wstring_view na{EnvName(a)}, nb{EnvName(b)};
    return CompareStringOrdinal(na.data(), static_cast<int>(na.size()), nb.data(), static_cast<int>(nb.size()), TRUE) ==
           CSTR_LESS_THAN;
  });
  std::vector<wchar_t> block;
  for (auto const &entry : env) {
    block.insert(block.end(), entry.begin(), entry.end());
    block.push_back(L'\0');
  }
  if (block.empty()) block.push_back(L'\0');
  block.push_back(L'\0');
  return block;
}

// Variables a restart carries over from the running app, so the user's own settings survive it.
inline bool Kept(std::wstring_view name) {
  return IStartsWith(name, L"OLLAMA_") || IStartsWith(name, L"LLAMA_") || IEquals(name, L"HTTP_PROXY") ||
         IEquals(name, L"HTTPS_PROXY") || IEquals(name, L"NO_PROXY") || IEquals(name, L"ALL_PROXY");
}

// --- launch ---

// Best effort: confirm the new tray app runs outside LarpLess's package (logs only whether it has an identity).
inline void LogPackageIdentity() {
  for (int attempt = 0; attempt < 20; ++attempt) {
    for (auto const &proc : Processes()) {
      if (!IsApp(proc)) continue;
      const winrt::handle process{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, proc.pid)};
      if (!process) continue;
      UINT32 length{0};
      const LONG rc{GetPackageFullName(process.get(), &length, nullptr)};
      Log(rc == APPMODEL_ERROR_NO_PACKAGE ? "Ollama runs without package identity"
                                          : "WARNING: Ollama inherited a package identity (rc " + std::to_string(rc) + ")");
      return;
    }
    Sleep(100);
  }
  Log("couldn't find the new Ollama process to check its package identity");
}

// cmd.exe /d /s /c start "" "<dir>\ollama app.exe", with `env` and the breakaway policy for cmd's children.
inline bool StartApp(std::wstring const &dir, EnvList env) {
  std::vector<wchar_t> block{EnvironmentBlock(std::move(env))};
  wchar_t systemDir[MAX_PATH]{};
  const UINT systemLength{GetSystemDirectoryW(systemDir, MAX_PATH)};
  if (systemLength == 0 || systemLength >= MAX_PATH) return false;
  const std::wstring cmd{Join(systemDir, L"cmd.exe")};
  // /s strips the outermost quotes around everything after /c.
  std::wstring line{L"\"" + cmd + L"\" /d /s /c \"start \"\" \"" + Join(dir, kAppExe) + L"\"\""};

  SIZE_T attributesSize{0};
  InitializeProcThreadAttributeList(nullptr, 1, 0, &attributesSize);
  std::vector<BYTE> attributesBuffer(attributesSize);
  auto *attributes{reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributesBuffer.data())};
  const bool haveAttributes{attributesSize > 0 && InitializeProcThreadAttributeList(attributes, 1, 0, &attributesSize)};
  DWORD policy = PROCESS_CREATION_DESKTOP_APP_BREAKAWAY_ENABLE_PROCESS_TREE;
  if (haveAttributes && !UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_DESKTOP_APP_POLICY, &policy,
                                                   sizeof(policy), nullptr, nullptr)) {
    Log("desktop app breakaway policy rejected (" + std::to_string(GetLastError()) + ")");
  }

  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = static_cast<DWORD>(sizeof(startup));
  startup.lpAttributeList = haveAttributes ? attributes : nullptr;
  DWORD flags = CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT;
  if (haveAttributes) flags |= EXTENDED_STARTUPINFO_PRESENT;
  PROCESS_INFORMATION info{};
  BOOL created = CreateProcessW(cmd.c_str(), line.data(), nullptr, nullptr, FALSE, flags | CREATE_BREAKAWAY_FROM_JOB,
                                block.data(), dir.c_str(), &startup.StartupInfo, &info);
  if (!created && GetLastError() == ERROR_ACCESS_DENIED) {
    // The job LarpLess runs in doesn't allow breakaway; start inside it.
    created = CreateProcessW(cmd.c_str(), line.data(), nullptr, nullptr, FALSE, flags, block.data(), dir.c_str(),
                             &startup.StartupInfo, &info);
  }
  const DWORD createError{created ? 0 : GetLastError()};
  if (haveAttributes) DeleteProcThreadAttributeList(attributes);
  if (!created) {
    Log("CreateProcess failed (" + std::to_string(createError) + ")");
    return false;
  }
  CloseHandle(info.hThread);
  const winrt::handle shell{info.hProcess};
  if (WaitForSingleObject(shell.get(), 10000) != WAIT_OBJECT_0) {
    Log("cmd start didn't finish in 10 s");
    return false;
  }
  DWORD exitCode{1};
  GetExitCodeProcess(shell.get(), &exitCode);
  if (exitCode != 0) {
    Log("cmd start exited with " + std::to_string(exitCode));
    return false;
  }
  return true;
}

// Opens the tray app with a fresh environment + `carried` + LLAMA_ARG_CACHE_RAM=0.
inline Outcome Open(std::wstring const &dir, EnvList const &carried) {
  EnvList env{FreshEnvironment()};
  for (auto const &entry : carried) SetEntry(env, entry);
  SetVar(env, kCacheVar, L"0");
  if (!StartApp(dir, std::move(env))) return Failure{"E_LAUNCH", "Couldn't open Ollama"};
  g_launchedByUs = true;
  Log("opened Ollama with LLAMA_ARG_CACHE_RAM=0, keeping " + std::to_string(carried.size()) + " variables");
  LogPackageIdentity();
  return std::nullopt;
}

inline Outcome LaunchApp() {
  const auto procs{Processes()};
  if (std::any_of(procs.begin(), procs.end(), IsApp)) return std::nullopt; // already running: no-op, like macOS
  const std::wstring dir{InstallDir()};
  if (dir.empty() || !FileExists(Join(dir, kAppExe))) return Failure{"E_NOT_INSTALLED", "Ollama isn't installed"};
  return Open(dir, {});
}

// Terminates and waits up to 5 s. True when the process is gone.
inline bool Stop(winrt::handle const &process) {
  if (WaitForSingleObject(process.get(), 0) == WAIT_OBJECT_0) return true;
  if (!TerminateProcess(process.get(), 1) && WaitForSingleObject(process.get(), 0) != WAIT_OBJECT_0) return false;
  return WaitForSingleObject(process.get(), 5000) == WAIT_OBJECT_0;
}

// Handle to `pid` for terminating; nullptr if it's gone. Sets `denied` when it exists but can't be opened.
inline winrt::handle OpenForStop(DWORD pid, bool &denied) {
  winrt::handle process{OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)};
  if (!process && GetLastError() == ERROR_ACCESS_DENIED) denied = true;
  return process;
}

inline Outcome RestartApp() {
  const auto procs{Processes()};
  std::vector<Proc> apps;
  std::copy_if(procs.begin(), procs.end(), std::back_inserter(apps), IsApp);
  if (apps.empty()) return Failure{"E_NOT_RUNNING", "Ollama isn't running"};

  // Where the running app lives, else the install dir.
  std::wstring dir;
  {
    const winrt::handle process{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, apps.front().pid)};
    wchar_t path[MAX_PATH * 2]{};
    DWORD pathLength = ARRAYSIZE(path);
    if (process && QueryFullProcessImageNameW(process.get(), 0, path, &pathLength)) {
      const std::wstring full(path, pathLength);
      const size_t slash{full.find_last_of(L"\\/")};
      if (slash != std::wstring::npos) dir = full.substr(0, slash);
    }
  }
  if (dir.empty() || !FileExists(Join(dir, kAppExe))) dir = InstallDir();
  if (dir.empty() || !FileExists(Join(dir, kAppExe))) return Failure{"E_NOT_INSTALLED", "Ollama isn't installed"};

  EnvList carried;
  if (auto env{ProcessEnvironment(apps.front().pid)}) {
    for (auto const &entry : *env) {
      const std::wstring_view name{EnvName(entry)};
      if (name.size() < entry.size() && Kept(name) && !IEquals(name, kCacheVar)) carried.push_back(entry);
    }
  } else {
    Log("restart: couldn't read Ollama's environment; starting with the user's");
  }

  // Open every handle before terminating anything: a held handle pins the pid, so nothing is killed by mistake.
  bool denied{false};
  std::vector<winrt::handle> appHandles;
  for (auto const &app : apps) {
    if (auto process{OpenForStop(app.pid, denied)}) appHandles.push_back(std::move(process));
  }
  const auto server{FindServer(procs)};
  winrt::handle serverHandle;
  std::vector<winrt::handle> descendants;
  if (server && server->fromApp) serverHandle = OpenForStop(server->pid, denied);
  if (serverHandle) {
    // The server's whole tree (llama-server runners), by parent pid; a child must be newer than its parent.
    std::vector<std::pair<DWORD, std::optional<ULONGLONG>>> frontier{{server->pid, CreatedAt(serverHandle.get())}};
    std::vector<DWORD> seen{server->pid};
    while (!frontier.empty() && seen.size() < 256) {
      const auto [parentPid, parentAt] = frontier.back();
      frontier.pop_back();
      for (auto const &proc : procs) {
        if (proc.parent != parentPid || std::find(seen.begin(), seen.end(), proc.pid) != seen.end()) continue;
        bool childDenied{false};
        winrt::handle child{OpenForStop(proc.pid, childDenied)};
        if (!child) continue;
        const auto childAt{CreatedAt(child.get())};
        if (parentAt && childAt && *childAt < *parentAt) continue; // reused pid, not a real child
        seen.push_back(proc.pid);
        frontier.emplace_back(proc.pid, childAt);
        descendants.push_back(std::move(child));
      }
    }
  }
  if (denied) {
    Log("restart: access denied opening Ollama's processes");
    return Failure{"E_TIMEOUT", "Ollama didn't quit"};
  }
  Log("restart: stopping " + std::to_string(appHandles.size()) + " app, " + (serverHandle ? "1" : "0") + " server, " +
      std::to_string(descendants.size()) + " runner processes; keeping " + std::to_string(carried.size()) +
      " variables");

  // The app first, so it can't respawn its server; then the server; then its runners.
  for (auto const &process : appHandles) {
    if (!Stop(process)) return Failure{"E_TIMEOUT", "Ollama didn't quit"};
  }
  if (serverHandle && !Stop(serverHandle)) return Failure{"E_TIMEOUT", "Ollama's server didn't stop"};
  for (auto const &process : descendants) {
    if (!Stop(process)) return Failure{"E_TIMEOUT", "Ollama's runner didn't stop"};
  }
  // The new server can't start until the port is free.
  if (serverHandle) {
    const auto deadline{std::chrono::steady_clock::now() + std::chrono::seconds(10)};
    while (ListenerPid()) {
      if (std::chrono::steady_clock::now() >= deadline) return Failure{"E_TIMEOUT", "Ollama's port didn't close"};
      Sleep(100);
    }
  }
  return Open(dir, carried);
}

// Runs launch/restart one at a time. A caller that had to wait skips its own run when the one it waited for
// succeeded (Ollama is then running with the cache off).
template <typename Op>
Outcome Exclusive(Op &&op) {
  const uint64_t before{g_completed.load()};
  std::unique_lock lock{g_busy, std::try_to_lock};
  if (!lock.owns_lock()) {
    lock.lock();
    if (g_completed.load() != before) return std::nullopt;
  }
  Outcome outcome;
  try {
    outcome = op();
  } catch (...) {
    outcome = Failure{"E_LAUNCH", "Couldn't open Ollama"};
  }
  if (!outcome) ++g_completed;
  return outcome;
}

inline winrt::Microsoft::ReactNative::JSValueObject CurrentInfo() {
  using winrt::Microsoft::ReactNative::JSValue;
  const std::wstring dir{InstallDir()};
  const bool appInstalled{!dir.empty() && FileExists(Join(dir, kAppExe))};
  wchar_t found[MAX_PATH]{};
  const bool cliInstalled{(!dir.empty() && FileExists(Join(dir, kCliExe))) ||
                          SearchPathW(nullptr, kCliExe, nullptr, MAX_PATH, found, nullptr) > 0};
  const auto procs{Processes()};
  const bool appRunning{std::any_of(procs.begin(), procs.end(), IsApp)};
  const auto server{FindServer(procs)};
  JSValue cache{nullptr};
  if (server) {
    if (auto env{ProcessEnvironment(server->pid)}) {
      cache = JSValue{std::string{PromptCache(EnvValue(*env, kCacheVar))}};
    } else if (server->fromApp && g_launchedByUs.load()) {
      cache = JSValue{std::string{"off"}}; // can't read it, but LarpLess started this Ollama with the cache off
    }
  }
  winrt::Microsoft::ReactNative::JSValueObject obj;
  obj["appInstalled"] = appInstalled;
  obj["cliInstalled"] = cliInstalled;
  obj["appRunning"] = appRunning;
  obj["server"] = server ? JSValue{std::string{server->fromApp ? "app" : "other"}} : JSValue{nullptr};
  obj["promptCache"] = std::move(cache);
  return obj;
}

} // namespace OllamaHost

REACT_MODULE(FLOllama)
struct FLOllama {
  using JSValue = winrt::Microsoft::ReactNative::JSValue;
  using JSValueObject = winrt::Microsoft::ReactNative::JSValueObject;
  using ReactError = winrt::Microsoft::ReactNative::ReactError;
  template <typename T>
  using ReactPromise = winrt::Microsoft::ReactNative::ReactPromise<T>;

  // { appInstalled, cliInstalled, appRunning, server: 'app'|'other'|null, promptCache: 'off'|'default'|'custom'|null }
  REACT_METHOD(Info, L"info")
  void Info(ReactPromise<JSValue> &&result) noexcept {
    std::thread([result = std::move(result)]() mutable noexcept {
      JSValueObject info;
      try {
        info = OllamaHost::CurrentInfo();
      } catch (...) {
        info = JSValueObject{{"appInstalled", false}, {"cliInstalled", false}, {"appRunning", false}};
        info["server"] = JSValue{nullptr};
        info["promptCache"] = JSValue{nullptr};
      }
      result.Resolve(JSValue{std::move(info)});
    }).detach();
  }

  // Opens Ollama in the background with the prompt cache off; no-op when it's running. Rejects E_NOT_INSTALLED /
  // E_LAUNCH.
  REACT_METHOD(Launch, L"launch")
  void Launch(ReactPromise<void> &&result) noexcept {
    std::thread([result = std::move(result)]() mutable noexcept {
      Settle(result, OllamaHost::Exclusive(&OllamaHost::LaunchApp));
    }).detach();
  }

  // Quits Ollama (app, server, runners) and opens it again with the prompt cache off, keeping its OLLAMA_/LLAMA_
  // and proxy variables. Rejects E_NOT_RUNNING, E_NOT_INSTALLED, E_TIMEOUT or E_LAUNCH.
  REACT_METHOD(Restart, L"restart")
  void Restart(ReactPromise<void> &&result) noexcept {
    std::thread([result = std::move(result)]() mutable noexcept {
      Settle(result, OllamaHost::Exclusive(&OllamaHost::RestartApp));
    }).detach();
  }

 private:
  static void Settle(ReactPromise<void> &result, OllamaHost::Outcome const &outcome) noexcept {
    if (outcome) {
      result.Reject(ReactError{outcome->code, outcome->message, {}});
    } else {
      result.Resolve();
    }
  }
};

} // namespace LarpLess
