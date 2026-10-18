# Empty pack: how to set up your semester

1. **Copy it, don't edit it in the repo.** Copy this folder to `local/<name>/`
   (e.g. `cp -r packs/empty local/my-semester`). `local/` is excluded by
   `.gitignore`, so your data stays on your computer.
2. **Edit `pack.json`:** `id`, `title`, semester dates. `subjects` lists the
   subject IDs in display order, `dojos` the dojo IDs. `settings.language` sets
   the language the AI uses (`en` by default, `de` for German).
3. **One file per subject** in `subjects/<id>.json` (template: `example.json`).
   The ID must match in the file name, inside the file and in `pack.json`.
4. **Dojos** go in `dojos/<id>.json`. Ready-made templates are in
   `packs/dojo-library/` and in the demo pack.
5. **Check:** `npm run validate -- local/my-semester`
6. **Open:** in the app choose "Open pack folder …" (Chrome/Edge), or run
   `LC_PACK_DIR=local/my-semester npm run dev` (any browser).

It is quicker with an AI: open the repo in Claude Code and say for example
"Create a pack for my semester in local/, here are my subjects and exam
dates: …". The rules for this are in `CLAUDE.md`.

## Fields at a glance

| Field | Meaning |
| --- | --- |
| `exam.format` | `written` written exam, `talk` talk or oral exam, `project` project, `unknown` unclear |
| `topics[].status` | `new`, `shaky`, `solid`, `skip` (never quizzed) |
| `topics[].due` | next review date (YYYY-MM-DD) |
| `chapters[]`, `topics[].chapter` | optional parts of a subject (script chapters); the learner switches chapters on once the lecture has happened |
| `topics[].questions[]` | prepared cards; the app adds `stats` and `blocked` itself, do not write them |
| `sheets[].status` | `open`, `done`, `checked` |
| `checks[].kind` | `material` (e.g. Moodle), `script` (script version), `notes` (own notes), `other` |
| `checks[].everyDays` | after this many days a check counts as stale |

All details are in `schema/*.schema.json`.
