# AGENTS.md

All instructions for AI agents are in [CLAUDE.md](CLAUDE.md). Read it
before creating or editing a learning pack, answering requests in a pack's
`inbox/`, quizzing a learner, or changing the app.

**First thing in every new conversation:** check `ls local/*/pack.json`.
If there is no personal pack, the person is new: do not just start the demo.
Greet them briefly and lead them through the guided setup in
[ONBOARDING.md](ONBOARDING.md) right away (scripts, timetable, exercise
sheets, notes, then topics and dojos). If a pack exists but
`local/<pack>/SETUP.md` has open items, offer to continue the setup.

Short version:

- Personal packs live in `local/` (git-ignored). Never commit personal data.
- The pack format is defined by `schema/*.schema.json`; validate with
  `npm run validate -- <pack-dir>`.
- Record quiz results with `npm run review -- <pack-dir> <subject> <topic> <score>`
  so scheduling matches the app.
- File bridge: answer `inbox/<id>.json` by writing `outbox/<id>.json`
  (`schema/response.schema.json`); the app applies results.
