# CLAUDE.md

Anleitung für KI-Assistenten (Claude Code, Codex, Cursor, …) in diesem Repo.
**Neue Person einrichten?** Dann zuerst [ONBOARDING.md](ONBOARDING.md)
(Installation, Quellen wie Moodle und reMarkable finden, Pack anlegen, starten).

Es gibt zwei Arten von Aufgaben: **Lernpacks pflegen** (Teil A) und **die App
weiterentwickeln** (Teil B). Antworte Lernenden in ihrer Sprache (Standard:
Deutsch); Code, Bezeichner und Commit-Messages auf Englisch.

---

## A. Lernpacks pflegen

### Datenschutz zuerst

- Persönliche Packs liegen in `local/<name>/`. Der Ordner ist per `.gitignore`
  ausgeschlossen. **Nie** persönliche Daten committen und nie in `packs/`
  schreiben: `packs/demo`, `packs/empty` und `packs/dojo-library` sind
  öffentliche Beispiele für alle Nutzer des Repos.
- Liegt ein Pack außerhalb des Repos, gelten dieselben Regeln.

### Aufbau eines Packs

```
local/<name>/
  pack.json              Manifest: Titel, Semester, Einstellungen, Fächer- und Dojo-IDs
  subjects/<id>.json     ein Fach: Prüfung, Themen (mit Verlauf), Blätter, offene Punkte, Checks
  dojos/<id>.json        Dojo-Definitionen (reine Daten)
  sessions/<id>.json     Protokolle von Abfragen und Dojos
  log/events.jsonl       Ereignis-Log, eine JSON-Zeile pro Ereignis, nur anhängen
  material/<fach-id>/    heruntergeladene Skripte, Folien, Blätter (optional)
  notes/<fach-id>/       eigene Notizen als PDF/Markdown, z.B. reMarkable-Export (optional)
  inbox/<id>.json        Anfragen der App (Datei-Brücke)
  outbox/<id>.json       deine Antworten darauf
```

Das Format ist in `schema/*.schema.json` vollständig beschrieben (JSON Schema
2020-12, mit Beschreibungen pro Feld). Das Schema ist maßgeblich.

### Ein Pack anlegen

1. `cp -r packs/empty local/<name>` (Name als Slug, z.B. `wise26`).
2. `pack.json`: `id`, `title`, `semester` setzen. `subjects` und `dojos` listen
   die IDs in Anzeigereihenfolge; jede ID braucht eine passende Datei.
3. Pro Fach `subjects/<id>.json`. IDs sind Slugs (`a-z0-9._-`) und müssen mit
   dem Dateinamen übereinstimmen. `example.json` löschen und aus `pack.json`
   entfernen.
4. **Themen:** ein prüfungsrelevantes Konzept pro Thema, typischerweise 8–30
   pro Fach. `notes` beschreibt Umfang und Quelle (z.B. „VL 3, Skript 2.4;
   typischer Fehler: …“). Das ist der wichtigste Kontext für gute Fragen.
   Neue Themen bekommen `status: "new"` und kein `due`.
5. **Prüfung:** `format` ist `written` (Klausur), `talk` (Vortrag/mündlich),
   `project` oder `unknown`. Kein Datum erfinden: Ist es unbekannt, `date`
   weglassen und einen offenen Punkt anlegen.
6. **Checks:** `material` (z.B. Moodle), `script` (Skript-Version in
   `version`), `notes` (eigene Mitschrift). `everyDays` markiert sie als
   veraltet, wenn sie zu lange nicht geprüft wurden. `url` sagt, wo man
   nachsieht (Link zum Kurs oder Pfad im Pack wie `material/db/`).
7. Prüfen: `npm run validate -- local/<name>`. Nach **jeder** Änderung erneut.

### Beim Bearbeiten

- JSON mit 2 Leerzeichen einrücken, die `$schema`-Zeile behalten.
- `history` eines Themas nie löschen oder umschreiben, nur anhängen.
- Jede inhaltliche Änderung als Ereignis anhängen, z.B.
  `{"ts":"2026-10-16T09:00:00Z","type":"topic.add","actor":"ai","subject":"db","ref":"normal-forms","data":{"title":"Normalformen"}}`.
  Gängige Typen: `topic.add`, `topic.status`, `topic.due`, `topic.review`,
  `sheet.status`, `openItem.add`, `openItem.done`, `check.done`, `exam.update`,
  `quiz.start`, `quiz.answer`, `quiz.graded`, `quiz.applied`, `dojo.task`,
  `dojo.check`, `ai.request`, `ai.response`.
