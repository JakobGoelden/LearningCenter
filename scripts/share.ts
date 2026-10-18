// Shares cards and dojos with friends through a git repository (one folder per subject).
// Usage (from the repo root):
//   npm run share -- status <pack-dir> [--repo <dir>]
//   npm run share -- pull   <pack-dir> [--repo <dir>] [--git] [--enable]
//   npm run share -- push   <pack-dir> [--repo <dir>] [--git] [--subject <id>]... [--author <name>]
// --repo     clone of the shared repository (remembered in <pack-dir>/shared.json)
// --git      pull: `git pull --ff-only` first; push: commit and push afterwards
// --enable   pull: switch new chapters on (default: off, choose them on the subject page)
// --subject  push: also create this subject in the repo (subjects already in the repo are always pushed)
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { appendEvent, loadPack, savePack, saveDojo, saveSubject, toJson } from '../src/storage/repo';
import { emptyState, pull, push, readChangelog, readTree, type ShareState, type SharedTree } from '../src/sharing/shared';
import { NodeFs } from './node-fs';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const values = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--repo', '--subject', '--author'].includes(args[i - 1])));
const [command, packDir] = positional;
if (!['status', 'pull', 'push'].includes(command ?? '') || !packDir) {
  console.error('Usage: npm run share -- <status|pull|push> <pack-dir> [--repo <dir>] [--git] [--enable] [--subject <id>]... [--author <name>]');
  process.exit(2);
}

const fs = new NodeFs(packDir);
const STATE_PATH = 'shared.json';
const stateText = await fs.read(STATE_PATH);
const state: ShareState = stateText ? { ...emptyState(), ...JSON.parse(stateText) } : emptyState();
const repoDir = resolve(values('repo')[0] ?? state.repo ?? '');
if (!values('repo')[0] && !state.repo) {
  console.error('Tell me where the shared repository is cloned: --repo <dir>');
  process.exit(2);
}
state.repo = repoDir;

const git = (...a: string[]) => execFileSync('git', ['-C', repoDir, ...a], { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

async function readRepo(dir: string, base = ''): Promise<SharedTree> {
  const tree: SharedTree = new Map();
  for (const e of await readdir(join(dir, base), { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) for (const [k, v] of await readRepo(dir, rel)) tree.set(k, v);
    else if (/\.(json|jsonl|md)$/.test(e.name)) tree.set(rel, await readFile(join(dir, rel), 'utf8'));
  }
  return tree;
}

async function writeRepo(before: SharedTree, after: SharedTree) {
  for (const [path, text] of after) {
    if (before.get(path) === text) continue;
    await mkdir(dirname(join(repoDir, path)), { recursive: true });
    await writeFile(join(repoDir, path), text, 'utf8');
  }
  for (const path of before.keys()) if (!after.has(path)) await rm(join(repoDir, path), { force: true });
}

if (command === 'pull' && flag('git')) {
  try {
    git('pull', '--ff-only');
  } catch {
    console.error('git pull failed; going on with what is in the folder.');
  }
}

const tree = await readRepo(repoDir);
const loaded = await loadPack(fs);
const log = readChangelog(tree);
const newLog = log.slice(state.changelogSeen);

if (command === 'status') {
  const shared = readTree(tree);
  console.log(`Repo ${repoDir}: ${shared.subjects.size} subjects, ${shared.topics.size} topics, ${shared.dojos.size} dojos, ${log.length} changelog entries (${newLog.length} new).`);
  for (const l of newLog.slice(-20)) console.log(`  ${l.ts.slice(0, 10)} ${l.by ?? '?'}: ${l.action} ${l.kind} ${l.subject}/${l.ref}`);
  const dry = pull(loaded, tree, state);
  console.log(dry.report.length ? `A pull would:\n${dry.report.map((r) => `  - ${r}`).join('\n')}` : 'A pull would change nothing.');
  const up = push(loaded, tree, state, { subjects: values('subject') });
  console.log(up.report.length ? `A push would:\n${up.report.map((r) => `  - ${r}`).join('\n')}` : 'A push would change nothing.');
  process.exit(0);
}

if (command === 'pull') {
  const res = pull(loaded, tree, state, { enableNewChapters: flag('enable') });
  const before = new Map(loaded.subjects.map((s) => [s.id, toJson(s)]));
  for (const s of res.loaded.subjects) if (before.get(s.id) !== toJson(s)) await saveSubject(fs, s);
  const beforeDojos = new Map(loaded.dojos.map((d) => [d.id, toJson(d)]));
  for (const d of res.loaded.dojos) if (beforeDojos.get(d.id) !== toJson(d)) await saveDojo(fs, d);
  if (toJson(res.loaded.pack) !== toJson(loaded.pack)) await savePack(fs, res.loaded.pack);
  await fs.write(STATE_PATH, toJson({ ...res.state, changelogSeen: log.length }));
  if (res.changed) await appendEvent(fs, { type: 'share.pull', actor: 'app', data: { changes: res.report.length } });
  for (const l of newLog.slice(-20)) console.log(`  ${l.ts.slice(0, 10)} ${l.by ?? '?'}: ${l.action} ${l.kind} ${l.subject}/${l.ref}`);
  console.log(res.report.length ? res.report.map((r) => `- ${r}`).join('\n') : 'Nothing new.');
}

if (command === 'push') {
  let author = values('author')[0];
  if (!author) {
    try {
      author = git('config', 'user.name');
    } catch {
      /* unnamed */
    }
  }
  const res = push(loaded, tree, state, { subjects: values('subject'), ...(author ? { author } : {}) });
  await writeRepo(tree, res.tree);
  await fs.write(STATE_PATH, toJson(res.state));
  console.log(res.report.length ? res.report.map((r) => `- ${r}`).join('\n') : 'Nothing to push.');
  if (res.written.length) {
    await appendEvent(fs, { type: 'share.push', actor: 'app', data: { files: res.written.length } });
    if (flag('git')) {
      git('add', '-A');
      git('commit', '-m', `Update cards and dojos${author ? ` (${author})` : ''}`);
      git('push');
      console.log('Committed and pushed.');
    } else console.log(`Written to ${repoDir}. Commit and push it (or run again with --git).`);
  }
}
