# LearningCenter

Ein Dashboard fürs Semester, das eine KI für dich mitpflegt. Für beliebige
Studierende und Fächer: Du siehst auf einen Blick, was ansteht, und startest
per Klick eine Abfrage oder ein Dojo. Eine KI (Claude oder eine andere) füllt
die Daten, stellt Verständnisfragen, bewertet Antworten und plant die nächsten
Wiederholungen.

![Dashboard mit Demo-Pack](docs/dashboard.png)

- **Dashboard:** eine Kachel pro Fach mit Prüfungsform, Termin, Countdown und
  Hilfsmitteln, Lernstand der Themen, fälligen Abfragen, Übungsblättern als
  Chips (offen → bearbeitet → geprüft), offenen Punkten und letzten Checks.
  Oben die Zeile „Heute dran“ über alle Fächer.
- **Abfrage:** Die KI stellt Verständnisfragen („Frage n/N“), bewertet sie von
  0–5 und erklärt Lücken. Danach Spaced Repetition: gute Themen wandern
  1 → 3 → 7 → 14 → 21 Tage weiter, unsichere bleiben kurz, keine Termine am
  Wochenende.
- **Dojos:** Übungsräume für Verfahren wie NFA → DFA, SQL von Hand oder
  Subnetting. Die KI erzeugt Aufgaben (leicht / mittel / Klausurniveau) und
  prüft deine Lösung Schritt für Schritt; Tipp und Musterlösung per Knopfdruck.
  Dojos sind reine Daten, neue brauchen keinen Code.
- **Themenliste** pro Fach mit Status und Termin, auch von Hand änderbar.

## Mit einer KI einrichten

Das Projekt ist dafür gebaut, dass eine KI die Einrichtung übernimmt. Öffne
das Repo in Claude Code (oder einem anderen KI-Werkzeug) und sag:

> Lies ONBOARDING.md und richte LearningCenter für mich ein.

Die KI installiert alles, fragt nach Fächern und Prüfungen, findet mit dir
heraus, wo Skripte (z.B. Moodle) und eigene Notizen (z.B. reMarkable) liegen,
legt dein Pack an und startet die App. Details: [ONBOARDING.md](ONBOARDING.md).

## Schnellstart

Voraussetzung: Node.js 18.19 oder neuer.

```bash
npm install
npm run dev
```

Dann <http://localhost:5173> öffnen und **Demo ausprobieren** wählen. Die Demo
liegt im Browser-Speicher und hat zwei Fächer.

## Eigenes Pack anlegen

Alle Daten stehen in einem **Learning Pack**: einem Ordner mit JSON-Dateien.
Persönliche Packs gehören nach `local/`. Dieser Ordner ist per `.gitignore`
ausgeschlossen, deine Lerndaten bleiben also auf deinem Rechner, auch wenn du
das Repo mit anderen teilst.

```bash
cp -r packs/empty local/mein-semester
```

Dann entweder von Hand ausfüllen (siehe `packs/empty/ANLEITUNG.md`) oder Claude
Code im Repo starten und sagen: *„Leg mir in local/mein-semester ein Pack an.
Meine Fächer und Prüfungen: …“*. Die Regeln für die KI stehen in
[`CLAUDE.md`](CLAUDE.md).

Öffnen auf einem von zwei Wegen:

| Weg | Browser | So geht's |
| --- | --- | --- |
| Dev-Server | alle | `LC_PACK_DIR=local/mein-semester npm run dev` |
| Ordner öffnen | Chrome, Edge | In der App **Pack-Ordner öffnen …** wählen |

In beiden Fällen schreibt die App direkt in die Dateien. Änderungen, die eine
KI parallel an den Dateien macht, lädt sie nach wenigen Sekunden neu.

Prüfen, ob ein Pack gültig ist: `npm run validate -- local/mein-semester`

## KI anbinden

Unter **Einstellungen → KI-Anbindung** wählst du einen von drei Wegen. Alle
nutzen dieselben Prompts (`prompts/`) und dasselbe Antwortformat.

1. **Datei-Brücke (Claude Code):** Ein Klick auf „Abfrage“ schreibt eine
   Anfrage nach `inbox/` im Pack-Ordner. Starte im Pack-Ordner
   `claude "Arbeite die Inbox ab"`. Claude Code schreibt die Antwort nach
   `outbox/`, und die App zeigt sie an. Braucht einen geöffneten Pack-Ordner.
2. **API:** Direkt mit eigenem API-Schlüssel, entweder Anthropic (Claude) oder
   ein OpenAI-kompatibler Dienst (OpenAI, OpenRouter, lokal mit Ollama). Der
   Schlüssel wird nur im `localStorage` dieses Browsers gespeichert, nie im
   Pack und nie im Export.
3. **Copy-Prompt:** Die App zeigt einen fertigen Prompt. Du fügst ihn in einen
   beliebigen KI-Chat ein und kopierst die JSON-Antwort zurück.

Ohne App geht es auch: Sag Claude Code im Repo *„Frag mich Datenbanken ab“*.
Es fragt im Chat und trägt die Ergebnisse mit `npm run review` ein, nach
denselben Regeln wie die App.

## Datenformat

Das Format ist offen und mit JSON Schema dokumentiert (`schema/`):

```
<pack>/
  pack.json              Titel, Semester, Einstellungen, Fächer- und Dojo-IDs
  subjects/<id>.json     Prüfung, Themen mit Verlauf, Übungsblätter, offene Punkte, Checks
  dojos/<id>.json        Dojo-Definitionen
  sessions/<id>.json     Protokolle von Abfragen und Dojos
  log/events.jsonl       Ereignis-Log: was angeklickt und beantwortet wurde
  inbox/, outbox/        Anfragen und Antworten der Datei-Brücke
```

**Export** (oben rechts) lädt das ganze Pack als eine `.pack.json` herunter,
**Import** lädt eine solche Datei wieder (Startseite oder Einstellungen).

Mitgeliefert:

- `packs/demo/`: Demo mit Theoretischer Informatik und Datenbanken samt Dojos
- `packs/empty/`: leere Vorlage mit Anleitung
- `packs/dojo-library/`: weitere Dojos (Mathe: Stetigkeit; Netze: Subnetting,
  Fragmentierung, Routing) zum Kopieren

## Als statische Seite (GitHub Pages)

`npm run build` erzeugt eine statische Seite in `dist/`. Der Workflow
`.github/workflows/pages.yml` veröffentlicht sie bei jedem Push auf `main`.
Einmalig aktivieren: **Settings → Pages → Source: GitHub Actions**.

Auf der statischen Seite liegen Packs im Browser-Speicher oder in einem
geöffneten Ordner (Chrome/Edge). Den Dev-Server-Weg gibt es dort nicht.

## Entwicklung

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Dev-Server, optional mit `LC_PACK_DIR=<ordner>` |
| `npm run build` | Typprüfung und statischer Build |
| `npm test` | Tests (Vitest) |
| `npm run validate [-- <ordner>]` | Packs gegen das Schema prüfen |
| `npm run review -- <ordner> <fach> <thema> <0-5>` | Bewertung eintragen und Termin neu planen |

Stack: Vite, TypeScript, Preact, Ajv. Kein Backend. Aufbau und Konventionen
stehen in [`CLAUDE.md`](CLAUDE.md), Teil B.
