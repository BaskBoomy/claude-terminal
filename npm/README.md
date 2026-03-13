# create-claude-terminal

Set up [Claude Web Terminal](https://github.com/BaskBoomy/claude-terminal) with a single command — access Claude Code from anywhere via browser.

## Usage

```bash
npx create-claude-terminal
```

The interactive installer will:

1. Check & auto-install prerequisites (tmux, Claude Code CLI, ttyd)
2. Prompt for password, ports, domain, and install directory
3. Download the Go server binary (or build from source)
4. Set up systemd (Linux) or launchd (macOS) services
5. Start everything automatically

Just press Enter through all prompts for sensible defaults.

## What is Claude Web Terminal?

A self-hosted PWA that wraps Claude Code in a mobile-friendly web UI. Install it on a Raspberry Pi, VPS, or any always-on machine — then open it from your phone, tablet, or any browser.

**Features:** Terminal, Preview, Notes, Brain (memory/skills editor), Files (file browser/editor), Launch (URL bookmarks), Dashboard (git + server status), Snippets, and more.

> **📱 PWA Recommended** — For the best mobile experience, tap "Add to Home Screen" in your browser to install as a PWA. Full-screen, wake lock, background notifications — like a native app.

See the full documentation at [github.com/BaskBoomy/claude-terminal](https://github.com/BaskBoomy/claude-terminal).

## Requirements

- **Node.js 16+** (for this installer)
- **tmux** — auto-installed if missing
- **Claude Code CLI** — auto-installed if missing

## License

MIT
