# Pi Minions

Delegate tasks to specialized subagents with **isolated context windows**.

Each subagent runs as an independent `pi` process — it can read hundreds of files, call tools, and reason deeply, and only the final answer comes back to the main session. No context pollution.

## Install

```bash
pi install git:github.com/dvictor357/pi-minions
```

## Modes

| Mode | Description |
|---|---|
| **Single** | One agent, one task. `{ agent, task }` |
| **Parallel** | Multiple agents run concurrently (max 4). `{ tasks: [...] }` |
| **Chain** | Sequential steps. Each step sees the previous output via `{previous}`. `{ chain: [...] }` |
| **Pipeline** | Items flow through stages independently — item B can be in stage 1 while item A is in stage 3. `{ items: [...], stages: [...] }` |

## Agent Definition

Agents are `.md` files with YAML frontmatter:

```markdown
---
name: fast-recon
description: Quick file search and pattern matching. Use for initial exploration.
tools: read,ls,find,grep
tier: fast
---

You are a fast reconnaissance agent. Find files quickly. Be concise.
```

| Location | Scope |
|---|---|
| `~/.pi/agent/agents/*.md` | Global (all projects) |
| `.pi/agents/*.md` | Project-local |

### Frontmatter fields

| Field | Description |
|---|---|
| `name` | Unique agent name |
| `description` | LLM-readable — Main Agent uses this to decide when to summon |
| `tools` | Comma-separated tool list (e.g. `read,ls,find,bash`) |
| `model` | Explicit model override |
| `thinking` | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `tier` | Tier name (`fast`, `reasoning`) — resolves to model via settings |

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

## License

MIT
