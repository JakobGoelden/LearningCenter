# CLAUDE.md

Guide for AI assistants (Claude Code, Codex, Cursor, …) in this repo.

## Start here, in every new conversation

Before you answer anything else, check whether the person already has a
personal pack: `ls local/*/pack.json`.

- **No pack yet:** the person is new. Do **not** just start the demo, explain
  the repo or wait for instructions. Greet them in one or two sentences,
  say what you are going to do together, and start the guided setup in
  [ONBOARDING.md](ONBOARDING.md) right away, even if they only said "hi",
  "what is this?" or "start the app". You lead: get their scripts, their
  timetable, their exercise sheets and notes into a pack together with them,
  then build topics and dojos from that material. For pages behind a login
  (Moodle, the campus system) use a browser you can control if you have
  one: the person logs in there, you click and download (ONBOARDING.md,
  step 3). `packs/demo` is only an example to look at; it is never the
  result of a setup.
- **Pack found:** work with it (part A). If `local/<pack>/SETUP.md` still has
  open items (or the pack obviously lacks subjects, timetable, scripts,
  topics or dojos), offer to continue the setup where it stopped before
  doing anything else. If there are new results since your last sync (see
  "Processing new results"), offer to process them.

There are two kinds of tasks: **maintaining learning packs** (part A) and
**developing the app** (part B). Answer learners in their language; quiz
questions and feedback follow the pack's `settings.language` (default `en`).
Code, identifiers and commit messages are in English.

---

## A. Maintaining learning packs

### Privacy first

- Personal packs live in `local/<name>/`. That folder is excluded via
  `.gitignore`. **Never** commit personal data and never write to `packs/`:
  `packs/demo`, `packs/empty` and `packs/dojo-library` are public examples for
  everyone who uses the repo.
- If a pack lives outside the repo, the same rules apply.

### Structure of a pack

```
local/<name>/
  pack.json              manifest: title, semester, settings, subject and dojo IDs
  subjects/<id>.json     one subject: exam, timetable, topics (with history), sheets, open tasks, checks
  dojos/<id>.json        dojo definitions (pure data)
  sessions/<id>.json     logs of quizzes and dojos
  log/events.jsonl       event log, one JSON line per event, append only
  material/<subject-id>/ downloaded scripts, slides, sheets (optional)
  work/<subject-id>/<sheet-id>.json  the person's answers to a sheet, written in the app
  shared.json            sync state with a shared card repository (written by `npm run share`)
  notes/<subject-id>/    own notes as PDF/Markdown, e.g. reMarkable export (optional)
  inbox/<id>.json        requests from the app (file bridge)
  outbox/<id>.json       your answers to them
```

The format is fully described in `schema/*.schema.json` (JSON Schema
2020-12, with a description per field). The schema is authoritative.

### Creating a pack

1. `cp -r packs/empty local/<name>` (name as a slug, e.g. `wise26`).
2. `pack.json`: set `id`, `title`, `semester`. `subjects` and `dojos` list
   the IDs in display order; every ID needs a matching file.
3. One `subjects/<id>.json` per subject. IDs are slugs (`a-z0-9._-`) and must
   match the file name. Delete `example.json` and remove it from `pack.json`.
