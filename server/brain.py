"""Brain directory scanner — reads Claude Code memory/skills/agents/rules/hooks."""

import os

from . import config

ALLOWED_EXTENSIONS = {'.md', '.sh'}


def scan():
    """Scan all brain directories and return tree structure."""
    scopes = []
    for scope in config.BRAIN_DIRS:
        categories = []
        for cat_name, cat_path in scope['categories'].items():
            if not cat_path or not os.path.isdir(cat_path):
                continue
            files = []
            for fname in sorted(os.listdir(cat_path)):
                _, ext = os.path.splitext(fname)
                if ext not in ALLOWED_EXTENSIONS:
                    continue
                fpath = os.path.join(cat_path, fname)
                if not os.path.isfile(fpath):
                    continue
                files.append({
                    'name': fname,
                    'size': os.path.getsize(fpath),
                })
            if files:
                categories.append({
                    'name': cat_name,
                    'dir': cat_path,
                    'files': files,
                })
        if categories:
            scopes.append({
                'id': scope['id'],
                'label': scope['label'],
                'categories': categories,
            })
    return scopes


def resolve_path(dirpath, filename):
    """Safely resolve a brain file path. Returns (full_path, writable) or (None, False)."""
    if not dirpath or not filename:
        return None, False

    # Prevent directory traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        return None, False

    _, ext = os.path.splitext(filename)
    if ext not in ALLOWED_EXTENSIONS:
        return None, False

    full_path = os.path.realpath(os.path.join(dirpath, filename))

    # Verify the resolved path is within an allowed brain directory
    base = os.path.realpath(dirpath)
    if not full_path.startswith(base + os.sep) and full_path != os.path.join(base, filename):
        return None, False

    if not os.path.isfile(full_path):
        return None, False

    writable = os.access(full_path, os.W_OK)
    return full_path, writable
