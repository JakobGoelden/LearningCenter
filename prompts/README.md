# Prompt templates

The app builds every AI request from `system.md`, the template for the request
kind and a JSON context block. Placeholders use `{{double braces}}`. Changes
here apply to all three AI paths (file bridge, API, copy-prompt).

| File | Request kind |
| --- | --- |
| `quiz-start.md` | generate quiz questions |
| `quiz-grade.md` | grade answers |
| `dojo-task.md` | generate a dojo task |
| `dojo-check.md` | check a solution step by step |
| `dojo-hint.md` | give a hint |
| `dojo-solution.md` | show the model solution |