4. **Topics:** one exam-relevant concept per topic, typically 8–30 per
   subject. `notes` describes scope and source (e.g. "Lecture 3, script 2.4;
   typical mistake: …"). This is the most important context for good
   questions. New topics get `status: "new"` and no `due`.
   **Questions:** give every topic 2–4 prepared `questions`
   (`{id, prompt, kind, answer}`). The app runs quizzes with them on its own,
   no AI and no copied prompt needed: one question per topic per quiz, in
   turn. `prompt` tests understanding (why, what if, explain, apply), not
   wording; `answer` lists the key points of a good answer (Markdown bullets,
   plus a typical mistake). The learner sees the key points after answering
   and grades themselves, or lets you grade later. In flashcard mode the
   learner answers in their head, flips to the key points and rates
   right/partly/wrong, so `answer` is what makes a good card: keep it short
   enough to check at a glance. A topic without
   questions gets a general "explain it" question.
   **Automata in Markdown:** wherever Markdown is shown (cards, sheet tasks,
   drill prompts and explanations), a fenced block with the language
   `automaton` is drawn as a state diagram. Write it as lines
   `start: q0`, `final: q2` (optional `states: q0, q1, q2`) and one
   transition per line, `q0 -a-> q1` or `q0 -a,b-> q1` (`ε`/`eps` for
   ε-transitions, `#` for comments); the JSON of a drill `reference` works
   too. `npm run validate` checks that every such block can be drawn.
   **Formulas:** LaTeX between `$…$`, `$$…$$`, `\(…\)` or `\[…\]` is
   rendered with KaTeX. A `$` that is glued to a word or quote, or followed
   by a space or punctuation, stays a literal dollar (regex anchors, the
   parser token `$`). Short plain notation also works without delimiters:
   `x_i`, `x_{ij}`, `2^n`, `π_{a,b}` become sub- and superscripts. Use `$…$`
   for anything bigger (fractions, sums, cases).
5. **Exam:** `format` is `written` (written exam), `talk` (presentation/oral),
   `project` or `unknown`. Do not invent a date: if it is unknown, leave out
   `date` and create an open task.
6. **Checks:** `material` (e.g. Moodle), `script` (script version in
   `version`), `notes` (own notes). `everyDays` marks them as outdated if
   they have not been checked for too long. `url` says where to look (link to
   the course or a path in the pack like `material/db/`).
7. **Timetable:** `schedule` lists weekly classes (`kind`, `weekday`
   `mon`…`sun`, `start`, `end`, optional `location`, `from`, `until`,
   `notes`). Take it from the person's timetable (an .ics export is best),
   never guess.
8. **Exercise sheets:** `file` points at the sheet (path in the pack such as
   `material/db/sheets/sheet-02.pdf`, or an https link) and `tasks` holds the
   tasks as Markdown (`id`, `label`, `text`, optional `points`), extracted
   from the sheet. With both, the person can solve the sheet in the app.
   Their answers land in `work/<subject-id>/<sheet-id>.json`
   (`work.schema.json`); never edit them, read them only to give feedback
   when asked. The one exception is working on a sheet together in the
   chat (see "Working on a sheet in the chat").
9. Validate: `npm run validate -- local/<name>`. Again after **every** change.

### When editing

- Indent JSON with 2 spaces, keep the `$schema` line.
- Never delete or rewrite a topic's `history`, only append.
- Append every content change as an event, e.g.
  `{"ts":"2026-10-16T09:00:00Z","type":"topic.add","actor":"ai","subject":"db","ref":"normal-forms","data":{"title":"Normal forms"}}`.
  Content additions use `topic.add`, `question.add`, `sheet.add`,
  `material.add` (new files in `material/`), `dojo.add` and
  `dojo.drills.add`, `share.pull`, `share.push`, always with `subject`: the dashboard shows per subject
  when new content last arrived.
  Common types: `topic.add`, `topic.status`, `topic.due`, `topic.review`,
  `sheet.status`, `openItem.add`, `openItem.done`, `check.done`, `exam.update`,
  `quiz.start`, `quiz.answer`, `quiz.graded`, `quiz.applied`, `dojo.task`,
  `dojo.check`, `ai.request`, `ai.response`.
- If the app is running, it notices changes to `pack.json`, `subjects/` and
  `dojos/` within a few seconds and reloads.

### What the app does and what you do

The app does the scheduling and the practice on its own: due dates and
intervals (spaced repetition, below), quizzes, flashcards, drills, and
**endless mode** (a button on every subject page: cards for as long as the
person wants, weak cards more often). You are not needed for any of that. Your
role is **weak-spot detector and study partner**:

- read `history`, `sessions/`, `work/` and the per-card `stats` to find what
  keeps going wrong, then fix the cause: a sharper `notes`, better or
  additional questions, drills, open tasks;
- explain, tutor and quiz in the chat when the person wants a human-style
  conversation;
- write the content the app practises (topics, questions, dojos, drills).

Do not reschedule topics by hand and do not "grade for the app": the app
records what the person rated. Only record grades yourself for answers given
in the chat (`npm run review`).

**Cards.** A card is a prepared `question` of a topic. Besides `id`, `prompt`,
`kind` and `answer` it carries two fields that only the app writes (never
edit or reset them; read them):

- `stats`: `{seen, recent, last}`, the number of answers, the last five
  scores and the date. Cards with low recent scores are drawn more often in
  endless mode; this priority is separate from the topic schedule, and endless
  answers do not move `due`. A card answered in a normal quiz also adds to its
  stats. Use it to find weak cards: low `recent` scores point at a question
  that is unclear or a topic that needs explaining.
- `blocked: true`: the person blocked the card ("Block this card" on the
  answer page, or in endless mode). It is never asked again but stays in the
  file; do not delete, unblock or re-create it, and do not write a replacement
  that asks the same thing. A topic whose cards are all blocked is not quizzed.

### Chapters

A subject can be split into `chapters` (`{id, title, enabled?}`) with the
topics pointing to one via `topic.chapter` (a dojo can have `chapter` too).
Use them when the whole script is already there (math, theory): one chapter per
script chapter, so the person switches on only the ones whose lecture has
happened (subject page → Chapters, or `enabled` in the file). Topics of a
switched-off chapter are left out of quizzes, study, endless mode, the
calendar and the progress bar. Create chapters when you set up such a subject;
never switch one on or off for the person.

### Sharing cards and dojos with friends

A git repository (one per semester, e.g. `Semester3`) holds the cards and
dojos everybody wrote, so they only have to be made once. Layout, one folder
per subject:

```
repo.json, changelog.jsonl
<subject>/subject.json                    {id, name, short?, color?}
<subject>/topics/<topic>.json             {id, title, notes?, questions: [...]}
<subject>/dojos/<dojo>.json               a dojo file
<subject>/<chapter>/chapter.json          {id, title, order?}
<subject>/<chapter>/topics|dojos/...      same, for subjects split into chapters
```

Only content is shared (a card's `prompt`, `kind`, `answer`; topic title and
notes; whole dojos with drills). Stats, blocks, schedules, history, sheets and
sessions stay in the pack. Commands (`src/sharing/shared.ts`, `scripts/share.ts`):

- `npm run share -- status local/<name> --repo <clone>`: the new changelog
  lines and what a pull or push would do.
- `npm run share -- pull local/<name> --repo <clone> [--git] [--enable]`: adds
  new topics, cards and dojos (topics `status: "new"`, new chapters switched
  off unless `--enable`), updates cards the person did not touch. If both
  sides changed a card, the person's version stays and it is reported.
- `npm run share -- push local/<name> [--git] [--subject <id>]`: writes new and
  edited cards, topics and dojos into the clone and appends the changelog.
  Subjects the repo does not have yet need `--subject`. Blocked cards are never
  pushed. If the repo changed the same item meanwhile, it says "pull first".
- `--git` runs `git pull --ff-only` before a pull, and commit + push after a
  push; without it the person commits themselves.

The repo path and the version of every item at the last sync live in
`<pack>/shared.json` (written by the script; never edit it). A card the person
blocked stays blocked through every pull. A card removed upstream stays in the
pack and is not pushed back. Before pushing, check that the cards are good
(the rules for writing questions above apply, because others will use them) and
that nothing personal is in `notes`. When the person says "sync with the
repo": status, pull, review what came in (sanity-check, tell them about
conflicts), then push what they added.

