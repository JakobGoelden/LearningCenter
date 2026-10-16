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
3. **Exercise sheets:** rhythm and due day per subject, if there are any.
4. **Study rhythm:** how many questions per quiz, whether weekends should stay
   free.
5. **AI connection in the app:** file bridge with Claude Code (recommended if
   you are Claude Code), own API key, or Copy-Prompt for any chat. Briefly
   explain the differences (see README).

Do not invent dates. Whatever is unknown becomes an open task in the pack.

## 3. Find sources: material and own notes

Goal: for every subject, know **where the official material lives** and
**where the person's own notes live**, and make both readable for you.

### 3a. Official material (script, slides, exercise sheets)

Ask per subject where the material is. Typical places:

- The university's learning platform: **Moodle**, ILIAS, Stud.IP, OLAT, Canvas
- The chair's website, GitLab/GitHub, shared cloud folders
- A printed script or a book

Access without touching credentials:

- **Preferred:** the person downloads the files and puts them in
  `local/<pack>/material/<subject-id>/`. In Moodle this often works per course
  via "Download all files" or per section; in ILIAS via "Download" on the
  folder.
- You may fetch public pages yourself if you have a web tool.
- If the person has set up a sync tool (e.g. a Moodle downloader or a synced
  cloud folder), read from its target folder.
- **Never** ask for, store or write passwords, tokens or session cookies to
  files. Logins are the person's job.

Record every source as a check in the subject, so the dashboard shows when
it was last looked at:

```json
{ "id": "moodle", "kind": "material", "label": "Moodle course", "url": "https://moodle.example.edu/course/view.php?id=1234", "everyDays": 3 }
{ "id": "script", "kind": "script", "label": "Script", "version": "v1.2", "url": "material/db/script.pdf", "everyDays": 14 }
```

`url` may be a link or a path relative to the pack folder.

### 3b. Own notes

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
2. One `subjects/<id>.json` per subject with exam, checks (step 3) and
   exercise sheets (known sheets as `open` with `due`).
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

Then show the person a short overview: subjects, exams with dates, number of
topics per subject, open tasks. Ask whether anything is missing.

## 5. Start

```bash
LC_PACK_DIR=local/<pack> npm run dev
```

The person opens <http://localhost:5173>. In **Settings → AI connection**,
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
  files put into `material/`, compare the script version, create new topics
  and exercise sheets, set `lastChecked`.
- **"Compare my notes"**: read new notes against the script and the topics,
  gaps become open tasks, new concepts become topics.
- **"Quiz me on <subject>"** and **"Dojo <procedure>"**: see CLAUDE.md.
- **"How am I doing?"**: due and overdue topics, exams in the next two
  weeks, open sheets, outdated checks.

At the end of the setup, put short phrases the person can say to you at any
time as a list in your final message.
