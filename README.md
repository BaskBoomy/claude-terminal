# Claude Terminal

A mobile-friendly web terminal for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — access your AI coding assistant from anywhere via browser.

Built as a PWA (Progressive Web App) that connects to Claude Code running in tmux via [ttyd](https://github.com/nicot/ttyd). Designed for phones, tablets, and desktops.

## Features

- **Terminal** — Full xterm.js terminal with touch scrolling, tmux session switching (swipe), and input history
- **Preview** — Multi-tab browser for previewing web apps
- **Notes** — Create and manage notes with auto-save, send content directly to Claude
- **Brain** — Browse and edit Claude Code's memory, skills, agents, rules, and hooks with markdown rendering
- **Dashboard** — Git status, Claude usage metrics, and server health at a glance
- **Snippets** — Custom command buttons with color coding, confirmation, and new-window support
- **Settings** — Configurable terminal font size, input font size, wake lock, notifications
- **Pull-to-refresh** — Native-feeling refresh gesture on Brain and Dashboard tabs
- **Tab reordering** — Drag and drop to customize your tab layout
- **Copy mode** — Capture terminal output (current screen or scrollback history)
- **PWA** — Install as a home screen app on iOS/Android for full-screen experience

## Requirements

- Linux or macOS server (Raspberry Pi, VPS, etc.)
- tmux
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed

## Quick Start

```bash
git clone https://github.com/BaskBoomy/claude-terminal.git
cd claude-terminal
./install.sh
```

The install script will:
1. Install ttyd (web terminal emulator)
2. Configure your password and settings
3. Build the Go server (requires Go 1.22+)
4. Create systemd services
5. Start the server

Access at `http://YOUR_IP:PORT` (default port from `.env`)

## Manual Setup

### 1. Install ttyd

```bash
sudo bash scripts/setup-ttyd.sh
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — set at minimum: PASSWORD
```

### 3. Build

```bash
go build -ldflags="-s -w" -o claude-terminal .
```

### 4. Start services

```bash
# Start ttyd (web terminal)
ttyd -p $TTYD_PORT -W -b /ttyd scripts/ttyd-start.sh &

# Start server
./claude-terminal
```

### 5. Access

Open `http://YOUR_IP:PORT` in your browser. Log in with your password.

## HTTPS

The server supports automatic HTTPS via Let's Encrypt when a domain is configured:

```bash
# In .env
DOMAIN=your.domain.com
```

Alternatively, use a reverse proxy like Caddy or nginx.

## Configuration

All settings are in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PASSWORD` | (required) | Login password |
| `PORT` | `7680` | Server port |
| `TTYD_PORT` | `7681` | ttyd port |
| `DOMAIN` | | Custom domain (enables HTTPS) |
| `TMUX_SESSION` | `claude` | tmux session name |
| `CLAUDE_CMD` | `claude` | Claude startup command |
| `SESSION_MAX_AGE` | `86400` | Session lifetime (seconds) |
| `UPLOAD_DIR` | `/tmp/claude-uploads` | File upload directory |
| `NOTIFY_DIR` | `/tmp/claude-notify` | Notification directory |

## Project Structure

```
claude-terminal/
├── main.go                # Entry point + HTTP server
├── config.go              # Environment-based configuration
├── auth.go                # Authentication + sessions
├── routes.go              # API route handlers
├── brain.go               # Claude Code file scanner
├── public/                # Frontend (served as static files)
│   ├── index.html         # Main app HTML
│   ├── login.html         # Login page
│   ├── css/style.css      # Styles
│   └── js/                # ES modules
│       ├── app.js         # Main orchestrator
│       ├── terminal.js    # xterm.js integration
│       ├── preview.js     # Multi-tab browser
│       ├── notes.js       # Notes CRUD
│       ├── brain.js       # Memory/skills viewer
│       ├── dash.js        # Dashboard
│       ├── settings.js    # Settings sheet
│       ├── polling.js     # Status bar polling
│       ├── copy-mode.js   # Terminal copy mode
│       ├── gestures.js    # Touch gestures + PTR
│       ├── snippets.js    # Command snippets
│       ├── auth.js        # Auth check
│       └── utils.js       # Shared utilities
├── scripts/               # Setup scripts
├── data/                  # Runtime data (gitignored)
├── npm/                   # npx create-claude-terminal CLI
├── install.sh             # One-click setup
├── .env.example           # Configuration template
└── README.md
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Authenticate |
| GET | `/api/settings` | Get settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/tmux-session` | Current tmux session |
| GET | `/api/tmux-capture` | Capture terminal output |
| GET | `/api/claude-sessions` | List Claude sessions |
| POST | `/api/claude-send` | Send text to session |
| GET | `/api/notes` | List notes |
| GET | `/api/brain` | Brain file tree |
| GET | `/api/server-status` | Server metrics |
| GET | `/api/git-status` | Git repository status |
| GET | `/api/claude-usage` | Claude API usage |
| POST | `/upload` | File upload |

## Security

- Password hashed with PBKDF2-SHA256 (600,000 iterations)
- Session cookies: HttpOnly, Secure (when HTTPS), SameSite=Strict
- Rate limiting: 5 failed attempts per 15 minutes per IP
- Path traversal protection on brain file access
- No credentials stored in source code

## License

MIT