### Due dates and spaced repetition

Same rules as in the app (`src/scheduling/scheduler.ts`). The ladder is in
`pack.json` → `settings.reviewLadder` (default `1, 3, 7, 14, 21, 35, 60`
days).

| Grade | New interval | Status |
| --- | --- | --- |
| 4–5 | one step up, at least step 2 (3 days); if the topic was `shaky`, at most step 3 (7 days) | `solid` |
| 3 | step 1 or 2 (1 or 3 days) | `shaky` |
| 0–2 | step 1 (1 day) | `shaky` |

- `due` = date of the quiz + interval. If it falls on Sat/Sun and
  `settings.skipWeekends` is not `false`, move it to Monday.
- `skip` ("do not quiz") is never due and never quizzed.
- **Always record grades with the script**, so the rules stay exactly the
  same:
  `npm run review -- local/<name> <subject-id> <topic-id> <score> [quiz|dojo|manual] ["note"]`
  The script appends to `history`, sets `status`, `due`, `intervalDays` and
  writes an event to the log.
- Only set due dates by hand if the person explicitly wants it (e.g.
  "don't quiz me on normal forms until after the exercise class on Thursday").

### Grading fairly (scale 0–5)

| Score | Meaning |
| --- | --- |
| 0 | no answer or "don't know" |
| 1 | wrong |
| 2 | big gaps |
| 3 | right at the core, with gaps |
| 4 | right |
| 5 | right and well reasoned |

