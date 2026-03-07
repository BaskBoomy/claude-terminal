"""Brain directory scanner — reads Claude Code memory/skills/agents/rules/hooks."""

import os

from . import config

ALLOWED_EXTENSIONS = {'.md', '.sh'}


def scan():
    """Scan all brain directories and return tree structure.

    Handles both flat files (rules/hooks) and subdirectory-based entries
    (agents/skills where each entry is a subfolder containing a .md file).
    """
    scopes = []
    for scope in config.BRAIN_DIRS:
        categories = []
        for cat_name, cat_path in scope['categories'].items():
            if not cat_path or not os.path.isdir(cat_path):
                continue
            files = []
            for entry in sorted(os.listdir(cat_path)):
                entry_path = os.path.join(cat_path, entry)
                # Direct file (e.g. rules/api-patterns.md, hooks/notify.sh)
                if os.path.isfile(entry_path):
                    _, ext = os.path.splitext(entry)
                    if ext in ALLOWED_EXTENSIONS:
                        files.append({
                            'name': entry,
                            'size': os.path.getsize(entry_path),
                        })
                # Subdirectory (e.g. agents/billing-dev/, skills/new-feature/)
                elif os.path.isdir(entry_path):
                    for fname in sorted(os.listdir(entry_path)):
                        _, ext = os.path.splitext(fname)
                        if ext not in ALLOWED_EXTENSIONS:
                            continue
                        fpath = os.path.join(entry_path, fname)
                        if os.path.isfile(fpath):
                            # Use subdir/filename as the display name
                            files.append({
                                'name': os.path.join(entry, fname),
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
    """Safely resolve a brain file path. Returns (full_path, writable) or (None, False).

    Supports both flat files (e.g. "api-patterns.md") and subdirectory files
    (e.g. "billing-dev/billing-dev.md").
    """
    if not dirpath or not filename:
        return None, False

    # Prevent directory traversal
    if '..' in filename or '\\' in filename:
        return None, False

    # Allow at most one level of subdirectory (subdir/file.md)
    parts = filename.replace('\\', '/').split('/')
    if len(parts) > 2:
        return None, False

    _, ext = os.path.splitext(filename)
    if ext not in ALLOWED_EXTENSIONS:
        return None, False

    full_path = os.path.realpath(os.path.join(dirpath, filename))

    # Verify the resolved path is within the allowed brain directory
    base = os.path.realpath(dirpath)
    if not full_path.startswith(base + os.sep):
        return None, False

    if not os.path.isfile(full_path):
        return None, False

    writable = os.access(full_path, os.W_OK)
    return full_path, writable
