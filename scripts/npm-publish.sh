#!/bin/bash
# npm-publish.sh — create-claude-terminal npm 배포 스크립트
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PKG_DIR="$ROOT_DIR/npm"
ENV_FILE="$ROOT_DIR/.env"

# Load token from .env
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi
NPM_TOKEN=$(grep '^NPM_TOKEN=' "$ENV_FILE" | cut -d'=' -f2)
if [ -z "$NPM_TOKEN" ]; then
  echo "Error: NPM_TOKEN not found in .env"
  exit 1
fi

# Read current version
CURRENT=$(node -p "require('$PKG_DIR/package.json').version")
echo "Current version: $CURRENT"

# Determine bump type (default: patch)
BUMP="${1:-patch}"
case "$BUMP" in
  patch|minor|major) ;;
  *) echo "Usage: $0 [patch|minor|major]"; exit 1 ;;
esac

# Bump version
cd "$PKG_DIR"
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version | tr -d 'v')
echo "New version: $NEW_VERSION"

# Publish
npm publish --registry https://registry.npmjs.org/ --//registry.npmjs.org/:_authToken="$NPM_TOKEN"

echo ""
echo "Published create-claude-terminal@$NEW_VERSION"