- Understanding counts, not wording. Right ideas in the person's own words get
  full marks; typos, notation and formatting do not matter as long as the
  content is clear.
- Name gaps concretely: what is missing, why it matters, what would be right
  (1–3 sentences). No lecturing that is unrelated to the answer.
- For calculation procedures, count follow-on errors only once.
- When in doubt, ask instead of guessing, but at most once per question.

### Processing the inbox (file bridge)

When the person clicks "Quiz" or works in a dojo, the app writes a request to
`inbox/<id>.json` (schema: `schema/request.schema.json`).
"Process the inbox" means:

1. Read all files in `inbox/`, oldest first (the ID starts with a
   timestamp).
2. The `prompt` field contains the complete task including context and the
   expected answer format. Follow it; `context` holds the same data in
   structured form.
3. Write the answer to `outbox/<id>.json`, same `id`, with `requestId` and
   `kind` from the request plus the field for the request type:

   | `kind` | Field |
   | --- | --- |
   | `quiz.start` | `questions: [{topicId, kind, prompt}]` (exactly `count` questions) |
   | `quiz.grade` | `grades: [{n, score, feedback, gaps}]`, optional `summary` |
   | `dojo.task` | `task` (Markdown) |
   | `dojo.check` | `check: {correct, score, steps: [{label, ok, comment}], feedback}` |
   | `dojo.hint` | `hint` |
   | `dojo.solution` | `solution` (Markdown) |
   | `dojo.drills` | `drills` (exactly `count` new drills, format see Dojos → Drills) |

   Validate against `schema/response.schema.json`.
4. Do **not** delete the inbox file and do **not** change any topics: the app
   reads the answer, cleans up both files, and the person applies the result
   to their progress with a click.
5. If the person wants, keep waiting for new requests (e.g. check every few
   seconds) until they say "stop".

### Processing new results

Everything the learner does in the app is saved: quizzes, dojo rounds, sheet
answers. Until you have looked at it, the dashboard shows a banner "New
results for your AI" with a prompt to copy. When the person pastes it (or
says "Process my new results"):

1. Find what is new: events in `log/events.jsonl` after the last `ai.sync`
   event (all of them if there is none), not written by you (`actor` not
   `ai`). Relevant types: `quiz.applied`, `quiz.gradeLater`,
   `dojo.drill.round`, `dojo.applied`, `sheet.status` (to `done`),
   `sheet.work`. The sessions are in `sessions/<ref>.json`.
2. Grade open quizzes first (next section).
3. Look at the results: self-graded quiz answers (`sessions/`), dojo rounds
   (which drills went wrong, by `topicId`), sheets marked done (read
   `work/<subject>/<sheet>.json` against the sheet's `tasks`; never edit
   the answers). Grades that are already recorded stay as they are; do not
   run `npm run review` again for them.
4. Update the learning state where the results show a need: notes on
   typical mistakes in the topic's `notes`, new prepared `questions` for
   shaky topics, new drills in a dojo whose drills keep going wrong, open
   tasks for gaps that need the script or the exercise class. Log each
   change as an event and validate.
5. Append `{"ts":"<now>","type":"ai.sync","actor":"ai","data":{"quizzes":n,"dojo":n,"sheets":n}}`
   to `log/events.jsonl`. The banner disappears within seconds.
6. Tell the person in a few lines what you saw and what you changed, and
   name the next due dates.

### Grading open quizzes

At the end of a quiz in the app the learner picks "Check myself" or "Check
in chat". The second saves the answers in `sessions/<id>.json` with
`gradeLater: true` and copies a prompt naming that session; the dashboard
banner counts open ones too. When the prompt comes in, go through the
answers one at a time in the chat (the person may add something by voice
before you settle a score), then do steps 3–5. When the person says "Grade my open
quizzes" (or you notice open ones):

1. Find the sessions with `gradeLater: true` and without `applied: true`.
2. Grade every item by the rules in "Grading fairly": `prompt` is the
   question, `answer` the person's answer, `solution` the key points. Write
   `score`, `feedback` and `gaps` into each item, plus a short `summary`.
3. Record one grade per topic (average if a topic appears more than once)
   with `npm run review -- local/<name> <subject-id> <topic-id> <score> quiz "<session id>"`.
