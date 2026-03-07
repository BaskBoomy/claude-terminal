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

- Linux server (Raspberry Pi, VPS, etc.)
- Python 3.8+
- tmux
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/claude-terminal.git
cd claude-terminal
./install.sh
```

The install script will:
1. Install ttyd (web terminal emulator)
2. Configure your password and settings
3. Create systemd services
4. Start the server

Access at `http://YOUR_IP:7682`

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

### 3. Start services

```bash
# Start ttyd (web terminal)
ttyd -p 7681 -W -b /ttyd scripts/ttyd-start.sh &

# Start API server
python3 -m server.app
```

### 4. Access

Open `http://YOUR_IP:7682` in your browser. Log in with your password.

## HTTPS with Caddy (Recommended)

For secure remote access with a custom domain:

```bash
cp Caddyfile.example /etc/caddy/Caddyfile
# Edit: replace YOUR_DOMAIN and paths
sudo systemctl reload caddy
```

The Caddyfile template includes:
- Automatic TLS certificates
- Cookie-based auth check on ttyd access
- Static file serving with SPA fallback
- Redirect to login for unauthenticated users

## Configuration

All settings are in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PASSWORD` | (required) | Login password |
| `PORT` | `7682` | API server port |
| `TTYD_PORT` | `7681` | ttyd port |
| `DOMAIN` | | Custom domain (for display) |
| `GIT_DIR` | | Git repo path for dashboard |
| `PROJECT_DIRS` | | Comma-separated project paths for Brain tab |
| `TMUX_SESSION` | `claude` | tmux session name |
| `CLAUDE_CMD` | `claude --dangerously-skip-permissions` | Claude startup command |
| `SESSION_MAX_AGE` | `86400` | Session lifetime (seconds) |

## Project Structure

```
claude-terminal/
├── server/                 # Python backend
│   ├── app.py              # HTTP server + routing
│   ├── config.py           # Environment-based configuration
│   ├── auth.py             # Authentication + sessions
│   ├── brain.py            # Claude Code file scanner
│   └── routes.py           # API route handlers
├── public/                 # Frontend (served as static files)
│   ├── index.html          # Main app HTML
│   ├── login.html          # Login page
│   ├── css/style.css       # Styles
│   └── js/                 # ES modules
│       ├── app.js          # Main orchestrator
│       ├── terminal.js     # xterm.js integration
│       ├── preview.js      # Multi-tab browser
│       ├── notes.js        # Notes CRUD
│       ├── brain.js        # Memory/skills viewer
│       ├── dash.js         # Dashboard
│       ├── settings.js     # Settings sheet
│       ├── polling.js      # Status bar polling
│       ├── copy-mode.js    # Terminal copy mode
│       ├── gestures.js     # Touch gestures + PTR
│       ├── snippets.js     # Command snippets
│       ├── auth.js         # Auth check
│       └── utils.js        # Shared utilities
├── scripts/                # Setup scripts
├── data/                   # Runtime data (gitignored)
├── install.sh              # One-click setup
├── Caddyfile.example       # Caddy reverse proxy template
├── .env.example            # Configuration template
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
- Session cookies: HttpOnly, Secure, SameSite=Strict
- Rate limiting: 5 failed attempts per 15 minutes per IP
- Path traversal protection on brain file access
- No credentials stored in source code

## License

MIT
