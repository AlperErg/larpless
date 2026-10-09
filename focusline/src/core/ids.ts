/** Short, stable-looking ids: `ses_lq3k9x2a7f`. Not cryptographic. */
export function newId(prefix: string, now: number = Date.now()): string {
  const rand = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `${prefix}_${now.toString(36)}${rand}`;
}

/** Deterministic chunk id within a session. */
export function chunkId(sessionId: string, index: number): string {
  return `chk_${sessionId.replace(/^ses_/, '')}_${String(index).padStart(3, '0')}`;
}
