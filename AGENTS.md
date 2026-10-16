# AGENTS.md

All instructions for AI agents are in [CLAUDE.md](CLAUDE.md). Read it
before creating or editing a learning pack, answering requests in a pack's
`inbox/`, quizzing a learner, or changing the app.

To set up LearningCenter for a new learner (install, find course material
and personal notes, create and start a pack), follow [ONBOARDING.md](ONBOARDING.md).

Short version:

- Personal packs live in `local/` (git-ignored). Never commit personal data.
- The pack format is defined by `schema/*.schema.json`; validate with
  `npm run validate -- <pack-dir>`.
- Record quiz results with `npm run review -- <pack-dir> <subject> <topic> <score>`
  so scheduling matches the app.
- File bridge: answer `inbox/<id>.json` by writing `outbox/<id>.json`
  (`schema/response.schema.json`); the app applies results.
