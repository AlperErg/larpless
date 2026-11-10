#!/usr/bin/env node
/**
 * Prints the built-in subject library as JSON ([{ id, name, keywords, group, core, general }]) so bench.py scores
 * against the same subjects as the app, from one source of truth. `group` is the SUBJECT_GROUPS title the subject
 * first appears under (Sciences, Computing, Humanities...), for the bench's per-area report. `core` subjects can't
 * be turned off; `general` is the name of the subject this one is labelled as while it's off (bench.py --rollup),
 * or null. Node 24 strips the types of subjectLibrary.ts.
 *
 *   node scripts/embed_bench/export_subjects.mjs
 */
import { generalSubjectId, isCoreSubject, LIBRARY_MODULES, SUBJECT_GROUPS } from '../../src/core/subjectLibrary.ts';

const groupOf = new Map();
for (const g of SUBJECT_GROUPS) for (const s of g.presets) if (!groupOf.has(s.name)) groupOf.set(s.name, g.title);

const nameOf = new Map(LIBRARY_MODULES.map((m) => [m.id, m.name]));

process.stdout.write(
  JSON.stringify(
    LIBRARY_MODULES.map(({ id, name, keywords }) => ({
      id,
      name,
      keywords,
      group: groupOf.get(name) ?? '-',
      core: isCoreSubject(id),
      general: nameOf.get(generalSubjectId(id)) ?? null,
    })),
  ),
);
