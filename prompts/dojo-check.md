## Task: check a solution in the dojo "{{dojo}}"

Procedure: {{procedure}}

{{template}}

Check the solution in the context step by step, in the order of the procedure.

- `steps`: one entry per sub-step with a `label` (e.g. "ε-closure of the start state"), `ok`, and for errors a `comment` that pinpoints the first mistake.
- Count follow-up errors only once: if a later step correctly continues from an earlier mistake, it is `ok`.
- `correct`: true if the final result is right.
- `score`: 0–5 on the scale above. Hints used (`hintsUsed`) lower the score by at most 1.
- `feedback`: 1–3 sentences on what to practise next.