- Läuft die App gerade, merkt sie Änderungen an `pack.json`, `subjects/` und
  `dojos/` innerhalb weniger Sekunden und lädt neu.

### Termine und Spaced Repetition

Dieselben Regeln wie in der App (`src/scheduling/scheduler.ts`). Die Leiter
steht in `pack.json` → `settings.reviewLadder` (Standard `1, 3, 7, 14, 21, 35, 60`
Tage).

| Bewertung | Neuer Abstand | Status |
| --- | --- | --- |
| 4–5 | eine Stufe höher, mindestens Stufe 2 (3 Tage); war das Thema `shaky`, höchstens Stufe 3 (7 Tage) | `solid` |
| 3 | Stufe 1 oder 2 (1 bzw. 3 Tage) | `shaky` |
| 0–2 | Stufe 1 (1 Tag) | `shaky` |

- `due` = Datum der Abfrage + Abstand. Fällt es auf Sa/So und ist
  `settings.skipWeekends` nicht `false`, auf Montag schieben.
- `skip` („nicht abfragen“) wird nie fällig und nie abgefragt.
- **Bewertungen immer mit dem Skript eintragen**, damit die Regeln exakt
  gleich bleiben:
  `npm run review -- local/<name> <fach-id> <thema-id> <score> [quiz|dojo|manual] ["Notiz"]`
  Das Skript ergänzt `history`, setzt `status`, `due`, `intervalDays` und
  schreibt ein Ereignis ins Log.
- Termine von Hand setzen nur, wenn die Person es ausdrücklich will (z.B.
  „frag mich Normalformen erst nach der Übung am Donnerstag ab“).

### Fair bewerten (Skala 0–5)

| Score | Bedeutung |
| --- | --- |
| 0 | keine Antwort oder „weiß nicht“ |
| 1 | falsch |
| 2 | große Lücken |
| 3 | im Kern richtig, mit Lücken |
| 4 | richtig |
| 5 | richtig und gut begründet |

- Verständnis zählt, nicht Wortlaut. Richtige Ideen in eigenen Worten bekommen
  volle Punkte; Tippfehler, Notation und Formatierung sind egal, solange der
  Inhalt eindeutig ist.
- Lücken konkret benennen: was fehlt, warum es wichtig ist, wie es richtig
  wäre (1–3 Sätze). Keine Belehrungen ohne Bezug zur Antwort.
- Bei Rechenverfahren Folgefehler nur einmal anrechnen.
- Im Zweifel nachfragen statt raten, aber höchstens einmal pro Frage.

### Inbox abarbeiten (Datei-Brücke)

Die App schreibt bei Klick auf „Abfrage“ oder im Dojo eine Anfrage nach
`inbox/<id>.json` (Schema: `schema/request.schema.json`). Auftrag wie
„Arbeite die Inbox ab“ bedeutet:

1. Alle Dateien in `inbox/` lesen, älteste zuerst (die ID beginnt mit einem
   Zeitstempel).
2. Das Feld `prompt` enthält die vollständige Aufgabe samt Kontext und
   gewünschtem Antwortformat. Danach richten; `context` enthält dieselben
   Daten strukturiert.
3. Antwort nach `outbox/<id>.json` schreiben, gleiche `id`, mit
   `requestId` und `kind` aus der Anfrage plus dem Feld für die Anfrageart:

   | `kind` | Feld |
   | --- | --- |
   | `quiz.start` | `questions: [{topicId, kind, prompt}]` (genau `count` Fragen) |
   | `quiz.grade` | `grades: [{n, score, feedback, gaps}]`, optional `summary` |
   | `dojo.task` | `task` (Markdown) |
   | `dojo.check` | `check: {correct, score, steps: [{label, ok, comment}], feedback}` |
   | `dojo.hint` | `hint` |
   | `dojo.solution` | `solution` (Markdown) |

   Gegen `schema/response.schema.json` prüfen.
