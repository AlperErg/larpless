/**
 * LarpLess design tokens. CONTRACTS.md §9.
 *
 * Cool desk-paper canvas, white raised surfaces, one cobalt accent.
 * This is the ONLY file in src/ui that may contain hex colour values.
 * Tokens are grouped per scheme so a `dark` set can be added later (cut item 4);
 * only `light` ships today, and `colors` / `tag` point at it.
 */
import type { ChunkKind, TagColor } from '../contracts/domain';

export type SchemeName = 'light';

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
