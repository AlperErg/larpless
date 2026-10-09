/**
 * Distraction fast path: a frontmost app / window title that matches one of these is "Not study"
 * without a screenshot. Plain "YouTube" is deliberately absent (it may be a lecture; the VLM decides).
 */

export interface DistractionRule {
  /** Shown in the UI and used as the chunk activity, e.g. "Instagram". */
  label: string;
  /** Case-insensitive pattern tested against `appName + ' ' + windowTitle`. */
  pattern: RegExp;
}

// Word boundaries keep "x.com" from matching "netflix.com" and "steam" from matching "mainstream".
export const DISTRACTION_RULES: readonly DistractionRule[] = [
  { label: 'YouTube Shorts', pattern: /\byoutube shorts\b|youtube\.com\/shorts\b/i },
  { label: 'Instagram', pattern: /\binstagram\b/i },
  { label: 'TikTok', pattern: /\btiktok\b/i },
  { label: 'Facebook', pattern: /\bfacebook\b/i },
  { label: 'Reddit', pattern: /\breddit\b/i },
  { label: 'X', pattern: /(^|[^a-z0-9.])x\.com\b/i },
  { label: 'Twitter', pattern: /\btwitter\b/i },
  { label: 'Netflix', pattern: /\bnetflix\b/i },
  { label: 'Twitch', pattern: /\btwitch\b/i },
  { label: 'Discord', pattern: /\bdiscord\b/i },
  { label: 'WhatsApp', pattern: /\bwhatsapp\b/i },
  { label: 'Messenger', pattern: /\bmessenger\b/i },
  { label: 'Steam', pattern: /\bsteam\b/i },
  { label: 'Amazon', pattern: /\bamazon\b/i },
];

export function matchDistraction(
  appName: string | null | undefined,
  windowTitle: string | null | undefined,
): { activity: string } | null {
  const hay = `${appName ?? ''} ${windowTitle ?? ''}`.trim();
  if (!hay) return null;
  for (const rule of DISTRACTION_RULES) {
    if (rule.pattern.test(hay)) return { activity: rule.label };
  }
  return null;
}
