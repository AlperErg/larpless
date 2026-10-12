// FLScreenModel (Windows only for now; the macOS app has no counterpart yet, so the classifier skips this step
// there): on-device "decision" classifier. classify() captures the screen, reads its text with Windows.Media.Ocr,
// embeds the image with SigLIP 2 (vision tower) and the title + text with all-MiniLM-L6-v2, both through ONNX
// Runtime, and resolves with numbers only: a logit per fixed SigLIP prompt (Assets/Models/FLScreenModelPrompts.json,
// built by scripts/embed_bench/export_prompts.py) and a cosine per caller-supplied text. src/core/screenModel.ts
// turns those into a verdict.
//
// The model files (~460 MB) are downloaded once by download() from pinned Hugging Face URLs into
// LocalFolder\Models and checked against their size and SHA-256.
//
// PRIVACY: the frame, the OCR text and the embeddings stay in this process's memory and are dropped after each
// call; nothing is written to disk or logged except sizes and timings. Only the window snapshot (the same
// fields getActiveWindow returns) and the scores go back to JS.
#pragma once

#include <NativeModules.h>
#include <bcrypt.h>
#include <onnxruntime_cxx_api.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Globalization.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Media.Ocr.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Web.Http.Filters.h>
#include <winrt/Windows.Web.Http.Headers.h>
#include <winrt/Windows.Web.Http.h>

#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "FLScreenCapture.h"
#include "FLUtil.h"
#include "FLWordPiece.h"

#pragma comment(lib, "bcrypt.lib")

namespace LarpLess {

REACT_MODULE(FLScreenModel)
struct FLScreenModel {
  using JSValue = winrt::Microsoft::ReactNative::JSValue;
  using JSValueArray = winrt::Microsoft::ReactNative::JSValueArray;
  using JSValueObject = winrt::Microsoft::ReactNative::JSValueObject;
  using ReactError = winrt::Microsoft::ReactNative::ReactError;
  template <typename T>
  using ReactPromise = winrt::Microsoft::ReactNative::ReactPromise<T>;

  // The only file names download() accepts and classify() loads.
  static constexpr wchar_t kVision[]{L"siglip2-vision.onnx"};
  static constexpr wchar_t kText[]{L"minilm.onnx"};
  static constexpr wchar_t kVocab[]{L"minilm-vocab.txt"};

  ~FLScreenModel() noexcept {
    m_cancel = true;
  }

  // files = [{ name, size }]. Resolves { supported, installed, missing: [name], loaded }.
  REACT_METHOD(Status, L"status")
  void Status(JSValueArray &&files, ReactPromise<JSValue> &&result) noexcept {
    std::thread([this, files = std::move(files), result = std::move(result)]() mutable noexcept {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      JSValueArray missing;
      try {
        const auto dir{ModelDir()};
        for (auto const &f : files) {
          auto const *obj{f.TryGetObject()};
          if (!obj) {
            continue;
          }
          const auto name{Text(*obj, "name")};
          const auto size{Number(*obj, "size", -1)};
          std::error_code ec;
          const auto path{dir / winrt::to_hstring(name).c_str()};
          if (!std::filesystem::is_regular_file(path, ec) ||
              static_cast<double>(std::filesystem::file_size(path, ec)) != size) {
            missing.push_back(JSValue{name});
          }
        }
      } catch (...) {
        result.Reject(ReactError{"E_STATUS", "model folder unavailable", {}});
        return;
      }
      const bool installed{missing.empty()};
      result.Resolve(JSValue{JSValueObject{
          {"supported", true}, {"installed", installed}, {"missing", std::move(missing)}, {"loaded", m_loaded.load()}}});
    }).detach();
  }

