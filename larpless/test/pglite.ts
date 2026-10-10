/// <reference types="node" />
/** Client for test/pgliteServer.mjs: a throwaway in-memory Postgres for schema/RLS tests. */
import { fork } from 'child_process';
import type { ChildProcess } from 'child_process';
import { join } from 'path';

export interface QueryResult<T> {
  rows: T[];
  affectedRows: number;
}

/** Rejection from Postgres; `code` is the SQLSTATE (e.g. 42501 insufficient privilege / RLS). */
export class PgError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
  }
}

export interface TestPostgres {
  exec(sql: string): Promise<void>;
  /** As the superuser (bypasses RLS, like the service role). */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** As an API caller: `role` is anon or authenticated, `sub` the user id auth.uid() returns. */
  as<T = Record<string, unknown>>(role: string, sub: string | null, sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  close(): Promise<void>;
}

export async function startTestPostgres(): Promise<TestPostgres> {
  const child: ChildProcess = fork(join(__dirname, 'pgliteServer.mjs'), [], { serialization: 'advanced', stdio: 'inherit' });
  const pending = new Map<number, { resolve: (v: QueryResult<never>) => void; reject: (e: Error) => void }>();
  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`pgliteServer exited with ${code} before it was ready`)));
    child.once('message', () => resolve());
  });
  child.removeAllListeners('exit');
  child.on('exit', (code) => {
    pending.forEach((p) => p.reject(new Error(`pgliteServer exited with ${code}`)));
    pending.clear();
  });
  child.on('message', (msg: { id: number; ok: boolean; rows?: never[]; affectedRows?: number; message?: string; code?: string | null }) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve({ rows: msg.rows ?? [], affectedRows: msg.affectedRows ?? 0 });
    else p.reject(new PgError(msg.message ?? 'error', msg.code ?? null));
  });

  const send = <T>(msg: Record<string, unknown>) =>
    new Promise<QueryResult<T>>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: QueryResult<never>) => void, reject });
      child.send({ id, ...msg });
    });

  return {
    exec: async (sql) => {
      await send({ op: 'exec', sql });
    },
    query: (sql, params = []) => send({ op: 'query', sql, params }),
    as: (role, sub, sql, params = []) => send({ op: 'as', role, sub, sql, params }),
    close: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill();
      }),
  };
}
