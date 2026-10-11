/**
 * LarpLess design tokens. CONTRACTS.md §9.
 *
 * Light: cool desk-paper canvas, white raised surfaces, one cobalt accent.
 * Dark: the landing site (site/src/style.css). Warm paper ink on #10110F,
 * cream as the accent, borders instead of shadows. Same hue, lightness steps only.
 * This is the ONLY file in src/ui that may contain hex colour values.
 *
 * `colors`, `tag`, and `heat` are mutated in place by `applyScheme`. Style
 * objects that must follow the scheme go through `themed()` so they read the
 * tokens at render time instead of baking them in at load.
 */
import { Platform } from 'react-native';
import type { ChunkKind, TagColor } from '../contracts/domain';

export type SchemeName = 'light' | 'dark';

export interface Palette {
  bg: string;
  /** Cards, fields, and secondary buttons sitting on the canvas. */
  raised: string;
  /** Quiet band behind page titles. Same hue as the canvas, a step deeper. */
  wash: string;
  sidebar: string;
  /** Pale accent fill for the selected nav row. */
  accentSoft: string;
  text: string;
  muted: string;
  /** Lighter than muted: placeholders, disabled text, secondary icons. */
  faint: string;
  border: string;
  hover: string;
  /** Pressed / selected row background (a notch darker than hover). */
  active: string;
  accent: string;
  accentHover: string;
  /** Text on accent backgrounds. */
  onAccent: string;
  /** Dimmed backdrop behind the ⌘K palette. */
  backdrop: string;
  /** Inline code and code blocks. */
  codeBg: string;
  codeText: string;
  /** Soft shadow colour for the palette card (almost no shadows elsewhere). */
  shadow: string;
}

export interface TagTone {
  bg: string;
  text: string;
}

const lightPalette: Palette = {
  bg: '#F3F5F8',
  raised: '#FFFFFF',
  wash: '#E6ECF3',
  sidebar: '#F3F5F8',
  text: '#152033',
  muted: '#4C5D72',
  faint: '#5E7086',
  border: '#E2E7EE',
  hover: '#E8EDF3',
  active: '#DDE3EC',
  accent: '#1E4ED8',
  accentHover: '#1A45C2',
  accentSoft: '#E8EEFB',
  onAccent: '#FFFFFF',
  backdrop: '#15203366',
  codeBg: '#1E4ED814',
  codeText: '#C2413B',
  shadow: '#152033',
};

const lightTags: Record<TagColor, TagTone> = {
  gray: { bg: '#E7ECF2', text: '#4C5D72' },
  brown: { bg: '#F4EEEE', text: '#9F6B53' },
  orange: { bg: '#FBECDD', text: '#D9730D' },
  yellow: { bg: '#FBF3DB', text: '#CB912F' },
  green: { bg: '#EDF3EC', text: '#448361' },
  blue: { bg: '#E7F3F8', text: '#337EA9' },
  purple: { bg: '#F6F3F9', text: '#9065B0' },
  pink: { bg: '#FAF1F5', text: '#C14C8A' },
  red: { bg: '#FDEBEC', text: '#D44C47' },
};

/** Heatmap intensities: 0 min, <15, <30, <60, ≥60 (greens). */
const lightHeat: [string, string, string, string, string] = [
  '#E4E9F0',
  '#D3E5D2',
  '#A6CCA4',
  '#6DAA75',
  '#448361',
];

/**
 * Dark ramp from the landing site. Faint is one step lighter than the site's
 * #8F8A82 so hints still clear 4.5:1 on a selected row.
 */
const darkPalette: Palette = {
  bg: '#10110F',
  raised: '#1C1D1A',
  wash: '#242522',
  sidebar: '#10110F',
  text: '#F4F1EA',
  muted: '#C8C3B8',
  faint: '#9B968E',
  border: '#F4F1EA29',
  hover: '#2A2B28',
  active: '#343532',
  accent: '#F4F1EA',
  accentHover: '#E4DFD4',
  accentSoft: '#30302E',
  onAccent: '#161614',
  backdrop: '#10110FCC',
  codeBg: '#1C1D1A',
  codeText: '#E07A74',
  shadow: '#000000',
};