  // files = [{ name, url, sha256, size }]: downloads each missing or wrong-sized file to LocalFolder\Models,
  // emitting FLScreenModelProgress. Rejects E_INVALID_ARG / E_BUSY / E_DOWNLOAD / E_CHECKSUM / E_CANCELLED.
  REACT_METHOD(Download, L"download")
  void Download(JSValueArray &&files, ReactPromise<void> &&result) noexcept {
    std::vector<FileSpec> specs;
    for (auto const &f : files) {
      auto const *obj{f.TryGetObject()};
      if (!obj) {
        continue;
      }
      FileSpec s{winrt::to_hstring(Text(*obj, "name")).c_str(), Text(*obj, "url"), Text(*obj, "sha256"),
                 static_cast<uint64_t>(Number(*obj, "size", 0))};
      const bool knownName{s.name == kVision || s.name == kText || s.name == kVocab};
      if (!knownName || s.url.rfind("https://huggingface.co/", 0) != 0 || s.sha256.size() != 64 || s.size == 0) {
        result.Reject(ReactError{"E_INVALID_ARG", "unexpected model file spec", {}});
        return;
      }
      specs.push_back(std::move(s));
    }
    if (m_downloading.exchange(true)) {
      result.Reject(ReactError{"E_BUSY", "a download is already running", {}});
      return;
    }
    m_cancel = false;
    std::thread([this, specs = std::move(specs), result = std::move(result)]() mutable noexcept {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      std::string code, message;
      try {
        const auto dir{ModelDir()};
        std::filesystem::create_directories(dir);
        for (size_t i = 0; i < specs.size() && code.empty(); ++i) {
          auto const &s{specs[i]};
          std::error_code ec;
          const auto path{dir / s.name};
          if (std::filesystem::is_regular_file(path, ec) && std::filesystem::file_size(path, ec) == s.size) {
            continue;
          }
          code = Fetch(s, path, i, specs.size(), message);
        }
      } catch (...) {
        code = "E_DOWNLOAD";
        message = "download failed";
      }
      m_downloading = false;
      if (code.empty()) {
        result.Resolve();
      } else {
        result.Reject(ReactError{code, message, {}});
      }
    }).detach();
  }

  REACT_METHOD(CancelDownload, L"cancelDownload")
  void CancelDownload(ReactPromise<void> &&result) noexcept {
    m_cancel = true;
    result.Resolve();
  }

  // opts = { maxWidth, ocrLanguage?, texts: [{ id, text }] }. Resolves the window snapshot (appName, bundleId,
  // windowTitle, isSelf) plus { width, height, capturedAt, image: {promptId: logit}, text: {id: cosine} | null,
  // ocrChars, timings: { captureMs, ocrMs, imageMs, textMs } }. Rejects E_NOT_INSTALLED / E_MODEL / E_CAPTURE.
  REACT_METHOD(Classify, L"classify")
  void Classify(JSValueObject &&opts, ReactPromise<JSValue> &&result) noexcept {
    const int maxWidth{static_cast<int>(Number(opts, "maxWidth", 1024))};
    std::wstring language{winrt::to_hstring(Text(opts, "ocrLanguage")).c_str()};
    std::vector<std::pair<std::string, std::wstring>> texts;
    if (const auto it{opts.find("texts")}; it != opts.end()) {
      if (auto const *arr{it->second.TryGetArray()}) {
        for (auto const &t : *arr) {
          if (auto const *obj{t.TryGetObject()}) {
            texts.emplace_back(Text(*obj, "id"), winrt::to_hstring(Text(*obj, "text")).c_str());
          }
        }
      }
    }
    if (maxWidth < 224 || maxWidth > 8192) {
      result.Reject(ReactError{"E_INVALID_ARG", "maxWidth must be 224-8192", {}});
      return;
    }
    std::thread([this, maxWidth, language = std::move(language), texts = std::move(texts),
                 result = std::move(result)]() mutable noexcept {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      std::lock_guard<std::mutex> lock{m_runMutex};
      std::string code, message;
      JSValueObject out;
      try {
        code = EnsureLoaded(message);
        if (code.empty()) {
          code = Run(maxWidth, language.empty() ? L"en-US" : language, texts, out);
          if (code == "E_CAPTURE") {
            message = "screen capture failed";
          }
        }
      } catch (Ort::Exception const &e) {
        code = "E_MODEL";
        message = std::string{"onnxruntime: "} + e.what();
      } catch (winrt::hresult_error const &e) {
        code = "E_MODEL";
        message = "winrt " + std::to_string(static_cast<int32_t>(e.code())) + ": " + winrt::to_string(e.message());
      } catch (std::exception const &e) {
        code = "E_MODEL";
        message = e.what();
      } catch (...) {
        code = "E_MODEL";
        message = "inference failed";
      }
      if (!code.empty()) {
        // Error texts come from ONNX Runtime / WinRT / the STL, never from the screen.
        OutputDebugStringA(("[FLScreenModel] " + code + " " + message + "\n").c_str());
      }
      if (code.empty()) {
        result.Resolve(JSValue{std::move(out)});
      } else {
        result.Reject(ReactError{code, message, {}});
      }
    }).detach();
  }

