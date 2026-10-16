// `npm start`: the one command after downloading. Without a personal pack it
// starts the guided setup in Claude Code right away (no "set me up" needed);
// with a pack it starts the app on it.
//   npm start            setup if needed, otherwise the app
//   npm run setup        always the setup (continue an unfinished one)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { personalPacks, ROOT } from './packs.mjs';

const win = process.platform === 'win32';
const forceSetup = process.argv.includes('--setup');

const SETUP_PROMPT =
  'I just downloaded LearningCenter. Start the guided setup from ONBOARDING.md right now and lead me step by step: ' +
  'install, my subjects and exams, scripts, timetable, exercise sheets and notes, then topics, questions and dojos, and finally start the app with my pack. ' +
  'If a pack in local/ already has open items in SETUP.md, continue there.';

function has(cmd) {
  return spawnSync(win ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
}

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: win, env: { ...process.env, ...env } });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

async function setup() {
  console.log('\n  LearningCenter: no personal pack yet, so the setup starts now.\n');
  if (has('claude')) {
    console.log('  Claude Code opens and leads you through the setup. Answer its questions; it does the rest.\n');
    // With shell (Windows) the prompt needs quotes; without, it is passed as is.
    await run('claude', [win ? JSON.stringify(SETUP_PROMPT) : SETUP_PROMPT]);
    return true;
  }
  console.log(
    [
      '  Claude Code is not installed (https://claude.com/claude-code).',
      '  Either install it and run `npm start` again, or open this folder in your AI tool',
      '  (Claude desktop app, Codex, Cursor, …): the setup starts with your first message, whatever you write.',
      '',
    ].join('\n'),
  );
  return false;
}

if (!existsSync(join(ROOT, 'node_modules'))) {
  console.log('Installing dependencies …');
  if ((await run('npm', ['install'])) !== 0) process.exit(1);
}

let packs = personalPacks();
const unfinished = packs.find((p) => p.setupOpen > 0);
if (forceSetup || !packs.length) {
  const ran = await setup();
  packs = personalPacks();
  if (!ran || !packs.length) process.exit(0);
} else if (unfinished) {
  console.log(`\n  ${unfinished.dir}/SETUP.md still has ${unfinished.setupOpen} open items. Continue with: npm run setup\n`);
}

const pack = process.env.LC_PACK_DIR || packs[0].dir;
console.log(`  Starting the app with ${pack} …\n`);
process.exit(await run(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')], { LC_PACK_DIR: pack }));
