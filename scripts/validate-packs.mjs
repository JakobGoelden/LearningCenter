// Validates learning packs against /schema. Usage:
//   npm run validate                  # all packs under packs/
//   npm run validate -- local/my-pack # specific pack folders
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

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
    }
    topicIds.set(id, ids);
  }
  for (const id of pack.dojos ?? []) {
    const d = checkFile(join(dir, 'dojos', `${id}.json`), 'dojo');
    if (!d) continue;
    if (d.id !== id) fail(`dojos/${id}.json has id "${d.id}"`);
    if (!topicIds.has(d.subject)) fail(`dojos/${id}.json: unknown subject "${d.subject}"`);
    for (const t of d.topics ?? []) {
      if (!topicIds.get(d.subject)?.has(t)) fail(`dojos/${id}.json: unknown topic "${t}"`);
    }
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
  for (const f of readdirSync(lib).filter((f) => f.endsWith('.json'))) checkFile(join(lib, f), 'dojo');
}

if (failures) {
  console.error(`\n${failures} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll packs valid.');
