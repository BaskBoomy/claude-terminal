# create-claude-terminal

Set up [Claude Terminal](https://github.com/BaskBoomy/claude-terminal) with a single command — access Claude Code from anywhere via browser.

## Usage

```bash
npx create-claude-terminal
```

The interactive installer will:

1. Check prerequisites (tmux, Claude Code CLI)
2. Prompt for password, ports, domain, and install directory
3. Install [ttyd](https://github.com/tsl0922/ttyd) if not found
4. Download the Go server binary (or build from source)
5. Set up systemd (Linux) or launchd (macOS) services
6. Start everything automatically

## What is Claude Terminal?

A self-hosted PWA that wraps Claude Code in a mobile-friendly web UI. Install it on a Raspberry Pi, VPS, or any always-on machine — then open it from your phone, tablet, or any browser.

**Features:** Terminal, Preview, Notes, Brain (memory/skills editor), Dashboard (git + server status), Snippets, and more.

See the full documentation at [github.com/BaskBoomy/claude-terminal](https://github.com/BaskBoomy/claude-terminal).

## Requirements

- **Node.js 16+** (for this installer)
- **tmux** — `apt install tmux` / `brew install tmux`
- **Claude Code CLI** — [Installation guide](https://docs.anthropic.com/en/docs/claude-code)

## License

MIT
