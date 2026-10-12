import Foundation
import Security
import os

/// JS module `FLKeychain` (`KeychainApi`): generic-password items in the login Keychain, so the Supabase
/// session (access and refresh tokens) isn't plain JSON in AsyncStorage that any process running as the
/// user could read. The Keychain ties each item to this app's signature, so another app gets a prompt.
///
/// Keys and statuses may be logged; values never are.
@objc(FLKeychain)
final class FLKeychain: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  private static let service = "com.larpless.app"
  /// Keychain calls can block on a prompt, so they never run on the JS or main thread.
  private let queue = DispatchQueue(label: "com.larpless.keychain", qos: .userInitiated)

  @objc func getItem(_ key: String, resolve: @escaping RCTPromiseResolveBlock,
                     reject: @escaping RCTPromiseRejectBlock) {
    queue.async {
      var query = Self.query(key)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      var out: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &out)
      switch status {
      case errSecSuccess:
        guard let data = out as? Data, let value = String(data: data, encoding: .utf8) else {
          resolve(nil)
          return
        }
        resolve(value)
      case errSecItemNotFound:
        resolve(nil)
      default:
        Self.fail("get", key, status, reject)
      }
    }
  }

  @objc func setItem(_ key: String, value: String, resolve: @escaping RCTPromiseResolveBlock,
                     reject: @escaping RCTPromiseRejectBlock) {
    queue.async {
      let data = Data(value.utf8)
      var status = SecItemUpdate(Self.query(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
      if status == errSecItemNotFound {
        var add = Self.query(key)
        add[kSecValueData as String] = data
        add[kSecAttrLabel as String] = "LarpLess"
        status = SecItemAdd(add as CFDictionary, nil)
      }
      if status == errSecSuccess {
        resolve(nil)
      } else {
        Self.fail("set", key, status, reject)
      }
    }
  }

  @objc func removeItem(_ key: String, resolve: @escaping RCTPromiseResolveBlock,
                        reject: @escaping RCTPromiseRejectBlock) {
    queue.async {
      let status = SecItemDelete(Self.query(key) as CFDictionary)
      if status == errSecSuccess || status == errSecItemNotFound {
        resolve(nil)
      } else {
        Self.fail("remove", key, status, reject)
      }
    }
  }

  private static func query(_ key: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
    ]
  }

  private static func fail(_ op: String, _ key: String, _ status: OSStatus, _ reject: RCTPromiseRejectBlock) {
    keychainLogger.error("[FLKeychain] \(op, privacy: .public) \(key, privacy: .public) failed: \(status)")
    reject("E_KEYCHAIN", "Keychain \(op) failed (\(status))", nil)
  }
}

private let keychainLogger = Logger(subsystem: "com.larpless.app", category: "keychain")
