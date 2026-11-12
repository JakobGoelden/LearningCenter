// Moves a pack's progress into the event log (see src/progress/migrate.ts).
// Usage (from the repo root):
//   npm run progress -- check   <pack-dir>   replay test only, writes nothing
//   npm run progress -- migrate <pack-dir>   baseline events + switch, only if the replay is exact
//   npm run progress -- status  <pack-dir>   mode, number of progress events, unusable log lines
import { today } from '../src/lib/dates';
import { migratePack } from '../src/progress/migrate';
import { unknownRules } from '../src/progress/ops';
import { loadPack } from '../src/storage/repo';
import { NodeFs } from './node-fs';

const [cmd, dir] = process.argv.slice(2);
if (!dir || !['check', 'migrate', 'status'].includes(cmd)) {
  console.error('Usage: npm run progress -- check|migrate|status <pack-dir>');
  process.exit(2);
}
const fs = new NodeFs(dir);

if (cmd === 'status') {
  const loaded = await loadPack(fs);
  const ev = loaded.progress?.events ?? [];
  console.log(
    `${loaded.pack.id}: ${loaded.pack.progress === 'events' ? 'events' : 'files'}; ${ev.length} progress events` +
      (loaded.progress ? `, ${loaded.progress.skipped} unusable lines, ${unknownRules(ev).length} of unknown rules` : ''),
  );
} else {
  const r = await migratePack(fs, { write: cmd === 'migrate', on: today() });
  console.log(`${r.pack}: ${r.subjects} subjects, ${r.topics} topics, ${r.cards} cards, ${r.events} baseline events`);
  if (r.diffs.length) {
    console.log(r.migrated ? `SWITCHED WITH WARNINGS:` : `NOT switched, ${r.diffs.length} differences:`);
    for (const d of r.diffs.slice(0, 20)) console.log('  ' + d);
    process.exit(1);
  }
  console.log(cmd === 'migrate' ? (r.migrated ? 'migrated: replay matches every file exactly' : 'NOT switched') : 'check ok: replay matches every file exactly (nothing written)');
}