4. Set `applied: true` in the session and append a `quiz.applied` event
   with `ref` = the session id (`actor: "ai"`), so it no longer counts as
   open. Validate.
5. Tell the person the result per question in a few lines and name the
   next due dates.

### Quizzing directly in the chat

For "Quiz me on <subject>" without the app. Every start button in the app
has a partner "Start in chat" (Quiz, Study, Dojo) that copies a prompt with
the pack path and the chosen topics; follow it like this, taking the topics
from the prompt instead of picking them. The person may answer by voice:
ignore filler words and transcription slips.

1. Pick topics like the app does: first due/overdue ones (`due` ≤ today,
   oldest first), then `shaky`, then `new`; never `skip`. Default:
   `settings.questionsPerQuiz` questions, one per topic.
2. Ask the questions one at a time, numbered as "Question n/N". Mix question
   types: why, what if, explain in your own words, apply to an example.
3. After each answer, grade briefly (score + gaps). Give a summary at the end.
4. Record the results with `npm run review` (`source` = `quiz`) and optionally
   write a log `sessions/<id>.json` (schema `session.schema.json`, `id` e.g.
   `20261016T090000Z-quiz-db`).
5. Name the next due dates.

Ask in the pack's language (`settings.language`, default `en`). A person who
wants German questions can set Settings → Study plan → AI language to Deutsch
(or `settings.language: "de"` in `pack.json`).

### Working on a sheet in the chat

The sheet page has "Work on it in chat": it copies a prompt naming the
subject, the sheet and its work file. You are a tutor, not an answer key:

1. Read the sheet (`tasks`, and `file` if you can open it) and the person's
   answers so far in `work/<subject-id>/<sheet-id>.json`.
2. Go task by task. Let them try first, guide with questions and hints,
   check every step and say what is right and what is missing. Show a full
   solution only when they ask for it. They may answer by voice.
3. When you settle an answer and they agree, write it in their words into
   the work file (`answers.<task-id>`, `_` if the sheet has no tasks; keep
   the other answers, set `updatedAt`). Never overwrite an answer they wrote
   without asking. Append a `sheet.work` event (`actor: "ai"`, `subject`,
   `ref` = sheet id) once per session and validate. The open sheet page
   reloads the answers when the person comes back to it.
4. Do not change the sheet's `status`; the person marks it done in the app.
   At the end name the solid tasks and the topics worth reviewing.

### Dojos

A dojo is a file `dojos/<id>.json` (schema `dojo.schema.json`) and needs no
code. `promptTemplate` describes what tasks look like for the levels `easy`,
`medium`, `exam` and how to check them step by step; placeholders:
`{{level}}`, `{{procedure}}`, `{{subject}}`, `{{aids}}`, `{{language}}`.
`topics` links the dojo to topics whose progress can be updated after a
check. Templates: `packs/dojo-library/` and `packs/demo/dojos/`. Also add new
dojos to `pack.json` → `dojos`.

In the chat: set a task following `promptTemplate`, wait for the solution,
check it step by step, give a hint or model solution only on request.
Afterwards record the grade for the dojo's `topics` with `npm run review`
(`source` = `dojo`).

`symbols` (optional) lists formula symbols that the app offers as buttons
while answering, as characters (`["σ", "⋈"]`) or group names (`automata`,
`sets`, `numbers`, `logic`, `relational-algebra`, `compare`, `calculus`,
`powers`, `arrows`, `greek`, `brackets`; see `src/dojo/symbols.ts`). The
app also adds the symbols it finds in a task and its answer key, so set
`symbols` only when tasks need symbols they do not show.

#### Drills (practice rounds in the app)

