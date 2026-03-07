#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[ttyd]${NC} $1"; }
error()   { echo -e "${RED}[ttyd]${NC} $1"; exit 1; }

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)   TTYD_ARCH="x86_64" ;;
    aarch64)  TTYD_ARCH="aarch64" ;;
    armv7l)   TTYD_ARCH="armhf" ;;
    *)        error "Unsupported architecture: $ARCH" ;;
esac

info "Detected architecture: $ARCH -> ttyd binary: $TTYD_ARCH"

# Get latest release URL from GitHub
TTYD_VERSION="$(curl -s https://api.github.com/repos/tsl0922/ttyd/releases/latest | grep -oP '"tag_name":\s*"\K[^"]+')"
if [ -z "$TTYD_VERSION" ]; then
    TTYD_VERSION="1.7.7"
    info "Could not detect latest version, using $TTYD_VERSION"
else
    info "Latest ttyd version: $TTYD_VERSION"
fi

DOWNLOAD_URL="https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${TTYD_ARCH}"

info "Downloading from: $DOWNLOAD_URL"
TMP_FILE="$(mktemp)"
curl -fsSL -o "$TMP_FILE" "$DOWNLOAD_URL" || error "Failed to download ttyd"

info "Installing to /usr/local/bin/ttyd"
sudo mv "$TMP_FILE" /usr/local/bin/ttyd
sudo chmod +x /usr/local/bin/ttyd

info "Installed: $(ttyd --version 2>&1 | head -1)"
