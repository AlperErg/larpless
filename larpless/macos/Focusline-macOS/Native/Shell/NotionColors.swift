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

/// Set from JS (`setColorScheme`). Views read the computed colors below.
enum FLScheme {
  static var dark = false
}

enum FLNotionColors {
  // Mirrors src/ui/theme.ts. Light is the cool paper canvas; dark is the landing site.
  static var bg: Color { Color(flHex: FLScheme.dark ? "#10110F" : "#F3F5F8") }
  static var sidebar: Color { Color(flHex: FLScheme.dark ? "#10110F" : "#F3F5F8") }
  static var text: Color { Color(flHex: FLScheme.dark ? "#F4F1EA" : "#152033") }
  static var muted: Color { Color(flHex: FLScheme.dark ? "#C8C3B8" : "#4C5D72") }
  static var border: Color { Color(flHex: FLScheme.dark ? "#F4F1EA29" : "#E2E7EE") }
  static var hover: Color { Color(flHex: FLScheme.dark ? "#2A2B28" : "#E8EDF3") }
  static var accent: Color { Color(flHex: FLScheme.dark ? "#F4F1EA" : "#1E4ED8") }

  static var gray: FLNotionTag {
    FLScheme.dark ? FLNotionTag(bgHex: "#222220", textHex: "#C8C3B8") : FLNotionTag(bgHex: "#E7ECF2", textHex: "#4C5D72")
  }
  static var brown: FLNotionTag {
    FLScheme.dark ? FLNotionTag(bgHex: "#3F2F28", textHex: "#DEB3A0") : FLNotionTag(bgHex: "#F4EEEE", textHex: "#9F6B53")
  }
  static var orange: FLNotionTag {
    FLScheme.dark ? FLNotionTag(bgHex: "#432D1F", textHex: "#EBAF85") : FLNotionTag(bgHex: "#FBECDD", textHex: "#D9730D")
  }
  static var yellow: FLNotionTag {
    FLScheme.dark ? FLNotionTag(bgHex: "#3F301B", textHex: "#DFB67B") : FLNotionTag(bgHex: "#FBF3DB", textHex: "#CB912F")
  }
  static var green: FLNotionTag {
    FLScheme.dark ? FLNotionTag(bgHex: "#1A2420", textHex: "#6FBF8E") : FLNotionTag(bgHex: "#EDF3EC", textHex: "#448361")
  }
  static var blue: FLNotionTag {
    FLScheme.dark ? FLNotionTag(bgHex: "#1A242C", textHex: "#7EB0D4") : FLNotionTag(bgHex: "#E7F3F8", textHex: "#337EA9")
  }
  static var purple: FLNotionTag {
    FLScheme.dark ? FLNotionTag(bgHex: "#392D42", textHex: "#CFAEEA") : FLNotionTag(bgHex: "#F6F3F9", textHex: "#9065B0")
  }
  static var pink: FLNotionTag {
    FLScheme.dark ? FLNotionTag(bgHex: "#432A36", textHex: "#EBA6C5") : FLNotionTag(bgHex: "#FAF1F5", textHex: "#C14C8A")
  }
  static var red: FLNotionTag {
    FLScheme.dark ? FLNotionTag(bgHex: "#2A1C1B", textHex: "#E07A74") : FLNotionTag(bgHex: "#FDEBEC", textHex: "#D44C47")
  }

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
