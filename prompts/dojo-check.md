## Aufgabe: Lösung im Dojo „{{dojo}}“ prüfen

Verfahren: {{procedure}}

{{template}}

Prüfe die Lösung im Kontext Schritt für Schritt, in der Reihenfolge des Verfahrens.

- `steps`: ein Eintrag pro Teilschritt mit `label` (z.B. „ε-Hülle des Startzustands“), `ok` und bei Fehlern einem `comment`, der den ersten Fehler genau benennt.
- Folgefehler nur einmal anrechnen: Wenn ein späterer Schritt aus einem früheren Fehler richtig weitergerechnet ist, ist er `ok`.
- `correct`: true, wenn das Endergebnis stimmt.
- `score`: 0–5 nach der Skala oben. Verwendete Tipps (`hintsUsed`) senken den Score um höchstens 1.
- `feedback`: 1–3 Sätze, was als Nächstes zu üben ist.
