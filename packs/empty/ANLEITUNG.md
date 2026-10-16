# Leeres Pack: so legst du dein Semester an

1. **Kopieren, nicht im Repo bearbeiten.** Kopiere diesen Ordner nach `local/<name>/`
   (z.B. `cp -r packs/empty local/mein-semester`). `local/` ist per `.gitignore`
   ausgeschlossen, deine Daten bleiben also auf deinem Rechner.
2. **`pack.json` anpassen:** `id`, `title`, Semesterzeitraum. In `subjects` stehen
   die Fach-IDs in Anzeigereihenfolge, in `dojos` die Dojo-IDs.
3. **Pro Fach eine Datei** `subjects/<id>.json` anlegen (Vorlage: `example.json`).
   Die ID im Dateinamen, in der Datei und in `pack.json` muss gleich sein.
4. **Dojos** als `dojos/<id>.json` anlegen. Fertige Vorlagen liegen in
   `packs/dojo-library/` und im Demo-Pack.
5. **Prüfen:** `npm run validate -- local/mein-semester`
6. **Öffnen:** In der App „Ordner öffnen“ (Chrome/Edge) oder mit
   `LC_PACK_DIR=local/mein-semester npm run dev` (jeder Browser).

Schneller geht es mit einer KI: Öffne das Repo in Claude Code und sag z.B.
„Leg mir in local/ein Pack für mein Semester an, hier sind meine Fächer und
Prüfungstermine: …“. Die Regeln dafür stehen in `CLAUDE.md`.

## Felder in Kürze

| Feld | Bedeutung |
| --- | --- |
| `exam.format` | `written` Klausur, `talk` Vortrag/mündlich, `project` Projekt, `unknown` unklar |
| `topics[].status` | `new` neu, `shaky` unsicher, `solid` sicher, `skip` nicht abfragen |
| `topics[].due` | nächster Abfragetermin (YYYY-MM-DD) |
| `sheets[].status` | `open` offen, `done` bearbeitet, `checked` geprüft |
| `checks[].kind` | `material` (z.B. Moodle), `script` (Skript-Version), `notes` (Mitschrift), `other` |
| `checks[].everyDays` | ab so vielen Tagen gilt ein Check als veraltet |

Alle Details stehen in `schema/*.schema.json`.
