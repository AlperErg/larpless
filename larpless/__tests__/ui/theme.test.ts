import { TAG_COLORS, applyScheme, colors, heat, tag, themed } from '../../src/ui/theme';

function channel(hex: string, i: number): number {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG contrast for #RRGGBB. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
}

const swatch = themed(() => ({
  bg: { backgroundColor: colors.bg, color: colors.text },
}));

describe('appearance schemes', () => {
  afterEach(() => applyScheme('light'));

  it('dark follows the landing site and keeps text readable', () => {
    applyScheme('dark');
    expect(colors.bg).toBe('#10110F');
    expect(colors.text).toBe('#F4F1EA');
    expect(colors.accent).toBe('#F4F1EA');
    expect(swatch.bg.backgroundColor).toBe('#10110F');
    expect(heat[0]).toBe('#2A2B28');
    expect(tag.green).toEqual({ bg: '#1A2420', text: '#6FBF8E' });

    const pairs: Array<[string, string]> = [
      [colors.text, colors.bg],
      [colors.text, colors.raised],
      [colors.text, colors.wash],
      [colors.text, colors.hover],
      [colors.text, colors.accentSoft],
      [colors.muted, colors.bg],
      [colors.muted, colors.raised],
      [colors.muted, colors.wash],
      [colors.faint, colors.bg],
      [colors.faint, colors.raised],
      [colors.faint, colors.wash],
      [colors.faint, colors.hover],
      [colors.faint, colors.accentSoft],
      [colors.onAccent, colors.accent],
      [colors.onAccent, colors.accentHover],
      [colors.codeText, colors.codeBg],
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    for (const name of TAG_COLORS) {
      expect(contrast(tag[name].text, tag[name].bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tag[name].text, colors.bg)).toBeGreaterThanOrEqual(4.5);
    }

    applyScheme('light');
    expect(swatch.bg.backgroundColor).toBe('#F3F5F8');
    expect(colors.accent).toBe('#1E4ED8');
    expect(heat[0]).toBe('#E4E9F0');
  });
});
