import AppKit
import Darwin
import Foundation
import os

/// Finds, opens and restarts Ollama so it runs without llama.cpp's RAM prompt cache (`OllamaHostApi`).
///
/// Ollama ≥ 0.30 runs models in llama-server, which keeps up to 8 GiB of old prompt states in RAM: one
/// ~340 MB entry per LarpLess screenshot, never reused, enough to make a 24 GB Mac swap. The only switch
/// is `LLAMA_ARG_CACHE_RAM=0` in Ollama's environment when it starts (`launchctl setenv` doesn't reach
/// it), so LarpLess opens Ollama.app with that variable itself. LaunchServices gives the new app this
/// process's environment plus `OpenConfiguration.environment`; the server and llama-server inherit it.
///
/// Process environments are read only to look up that variable and to carry a user's OLLAMA_/LLAMA_
/// settings across a restart. Values are never logged or sent to JS.
@objc(FLOllama)
final class FLOllama: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  private static let bundleId = "com.electron.ollama"
  private static let cacheVar = "LLAMA_ARG_CACHE_RAM"
  private static let cliPaths = ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"]
  /// Variables a restart carries over from the running app, so the user's own settings survive it.
  private static let keptPrefixes = ["OLLAMA_", "LLAMA_"]
  private static let keptVars: Set<String> = [
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
  ]

  // MARK: exported

  @objc func info(_ resolve: @escaping RCTPromiseResolveBlock,
                  reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      resolve(Self.currentInfo())
    }
  }

  @objc func launch(_ resolve: @escaping RCTPromiseResolveBlock,
                    reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      if Self.runningApp() != nil {
        resolve(nil)
        return
      }
      guard let url = Self.appURL() else {
        reject("E_NOT_INSTALLED", "Ollama.app isn't installed", nil)
        return
      }
      Self.open(url, env: [Self.cacheVar: "0"], resolve: resolve, reject: reject)
    }
  }

  @objc func restart(_ resolve: @escaping RCTPromiseResolveBlock,
                     reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let app = Self.runningApp() else {
        reject("E_NOT_RUNNING", "Ollama.app isn't running", nil)
        return
      }
      let appPid = app.processIdentifier
      guard let url = app.bundleURL ?? Self.appURL() else {
        reject("E_NOT_INSTALLED", "Ollama.app isn't installed", nil)
        return
      }
      let server = Self.findServer(appPid: appPid)
      var env = (Self.processArgsEnv(appPid)?.env ?? [:]).filter { key, _ in
        Self.keptVars.contains(key) || Self.keptPrefixes.contains { key.hasPrefix($0) }
      }
      env[Self.cacheVar] = "0"
      flOllamaLog("[FLOllama] restart: quitting Ollama.app pid \(appPid), keeping \(env.count - 1) variables")

      // Ollama.app (0.30) ignores the quit Apple Event that NSRunningApplication.terminate() sends, but
      // shuts down cleanly, server included, on SIGTERM. Signal this exact pid, never a name pattern.
      kill(appPid, SIGTERM)
      guard Self.waitForExit(appPid, timeout: 6) else {
        reject("E_TIMEOUT", "Ollama didn't quit", nil)
        return
      }
      // The app stops its server on quit; the new one can't start until the port is free.
      if let server, server.fromApp, !Self.waitForExit(server.pid, timeout: 5) {
        kill(server.pid, SIGTERM)
        guard Self.waitForExit(server.pid, timeout: 5) else {
          reject("E_TIMEOUT", "Ollama's server didn't stop", nil)
          return
        }
      }
      DispatchQueue.main.async {
        Self.open(url, env: env, resolve: resolve, reject: reject)
      }
    }
  }

  /// Quits Ollama.app and its server. Nothing is relaunched. No-op when Ollama isn't running.
  @objc func quit(_ resolve: @escaping RCTPromiseResolveBlock,
                  reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      if Self.quitBlocking() {
        resolve(nil)
      } else {
        reject("E_TIMEOUT", "Ollama didn't quit", nil)
      }
    }
  }

  /// SIGTERM only, for app quit, where waiting out Ollama's shutdown would hold the process open.
  @objc static func quitNow() {
    let app = runningApp()
    let server = findServer(appPid: app?.processIdentifier)
    if let app {
      kill(app.processIdentifier, SIGTERM)
    }
    if let server, app == nil || !server.fromApp {
      kill(server.pid, SIGTERM)
    }
  }

  /// Same shutdown as restart, without opening Ollama again. Signals the exact pid, never a name.
  private static func quitBlocking() -> Bool {
    guard let app = runningApp() else {
      guard let server = findServer(appPid: nil) else { return true }
      kill(server.pid, SIGTERM)
      return waitForExit(server.pid, timeout: 5)
    }
    let appPid = app.processIdentifier
    let server = findServer(appPid: appPid)
    flOllamaLog("[FLOllama] quit: signalling Ollama.app pid \(appPid)")
    kill(appPid, SIGTERM)
    guard waitForExit(appPid, timeout: 6) else { return false }
    if let server, !waitForExit(server.pid, timeout: 5) {
      kill(server.pid, SIGTERM)
      return waitForExit(server.pid, timeout: 5)
    }
    return true
  }

  // MARK: lookup

  private struct Server {
    let pid: pid_t
    let fromApp: Bool
  }

  private static func currentInfo() -> [String: Any] {
    let app = runningApp()
    let server = findServer(appPid: app?.processIdentifier)
    var cache: Any = NSNull()
    if let server, let env = processArgsEnv(server.pid)?.env {
      cache = promptCache(env[cacheVar])
    }
    return [
      "appInstalled": appURL() != nil,
      "cliInstalled": cliPaths.contains { FileManager.default.isExecutableFile(atPath: $0) },
      "appRunning": app != nil,
      "server": server.map { $0.fromApp ? "app" : "other" } ?? NSNull(),
      "promptCache": cache,
    ]
  }

  /// llama.cpp reads the variable as MiB: unset means its 8 GiB default, 0 turns the cache off.
  private static func promptCache(_ value: String?) -> String {
    guard let v = value?.trimmingCharacters(in: .whitespaces), !v.isEmpty else { return "default" }
    return Int(v) == 0 ? "off" : "custom"
  }

  private static func appURL() -> URL? {
    NSWorkspace.shared.urlsForApplications(withBundleIdentifier: bundleId)
      .first { !$0.path.contains("/.Trash/") }
  }

  private static func runningApp() -> NSRunningApplication? {
    NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first { !$0.isTerminated }
  }

  /// The `ollama serve` process, preferring the one Ollama.app started.
  private static func findServer(appPid: pid_t?) -> Server? {
    var other: Server?
    for pid in allPids() {
      guard let path = execPath(pid), (path as NSString).lastPathComponent == "ollama",
            let args = processArgsEnv(pid)?.args, args.count >= 2, args[1] == "serve" || args[1] == "start"
      else { continue }
      if let appPid, parentPid(pid) == appPid { return Server(pid: pid, fromApp: true) }
      other = other ?? Server(pid: pid, fromApp: false)
    }
    return other
  }

  // MARK: processes

  private static func allPids() -> [pid_t] {
    let count = proc_listallpids(nil, 0)
    guard count > 0 else { return [] }
    var pids = [pid_t](repeating: 0, count: Int(count) + 64)
    let n = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
    return pids.prefix(Int(max(0, n))).filter { $0 > 0 }
  }

  private static func execPath(_ pid: pid_t) -> String? {
    var buf = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))  // PROC_PIDPATHINFO_MAXSIZE
    return proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 ? String(cString: buf) : nil
  }

  private static func parentPid(_ pid: pid_t) -> pid_t? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size ? pid_t(info.pbi_ppid) : nil
  }

  /// argv and environment of a process owned by this user (KERN_PROCARGS2); nil if it can't be read.
  private static func processArgsEnv(_ pid: pid_t) -> (args: [String], env: [String: String])? {
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
    var size = 0
    guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > MemoryLayout<Int32>.size else { return nil }
    var buf = [UInt8](repeating: 0, count: size)
    guard sysctl(&mib, 3, &buf, &size, nil, 0) == 0, size > MemoryLayout<Int32>.size else { return nil }
    // Layout: argc, exec path, NUL padding, argv[argc], environment, then an empty string.
    let argc = buf.withUnsafeBytes { Int($0.loadUnaligned(as: Int32.self)) }
    var i = MemoryLayout<Int32>.size
    while i < size && buf[i] != 0 { i += 1 }
    while i < size && buf[i] == 0 { i += 1 }
    var strings: [String] = []
    var start = i
    while i < size {
      if buf[i] == 0 {
        if i == start { break }
        strings.append(String(decoding: buf[start..<i], as: UTF8.self))
        start = i + 1
      }
      i += 1
    }
    var env: [String: String] = [:]
    for s in strings.dropFirst(argc) {
      guard let eq = s.firstIndex(of: "=") else { continue }
      env[String(s[..<eq])] = String(s[s.index(after: eq)...])
    }
    return (Array(strings.prefix(argc)), env)
  }

  private static func isAlive(_ pid: pid_t) -> Bool {
    kill(pid, 0) == 0 || errno == EPERM
  }

  private static func waitForExit(_ pid: pid_t, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while isAlive(pid) {
      if Date() >= deadline { return false }
      usleep(100_000)
    }
    return true
  }

  // MARK: launch

  private static func open(_ url: URL, env: [String: String],
                           resolve: @escaping RCTPromiseResolveBlock,
                           reject: @escaping RCTPromiseRejectBlock) {
    let cfg = NSWorkspace.OpenConfiguration()
    cfg.activates = false
    cfg.addsToRecentItems = false
    cfg.environment = env
    NSWorkspace.shared.openApplication(at: url, configuration: cfg) { _, error in
      if let error {
        flOllamaLog("[FLOllama] open failed: \(error.localizedDescription)")
        reject("E_LAUNCH", "Couldn't open Ollama: \(error.localizedDescription)", error)
      } else {
        flOllamaLog("[FLOllama] opened Ollama.app with \(cacheVar)=0")
        resolve(nil)
      }
    }
  }
}

private let ollamaLogger = Logger(subsystem: "com.larpless.app", category: "ollama")

/// Statuses, pids and counts only: never environment values.
func flOllamaLog(_ message: String) {
  ollamaLogger.notice("\(message, privacy: .public)")
}
