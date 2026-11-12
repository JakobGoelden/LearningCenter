# The API for your AI

Your AI can ask the app directly how you are doing, instead of digging through the pack's files:
where you are weak, how you are progressing, what is due, and what your cards say. It can also fix
cards, record grades from a chat, and switch topics on or off.

The same tools are available in two ways:

- **MCP** (Claude Code, Claude Desktop, Cursor and other MCP clients): `.mcp.json` registers the
  server, so in this repo Claude Code offers it by itself (approve `learningcenter` once).
- **Command line**, for any AI that can run commands: `npm run ai -- <tool> --<argument> <value>`.
  `npm run ai -- list` shows every tool.

```bash
npm run --silent ai -- get_weak_spots --subject db --limit 5
```

## Tools

| Tool | What it does |
| --- | --- |
| `get_progress` | Per subject: exam, topic and card counts, covered share, due and overdue cards, new cards a day needed until the exam, switched-off chapters and topics, dojos, open sheets and tasks. Plus activity per week, streak, today's items, what a study round would ask. Start here. |
| `get_weak_spots` | Topics that keep going wrong, worst first, with reasons and evidence: weak cards, relapses, failing drills, gaps from graded answers. Near exams count more. |
| `get_subject_topics` | Chapters and topics of a subject. |
| `get_topic` | One topic in depth: notes, history, all cards, dojos, your last answers with feedback. |
| `list_cards` | Your cards with answers, schedule and statistics. Filters: `all`, `due`, `new`, `weak`, `blocked`. |
| `get_new_results` | What you did since the AI last looked, with your answers. |
| `add_card`, `edit_card` | Add a card, or change its prompt, answer or kind. Schedule and statistics stay. Blocked cards stay as they are. |
| `set_topic_notes` | Replace a topic's notes. Notes are never pushed. |
| `set_topics_enabled` | Switch topics on or off, see below. |
| `record_review` | Grade an answer given in the chat, with the app's scheduling rules. In a migrated pack (`"progress": "events"`) this appends one progress event instead of changing the subject file. |
| `mark_results_processed` | Clears the "New results" banner. |

Scheduling stays with the app: there is no tool to set due dates or statistics, and arguments for
them are refused. Every change lands in `log/events.jsonl` with `actor: "ai"`. Edits to cards of a
subject in the shared repository go out with the next `npm run share -- push`, so friends get them.

## Switching topics off

To study with only part of a subject, open **Topics**, filter (for example "Klausurfragen") and click
**Study only these**; **Switch all on** undoes it. It sets `enabled: false` on the topics and touches
nothing else: status, due dates, history and card statistics stay, and new topics from a pull stay
on. This differs from the status `skip`, which clears the schedule. A topic also needs its chapter
switched on to count.

## Which pack

In order: `--pack <dir>` (command line), `LC_URL`, `LC_PACK`, else the most recently changed pack in
`local/` that is not a backup.

For the hosted app the tools use its file API with your login. Put the login in your MCP client's
own configuration, never in this repo:

```json
{
  "mcpServers": {
    "learningcenter": {
      "command": "npm",
      "args": ["--prefix", "/path/to/LearningCenter", "run", "--silent", "mcp"],
      "env": { "LC_URL": "https://learn.goelden.dev", "LC_USER": "you", "LC_PASSWORD": "..." }
    }
  }
}
```

## Read-only HTTP API

For an AI that cannot run this repo (a chat in another project, a web assistant): four read-only
endpoints over HTTPS with a bearer token. They answer with learning state only: card counts,
scores, due dates, weak topics and dojos, sessions as numbers, exam dates. No notes, no answers you
typed, no open-task texts, no login name. Nothing can be changed through them.

- Base URL: `https://learn.goelden.dev/api/v1` (on another server: its own address + `/api/v1`)
- Header: `Authorization: Bearer <token>`. Only `GET`; anything else is refused with 405.
- Every answer carries `generatedAt` (now; the pack is read live) and `lastSync` (last time the app
  saved your progress), so the AI sees how current the numbers are.
- Rate limit: 60 requests a minute per token, 20 wrong tokens per 15 minutes per address (429 with
  `Retry-After`).

| Endpoint | Parameters | What |
| --- | --- | --- |
| `GET /progress` | `subject` | Per subject: cards total/answered/new/shaky/solid, covered and solid share, due, overdue, average recent score, exam date and days left, switched-off chapters, dojos. Plus activity per week and streak. |
| `GET /weak-spots` | `subject`, `limit` (default 10) | Weakest topics with reasons and weak cards, dojos ranked by what to practise next (skill, unseen drills), and chapters (or topics) never asked. |
| `GET /recent-activity` | `subject`, `limit` (default 10) | Latest quiz and dojo sessions: when, subject, dojo, items, average score, right/partly/wrong, minutes. |
| `GET /exam-dates` | | Exam format, date, time, duration and days left per subject. |

```bash
TOKEN=lc_ro_...   # from the admin
curl -s -H "Authorization: Bearer $TOKEN" https://learn.goelden.dev/api/v1/progress
curl -s -H "Authorization: Bearer $TOKEN" "https://learn.goelden.dev/api/v1/weak-spots?subject=db&limit=5"
curl -s -H "Authorization: Bearer $TOKEN" "https://learn.goelden.dev/api/v1/recent-activity?limit=5"
curl -s -H "Authorization: Bearer $TOKEN" https://learn.goelden.dev/api/v1/exam-dates
```

**Tokens** (on the server, see `docs/SERVER.md`): `node progress-api.mjs token add <user> <id>`
prints a new token once and stores only its SHA-256; `token list` shows them; `token revoke <id>`
switches one off at once. One token per AI, so each can be revoked on its own.

Running it yourself: `npm run build:api` makes `dist-api/progress-api.mjs` (one file, Node 18+, no
`node_modules`). `LC_DATA` is a folder with one pack folder per user (default `/data/users`),
`LC_API_TOKENS` the token file (default `/data/api/tokens.json`), `PORT` default 8092. Mount the
packs read-only. For a local test: `LC_DATA=local LC_API_TOKENS=local/api-tokens.json npm run api`.

## For developers

`src/api/tools.ts` is the table of tools; `insights.ts` computes, `edit.ts` changes, `mcp.ts` speaks
the protocol (JSON-RPC 2.0 by hand, tools only, no dependency). The HTTP API is `readonly.ts` (views)
and `http.ts` (tokens, rate limit, routes), served by `scripts/progress-api.ts`. `scripts/mcp.ts` is the stdio
transport: nothing else may write to stdout, which is why `.mcp.json` uses `npm run --silent`.
