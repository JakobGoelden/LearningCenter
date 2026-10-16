# ONBOARDING.md: Setting up LearningCenter for a person

This file is for an AI (Claude Code, Codex, Cursor, …) that installs
LearningCenter for a learner and creates a personal semester. The person
usually starts it like this:

> Read ONBOARDING.md and set up LearningCenter for me.

Work through the steps in order. Only ask what you cannot find out yourself,
and always in batches (one block of questions per step, not one question per
message). Talk to the person in their own language, even though this guide is
in English. The rules for data format, grading and due dates are in
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

## 3. Collect timetable, scripts, sheets and notes

This step is the core of the setup. The app is only as good as what you put
into the pack here, so do not skip parts of it. For **every subject** you need:

| What | Goes to | Used for |
| --- | --- | --- |
| Timetable (lectures, tutorials, labs) | `schedule` in `subjects/<id>.json` | "Today" line, subject page |
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

### 3a. Timetable

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

### 3b. Scripts and slides

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

## 4. Create the pack

```bash
cp -r packs/empty local/<pack>      # e.g. local/wise26
```

Then follow CLAUDE.md, part A:

1. `pack.json`: title, semester, settings from step 2, list of subjects.
2. One `subjects/<id>.json` per subject with exam, `schedule` (step 3a),
   checks (3b, 3d) and exercise sheets with `file` and `tasks` (3c). Sheets
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
6. Log everything you create as an event in `log/events.jsonl`
   (`actor: "ai"`).
7. `npm run validate -- local/<pack>` must report "All packs valid.".

Then show the person a short overview: subjects, exams with dates, classes
per week, scripts found, sheets with tasks, number of topics per subject,
open tasks. Ask whether anything is missing.

## 5. Start

```bash
LC_PACK_DIR=local/<pack> npm run dev
```

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
- **"How am I doing?"**: due and overdue topics, exams in the next two
  weeks, open sheets, outdated checks.

At the end of the setup, put short phrases the person can say to you at any
time as a list in your final message.
