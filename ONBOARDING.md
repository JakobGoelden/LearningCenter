# ONBOARDING.md: LearningCenter für eine Person einrichten

Diese Datei ist für eine KI (Claude Code, Codex, Cursor, …), die LearningCenter
für eine lernende Person installiert und ein persönliches Semester anlegt. Die
Person startet das meistens so:

> Lies ONBOARDING.md und richte LearningCenter für mich ein.

Arbeite die Schritte der Reihe nach ab. Frag nur, was du nicht selbst
herausfinden kannst, und immer gebündelt (ein Fragenblock pro Schritt, nicht
eine Frage pro Nachricht). Die Regeln für Datenformat, Bewertung und Termine
stehen in [CLAUDE.md](CLAUDE.md). Lies sie vor Schritt 4.

---

## 1. Installieren

Voraussetzungen: Git und Node.js ≥ 18.19 (`node -v`). Fehlt Node, nenne der
Person den passenden Weg für ihr System (z.B. `nvm`, Paketmanager oder
nodejs.org) und warte, bis es installiert ist.

```bash
git clone https://github.com/JakobGoelden/LearningCenter.git
cd LearningCenter
npm install
npm test            # muss grün sein
npm run validate    # prüft die mitgelieferten Packs
```

Ist das Repo schon geklont, reicht `git pull` und `npm install`.

## 2. Die Person kennenlernen

Frag in einem Block, und biete Beispiele an, damit die Antworten leichtfallen:

1. **Semester:** Bezeichnung (z.B. „WiSe 2026/27“), Start und Ende der
   Vorlesungszeit, Sprache für Fragen (Deutsch/Englisch).
2. **Fächer:** Name, Kürzel, und pro Fach die Prüfung: Form (Klausur, Vortrag
   oder mündlich, Projekt, noch unklar), Datum und Uhrzeit falls bekannt,
   erlaubte Hilfsmittel (z.B. ein bestimmter Taschenrechner, ein DIN-A4-Blatt).
3. **Übungsblätter:** Rhythmus und Abgabetag pro Fach, falls es welche gibt.
4. **Lernrhythmus:** wie viele Fragen pro Abfrage, ob Wochenenden frei
   bleiben sollen.
5. **KI-Weg in der App:** Datei-Brücke mit Claude Code (empfohlen, wenn du
   Claude Code bist), eigener API-Schlüssel, oder Copy-Prompt für einen
   beliebigen Chat. Erkläre kurz die Unterschiede (siehe README).

Erfinde keine Termine. Was offen ist, wird ein offener Punkt im Pack.

## 3. Quellen finden: Material und eigene Notizen

Ziel: Für jedes Fach wissen, **wo das offizielle Material liegt** und **wo die
eigenen Notizen liegen**, und beides für dich lesbar machen.

### 3a. Offizielles Material (Skript, Folien, Übungsblätter)

Frag pro Fach, wo das Material liegt. Typisch:

- Lernplattform der Hochschule: **Moodle**, ILIAS, Stud.IP, OLAT, Canvas
- Webseite des Lehrstuhls, GitLab/GitHub, geteilte Cloud-Ordner
- Ein gedrucktes Skript oder ein Buch

Zugriff, ohne Zugangsdaten anzufassen:

- **Bevorzugt:** Die Person lädt die Dateien herunter und legt sie nach
  `local/<pack>/material/<fach-id>/`. In Moodle geht das pro Kurs oft über
  „Alle Dateien herunterladen“ oder pro Abschnitt; bei ILIAS über
  „Herunterladen“ am Ordner.
- Öffentliche Seiten darfst du selbst abrufen, wenn du ein Web-Werkzeug hast.
- Hat die Person ein Sync-Werkzeug eingerichtet (z.B. einen Moodle-Downloader
  oder einen synchronisierten Cloud-Ordner), lies aus dessen Zielordner.
- **Nie** Passwörter, Tokens oder Session-Cookies erfragen, speichern oder in
  Dateien schreiben. Für Logins ist die Person zuständig.

Halte jede Quelle als Check im Fach fest, damit das Dashboard zeigt, wann
zuletzt nachgesehen wurde:

```json
{ "id": "moodle", "kind": "material", "label": "Moodle-Kurs", "url": "https://moodle.example.edu/course/view.php?id=1234", "everyDays": 3 }
{ "id": "script", "kind": "script", "label": "Skript", "version": "v1.2", "url": "material/db/skript.pdf", "everyDays": 14 }
```

`url` darf ein Link oder ein Pfad relativ zum Pack-Ordner sein.

### 3b. Eigene Notizen

Frag, womit die Person mitschreibt, und hilf beim Export:

