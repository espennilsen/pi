# @e9n/pi-context

Visual context window usage command for [pi](https://github.com/mariozechner/pi-coding-agent) — see how your context budget is being spent, inspired by Claude Code's `/context` command.

## Features

- **Usage bar** — colored hexagon grid showing filled vs free context
- **Category breakdown** — system prompt, tools, agents, skills, messages shown with distinct colors
- **Per-item details** — individual token counts for every tool, agent profile, and skill
- **Autocompact buffer** — shows reserved space for compaction headroom

## Usage

```
/context
```

Example output:

```
Context Usage

⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛶ ⛶   claude-sonnet-4-5 · 38k/200k tokens (19.0%)
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶
⛁ ⛁ ⛁ ⛁ ⛀ ⛶ ⛶ ⛶ ⛶ ⛶   Estimated usage by category
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛝ ⛝ ⛝ ⛝
                           ⛁ System prompt: 3.2k tokens (1.6%)
                           ⛁ Tools: 18.4k tokens (9.2%)
                           ⛁ Custom agents: 1.5k tokens (0.8%)
                           ⛁ Skills: 1.1k tokens (0.6%)
                           ⛀ Messages: 14k tokens (7.0%)
                           ⛶ Free space: 129k (64.5%)
                           ⛝ Autocompact buffer: 33k tokens (16.5%)

Tools (12)
└ subagent: 2.8k tokens
└ bash: 1.4k tokens
└ read: 1.2k tokens
...
```

## Color Legend

| Symbol | Color | Category |
|--------|-------|----------|
| ⛁ | Blue | System prompt |
| ⛁ | Cyan | Tools |
| ⛁ | Magenta | Custom agents |
| ⛁ | Yellow | Skills |
| ⛀ | Green | Messages |
| ⛶ | Gray | Free space |
| ⛝ | Red | Autocompact buffer |

## Notes

- **Autocompact buffer** is based on pi's `compaction.reserveTokens` setting (default: 16,384 tokens). The value is read from your settings if configured, otherwise the default is used. See [pi compaction docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md) for details.
- **Category estimates** are approximate — token counts use a chars/4 heuristic and may not exactly match the API-reported usage.

## Install

```bash
pi install npm:@e9n/pi-context
```

## License

MIT
