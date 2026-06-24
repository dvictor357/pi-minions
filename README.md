# Pi Minions

Delegate tasks to specialized subagents with **isolated context windows**.

Each subagent runs as an independent `pi` process — it can read hundreds of files, call tools, and reason deeply, and only the final answer comes back to the main session. No context pollution.

## Install

```bash
pi install git:github.com/dvictor357/pi-minions
```

## Modes

| Mode         | Description                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Single**   | One agent, one task. `{ agent, task }`                                                                                           |
| **Parallel** | Multiple agents run concurrently (max 4). `{ tasks: [...] }`                                                                     |
| **Chain**    | Sequential steps. Each step sees the previous output via `{previous}`. `{ chain: [...] }`                                        |
| **Pipeline** | Items flow through stages independently — item B can be in stage 1 while item A is in stage 3. `{ items: [...], stages: [...] }` |

## Codebase Intelligence

A built-in `codebase` tool scans your repo, builds a dependency graph, and answers architecture questions. No native dependencies — regex parsers, Node built-ins, and a JSON sidecar cache.

### Operations

| Operation  | Description                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| **scan**   | Index all JS/TS source files (imports, exports, symbols, hashes). Writes `.pi/codebase-index.json`. Auto-runs on first use. |
| **query**  | Find files by pattern — matches paths, file names, symbols, and exports (case-insensitive).                                 |
| **map**    | Show a file's immediate dependencies and reverse dependencies with import/export details.                                   |
| **impact** | Transitive reverse dependency closure — every file that depends on a given file, directly or transitively.                  |

### Cache

The index is cached to `.pi/codebase-index.json` and auto-refreshes when files change (mtime + SHA-256 hash of first 16 KiB). Force a re-scan with `force: true`.

### Bundled Agent

`codebase-analyst` (`tier: reasoning`) reads `.pi/codebase-index.json` directly to answer architecture, dependency, and refactoring-impact questions.

### pi-suite Integration

pi-suite's quest orchestration consumes the same `.pi/codebase-index.json` for pre-flight checks and post-task impact verification. No code dependencies — the contract is the JSON schema and `contractVersion` field.

**Ownership split:**

| Layer                           | Owner      | Role                                                                                         |
| ------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| **Scanner** (`indexer.ts`)      | pi-minions | Walk repo, parse imports/exports/symbols, build dep/revDep maps                              |
| **Cache** (`cache.ts`)          | pi-minions | Read/write `.pi/codebase-index.json`, staleness detection                                    |
| **Query engine** (`query.ts`)   | pi-minions | `scanIndex`, `queryFiles`, `depMap`, `getImpact` — pure functions on `IndexData`             |
| **`codebase` tool**             | pi-minions | Tool registration, params, results, and TUI rendering                                        |
| **Quest planning/verification** | pi-suite   | Reads `.pi/codebase-index.json` directly for pre-flight checks and post-task impact analysis |

pi-suite never imports pi-minions code. The integration contract is the JSON schema and `contractVersion` field in the sidecar cache. See [`CONTRACT.md`](extensions/subagent/codebase/CONTRACT.md) for the full specification including cache location, schema, tool params/results, staleness rules, and limitations.

## Agent Definition

Agents are `.md` files with YAML frontmatter. **9 agents ship with the package** (Scout, Worker, Reviewer, Verifier, Planner, Lead, QA, Quick-Worker, Codebase Analyst) and are auto-discovered. Define your own in user or project directories — they override bundled agents with the same name.

### Discovery order (last wins)

1. **Bundled** — shipped with pi-minions (`extensions/subagent/agents/`)
2. **User** — `~/.pi/agent/agents/*.md`
3. **Project** — `.pi/agents/*.md` (nearest to cwd)

```markdown
---
name: fast-recon
description: Quick file search and pattern matching. Use for initial exploration.
tools: read,ls,find,grep
tier: fast
---

You are a fast reconnaissance agent. Find files quickly. Be concise.
```

| Location                          | Scope                 |
| --------------------------------- | --------------------- |
| `extensions/subagent/agents/*.md` | Bundled with package  |
| `~/.pi/agent/agents/*.md`         | Global (all projects) |
| `.pi/agents/*.md`                 | Project-local         |

### Frontmatter fields

| Field         | Description                                                        |
| ------------- | ------------------------------------------------------------------ |
| `name`        | Unique agent name                                                  |
| `description` | LLM-readable — Main Agent uses this to decide when to summon       |
| `tools`       | Comma-separated tool list (e.g. `read,ls,find,bash`)               |
| `model`       | Explicit model override                                            |
| `thinking`    | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `tier`        | Tier name (`fast`, `reasoning`) — resolves to model via settings   |

### Tier routing

Map tiers to models in `~/.pi/agent/settings.json`:

```json
{
  "subagent": {
    "models": {
      "fast": "deepseek/deepseek-v4-flash",
      "reasoning": "deepseek/deepseek-v4-pro"
    },
    "thinking": {
      "fast": "low"
    }
  }
}
```

Change models in one place — all agents using that tier update automatically.

### Model precedence

When resolving which model an agent runs with:

1. **Explicit `model:`** in the agent's frontmatter
2. **pi-quest role model** — a per-role model the user approved inside a [pi-suite](https://github.com/dvictor357/pi-suite) quest (`quest_assign_model`), read from the shared project memory at `~/.pi/agent/memory/projects/<cwdHash>.json`
3. **Tier mapping** in `settings.json`
4. **Unset** — the spawned `pi` inherits its own default

## Works with pi-suite / pi-quest

pi-minions is the `subagent` tool that [pi-suite](https://github.com/dvictor357/pi-suite)'s **pi-quest** orchestrator expects. Quest never registers its own `subagent` tool — its planning and verification steps call `subagent(agent="scout")`, `subagent(agent="planner")`, `subagent(agent="verifier")`, etc. The bundled agents (`scout`, `planner`, `worker`, `quick-worker`, `reviewer`, `verifier`) cover every role quest's built-in teams reference, so the two install side-by-side with no setup.

Per-role models a user approves in a quest are honored here too — see **Model precedence** above. The lookup is read-only and contract-versioned: with no pi-suite installed (or no quest run), the file is simply absent and pi-minions falls back to tier routing.

## License

MIT
