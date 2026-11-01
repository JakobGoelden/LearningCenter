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
| `record_review` | Grade an answer given in the chat, with the app's scheduling rules. |
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

## For developers

`src/api/tools.ts` is the table of tools; `insights.ts` computes, `edit.ts` changes, `mcp.ts` speaks
the protocol (JSON-RPC 2.0 by hand, tools only, no dependency). `scripts/mcp.ts` is the stdio
transport: nothing else may write to stdout, which is why `.mcp.json` uses `npm run --silent`.
