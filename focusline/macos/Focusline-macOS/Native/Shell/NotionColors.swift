import AppKit
import SwiftUI

// Notion design tokens for native views (CONTRACTS.md §9). Mirrors src/ui/theme.ts.
// Hex helpers are FL-prefixed (`Color(flHex:)`) so they can't collide with another target file's `init(hex:)`.

extension Color {
  /// "#RRGGBB" or "#RRGGBBAA" (leading "#" optional). Invalid input → magenta, so mistakes are visible.
  init(flHex hex: String) {
    let rgba = FLNotionColors.parseHex(hex)
    self.init(.sRGB, red: rgba.r, green: rgba.g, blue: rgba.b, opacity: rgba.a)
  }
}

extension NSColor {
  convenience init(flHex hex: String) {
    let rgba = FLNotionColors.parseHex(hex)
    self.init(srgbRed: rgba.r, green: rgba.g, blue: rgba.b, alpha: rgba.a)
  }
}

/// A Notion tag colour pair (background + text). Also used for the floating panel tints.
struct FLNotionTag: Equatable {
  let bgHex: String
  let textHex: String
  var bg: Color { Color(flHex: bgHex) }
  var text: Color { Color(flHex: textHex) }
}

enum FLNotionColors {
  // Base (light)
  static let bg = Color(flHex: "#FFFFFF")
  static let sidebar = Color(flHex: "#F7F6F3")
  static let text = Color(flHex: "#37352F")
  static let muted = Color(flHex: "#787774")
  static let border = Color(flHex: "#E9E9E7")
  static let hover = Color(flHex: "#EFEFED")
  static let accent = Color(flHex: "#2383E2")

  // Base (dark, cut item; kept for completeness)
  static let darkBg = Color(flHex: "#191919")
  static let darkSidebar = Color(flHex: "#202020")
  static let darkText = Color(flHex: "#FFFFFFCF")

  // Tags (bg / text)
  static let gray = FLNotionTag(bgHex: "#F1F1EF", textHex: "#787774")
  static let brown = FLNotionTag(bgHex: "#F4EEEE", textHex: "#9F6B53")
  static let orange = FLNotionTag(bgHex: "#FBECDD", textHex: "#D9730D")
  static let yellow = FLNotionTag(bgHex: "#FBF3DB", textHex: "#CB912F")
  static let green = FLNotionTag(bgHex: "#EDF3EC", textHex: "#448361")
  static let blue = FLNotionTag(bgHex: "#E7F3F8", textHex: "#337EA9")
  static let purple = FLNotionTag(bgHex: "#F6F3F9", textHex: "#9065B0")
  static let pink = FLNotionTag(bgHex: "#FAF1F5", textHex: "#C14C8A")
  static let red = FLNotionTag(bgHex: "#FDEBEC", textHex: "#D44C47")

  /// TagColor / PanelTint name → pair. Unknown names fall back to gray.
  static func tag(_ name: String) -> FLNotionTag {
    switch name {
    case "brown": return brown
    case "orange": return orange
    case "yellow": return yellow
    case "green": return green
    case "blue": return blue
    case "purple": return purple
    case "pink": return pink
    case "red": return red
    default: return gray
    }
  }

  static func parseHex(_ hex: String) -> (r: Double, g: Double, b: Double, a: Double) {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { return (1, 0, 1, 1) }
    if s.count == 6 {
      return (Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255, 1)
    }
    return (Double((v >> 24) & 0xFF) / 255, Double((v >> 16) & 0xFF) / 255,
            Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)
  }
}

/// Bundled fonts (PostScript names verified with mdls, CONTRACTS.md §9).
enum FLNotionFonts {
  static let interRegular = "Inter-Regular"
  static let interMedium = "Inter-Medium"
  static let interSemiBold = "Inter-SemiBold"
  static let serifRegular = "InstrumentSerif-Regular"
  static let serifItalic = "InstrumentSerif-Italic"

  /// True when the bundled font is registered (ATSApplicationFontsPath); false means SwiftUI falls back to system.
  static func isAvailable(_ postScriptName: String) -> Bool {
    NSFont(name: postScriptName, size: 12) != nil
  }
}

/// WS-E's brief refers to `NotionColors`; keep that spelling available.
typealias NotionColors = FLNotionColors
