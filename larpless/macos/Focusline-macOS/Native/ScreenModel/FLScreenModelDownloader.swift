import CryptoKit
import Foundation

/// Downloads one model file into `<name>.part`, hashing as it goes, then checks size + SHA-256 and moves it into
/// place. Blocking: FLScreenModel runs it on a background thread. Model weights are public files, not user data,
/// so they may touch disk; nothing else does.
final class FLScreenModelDownloader: NSObject, URLSessionDataDelegate {
  struct Spec {
    let name: String
    let url: URL
    let sha256: String
    let size: Int64
  }

  struct Failure: Error {
    let code: String
    let message: String
  }

  private let spec: Spec
  private let destination: URL
  private let part: URL
  private let isCancelled: () -> Bool
  private let onProgress: (Int64) -> Void

  private let done = DispatchSemaphore(value: 0)
  private var file: FileHandle?
  private var digest = SHA256()
  private var received: Int64 = 0
  private var lastEmit = Date.distantPast
  private var failure: Failure?

  init(spec: Spec, into dir: URL, isCancelled: @escaping () -> Bool, onProgress: @escaping (Int64) -> Void) {
    self.spec = spec
    destination = dir.appendingPathComponent(spec.name)
    part = dir.appendingPathComponent(spec.name + ".part")
    self.isCancelled = isCancelled
    self.onProgress = onProgress
  }

  /// Throws `Failure` (E_DOWNLOAD / E_CHECKSUM / E_CANCELLED).
  func run() throws {
    defer { try? FileManager.default.removeItem(at: part) }
    try? FileManager.default.removeItem(at: part)
    guard FileManager.default.createFile(atPath: part.path, contents: nil),
          let handle = try? FileHandle(forWritingTo: part)
    else { throw Failure(code: "E_DOWNLOAD", message: "cannot write the model folder") }
    file = handle

    // Ephemeral: don't let URLCache keep a second copy of a 372 MB file.
    let config = URLSessionConfiguration.ephemeral
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForRequest = 60
    let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    session.dataTask(with: spec.url).resume()
    done.wait()
    session.invalidateAndCancel()
    try? handle.close()
    file = nil

    if let failure { throw failure }
    onProgress(received)
    let hex = digest.finalize().map { String(format: "%02x", $0) }.joined()
    guard received == spec.size, hex == spec.sha256 else {
      throw Failure(code: "E_CHECKSUM", message: "\(spec.name) failed its size/SHA-256 check")
    }
    do {
      try? FileManager.default.removeItem(at: destination)
      try FileManager.default.moveItem(at: part, to: destination)
    } catch {
      throw Failure(code: "E_DOWNLOAD", message: "cannot move the model into place")
    }
  }

  private func fail(_ code: String, _ message: String, _ task: URLSessionTask) {
    if failure == nil { failure = Failure(code: code, message: message) }
    task.cancel()
  }

  // MARK: URLSessionDataDelegate (serial delegate queue)

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      failure = Failure(code: "E_DOWNLOAD", message: "HTTP \(http.statusCode)")
      completionHandler(.cancel)
      return
    }
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard failure == nil else { return }
    if isCancelled() {
      fail("E_CANCELLED", "cancelled", dataTask)
      return
    }
    do {
      try file?.write(contentsOf: data)
    } catch {
      // The hash covers the network bytes, not the disk: a short write (disk full) must fail here.
      fail("E_DOWNLOAD", "cannot write the model file (is the disk full?)", dataTask)
      return
    }
    digest.update(data: data)
    received += Int64(data.count)
    if Date().timeIntervalSince(lastEmit) > 0.25 {
      lastEmit = Date()
      onProgress(received)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error, failure == nil {
      failure = Failure(code: "E_DOWNLOAD", message: "download failed: \(error.localizedDescription)")
    }
    done.signal()
  }
}
