#!/usr/bin/env node
/**
 * Prints the built-in subject library as JSON ([{ id, name, keywords }]) so bench.py scores against the
 * same 44 subjects as the app, from one source of truth. Node 24 strips the types of subjectLibrary.ts.
 *
 *   node scripts/embed_bench/export_subjects.mjs
 */
import { LIBRARY_MODULES } from '../../src/core/subjectLibrary.ts';

process.stdout.write(JSON.stringify(LIBRARY_MODULES.map(({ id, name, keywords }) => ({ id, name, keywords }))));
