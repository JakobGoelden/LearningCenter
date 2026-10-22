// Validates learning packs against /schema. Usage:
//   npm run validate                  # all packs under packs/
//   npm run validate -- local/my-pack # specific pack folders
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { drillProblems } from '../src/dojo/drills.ts';
import { automatonBlockProblems } from '../src/dojo/automatonBlock.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = join(root, 'schema');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const f of readdirSync(schemaDir)) ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, f), 'utf8')));
const BASE = 'https://github.com/JakobGoelden/LearningCenter/schema/';
const v = (name) => ajv.getSchema(`${BASE}${name}.schema.json`);

let failures = 0;
function fail(msg) {
  failures++;
  console.error(`  ✗ ${msg}`);
}
function checkFile(path, name) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`${path}: ${e.message}`);
    return null;
  }
  const fn = v(name);
  if (!fn(data)) {
    for (const e of fn.errors) fail(`${path} ${e.instancePath || '/'} ${e.message}`);
    return null;
  }
  return data;
}

// Checks what the schema cannot: unique ids, known topics, answers that fit
// the options, and reference expressions/automata that actually work.
function checkDrills(where, dojo, topics) {
  const ids = new Set();
  let unsourced = 0;
  for (const drill of dojo.drills ?? []) {
    if (ids.has(drill.id)) fail(`${where}: duplicate drill id "${drill.id}"`);
    ids.add(drill.id);
    if (drill.topic && topics && !topics.has(drill.topic)) fail(`${where}: drill "${drill.id}" has unknown topic "${drill.topic}"`);
    for (const p of drillProblems(drill)) fail(`${where}: drill "${drill.id}" ${p}`);
    if ((drill.origin === 'exam' || drill.origin === 'adapted') && !drill.source) fail(`${where}: drill "${drill.id}" has origin "${drill.origin}" but no source (which exam, which task)`);
    if (drill.level === 'exam' && !drill.origin) unsourced++;
    for (const text of [drill.prompt, drill.explanation, drill.solution]) {
      for (const p of automatonBlockProblems(text ?? '')) fail(`${where}: drill "${drill.id}" automaton block: ${p}`);
    }
  }
  if (unsourced) console.warn(`  ! ${where}: ${unsourced} exam-level drill(s) without "origin" (exam, adapted or made-up)`);
}

function checkPack(dir) {
  console.log(`• ${dir}`);
  const pack = checkFile(join(dir, 'pack.json'), 'pack');
  if (!pack) return;
  const topicIds = new Map();
  for (const id of pack.subjects) {
    const s = checkFile(join(dir, 'subjects', `${id}.json`), 'subject');
    if (!s) continue;
    if (s.id !== id) fail(`subjects/${id}.json has id "${s.id}"`);
    const ids = new Set();
    for (const t of s.topics) {
      if (ids.has(t.id)) fail(`subjects/${id}.json: duplicate topic id "${t.id}"`);
      ids.add(t.id);
      const qids = new Set();
      for (const q of t.questions ?? []) {
        if (qids.has(q.id)) fail(`subjects/${id}.json: topic "${t.id}" has duplicate question id "${q.id}"`);
        qids.add(q.id);
        for (const p of automatonBlockProblems(`${q.prompt}\n${q.answer ?? ''}`)) {
          fail(`subjects/${id}.json: topic "${t.id}" question "${q.id}" automaton block: ${p}`);
        }
      }
    }
    topicIds.set(id, ids);
    const sheetIds = new Set();
    for (const sh of s.sheets ?? []) {
      if (sheetIds.has(sh.id)) fail(`subjects/${id}.json: duplicate sheet id "${sh.id}"`);
      sheetIds.add(sh.id);
      for (const task of sh.tasks ?? []) {
        for (const p of automatonBlockProblems(task.text)) fail(`subjects/${id}.json: sheet "${sh.id}" task "${task.id}" automaton block: ${p}`);
      }
      if (sh.file && !/^https?:\/\//.test(sh.file) && !existsSync(join(dir, sh.file))) {
        console.warn(`  ! subjects/${id}.json: sheet "${sh.id}" file not found: ${sh.file}`);
      }
    }
    const work = join(dir, 'work', id);
    if (existsSync(work)) {
      for (const f of readdirSync(work).filter((f) => f.endsWith('.json'))) {
        const w = checkFile(join(work, f), 'work');
        if (w && !sheetIds.has(w.sheet)) fail(`work/${id}/${f}: unknown sheet "${w.sheet}"`);
      }
    }
  }
  for (const id of pack.dojos ?? []) {
    const d = checkFile(join(dir, 'dojos', `${id}.json`), 'dojo');
    if (!d) continue;
    if (d.id !== id) fail(`dojos/${id}.json has id "${d.id}"`);
    if (!topicIds.has(d.subject)) fail(`dojos/${id}.json: unknown subject "${d.subject}"`);
    for (const t of d.topics ?? []) {
      if (!topicIds.get(d.subject)?.has(t)) fail(`dojos/${id}.json: unknown topic "${t}"`);
    }
    checkDrills(`dojos/${id}.json`, d, topicIds.get(d.subject));
  }
  const sessions = join(dir, 'sessions');
  if (existsSync(sessions)) {
    for (const f of readdirSync(sessions).filter((f) => f.endsWith('.json'))) checkFile(join(sessions, f), 'session');
  }
  const log = join(dir, 'log', 'events.jsonl');
  if (existsSync(log)) {
    readFileSync(log, 'utf8').split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      try {
        if (!v('event')(JSON.parse(line))) fail(`log/events.jsonl:${i + 1} invalid event`);
      } catch {
        fail(`log/events.jsonl:${i + 1} is not JSON`);
      }
    });
  }
}

const args = process.argv.slice(2);
const dirs = args.length
  ? args.map((a) => resolve(a))
  : readdirSync(join(root, 'packs'))
      .map((d) => join(root, 'packs', d))
      .filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'pack.json')));

for (const d of dirs) checkPack(d);

if (!args.length) {
  const lib = join(root, 'packs', 'dojo-library');
  console.log(`• ${lib}`);
  for (const f of readdirSync(lib).filter((f) => f.endsWith('.json'))) {
    const d = checkFile(join(lib, f), 'dojo');
    if (d) checkDrills(`dojo-library/${f}`, d, null);
  }
}

if (failures) {
  console.error(`\n${failures} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll packs valid.');