  // Frees the sessions (about 1 GB) between study sessions.
  REACT_METHOD(Unload, L"unload")
  void Unload(ReactPromise<void> &&result) noexcept {
    std::thread([this, result = std::move(result)]() mutable noexcept {
      std::lock_guard<std::mutex> lock{m_runMutex};
      m_vision = nullptr;
      m_text = nullptr;
      m_textCache.clear();
      m_ocr = nullptr;
      m_loaded = false;
      result.Resolve();
    }).detach();
  }

  REACT_METHOD(AddListener, L"addListener")
  void AddListener(std::string) noexcept {
    ++m_listeners;
  }

  REACT_METHOD(RemoveListeners, L"removeListeners")
  void RemoveListeners(double count) noexcept {
    m_listeners = (std::max)(0, m_listeners - static_cast<int>(count));
  }

  REACT_EVENT(Progress, L"FLScreenModelProgress")
  std::function<void(JSValueObject const &)> Progress;

 private:
  struct FileSpec {
    std::wstring name;
    std::string url, sha256;
    uint64_t size{0};
  };

  struct Prompt {
    std::string id;
    std::vector<float> embedding;
  };

  std::atomic<int> m_listeners{0};
  std::atomic<bool> m_downloading{false}, m_cancel{false}, m_loaded{false};
  std::mutex m_runMutex;  // one classify / load / unload at a time

  // Guarded by m_runMutex.
  std::unique_ptr<Ort::Env> m_env;
  std::unique_ptr<Ort::Session> m_vision, m_text;
  WordPiece m_vocab;
  std::vector<Prompt> m_prompts;
  float m_logitScale{1}, m_logitBias{0};
  std::unordered_map<std::wstring, std::vector<float>> m_textCache;  // embeddings of caller texts (module labels)
  winrt::Windows::Media::Ocr::OcrEngine m_ocr{nullptr};
  std::wstring m_ocrLanguage;
  std::vector<float> m_pixels;
  int m_weightsW{0}, m_weightsH{0};
  std::vector<std::vector<std::pair<int, float>>> m_colWeights, m_rowWeights;

  static constexpr int kSize{224};
  static constexpr size_t kMaxTextChars{1000};

  static std::string Text(JSValueObject const &obj, char const *key) {
    const auto it{obj.find(key)};
    if (it == obj.end()) {
      return {};
    }
    auto const *s{it->second.TryGetString()};
    return s ? *s : std::string{};
  }

  static double Number(JSValueObject const &obj, char const *key, double fallback) {
    const auto it{obj.find(key)};
    return it == obj.end() || it->second.IsNull() ? fallback : it->second.AsDouble();
  }

  static double Ms(std::chrono::steady_clock::time_point since) {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - since).count();
  }

