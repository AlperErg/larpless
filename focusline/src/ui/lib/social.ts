/** Small helpers for the social UI (no react-native imports). */

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/network request failed|failed to fetch/i.test(msg)) return "Can't reach Supabase. Check your connection.";
  return msg;
}