4. Die Inbox-Datei **nicht** löschen und **keine** Themen ändern: Die App
   liest die Antwort, räumt beide Dateien weg, und die Person übernimmt das
   Ergebnis per Klick in den Lernstand.
5. Wenn die Person es möchte, weiter auf neue Anfragen warten (z.B. alle paar
   Sekunden nachsehen), bis sie „stopp“ sagt.

### Abfrage direkt im Chat

Bei „Frag mich <Fach> ab“ ohne App:

1. Themen wählen wie die App: zuerst fällige/überfällige (`due` ≤ heute,
   ältestes zuerst), dann `shaky`, dann `new`; nie `skip`. Standard:
   `settings.questionsPerQuiz` Fragen, eine pro Thema.
2. Fragen einzeln stellen, nummeriert als „Frage n/N“. Fragetypen mischen:
   Warum, Was wäre wenn, mit eigenen Worten erklären, auf ein Beispiel anwenden.
3. Nach jeder Antwort kurz bewerten (Score + Lücken). Am Ende eine
   Zusammenfassung.
4. Ergebnisse mit `npm run review` eintragen (`source` = `quiz`) und optional
   ein Protokoll `sessions/<id>.json` schreiben (Schema
   `session.schema.json`, `id` z.B. `20261016T090000Z-quiz-db`).
5. Nächste Termine nennen.

### Dojos

Ein Dojo ist eine Datei `dojos/<id>.json` (Schema `dojo.schema.json`) und
braucht keinen Code. `promptTemplate` beschreibt, wie Aufgaben für die Niveaus
`easy`, `medium`, `exam` aussehen und wie Schritt für Schritt geprüft wird;
Platzhalter: `{{level}}`, `{{procedure}}`, `{{subject}}`, `{{aids}}`,
`{{language}}`. `topics` verknüpft das Dojo mit Themen, deren Lernstand nach
dem Prüfen aktualisiert werden kann. Vorlagen: `packs/dojo-library/` und
`packs/demo/dojos/`. Neue Dojos auch in `pack.json` → `dojos` eintragen.

Im Chat: Aufgabe nach `promptTemplate` stellen, Lösung abwarten, Schritt für
Schritt prüfen, Tipp oder Musterlösung nur auf Wunsch.

### Den Stand nachvollziehen

`log/events.jsonl` zeigt, was die Person geklickt und beantwortet hat;
`sessions/` enthält die Fragen, Antworten und Bewertungen. Für einen Überblick
(„Wie steht es um DB?“) Themenstatus, fällige Termine, überfällige Blätter,
veraltete Checks und offene Punkte zusammenfassen.

---

## B. Die App weiterentwickeln

- Stack: Vite 6, TypeScript (strict), Preact, Ajv. Kein Backend. Node ≥ 18.19.
- Befehle: `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`,
  `npm run validate`. Mit `LC_PACK_DIR=local/<name> npm run dev` liest und
  schreibt die App einen Pack-Ordner über den Dev-Server (jeder Browser).
- Struktur:
  - `schema/` JSON-Schemas (Quelle der Wahrheit für das Format)
  - `src/model/` Typen (Spiegel des Schemas), Validierung, abgeleitete Ansichten
  - `src/scheduling/` Spaced Repetition
  - `src/storage/` `PackFs`-Backends (Ordner, Dev-Server, Browser), Laden/Speichern, Export
  - `src/ai/` Anfragen bauen, Antworten prüfen, Adapter (Datei-Brücke, API, Copy-Prompt)
  - `src/ui/` Preact-Komponenten
  - `prompts/` Prompt-Vorlagen (Markdown mit `{{platzhaltern}}`)
  - `tools/vite-pack-fs.ts` Dev-Server-Dateizugriff
  - `scripts/` Node-Skripte (`validate-packs.mjs`, `review.ts`)
- Formatänderungen immer zusammen in `schema/`, `src/model/types.ts`, Demo-
  und Leer-Pack und dieser Datei. `npm test` und `npm run validate` müssen
  grün sein.
- UI-Texte auf Deutsch, Code und Bezeichner auf Englisch.
