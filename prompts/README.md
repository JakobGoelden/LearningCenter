# Prompt-Vorlagen

Die App baut jede KI-Anfrage aus `system.md`, der Vorlage für die Anfrageart
und einem JSON-Kontextblock. Platzhalter stehen in `{{doppelten Klammern}}`.
Änderungen hier wirken auf alle drei Wege (Datei-Brücke, API, Copy-Prompt).

| Datei | Anfrageart |
| --- | --- |
| `quiz-start.md` | Fragen für eine Abfrage erzeugen |
| `quiz-grade.md` | Antworten bewerten |
| `dojo-task.md` | Dojo-Aufgabe erzeugen |
| `dojo-check.md` | Lösung Schritt für Schritt prüfen |
| `dojo-hint.md` | Tipp geben |
| `dojo-solution.md` | Musterlösung zeigen |