`drills` in a dojo file are prepared exercises that run and get graded in the
app without an AI: the learner picks a level and a count, answers against a
timer, sees right/wrong with an explanation after each one and a result at
the end, and can save the round to their progress (right = 5, partly = 3,
wrong = 1, time up = 0, applied per `topic` of the drill, otherwise to the
dojo's `topics`). The button "+ 5 new exercises with AI" sends a
`dojo.drills` request and appends the answer to the dojo file.

Every drill has `id` (slug, unique in the dojo), `kind`, `prompt` (Markdown
with all data, tables as Markdown tables), and optionally `level`
(`easy`/`medium`/`exam`), `topic` (topic id of the subject), `explanation`
(shown after answering: why the answer is right) and `seconds` (time limit;
default 60/120/240 by level, doubled for `automaton`, `regex`, `self`).

| `kind` | Fields | Graded by |
| --- | --- | --- |
| `choice` | `options` (2–6), `correct` (0-based indexes, one or more) | exact set of picked options; partly if one off in a multi-answer question |
| `input` | `accept` (all accepted spellings), `caseSensitive?` | match ignoring case, extra spaces and spaces around punctuation |
| `number` | `answer`, `tolerance?` (default 0), `unit?` | within tolerance; `0,5` and `1.000,5` are understood |
| `order` | `items` in the right order (the app shuffles) | exact order; partly if at most two items are misplaced (4+ items) |
| `regex` | `alphabet` (single characters), `reference`, `given?` | same language as `reference`, shortest counterexample otherwise |
| `automaton` | `alphabet`, `reference`, `given?`, `deterministic?`, `minimal?` | same language; checks DFA/minimality if asked |
| `self` | `solution` (Markdown) | learner compares and rates right/partly/wrong |

`reference` is exactly one of `{"regex": "..."}` or `{"automaton": {...}}`;
an automaton is `{states, start, final, transitions: [[from, symbol, to]]}`
with `ε` for ε-transitions. Regex syntax: `|`, juxtaposition, `* + ?`,
parentheses, `ε` (or `eps`), `∅`. `given` shows an automaton as a table and a
state diagram in the task (e.g. "turn this NFA into a DFA"); the automaton
the learner types into the table is drawn live below it.

Writing good drills (for you as an AI):

- Pick the kind that lets the app check the real skill: a result as a number
  (`number`), a canonical short answer (`input`), a constructed language
  (`regex`/`automaton`), steps of a procedure (`order`), concepts and typical
  mistakes (`choice`). Use `self` only for proofs and explanations.
- One clearly right answer. For `input`, list every form you would accept
  (e.g. `{q0,q1}` and `{q1,q0}`); if there are too many, use `choice` or
  `number` instead.
- Wrong `choice` options are typical mistakes from the material, not
  nonsense.
- Mix levels: `easy` checks one step or a definition, `medium` a whole small
  run of the procedure, `exam` the size and wording of an exam task.
- Work out every answer yourself and double-check it: a wrong answer key is
  worse than no drill. `npm run validate -- local/<name>` checks the format,
  that references parse and that ids and topics exist.
- Examples for many kinds: `packs/demo/dojos/` (automata, SQL, relational
  algebra) and `packs/dojo-library/` (subnetting, fragmentation, routing,
  continuity).

### Understanding the current state

`log/events.jsonl` shows what the person clicked and answered; `sessions/`
holds the questions, answers and grades; `work/` holds their sheet answers. For an overview ("How am I doing in
databases?"), summarize topic status, due dates, overdue sheets, outdated
checks and open tasks.

---

## B. Developing the app

- Stack: Vite 6, TypeScript (strict), Preact, Ajv. No backend. Node ≥ 18.19.
- Commands: `npm start` (setup if there is no pack in `local/`, otherwise
  the app on the newest pack; `npm run setup` forces the setup), `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`,
  `npm run validate`. With `LC_PACK_DIR=local/<name> npm run dev` the app
  reads and writes a pack folder through the dev server (any browser).
  `npm run dev` opens the browser by itself; `BROWSER=none npm run dev`
  turns that off (e.g. for headless tests).
- Structure:
  - `schema/` JSON schemas (source of truth for the format)
  - `src/model/` types (mirror of the schema), validation, derived views
  - `src/scheduling/` spaced repetition
  - `src/storage/` `PackFs` backends (folder, dev server, browser), loading/saving, export
  - `src/ai/` building requests, checking answers, adapters (file bridge, API, Copy-Prompt)
  - `src/ui/` Preact components
  - `prompts/` prompt templates (Markdown with `{{placeholders}}`)
  - `tools/vite-pack-fs.ts` dev server file access
  - `src/sharing/` sharing cards and dojos through a git repository (pure functions, tested)
  - `scripts/` Node scripts (`validate-packs.mjs`, `review.ts`, `share.ts`)
- Always make format changes together in `schema/`, `src/model/types.ts`, the
  demo and empty packs, and this file. `npm test` and `npm run validate` must
  pass.
- UI texts in English, code and identifiers in English.
