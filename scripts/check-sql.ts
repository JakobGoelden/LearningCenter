// Runs every SQL drill of a pack on the real database: `npm run check-sql -- local/<name>`.
// Separate from validate, which runs unattended and should not start a database.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Dojo } from '../src/model/types';
import { sqlProblems, type SqlDrill } from '../src/dojo/sql';

const dir = process.argv.filter((a) => a !== '--')[2];
if (!dir) throw new Error('usage: npm run check-sql -- <pack folder>');

let drills = 0;
let bad = 0;
for (const file of readdirSync(join(dir, 'dojos'))) {
  const dojo = JSON.parse(readFileSync(join(dir, 'dojos', file), 'utf8')) as Dojo;
  for (const d of dojo.drills ?? []) {
    if (d.kind !== 'sql') continue;
    drills++;
    for (const p of await sqlProblems(d as SqlDrill)) {
      bad++;
      console.error(`${file}: ${d.id}: ${p}`);
    }
  }
}
console.log(`${drills} SQL drills checked, ${bad} problems.`);
process.exit(bad ? 1 : 0);
