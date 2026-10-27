# Anleitung: LearningCenter mit einer KI weiterentwickeln

Für alle, die mit einer KI (Claude Code o. ä.) am LearningCenter arbeiten, das auf
learn.goelden.dev läuft.

## 1. Vorbereiten
```sh
cd LearningCenter
git checkout main && git pull
npm ci
```

## 2. Der KI sagen, was sie tun soll
Diesen Text in die KI kopieren (Nummer anpassen):

> Lies `CLAUDE.md` und `docs/SERVER.md`. Arbeite Punkt **1** der To-do-Liste in
> `docs/SERVER.md` ab. Halte die `/__lc/fs`-Schnittstelle stabil, schreib Tests,
> und am Ende müssen `npm test` und `npm run build` grün sein. Hak den Punkt in
> `docs/SERVER.md` ab, wenn er fertig ist.

Immer **ein Punkt pro Sitzung**. Die Punkte bauen aufeinander auf (3 braucht 4).

## 3. Prüfen
```sh
npm test
LC_PACK_DIR=packs/demo npm run dev      # lokal ausprobieren
```
Nur weiter, wenn die Tests grün sind und die App lokal funktioniert.

## 4. Hochladen
```sh
git push origin main
```

## 5. Live schalten (nur der Admin)
Auf dem Laptop des Admins:
```sh
~/Documents/Claude/goelden-server/learn/deploy-app.sh
```
Holt `main`, testet, baut und lädt hoch. Bei roten Tests wird nichts eingespielt.
Danach im Browser neu laden. Der Lernstand der Nutzer bleibt dabei unberührt.

## Nicht machen
- Keine Uni-Skripte, Blätter oder Altklausuren ins LearningCenter-Repo (es ist öffentlich).
  Die gehören ins private Semester3-Repo.
- Die `/__lc/fs`-Schnittstelle nicht umbauen, ohne dem Admin Bescheid zu geben:
  Der Server spricht genau diese.
- Punkt 5 (Einladungscodes) braucht Änderungen am Server: nur zusammen mit dem Admin.