/** Green, blue, red, and gray match the site's stage colors. The rest keep their hue, lifted in OKLCH. */
const darkTags: Record<TagColor, TagTone> = {
  gray: { bg: '#222220', text: '#C8C3B8' },
  brown: { bg: '#3F2F28', text: '#DEB3A0' },
  orange: { bg: '#432D1F', text: '#EBAF85' },
  yellow: { bg: '#3F301B', text: '#DFB67B' },
  green: { bg: '#1A2420', text: '#6FBF8E' },
  blue: { bg: '#1A242C', text: '#7EB0D4' },
  purple: { bg: '#392D42', text: '#CFAEEA' },
  pink: { bg: '#432A36', text: '#EBA6C5' },
  red: { bg: '#2A1C1B', text: '#E07A74' },
};

const darkHeat: [string, string, string, string, string] = [
  '#2A2B28',
  '#3D6B4E',
  '#4F8A62',
  '#7DBA8E',
  '#C8EAD4',
];

const schemes: Record<SchemeName, { colors: Palette; tag: Record<TagColor, TagTone>; heat: typeof lightHeat }> = {
  light: { colors: lightPalette, tag: lightTags, heat: lightHeat },
  dark: { colors: darkPalette, tag: darkTags, heat: darkHeat },
};

let activeScheme: SchemeName = 'light';

export const TAG_COLORS: TagColor[] = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
];

function cloneTags(src: Record<TagColor, TagTone>): Record<TagColor, TagTone> {
  const out = {} as Record<TagColor, TagTone>;
  for (const key of TAG_COLORS) out[key] = { ...src[key] };
  return out;
}

/** Live tokens. Mutated by `applyScheme`; identity stays stable. */
export const colors: Palette = { ...lightPalette };
export const tag: Record<TagColor, TagTone> = cloneTags(lightTags);
export const heat: [string, string, string, string, string] = [...lightHeat];

/** Point the live tokens at a scheme. Safe to call during render; a no-op when it already matches. */
export function applyScheme(name: SchemeName): void {
  if (name === activeScheme) return;
  activeScheme = name;
  const next = schemes[name];
  Object.assign(colors, next.colors);
  for (const key of TAG_COLORS) {
    tag[key].bg = next.tag[key].bg;
    tag[key].text = next.tag[key].text;
  }
  for (let i = 0; i < heat.length; i++) heat[i] = next.heat[i];
}

/**
 * Style objects that read tokens when a property is touched, so a scheme
 * change restyles the next render. The factory must be module-level.
 */
export function themed<T extends Record<string, unknown>>(factory: () => T): T {
  let cachedScheme: SchemeName | null = null;
  let cached: T | null = null;
  return new Proxy({} as T, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (cached === null || cachedScheme !== activeScheme) {
        cached = factory();
        cachedScheme = activeScheme;
      }
      return cached[prop as keyof T];
    },
  });
}

/** PostScript names of the bundled fonts (CONTRACTS.md §9, verified with mdls). */
const macFonts = {
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
  serif: 'InstrumentSerif-Regular',
  serifItalic: 'InstrumentSerif-Italic',
  mono: 'Menlo',
};

/**
 * react-native-windows (Fabric) can't load bundled fonts yet (microsoft/react-native-windows#16339), so
 * Windows uses system fonts. DirectWrite names each weight as its own family ("Segoe UI Semibold"), so the
 * weight stays encoded in the family name exactly like the macOS PostScript names. Segoe UI has no Medium.
 * Instrument Serif's italic needs `fontStyle: 'italic'` on Windows (see Text.tsx).
 */
const windowsFonts: typeof macFonts = {
  regular: 'Segoe UI',
  medium: 'Segoe UI',
  semibold: 'Segoe UI Semibold',
  serif: 'Georgia',
  serifItalic: 'Georgia',
  mono: 'Consolas',
};

export const fonts = Platform.OS === 'windows' ? windowsFonts : macFonts;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = 8;

export const motion = { fast: 140, base: 180, slow: 240 } as const;

export const layout = {
  sidebarWidth: 240,
  contentMaxWidth: 900,
  contentPadding: 48,
  coverHeight: 72,
  controlHeight: 32,
} as const;

/** Tag colour that represents a chunk kind (status dot, panel tint, timeline). */
export const kindColor: Record<ChunkKind | 'break' | 'paused' | 'starting', TagColor> = {
  subject: 'green',
  distracted: 'red',
  away: 'gray',
  unknown: 'gray',
  break: 'blue',
  paused: 'gray',
  starting: 'gray',
};
