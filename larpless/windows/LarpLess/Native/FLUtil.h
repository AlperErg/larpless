// Small helpers shared by the LarpLess Windows modules.
#pragma once

#include <chrono>
#include <cstdint>
#include <string>
#include <vector>

namespace LarpLess {

inline double EpochMs() noexcept {
  return static_cast<double>(
      std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());
}

// Standard base64 (with padding), for in-memory JPEGs handed to JS. Never log the result.
inline std::string Base64(uint8_t const *data, size_t size) {
  static constexpr char table[]{"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"};
  std::string out;
  out.reserve((size + 2) / 3 * 4);
  size_t i{0};
  for (; i + 2 < size; i += 3) {
    const uint32_t n{(uint32_t{data[i]} << 16) | (uint32_t{data[i + 1]} << 8) | data[i + 2]};
    out += table[(n >> 18) & 63];
    out += table[(n >> 12) & 63];
    out += table[(n >> 6) & 63];
    out += table[n & 63];
  }
  if (i < size) {
    const uint32_t n{(uint32_t{data[i]} << 16) | (i + 1 < size ? uint32_t{data[i + 1]} << 8 : 0)};
    out += table[(n >> 18) & 63];
    out += table[(n >> 12) & 63];
    out += i + 1 < size ? table[(n >> 6) & 63] : '=';
    out += '=';
  }
  return out;
}

inline std::string Base64(std::vector<uint8_t> const &data) {
  return Base64(data.data(), data.size());
}

} // namespace LarpLess
