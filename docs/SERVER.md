# Hosted LearningCenter (learn.goelden.dev)

The app also runs as a multi-user web app. Read this before changing storage, sharing or the build.

## How it works

- The static build (`dist/`) is served behind a login (HTTP basic auth). Each user has their own
  pack folder on the server.
- The server speaks the **same file API as the dev server** (`tools/vite-pack-fs.ts`):
  `/__lc/fs/{info,read,raw,write,append,remove,list,mtime}?path=…`. `DevFs.detect()` uses it in
  production builds too when `/__lc/fs/info` answers with JSON. **Keep this API stable**, or change
  the server (`learn/server.py` in the admin's server repo) at the same time.
- Every 15 min a sync job runs `npm run share -- push <pack> --repo Semester3 --git --author <user>`
  and then `share pull` for every user, against the private Semester3 repo. So `scripts/share.ts` and
  `src/sharing/shared.ts` run unattended for several users: keep them non-interactive and idempotent.
- Deploying: the admin runs `learn/deploy-app.sh` (pulls main, `npm ci`, `npm test`, build, upload).
  Tests must pass or nothing is deployed.

## AI prompts on the hosted app

A production build reports its pack as `kind: 'server'` with `sharedWithAi: false` (`DevFs.detect`),
because the person's AI cannot reach the files. So nothing may send it to a folder, `CLAUDE.md` or
`npm run review`, and the file bridge is off. Instead:

- Every "Start in chat" prompt carries its data (`src/ai/chat.ts`), and the results prompt is built
  from the log, sessions and sheet answers (`src/ai/results.ts`).
- Grades come back as a JSON block the person pastes into the app (`PasteGrades`, on the quiz page and
  in the dashboard banner). "Done, hide this" writes `ai.sync` with `actor: "user"`.
- Not covered yet: grades from a quiz run entirely in the chat and answers to a sheet stay in the
  chat, and the AI cannot change notes or cards from there.

- With the AI tools (`docs/API.md`) a person's own AI reaches the hosted pack through the file API
  with their login: `LC_URL`, `LC_USER`, `LC_PASSWORD`. Grades and card edits then work from the
  chat too.

## Read-only progress API

`/api/v1/*` (docs/API.md "Read-only HTTP API") is served by a separate container that runs
`dist-api/progress-api.mjs` (built with `npm run build:api`) with the user packs mounted read-only and
the token file in `learn/data/api/tokens.json` (hashes only; on the server, never in a repo). Caddy
routes `/api/v1/*` to it before the login check: the bearer token is the login. `deploy-app.sh`
builds and uploads the file too and restarts the container. Keep the answers free of anything
personal beyond the learning state (`tests/httpApi.test.ts` checks for notes, answers and names).

## SQL drills

`sql` drills run in the learner's browser (PGlite), so grading costs the server nothing. The engine
is a separate download of several MB, fetched only when a SQL drill opens and then cached by the
browser. Keep it that way: never import `@electric-sql/pglite` statically in app code.

## Format changes

The sync job on the T480 runs its own `~/LearningCenter` and validates every pack with that copy's
schema, and `sync.sh` does not update it. A new drill kind or field in a pack makes the sync fail for
that user until the T480 copy is updated. So for a format change: deploy the app, update the T480
(`git -C ~/LearningCenter pull --ff-only && (cd ~/LearningCenter && npm ci)`), and only then let the
new format reach Semester3.

## To-do (in this order)

1. ~~**Topic notes private.**~~ Done 2026-10-27: notes are never pushed or compared; repo notes come in
   with a new topic only. `share push` currently sends topic `notes` to Semester3, and they contain
   personal progress remarks ("Stand 26.10.: … falsch"). Notes should stay local, while shared notes
   from the repo can still come in. Careful: push and pull share the hash state in `shared.json`
   (`state.items[topicKey]`); if only push stops sending notes, pull may overwrite local notes.
   Add tests for both directions.
2. ~~**Don't overwrite pulled cards.**~~ Done: `updateSubjectFile`/`updatePackFile` (`repo.ts`) compare
   the file's mtime with the one stored when it was loaded or last saved (`context.tsx`) and, if it
   changed, apply the change to the version on disk instead (`tests/freshsave.test.ts`). A small
   window remains between the mtime check and the write.
3. ~~**Answers as events + PWA/offline.**~~ Done 2026-11-12 (app side), see below.
4. (merged into 3)
5. ~~**Admin page.**~~ Done 2026-11-12 at `/admin` (goelden-server 2df0cab): the current one-time
   join code (no expiry; once used, a new one is made), all users, block/delete (to a trash folder),
   action log. Replaces the fixed `LC_JOIN_CODE`.

## Answers as events, offline (2026-11-12)

Why: on 2026-11-12 a dropped phone upload cut jakob's `itr.json` in half, because the app uploaded the
whole ~1 MB subject file for every answer. The server now refuses incomplete uploads (c51e81c).

- **What is sent:** one `progress` event per answer (`src/progress/ops.ts`): `id` (made on the
  device), `ts`, `subject`, `ref`, `data: {op, rules, on, cfg?, …}`. Other log events get an `id` too.
- **Server:** `POST /__lc/events` with `{"events": [...]}` (max 500 events, 1 MB): validates each
  (`id`, `ts`, `type`), all-or-nothing; appends the new ones in one locked write, skipping ids it
  already has (resending is safe); answers `{accepted, added, mtime}`. The dev server has the same
  endpoint (`tools/events-endpoint.ts`). Hardening that came with it: 411 without Content-Length,
  atomic writes (mkstemp + fsync + replace), `.json` writes must parse, `.jsonl` appends must be whole
  lines, `ifMtime` conditional writes, Caddy `request_buffers`.
- **Progress:** lives only in the log once a pack is migrated (`pack.json` `"progress": "events"`).
  Subject files hold content; the app replays the events on load (`loadPack`), so the progress API,
  the AI tools and `share` see the same state. Content writers can no longer touch progress.
- **Rule changes are not retroactive** (admin's decision): every event carries its rules version;
  the replay uses the event's version.
- **Several devices:** events merge by `ts`, ids deduplicate, no conflicts.
- **Migration:** `npm run progress -- check|migrate <pack>`: one `baseline` event per topic with the
  file's progress, then the switch, only if the replay reproduces every subject file exactly (checked
  again after writing; undone otherwise). All 7 hosted packs were migrated on 2026-11-12 (server goelden-server 2df0cab, app 715f9fc); each matched its pre-migration backup (`data/state/migration-backup-20261112-193101/`) with 0 differences. On the server the tool runs as one file: `npm run build:progress`, copy `dist-progress/progress.mjs` to `/opt/goelden/learn/tools/`, then per user `docker run --rm -u 1000:1000 -v <pack>:/pack -v /opt/goelden/learn/tools:/tools:ro node:22-alpine sh -c 'flock /pack/log/events.jsonl node /tools/progress.mjs migrate /pack'`. Progress
  fields stay in the subject files for now; strip them only later, if ever.
- **Device:** answers go into an outbox in IndexedDB (one key per item, so tabs never overwrite each
  other) and show as done at once; they are sent on start, on `online`, when the app becomes visible,
  and with backoff (2 s … 60 s). Only `sessions/` and `work/` files may wait offline; subject and pack
  edits need a connection. The header says when answers could not be sent (offline, login expired,
  refused by the server; refused items are kept aside, never dropped).
- **PWA:** manifest + service worker (`public/sw.js`, rules in `public/sw-policy.js`). App shell and
  build files cached; pack reads network-first (4 s) with an offline copy; writes keep that copy
  current; a write based on an offline copy that is outdated on the server is refused (409). PDFs per
  subject "available offline" = later. Bump `VERSION` in `sw.js` when `sw-policy.js` changes.
- **iPhone:** no Background Sync, so sending happens while the app is open. Install via Share → "Add
  to Home Screen" (the app shows that hint), otherwise iOS deletes stored data after 7 days without a
  visit. The installed app has its own login.
- **Order of a rollout:** server endpoint live → app deployed (unmigrated packs behave exactly as
  before) → T480 app copy updated (format change: event `id`, pack `progress`) → migrate each pack.
