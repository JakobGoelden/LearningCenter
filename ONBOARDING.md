# ONBOARDING.md: Setting up LearningCenter for a person

This file is for an AI (Claude Code, Codex, Cursor, …) that installs
LearningCenter for a learner and creates a personal semester. Start it
whenever there is no personal pack in `local/` yet (see CLAUDE.md, "Start
here"), no matter how the person opened the conversation: "set me up",
"hi", "what is this?" or "start the app" all mean the same here.

## How to lead the setup

- **You lead, the person helps.** Most people do not know what the app
  needs. Tell them what comes next and why in one sentence, then do it
  together. They only do what only they can do: log in, click download,
  answer questions. You do everything else (folders, reading files, JSON,
  topics, dojos).
- **One step at a time, together.** For each source, tell the person exactly
  where to click and where to save the file (create the folder for them
  first), wait until they say it is done, then check the folder and read
  what arrived. Do not move on with a step half done.
- **Ask in batches.** Only ask what you cannot find out yourself, one block
  of questions per step, not one question per message.
- **Their language.** Talk to the person in their language, even though this
  guide is in English.
- **The demo is not the goal.** Never end the setup by showing `packs/demo`.
  The setup is done when the person's own pack has their subjects,
  timetable, scripts, sheets, topics and dojos, or when the person
  explicitly postpones an item (it then becomes an open task in the pack).
- **Keep a checklist** in `local/<pack>/SETUP.md` (see step 2) and tick items
  off as you go, so a later conversation can continue where this one
  stopped. Show the person the checklist after every step.

The rules for data format, grading and due dates are in
[CLAUDE.md](CLAUDE.md). Read them before step 4.

---

## 1. Install

Requirements: Git and Node.js ≥ 18.19 (`node -v`). If Node is missing, tell
the person the right way for their system (e.g. `nvm`, a package manager or
nodejs.org) and wait until it is installed.

```bash
git clone https://github.com/JakobGoelden/LearningCenter.git
cd LearningCenter
npm install
npm test            # must pass
npm run validate    # checks the included packs
```

If the repo is already cloned, `git pull` and `npm install` are enough.

## 2. Get to know the person

Ask in one block, and offer examples so the answers come easily:

1. **Semester:** name (e.g. "Winter 2026/27"), start and end of the lecture
   period, language for quiz questions. The default is English; for German
   questions set `settings.language: "de"` (in the app: Settings → Study plan
   → AI language → Deutsch).
2. **Subjects:** name, short name, and per subject the exam: format (written
   exam, presentation or oral exam, project, still unclear), date and time if
   known, allowed aids (e.g. a specific calculator, one A4 sheet).
3. **Timetable:** where their timetable lives (university portal, Moodle,
   a PDF, a calendar app) and which tutorial or lab group they are in.
4. **Scripts and exercise sheets:** per subject, where the script or slides
   and the exercise sheets are published, and the sheets' due day.
5. **Study rhythm:** how many questions per quiz, whether weekends should stay
   free.
6. **AI connection in the app:** file bridge with Claude Code (recommended if
   you are Claude Code), own API key, or Copy-Prompt for any chat. Briefly
   explain the differences (see README).

Do not invent dates. Whatever is unknown becomes an open task in the pack.

Then create the pack folder right away, so everything from step 3 has a
place to go:

```bash
cp -r packs/empty local/<pack>      # e.g. local/wise26
mkdir -p local/<pack>/material/<subject-id>/sheets local/<pack>/notes/<subject-id>   # per subject
```

and write `local/<pack>/SETUP.md` with one line per item, for example:

```markdown
# Setup checklist

- [x] Installed, tests pass
- [x] Semester, subjects and exams collected
- [ ] Timetable (.ics export from the campus system)
- [ ] DB: script / slides
- [ ] DB: exercise sheets with tasks
- [ ] DB: own notes
- [ ] Theo: script / slides
- [ ] …
- [ ] Topics per subject from the scripts
- [ ] Dojos with drills for every procedure
- [ ] Pack valid, app started with the pack, first quiz done
```

`SETUP.md` is for you and the person; the app ignores it.

## 3. Collect timetable, scripts, sheets and notes

This step is the core of the setup. The app is only as good as what you put
into the pack here, so do not skip parts of it. Go through it **together
with the person**, in this order: scripts first (they are the source for
topics and dojos), then the timetable, then the exercise sheets, then the
notes. For each item:

1. Ask where it lives (Moodle, campus system, chair website, …), if you do
   not know yet.
2. Tell them exactly what to click to download it and which folder to save
   it to (the folder already exists from step 2).
3. Wait until they say it is there, then list the folder and read the
   files. If something is missing or the wrong file, say so right away.
4. Tick it off in `SETUP.md`.

For **every subject** you need:

| What | Goes to | Used for |
| --- | --- | --- |
| Timetable (lectures, tutorials, labs) | `schedule` in `subjects/<id>.json` | calendar on the dashboard, subject page |
| Current script or slides | `material/<subject-id>/` + a `script` check | topics, quiz questions |
| Exercise sheets | `material/<subject-id>/sheets/` + `sheets[]` with `file` and `tasks` | solving sheets in the app |
| Own notes | `notes/<subject-id>/` + a `notes` check | comparing notes with the script |

If something does not exist or the person cannot get it right now, create an
open task for it (e.g. "Upload timetable PDF", "Script for DB not published
yet") instead of leaving it out silently.

Access without touching credentials, for everything in this step:

- **Preferred:** the person downloads the files and puts them into the pack
  folder (paths below). Tell them exactly where to click.
- You may fetch public pages yourself if you have a web tool.
- If the person has set up a sync tool (e.g. a Moodle downloader or a synced
  cloud folder), read from its target folder.
- **Never** ask for, store or write passwords, tokens or session cookies to
  files. Logins are the person's job.

### 3a. Scripts and slides

For **every subject**, get the current script (or the slides, if there is no
script) into `local/<pack>/material/<subject-id>/`. Typical places:

- The university's learning platform: **Moodle**, ILIAS, Stud.IP, OLAT, Canvas
- The chair's website, GitLab/GitHub, shared cloud folders
- A printed script or a book (then ask for photos or a scan of the table of
  contents at least)

In Moodle, downloading usually works per course via "Download all files" or
per section; in ILIAS via "Download" on the folder.

Read the script once completely, or at least its table of contents and
chapter openings: the topics in step 4 come from it. Note the version or
date printed on it, so later updates can be noticed.

Record every source as a check in the subject, so the dashboard shows when
it was last looked at:

```json
{ "id": "moodle", "kind": "material", "label": "Moodle course", "url": "https://moodle.example.edu/course/view.php?id=1234", "everyDays": 3 }
{ "id": "script", "kind": "script", "label": "Script", "version": "v1.2", "url": "material/db/script.pdf", "everyDays": 14 }
```

`url` may be a link or a path relative to the pack folder.

### 3b. Timetable

Ask where the timetable is and get it as a file. Typical sources:

- The university's campus system (e.g. HISinOne, LSF, TUMonline, Campus
  Management): most have an **iCal / .ics export** of the personal timetable.
  This is the best source: every weekly `VEVENT` with `RRULE:FREQ=WEEKLY`
  becomes one entry.
- A timetable PDF or a screenshot: read it page by page.
- The course page in Moodle or the course catalogue, per subject.
- If nothing exists as a file, the person dictates it.

Save the file as `local/<pack>/material/timetable.ics` (or `.pdf`, `.png`)
and fill `schedule` per subject:

```json
"schedule": [
  { "kind": "lecture", "weekday": "mon", "start": "10:00", "end": "12:00", "location": "Main lecture hall" },
  { "kind": "tutorial", "weekday": "wed", "start": "14:00", "end": "16:00", "location": "Room 2.031", "notes": "group B" }
]
```

`kind` is `lecture`, `tutorial`, `lab`, `seminar` or `other`. Only put in the
tutorial group the person actually attends. Use `from` / `until` for classes
that start late or end early, and `notes` for things like "every other week".
Never guess times or rooms; ask, or create an open task. Add a check so the
timetable gets looked at again after changes:

```json
{ "id": "timetable", "kind": "material", "label": "Timetable", "url": "material/timetable.ics", "everyDays": 30 }
```

### 3c. Exercise sheets

The person solves exercise sheets directly in the app: clicking a sheet opens
it next to an editor. For that, every sheet needs:

1. The file in `local/<pack>/material/<subject-id>/sheets/` (e.g.
   `sheet-03.pdf`), referenced in `file`. A PDF, an image or a Markdown file
   works. If the sheet is only online, `file` may be the https link.
2. The tasks as text in `tasks`, so the person can answer them one by one.
   Extract them from the PDF: keep the original numbering as `label`, the
   full task text as Markdown in `text` (formulas as plain text, e.g.
   `x^2 + 1`, tables as Markdown tables), and `points` if given. Subtasks
   (a, b, c) may stay inside one task or become their own task, whichever
   fits how the sheet is graded.

```json
{
  "id": "b3", "label": "Sheet 3", "due": "2026-11-03", "status": "open",
  "file": "material/theo/sheets/sheet-03.pdf",
  "tasks": [
    { "id": "1", "label": "Task 1", "points": 4, "text": "Construct the DFA for …" },
    { "id": "2a", "label": "Task 2a", "points": 2, "text": "Which language …" }
  ]
}
```

The person's answers end up in `work/<subject-id>/<sheet-id>.json`. Never
change them; read them only when the person asks for feedback.

### 3d. Own notes

Ask what the person takes notes with, and help with the export:

| Tool | Way to readable files |
| --- | --- |
| **reMarkable** | In the reMarkable app (desktop/phone), export the notebook as PDF; or via USB: enable "USB web interface" in the tablet settings, then open `http://10.11.99.1` in the browser and download PDFs; or with a cloud CLI like `rmapi` if the person has set it up. The reMarkable app can turn handwriting into text ("Convert to text"); otherwise read the PDF pages as images. |
| GoodNotes, Notability, OneNote | Export as PDF |
| Obsidian, Notion, Markdown | Folder or Markdown export |
| Paper | Photos or scans (e.g. a phone scanner app) as PDF |

Storage: `local/<pack>/notes/<subject-id>/`. Plus one check per subject:

```json
{ "id": "notes", "kind": "notes", "label": "Lecture notes (reMarkable)", "url": "notes/db/", "everyDays": 7 }
```

`material/` and `notes/` are inside the pack folder under `local/`, so they
never end up in Git.

## 4. Build the pack

The folder exists since step 2. Now fill it from the material, following
CLAUDE.md, part A:

1. `pack.json`: title, semester, settings from step 2, list of subjects.
2. One `subjects/<id>.json` per subject with exam, `schedule` (step 3b),
   checks (3a, 3d) and exercise sheets with `file` and `tasks` (3c). Sheets
   that are not published yet but have a known date go in as `open` with
   `due` and without `file`.
3. **Derive topics from the material:** go through the table of contents of
   the script or slides, one exam-relevant concept per topic. In `notes`,
   put scope, source (chapter, slide) and typical mistakes. Everything gets
   `status: "new"`. Anything that is only background gets `skip`.
4. **Compare with the notes:** whatever is in the person's own notes but not
   in the script (or the other way round) becomes an open task, e.g.
   "Notes lecture 3: BCNF example missing from the script". Missing slides or
   unclear exam info also become open tasks.
5. **Dojos:** one dojo for every calculation or construction procedure in the
   material. First look for templates in `packs/dojo-library/` and
   `packs/demo/dojos/`, otherwise write a new one (`schema/dojo.schema.json`).
   Put the exam's allowed aids (e.g. the allowed calculator) into `aids`.
   Then fill each dojo with **drills**, the prepared exercises the app runs
   on its own as a timed practice round (format and rules: CLAUDE.md →
   Dojos → Drills). Aim for 8–15 per dojo across `easy`, `medium` and
   `exam`, taken from the person's material (sheet tasks, old exams, script
   examples) where possible. Ideas by subject type:
   - Calculations (subnetting, statistics, physics): `number` with a
     sensible `tolerance` and `unit`, `input` for addresses or short results.
   - Formal languages: `automaton` (build a DFA/NFA, determinize, minimize)
     and `regex` (write a regex for a language or an automaton), graded by
     language equivalence.
   - Procedures with fixed steps (algorithms, proofs by induction,
     normalization): `order` for the steps, `choice` for the decisions in
     between.
   - Concepts and definitions (any subject): `choice` with typical mistakes
     as wrong options.
   - Languages and vocabulary: `input` with all accepted spellings.
   - Proofs, essays, explanations: `self` with a model solution.
   Double-check every answer key before writing it.
