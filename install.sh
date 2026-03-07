#!/bin/bash
set -e

# ─── Colors ────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo -e "${BOLD}"
echo "  ┌─────────────────────────────────────┐"
echo "  │       Claude Terminal Installer      │"
echo "  └─────────────────────────────────────┘"
echo -e "${NC}"

# ─── 1. Check prerequisites ───────────────────────────────
info "Checking prerequisites..."

command -v python3 >/dev/null 2>&1 || error "python3 is required but not installed. Run: sudo apt install python3"
success "python3 found: $(python3 --version)"

command -v tmux >/dev/null 2>&1 || error "tmux is required but not installed. Run: sudo apt install tmux"
success "tmux found: $(tmux -V)"

# ─── 2. Install ttyd if not found ─────────────────────────
if command -v ttyd >/dev/null 2>&1; then
    success "ttyd found: $(ttyd --version 2>&1 | head -1)"
else
    warn "ttyd not found. Installing..."
    bash "$SCRIPT_DIR/scripts/setup-ttyd.sh"
    success "ttyd installed: $(ttyd --version 2>&1 | head -1)"
fi

# ─── 3. Create .env from .env.example ─────────────────────
ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    info ".env already exists, preserving it."
else
    cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
    success "Created .env from .env.example"
fi

# ─── 4. Prompt for password ───────────────────────────────
echo ""
echo -e "${BOLD}Configuration${NC}"
echo "─────────────────────────────────────────"

read -sp "$(echo -e "${CYAN}Enter password for web access: ${NC}")" PASSWORD
echo ""
if [ -z "$PASSWORD" ]; then
    error "Password cannot be empty."
fi
sed -i "s|^PASSWORD=.*|PASSWORD=$PASSWORD|" "$ENV_FILE"
success "Password saved to .env"

# ─── 5. Prompt for domain (optional) ──────────────────────
echo ""
read -p "$(echo -e "${CYAN}Domain name (e.g. claude.example.com) [leave empty to skip]: ${NC}")" DOMAIN
if [ -n "$DOMAIN" ]; then
    sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" "$ENV_FILE"
    success "Domain set: $DOMAIN"
fi

# ─── 6. Prompt for git directory (optional) ───────────────
echo ""
read -p "$(echo -e "${CYAN}Git repository path to monitor [leave empty to skip]: ${NC}")" GIT_DIR
if [ -n "$GIT_DIR" ]; then
    GIT_DIR="$(realpath "$GIT_DIR" 2>/dev/null || echo "$GIT_DIR")"
    if [ ! -d "$GIT_DIR/.git" ]; then
        warn "$GIT_DIR does not appear to be a git repository."
    fi
    sed -i "s|^GIT_DIR=.*|GIT_DIR=$GIT_DIR|" "$ENV_FILE"
    success "Git directory set: $GIT_DIR"
fi

# ─── 7. Prompt for project directories (optional) ─────────
echo ""
read -p "$(echo -e "${CYAN}Project directories for Brain scan (comma-separated) [leave empty to skip]: ${NC}")" PROJECT_DIRS
if [ -n "$PROJECT_DIRS" ]; then
    sed -i "s|^PROJECT_DIRS=.*|PROJECT_DIRS=$PROJECT_DIRS|" "$ENV_FILE"
    success "Project directories set: $PROJECT_DIRS"
fi

# ─── 8. Create data directory structure ───────────────────
echo ""
info "Creating data directories..."
mkdir -p "$SCRIPT_DIR/data"
mkdir -p /tmp/claude-uploads
mkdir -p /tmp/claude-notify
success "Data directories ready"

# ─── 9. Create systemd service files ─────────────────────
info "Creating systemd service files..."

CURRENT_USER="$(whoami)"
PYTHON_BIN="$(command -v python3)"

# Main server service
sudo tee /etc/systemd/system/claude-terminal.service > /dev/null <<EOF
[Unit]
Description=Claude Terminal - Python API Server
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$PYTHON_BIN $SCRIPT_DIR/server/app.py
Restart=on-failure
RestartSec=5
EnvironmentFile=$SCRIPT_DIR/.env

[Install]
WantedBy=multi-user.target
EOF
success "Created claude-terminal.service"

# ttyd service
TTYD_BIN="$(command -v ttyd)"
sudo tee /etc/systemd/system/claude-terminal-ttyd.service > /dev/null <<EOF
[Unit]
Description=Claude Terminal - ttyd Web Terminal
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
Environment=TMUX_SESSION=claude
Environment=CLAUDE_CMD=claude --dangerously-skip-permissions
EnvironmentFile=$SCRIPT_DIR/.env
ExecStart=$TTYD_BIN --port 7681 --base-path /ttyd --writable $SCRIPT_DIR/scripts/ttyd-start.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
success "Created claude-terminal-ttyd.service"

# ─── 10. Enable and start services ────────────────────────
echo ""
info "Enabling and starting services..."
sudo systemctl daemon-reload
sudo systemctl enable claude-terminal.service claude-terminal-ttyd.service
sudo systemctl restart claude-terminal.service claude-terminal-ttyd.service
success "Services started"

# ─── 11. Print access info ────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo "  ┌─────────────────────────────────────┐"
echo "  │     Installation Complete!           │"
echo "  └─────────────────────────────────────┘"
echo -e "${NC}"

echo -e "  ${BOLD}Services:${NC}"
echo "    sudo systemctl status claude-terminal"
echo "    sudo systemctl status claude-terminal-ttyd"
echo ""
echo -e "  ${BOLD}Logs:${NC}"
echo "    journalctl -u claude-terminal -f"
echo "    journalctl -u claude-terminal-ttyd -f"
echo ""

if [ -n "$DOMAIN" ]; then
    echo -e "  ${BOLD}Access URL:${NC}"
    echo "    https://$DOMAIN"
    echo ""
    echo -e "  ${BOLD}Next steps:${NC}"
    echo "    1. Set up Caddy (see Caddyfile.example)"
    echo "    2. Point DNS for $DOMAIN to this server"
else
    echo -e "  ${BOLD}Access URL:${NC}"
    echo "    http://$(hostname -I | awk '{print $1}'):7682"
    echo ""
    echo -e "  ${BOLD}Next steps:${NC}"
    echo "    1. (Optional) Set up a domain with Caddy (see Caddyfile.example)"
fi
echo ""
