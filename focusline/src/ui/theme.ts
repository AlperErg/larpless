/**
 * Focusline design tokens (Notion-inspired). CONTRACTS.md §9.
 *
 * This is the ONLY file in src/ui that may contain hex colour values.
 * Tokens are grouped per scheme so a `dark` set can be added later (cut item 4);
 * only `light` ships today, and `colors` / `tag` point at it.
 */
import type { ChunkKind, TagColor } from '../contracts/domain';

export type SchemeName = 'light';

export interface Palette {
  bg: string;
  sidebar: string;
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
  bg: '#FFFFFF',
  sidebar: '#F7F6F3',
  text: '#37352F',
  muted: '#787774',
  faint: '#9B9A97',
  border: '#E9E9E7',
  hover: '#EFEFED',
  active: '#E3E2DF',
  accent: '#2383E2',
  accentHover: '#0077D4',
  onAccent: '#FFFFFF',
  backdrop: '#0F0F0F66',
  codeBg: '#87837826',
  codeText: '#EB5757',
  shadow: '#0F0F0F',
};

const lightTags: Record<TagColor, TagTone> = {
  gray: { bg: '#F1F1EF', text: '#787774' },
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
  '#EFEFED',
  '#D3E5D2',
  '#A6CCA4',
  '#6DAA75',
  '#448361',
];

export const schemes = {
  light: { colors: lightPalette, tag: lightTags, heat: lightHeat },
} as const;

/** Active scheme. Light only for now. */
export const colors: Palette = schemes.light.colors;
export const tag: Record<TagColor, TagTone> = schemes.light.tag;
export const heat = schemes.light.heat;

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

/** PostScript names of the bundled fonts (CONTRACTS.md §9, verified with mdls). */
export const fonts = {
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
  serif: 'InstrumentSerif-Regular',
  serifItalic: 'InstrumentSerif-Italic',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = 4;

export const motion = { fast: 150, base: 200, slow: 250 } as const;

export const layout = {
  sidebarWidth: 240,
  contentMaxWidth: 900,
  contentPadding: 48,
  coverHeight: 120,
  controlHeight: 28,
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