6. Log everything you create as an event in `log/events.jsonl`
   (`actor: "ai"`).
7. `npm run validate -- local/<pack>` must report "All packs valid.".

Then show the person a short overview: subjects, exams with dates, classes
per week, scripts found, sheets with tasks, number of topics per subject,
dojos with their number of drills, open tasks. Ask whether anything is
missing, and update `SETUP.md`.

## 5. Start

```bash
LC_PACK_DIR=local/<pack> npm run dev
```

Always start the app with the person's own pack like this, not with the
demo.

The app opens in the browser by itself (otherwise <http://localhost:5173>).
In **Settings → AI connection**,
choose the AI connection from step 2. With the file bridge, Claude Code runs
in the pack folder with "Process the inbox" (see CLAUDE.md, Processing the
inbox). If you are Claude Code yourself, you can take this over directly and
wait for new requests.

Finally, have the person start a first quiz in the first subject (or ask it
directly in the chat and record it with `npm run review`), so that due dates
get created.

## 6. Afterwards: regular upkeep

Suggest this routine to the person and carry it out when they ask for it:

- **"What's new?"** (e.g. twice a week): look at the check sources, have new
  files put into `material/`, compare the script version, create new topics,
  add new exercise sheets with `file` and `tasks`, update the timetable if it
  changed, set `lastChecked`.
- **"Check my sheet <n>"**: read `work/<subject>/<sheet>.json` against the
  tasks and give feedback per task (grading rules in CLAUDE.md), without
  changing the answers.
- **"Compare my notes"**: read new notes against the script and the topics,
  gaps become open tasks, new concepts become topics.
- **"Quiz me on <subject>"** and **"Dojo <procedure>"**: see CLAUDE.md.
- **"More exercises for <dojo>"**: write new drills into the dojo file
  (different from the existing ones, focused on topics that are `shaky`),
  then validate. In the app the button "+ 5 new exercises with AI" does the
  same through the AI connection.
- **"How am I doing?"**: due and overdue topics, exams in the next two
  weeks, open sheets, outdated checks.

At the end of the setup, tick off the last items in `SETUP.md` and put short
phrases the person can say to you at any time as a list in your final
message.