  static std::filesystem::path ModelDir() {
    return std::filesystem::path{winrt::Windows::Storage::ApplicationData::Current().LocalFolder().Path().c_str()} /
           L"Models";
  }

  // Packaged asset: a single file lands next to the exe, a wildcard at the package root (see FLWebcam).
  static std::filesystem::path AssetPath(wchar_t const *file) {
    wchar_t exe[MAX_PATH]{};
    GetModuleFileNameW(nullptr, exe, MAX_PATH);
    const auto exeDir{std::filesystem::path{exe}.parent_path()};
    std::error_code ec;
    for (auto const &root : {exeDir, exeDir.parent_path()}) {
      const auto path{root / L"Assets" / L"Models" / file};
      if (std::filesystem::is_regular_file(path, ec)) {
        return path;
      }
    }
    return {};
  }

  void Emit(JSValueObject payload) noexcept {
    if (m_listeners > 0 && Progress) {
      Progress(payload);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Download
  // ------------------------------------------------------------------------------------------------

  std::string Fetch(FileSpec const &s, std::filesystem::path const &path, size_t index, size_t count,
                    std::string &message) {
    using namespace winrt::Windows::Web::Http;
    using namespace winrt::Windows::Storage::Streams;
    Filters::HttpBaseProtocolFilter filter;
    // Don't let WinINet keep a second copy of a 372 MB file in its cache.
    filter.CacheControl().ReadBehavior(Filters::HttpCacheReadBehavior::NoCache);
    filter.CacheControl().WriteBehavior(Filters::HttpCacheWriteBehavior::NoCache);
    HttpClient client{filter};
    const auto response{
        client.GetAsync(winrt::Windows::Foundation::Uri{winrt::to_hstring(s.url)}, HttpCompletionOption::ResponseHeadersRead)
            .get()};
    if (!response.IsSuccessStatusCode()) {
      message = "HTTP " + std::to_string(static_cast<int>(response.StatusCode()));
      return "E_DOWNLOAD";
    }
    const auto input{response.Content().ReadAsInputStreamAsync().get()};
    auto part{path};
    part += L".part";
    std::ofstream file{part, std::ios::binary | std::ios::trunc};
    if (!file) {
      message = "cannot write the model folder";
      return "E_DOWNLOAD";
    }
    Sha256 hash;
    Buffer buffer{1u << 20};
    uint64_t received{0};
    auto lastEmit{std::chrono::steady_clock::now() - std::chrono::seconds{1}};
    for (;;) {
      if (m_cancel) {
        file.close();
        std::error_code ec;
        std::filesystem::remove(part, ec);
        message = "cancelled";
        return "E_CANCELLED";
      }
      const auto chunk{input.ReadAsync(buffer, buffer.Capacity(), InputStreamOptions::Partial).get()};
      const uint32_t n{chunk.Length()};
      if (n == 0) {
        break;
      }
      file.write(reinterpret_cast<char const *>(chunk.data()), n);
      hash.Update(chunk.data(), n);
      received += n;
      if (std::chrono::steady_clock::now() - lastEmit > std::chrono::milliseconds{250}) {
        lastEmit = std::chrono::steady_clock::now();
        Emit(ProgressPayload(s, index, count, received));
      }
    }
    file.close();
    Emit(ProgressPayload(s, index, count, received));
    std::error_code ec;
    if (received != s.size || hash.Hex() != s.sha256) {
      std::filesystem::remove(part, ec);
      message = winrt::to_string(s.name) + " failed its size/SHA-256 check";
      return "E_CHECKSUM";
    }
    std::filesystem::rename(part, path, ec);
    if (ec) {
      message = "cannot move the model into place";
      return "E_DOWNLOAD";
    }
    return {};
  }

  static JSValueObject ProgressPayload(FileSpec const &s, size_t index, size_t count, uint64_t received) {
    return JSValueObject{{"name", winrt::to_string(s.name)},
                         {"receivedBytes", static_cast<double>(received)},
                         {"totalBytes", static_cast<double>(s.size)},
                         {"fileIndex", static_cast<double>(index)},
                         {"fileCount", static_cast<double>(count)}};
  }

  class Sha256 {
   public:
    Sha256() {
      if (BCryptOpenAlgorithmProvider(&m_alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0) {
        BCryptCreateHash(m_alg, &m_hash, nullptr, 0, nullptr, 0, 0);
      }
    }
    ~Sha256() {
      if (m_hash) BCryptDestroyHash(m_hash);
      if (m_alg) BCryptCloseAlgorithmProvider(m_alg, 0);
    }
    void Update(uint8_t const *data, uint32_t size) {
      if (m_hash) BCryptHashData(m_hash, const_cast<PUCHAR>(data), size, 0);
    }
    std::string Hex() {
      uint8_t digest[32]{};
      if (!m_hash || BCryptFinishHash(m_hash, digest, sizeof(digest), 0) != 0) {
        return {};
      }
      static constexpr char hex[]{"0123456789abcdef"};
      std::string out;
      for (uint8_t b : digest) {
        out += hex[b >> 4];
        out += hex[b & 15];
      }
      return out;
    }

   private:
    BCRYPT_ALG_HANDLE m_alg{nullptr};
    BCRYPT_HASH_HANDLE m_hash{nullptr};
  };

  // ------------------------------------------------------------------------------------------------
  // Models
  // ------------------------------------------------------------------------------------------------

  std::string EnsureLoaded(std::string &message) {
    if (m_vision && m_text) {
      return {};
    }
    const auto dir{ModelDir()};
    std::error_code ec;
    for (auto const *file : {kVision, kText, kVocab}) {
      if (!std::filesystem::is_regular_file(dir / file, ec)) {
        message = "model files are not downloaded";
        return "E_NOT_INSTALLED";
      }
    }
    const auto start{std::chrono::steady_clock::now()};
    if (!LoadPrompts() || !m_vocab.Load((dir / kVocab).wstring())) {
      message = "prompt table or vocabulary unreadable";
      return "E_MODEL";
    }
    Ort::SessionOptions options;
    // A study session checks at most every 10 s; 4 threads keep a check well under a second on a laptop CPU.
    options.SetIntraOpNumThreads(4);
    options.SetInterOpNumThreads(1);
    options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
    if (!m_env) {
      m_env = std::make_unique<Ort::Env>(ORT_LOGGING_LEVEL_ERROR, "FLScreenModel");
    }
    m_vision = std::make_unique<Ort::Session>(*m_env, (dir / kVision).c_str(), options);
    m_text = std::make_unique<Ort::Session>(*m_env, (dir / kText).c_str(), options);
    m_loaded = true;
    char line[96];
    sprintf_s(line, "[FLScreenModel] loaded in %.0f ms\n", Ms(start));
    OutputDebugStringA(line);
    return {};
  }

  bool LoadPrompts() {
    using namespace winrt::Windows::Data::Json;
    if (!m_prompts.empty()) {
      return true;
    }
    const auto path{AssetPath(L"FLScreenModelPrompts.json")};
    std::ifstream file{path, std::ios::binary};
    if (path.empty() || !file) {
      return false;
    }
    const std::string json{std::istreambuf_iterator<char>{file}, std::istreambuf_iterator<char>{}};
    JsonObject root{nullptr};
    if (!JsonObject::TryParse(winrt::to_hstring(json), root)) {
      return false;
    }
    m_logitScale = static_cast<float>(root.GetNamedNumber(L"logitScale"));
    m_logitBias = static_cast<float>(root.GetNamedNumber(L"logitBias"));
    // GetObjectAt, not IJsonValue::GetObject: windows.h #defines GetObject.
    const auto prompts{root.GetNamedArray(L"prompts")};
    for (uint32_t i = 0; i < prompts.Size(); ++i) {
      const auto obj{prompts.GetObjectAt(i)};
      Prompt p{winrt::to_string(obj.GetNamedString(L"id")), {}};
      for (auto const &x : obj.GetNamedArray(L"embedding")) {
        p.embedding.push_back(static_cast<float>(x.GetNumber()));
      }
      m_prompts.push_back(std::move(p));
    }
    return !m_prompts.empty();
  }

  std::string Run(int maxWidth, std::wstring const &language,
                  std::vector<std::pair<std::string, std::wstring>> const &texts, JSValueObject &out) {
    auto t0{std::chrono::steady_clock::now()};
    const auto window{FLScreenCapture::QueryActiveWindow()}; // snapshot first, like capture()
    std::vector<uint8_t> bgra;
    int w{0}, h{0};
    if (!FLScreenCapture::CaptureBgra(maxWidth, bgra, w, h)) {
      return "E_CAPTURE";
    }
    const double captureMs{Ms(t0)};

    t0 = std::chrono::steady_clock::now();
    std::wstring screenText{Ocr(bgra, w, h, language)};
    const double ocrMs{Ms(t0)};

    t0 = std::chrono::steady_clock::now();
    Preprocess(bgra, w, h);
    std::fill(bgra.begin(), bgra.end(), uint8_t{0});
    bgra.clear();
    bgra.shrink_to_fit();
    const auto imageEmbedding{EmbedImage()};
    JSValueObject image;
    for (auto const &p : m_prompts) {
      image[p.id] = static_cast<double>(Dot(imageEmbedding, p.embedding) * m_logitScale + m_logitBias);
    }
    const double imageMs{Ms(t0)};

    t0 = std::chrono::steady_clock::now();
    // Window title + screen text, as the bench scores it (scripts/embed_bench/bench.py).
    std::wstring input{window.title};
    if (!screenText.empty()) {
      input += input.empty() ? L"" : L"\n";
      input += screenText;
    }
    if (input.size() > kMaxTextChars) {
      input.resize(kMaxTextChars);
    }
    JSValue text{nullptr};
    if (!input.empty() && !texts.empty()) {
      const auto embedding{EmbedText(input)};
      JSValueObject scores;
      for (auto const &[id, label] : texts) {
        auto cached{m_textCache.find(label)};
        if (cached == m_textCache.end()) {
          cached = m_textCache.emplace(label, EmbedText(label)).first;
        }
        scores[id] = static_cast<double>(Dot(embedding, cached->second));
      }
      text = JSValue{std::move(scores)};
    }
    const double textMs{Ms(t0)};
    const size_t ocrChars{screenText.size()};
    screenText.assign(screenText.size(), L'\0');
    input.assign(input.size(), L'\0');

    out = FLScreenCapture::ToJS(window);
    out["width"] = w;
    out["height"] = h;
    out["capturedAt"] = EpochMs();
    out["image"] = std::move(image);
    out["text"] = std::move(text);
    out["ocrChars"] = static_cast<double>(ocrChars);
    out["timings"] = JSValueObject{{"captureMs", captureMs}, {"ocrMs", ocrMs}, {"imageMs", imageMs}, {"textMs", textMs}};

    char line[160];
    sprintf_s(line, "[FLScreenModel] %dx%d capture %.0f ms, ocr %.0f ms (%zu chars), image %.0f ms, text %.0f ms\n", w,
              h, captureMs, ocrMs, ocrChars, imageMs, textMs);
    OutputDebugStringA(line);
    return {};
  }

  std::wstring Ocr(std::vector<uint8_t> const &bgra, int w, int h, std::wstring const &language) {
    using namespace winrt::Windows::Graphics::Imaging;
    using namespace winrt::Windows::Media::Ocr;
    if (!m_ocr || m_ocrLanguage != language) {
      m_ocr = OcrEngine::TryCreateFromLanguage(winrt::Windows::Globalization::Language{language});
      if (!m_ocr) {
        m_ocr = OcrEngine::TryCreateFromUserProfileLanguages();
      }
      m_ocrLanguage = language;
    }
    const auto maxDim{static_cast<int>(OcrEngine::MaxImageDimension())};
    if (!m_ocr || w > maxDim || h > maxDim) {
      return {};
    }
    SoftwareBitmap bitmap{BitmapPixelFormat::Bgra8, w, h, BitmapAlphaMode::Premultiplied};
    winrt::Windows::Storage::Streams::Buffer buffer{static_cast<uint32_t>(bgra.size())};
    std::memcpy(buffer.data(), bgra.data(), bgra.size());
    buffer.Length(static_cast<uint32_t>(bgra.size()));
    bitmap.CopyFromBuffer(buffer);
    std::memset(buffer.data(), 0, bgra.size());
    return std::wstring{m_ocr.RecognizeAsync(bitmap).get().Text()};
  }

  // PIL's bilinear resample (a tent filter whose support widens with the downsample factor), which is what the
  // SigLIP processor uses; cosine to the processor's embedding is 0.9999 (scripts/embed_bench/export_prompts.py).
  static std::vector<std::vector<std::pair<int, float>>> TentWeights(int in, int out) {
    std::vector<std::vector<std::pair<int, float>>> weights(static_cast<size_t>(out));
    const double scale{static_cast<double>(in) / out};
    const double support{(std::max)(scale, 1.0)};
    for (int i = 0; i < out; ++i) {
      const double center{(i + 0.5) * scale};
      const int lo{(std::max)(0, static_cast<int>(std::floor(center - support)))};
      const int hi{(std::min)(in, static_cast<int>(std::ceil(center + support)))};
      double sum{0};
      for (int j = lo; j < hi; ++j) {
        const double wgt{(std::max)(0.0, 1.0 - std::abs((j + 0.5 - center) / support))};
        if (wgt > 0) {
          weights[i].emplace_back(j, static_cast<float>(wgt));
          sum += wgt;
        }
      }
      for (auto &[j, wgt] : weights[i]) {
        wgt = static_cast<float>(wgt / sum);
      }
    }
    return weights;
  }

  // BGRA (w x h) -> RGB CHW 224x224, (x / 255 - 0.5) / 0.5.
  void Preprocess(std::vector<uint8_t> const &bgra, int w, int h) {
    if (m_weightsW != w || m_weightsH != h) {
      m_colWeights = TentWeights(w, kSize);
      m_rowWeights = TentWeights(h, kSize);
      m_weightsW = w;
      m_weightsH = h;
    }
    std::vector<float> rows(static_cast<size_t>(h) * kSize * 3);  // horizontal pass: h x 224 x RGB
    for (int y = 0; y < h; ++y) {
      uint8_t const *src{bgra.data() + static_cast<size_t>(y) * w * 4};
      for (int x = 0; x < kSize; ++x) {
        float r{0}, g{0}, b{0};
        for (auto const &[j, wgt] : m_colWeights[x]) {
          b += wgt * src[j * 4];
          g += wgt * src[j * 4 + 1];
          r += wgt * src[j * 4 + 2];
        }
        float *dst{rows.data() + (static_cast<size_t>(y) * kSize + x) * 3};
        dst[0] = r;
        dst[1] = g;
        dst[2] = b;
      }
    }
    m_pixels.assign(static_cast<size_t>(3) * kSize * kSize, 0.0f);
    for (int y = 0; y < kSize; ++y) {
      for (int x = 0; x < kSize; ++x) {
        float acc[3]{0, 0, 0};
        for (auto const &[i, wgt] : m_rowWeights[y]) {
          float const *src{rows.data() + (static_cast<size_t>(i) * kSize + x) * 3};
          acc[0] += wgt * src[0];
          acc[1] += wgt * src[1];
          acc[2] += wgt * src[2];
        }
        for (int c = 0; c < 3; ++c) {
          m_pixels[(static_cast<size_t>(c) * kSize + y) * kSize + x] = (acc[c] / 255.0f - 0.5f) / 0.5f;
        }
      }
    }
    std::fill(rows.begin(), rows.end(), 0.0f);
  }

  std::vector<float> EmbedImage() {
    std::array<int64_t, 4> shape{1, 3, kSize, kSize};
    auto memory{Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator, OrtMemTypeCPU)};
    Ort::Value input{Ort::Value::CreateTensor<float>(memory, m_pixels.data(), m_pixels.size(), shape.data(), shape.size())};
    const char *inputNames[]{"pixel_values"};
    const char *outputNames[]{"pooler_output"};
    auto outputs{m_vision->Run(Ort::RunOptions{nullptr}, inputNames, &input, 1, outputNames, 1)};
    std::fill(m_pixels.begin(), m_pixels.end(), 0.0f);
    const auto count{outputs[0].GetTensorTypeAndShapeInfo().GetElementCount()};
    float const *data{outputs[0].GetTensorData<float>()};
    return Normalized(std::vector<float>(data, data + count));
  }

  // Mean-pooled, L2-normalised last_hidden_state (sentence-transformers' default for all-MiniLM-L6-v2).
  std::vector<float> EmbedText(std::wstring const &text) {
    std::vector<int64_t> ids{m_vocab.Encode(text, 256)};
    std::vector<int64_t> mask(ids.size(), 1), types(ids.size(), 0);
    std::array<int64_t, 2> shape{1, static_cast<int64_t>(ids.size())};
    auto memory{Ort::MemoryInfo::CreateCpu(OrtDeviceAllocator, OrtMemTypeCPU)};
    std::array<Ort::Value, 3> inputs{
        Ort::Value::CreateTensor<int64_t>(memory, ids.data(), ids.size(), shape.data(), shape.size()),
        Ort::Value::CreateTensor<int64_t>(memory, mask.data(), mask.size(), shape.data(), shape.size()),
        Ort::Value::CreateTensor<int64_t>(memory, types.data(), types.size(), shape.data(), shape.size())};
    const char *inputNames[]{"input_ids", "attention_mask", "token_type_ids"};
    const char *outputNames[]{"last_hidden_state"};
    auto outputs{m_text->Run(Ort::RunOptions{nullptr}, inputNames, inputs.data(), inputs.size(), outputNames, 1)};
    const auto dims{outputs[0].GetTensorTypeAndShapeInfo().GetShape()};
    const size_t tokens{static_cast<size_t>(dims[1])}, dim{static_cast<size_t>(dims[2])};
    float const *data{outputs[0].GetTensorData<float>()};
    std::vector<float> pooled(dim, 0.0f);
    for (size_t t = 0; t < tokens; ++t) {
      for (size_t d = 0; d < dim; ++d) {
        pooled[d] += data[t * dim + d];
      }
    }
    std::fill(ids.begin(), ids.end(), 0);
    return Normalized(std::move(pooled));
  }

  static std::vector<float> Normalized(std::vector<float> v) {
    double norm{0};
    for (float x : v) {
      norm += static_cast<double>(x) * x;
    }
    const float inv{norm > 0 ? static_cast<float>(1.0 / std::sqrt(norm)) : 0.0f};
    for (float &x : v) {
      x *= inv;
    }
    return v;
  }

  static float Dot(std::vector<float> const &a, std::vector<float> const &b) {
    const size_t n{(std::min)(a.size(), b.size())};
    double sum{0};
    for (size_t i = 0; i < n; ++i) {
      sum += static_cast<double>(a[i]) * b[i];
    }
    return static_cast<float>(sum);
  }
};

} // namespace LarpLess
