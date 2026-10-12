#!/usr/bin/env node
/**
 * Checks that the app's fusion (src/core/screenModel.ts fuseScores) gives the same answers as the bench
 * (bench.py fused_predict with APP_PARAMS) on the same numeric scores. Run from larpless/:
 *
 *   scripts\embed_bench\.venv\Scripts\python -I scripts\embed_bench\bench.py --offline --dump-scores <file>
 *   node scripts/embed_bench/parity.mjs <file>
 *
 * The dump holds numbers only (logits, cosines, keyword counts, character counts): no text, no pixels.
 */
import { readFileSync } from 'node:fs';
import { fuseScores } from '../../src/core/screenModel.ts';

const { modules, items } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let same = 0;
let right = 0;
for (const it of items) {
  const v = fuseScores(it.scores, modules);
  const label = !v ? null : v.studying ? modules.find((m) => m.id === v.moduleId).name : 'Not study';
  const [benchLabel, benchConf] = it.bench;
  const agree = label === benchLabel && Math.abs((v?.confidence ?? 0) - benchConf) < 1e-6;
  same += agree;
  right += it.accept.includes(label);
  if (!agree) console.log(`MISMATCH ${it.file}: app ${label} ${v?.confidence.toFixed(4)} vs bench ${benchLabel} ${benchConf.toFixed(4)}`);
}
console.log(`parity ${same}/${items.length} identical · app top-1 ${right}/${items.length}`);
process.exit(same === items.length ? 0 : 1);