| Werkzeug | Weg zu lesbaren Dateien |
| --- | --- |
| **reMarkable** | In der reMarkable-App (Desktop/Handy) Notizbuch als PDF exportieren; oder per USB: in den Tablet-Einstellungen „USB-Webinterface“ aktivieren, dann im Browser `http://10.11.99.1` öffnen und PDFs laden; oder mit einem Cloud-CLI wie `rmapi`, wenn die Person es eingerichtet hat. Handschrift kann die reMarkable-App in Text umwandeln („Convert to text“); sonst liest du die PDF-Seiten als Bild. |
| GoodNotes, Notability, OneNote | Als PDF exportieren |
| Obsidian, Notion, Markdown | Ordner bzw. Markdown-Export |
| Papier | Fotos oder Scans (z.B. Handy-Scanner-App) als PDF |

Ablage: `local/<pack>/notes/<fach-id>/`. Dazu ein Check pro Fach:

```json
{ "id": "notes", "kind": "notes", "label": "Mitschrift (reMarkable)", "url": "notes/db/", "everyDays": 7 }
```

`material/` und `notes/` liegen im Pack-Ordner unter `local/`, also nie im Git.

## 4. Pack anlegen

```bash
cp -r packs/empty local/<pack>      # z.B. local/wise26
```

Dann nach CLAUDE.md, Teil A:

1. `pack.json`: Titel, Semester, Einstellungen aus Schritt 2, Fächerliste.
2. Pro Fach `subjects/<id>.json` mit Prüfung, Checks (Schritt 3) und
   Übungsblättern (bekannte Blätter als `open` mit `due`).
3. **Themen aus dem Material ableiten:** Inhaltsverzeichnis von Skript oder
   Folien durchgehen, ein prüfungsrelevantes Konzept pro Thema. In `notes`
   Umfang, Quelle (Kapitel, Folie) und typische Fehler. Alles `status: "new"`.
   Was nur Hintergrund ist, bekommt `skip`.
4. **Mitschrift abgleichen:** Was in den eigenen Notizen steht, aber nicht im
   Skript (oder umgekehrt), als offenen Punkt anlegen, z.B.
   „Mitschrift VL 3: Beispiel zu BCNF fehlt im Skript“. Fehlende Folien oder
   unklare Prüfungsinfos ebenfalls als offene Punkte.
5. **Dojos:** Für jedes Rechen- oder Konstruktionsverfahren im Material ein
   Dojo. Erst in `packs/dojo-library/` und `packs/demo/dojos/` nach Vorlagen
   suchen, sonst neu schreiben (`schema/dojo.schema.json`). Hilfsmittel aus
   der Prüfung (z.B. den erlaubten Taschenrechner) in `aids` eintragen.
6. Jede Anlage als Ereignis in `log/events.jsonl` (`actor: "ai"`).
7. `npm run validate -- local/<pack>` muss „All packs valid.“ melden.

Zeig der Person danach eine kurze Übersicht: Fächer, Prüfungen mit Datum,
Anzahl Themen pro Fach, offene Punkte. Frag, ob etwas fehlt.

## 5. Starten

```bash
LC_PACK_DIR=local/<pack> npm run dev
```

Die Person öffnet <http://localhost:5173>. In **Einstellungen → KI-Anbindung**
den KI-Weg aus Schritt 2 wählen. Mit Datei-Brücke: Im Pack-Ordner läuft
Claude Code mit „Arbeite die Inbox ab“ (siehe CLAUDE.md, Inbox abarbeiten).
Wenn du selbst Claude Code bist, kannst du das direkt übernehmen und auf neue
Anfragen warten.

Zum Schluss eine erste Abfrage im ersten Fach starten lassen (oder sie direkt
im Chat stellen und mit `npm run review` eintragen), damit Termine entstehen.

## 6. Danach: wiederkehrende Pflege

Schlag der Person diese Routine vor und führ sie aus, wenn sie danach fragt:

- **„Was ist neu?“** (z.B. zweimal pro Woche): Quellen der Checks ansehen,
  neue Dateien nach `material/` holen lassen, Skript-Version vergleichen,
  neue Themen und Übungsblätter anlegen, `lastChecked` setzen.
- **„Gleich meine Mitschrift ab“**: neue Notizen gegen Skript und Themen
  lesen, Lücken als offene Punkte, neue Konzepte als Themen.
- **„Frag mich <Fach> ab“** und **„Dojo <Verfahren>“**: siehe CLAUDE.md.
- **„Wie steht es?“**: fällige und überfällige Themen, Prüfungen in den
  nächsten zwei Wochen, offene Blätter, veraltete Checks.

Kurze Sätze, die die Person dir jederzeit sagen kann, stehen am Ende der
Einrichtung als Liste in deiner Abschlussnachricht.
