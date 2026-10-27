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

## To-do (in this order)

1. **Topic notes private.** `share push` currently sends topic `notes` to Semester3, and they contain
   personal progress remarks ("Stand 26.10.: … falsch"). Notes should stay local, while shared notes
   from the repo can still come in. Careful: push and pull share the hash state in `shared.json`
   (`state.items[topicKey]`); if only push stops sending notes, pull may overwrite local notes.
   Add tests for both directions.
2. ~~**Don't overwrite pulled cards.**~~ Done: `updateSubjectFile`/`updatePackFile` (`repo.ts`) compare
   the file's mtime with the one stored when it was loaded or last saved (`context.tsx`) and, if it
   changed, apply the change to the version on disk instead (`tests/freshsave.test.ts`). A small
   window remains between the mtime check and the write.
3. **PWA + offline** (the admin learns on the train). Installable app, service worker for the app
   shell, cards, dojos and progress cached on the device, per-subject "available offline" for PDFs,
   answers queued while offline and written when back online.
4. **Progress as an event log** so offline answers from several devices merge without conflicts
   (append-only events, schedule recomputed from them). Needed for 3.
5. **Invite codes** (server side, with the admin): a single-use code that renews after each sign-up,
   expires after 7 days, plus a small admin page (users, codes, block/delete). Today the admin adds
   users by hand with `adduser.sh`.
