## Task: write prepared exercises ("drills") for the dojo "{{dojo}}"

Procedure: {{procedure}}
Aids: {{aids}}

{{template}}

Write exactly {{count}} new drills that the app can grade on its own, without you. They run in a timed practice round, so each must be answerable in a few minutes and have exactly one clearly right answer. Mix the levels easy, medium and exam, and mix the kinds where they fit the procedure:

- `choice`: multiple choice. `options` (2–6), `correct` = 0-based indexes of all right options. Plausible wrong options, ideally typical mistakes.
- `input`: short text answer. `accept` = every acceptable spelling (case and spaces are ignored). Only for answers with one canonical form, e.g. an address, a set `{q0,q1}` (list each order you accept) or a keyword.
- `number`: numeric answer in `answer`, `tolerance` for rounding (0 for exact), optional `unit`.
- `order`: `items` in the correct order; the app shuffles them.
- `regex`: the learner writes a regular expression; `alphabet` (single characters) and `referenceRegex`, the correct language as a regex using | * + ? ( ) and ε. Any equivalent answer counts.
- `automaton`: the learner builds a finite automaton as a transition table; `alphabet`, `referenceRegex` for the target language, `deterministic` true if a DFA is required, `minimal` true if it must be minimal.
- `self`: an open task (a proof, an explanation, a derivation) with a model `solution`; the learner compares and rates themselves. Use it only when no other kind fits.

Every drill needs a unique `id` (lowercase slug, not one of the existing ids in the context), a `prompt` in Markdown with all data needed (tables as Markdown tables), and an `explanation` that says briefly why the answer is right. Set `topic` to one of the subject's topic ids if the drill trains exactly one topic, otherwise "". Double-check every answer: a wrong answer key is worse than no drill. Leave every field that does not apply to the drill's kind empty ("" , [] or 0).
