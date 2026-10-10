// In-memory Postgres (PGlite) in a plain Node child process, driven over IPC by test/pglite.ts.
// PGlite loads Node built-ins with dynamic import(), which Jest's sandbox can't run without
// --experimental-vm-modules, so it lives out here instead.
import { PGlite } from '@electric-sql/pglite';

const db = await PGlite.create();

async function run({ op, sql, params, role, sub }) {
  if (op === 'exec') {
    await db.exec(sql);
    return { rows: [], affectedRows: 0 };
  }
  if (op === 'query') return db.query(sql, params);
  // 'as': one statement as an API caller (role + JWT subject), in its own transaction.
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? '']);
    await tx.exec(`set local role ${role}`);
    return tx.query(sql, params);
  });
}

process.on('message', async (msg) => {
  try {
    const res = await run(msg);
    process.send({ id: msg.id, ok: true, rows: res.rows, affectedRows: res.affectedRows ?? 0 });
  } catch (e) {
    process.send({ id: msg.id, ok: false, message: e?.message ?? String(e), code: e?.code ?? null });
  }
});

process.send({ ready: true });
