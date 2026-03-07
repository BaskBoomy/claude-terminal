"""Configuration management — loads from .env file and environment variables."""

import os
import hashlib
import secrets

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_dotenv():
    """Parse .env file into os.environ (simple key=value, no quotes handling)."""
    env_path = os.path.join(_ROOT, '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            key = key.strip()
            value = value.strip()
            # Remove surrounding quotes
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv()


def _env(key, default=''):
    return os.environ.get(key, default)


def _env_int(key, default):
    try:
        return int(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


# ─── Authentication ───────────────────────────────────────

_HASH_FILE = os.path.join(_ROOT, 'data', '.password_hash')

SESSION_MAX_AGE = _env_int('SESSION_MAX_AGE', 86400)
COOKIE_NAME = '__claude_session'
PBKDF2_ITERATIONS = 600_000
RATE_LIMIT_MAX = _env_int('RATE_LIMIT_MAX', 5)
RATE_LIMIT_WINDOW = _env_int('RATE_LIMIT_WINDOW', 900)


def _hash_password(password, salt):
    """Hash a password with PBKDF2-SHA256."""
    return hashlib.pbkdf2_hmac(
        'sha256', password.encode(), salt, PBKDF2_ITERATIONS
    ).hex()


def _ensure_password_hash():
    """Ensure password hash file exists. Create from PASSWORD env var if needed."""
    os.makedirs(os.path.dirname(_HASH_FILE), exist_ok=True)

    if os.path.exists(_HASH_FILE):
        with open(_HASH_FILE) as f:
            parts = f.read().strip().split(':')
            if len(parts) == 2:
                return parts[0], parts[1]

    password = _env('PASSWORD')
    if not password or password == 'changeme':
        raise SystemExit(
            'ERROR: Set PASSWORD in .env file (must not be "changeme")'
        )

    salt = secrets.token_hex(32)
    pw_hash = _hash_password(password, bytes.fromhex(salt))

    with open(_HASH_FILE, 'w') as f:
        f.write(f'{salt}:{pw_hash}')
    os.chmod(_HASH_FILE, 0o600)

    return salt, pw_hash


PASSWORD_SALT, PASSWORD_HASH = _ensure_password_hash()

# ─── Server ───────────────────────────────────────────────

HOST = _env('HOST', '0.0.0.0')
PORT = _env_int('PORT', 7682)
DOMAIN = _env('DOMAIN')
TTYD_PORT = _env_int('TTYD_PORT', 7681)

# ─── Paths ────────────────────────────────────────────────

DATA_DIR = os.path.join(_ROOT, 'data')
PUBLIC_DIR = os.path.join(_ROOT, 'public')
SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')
NOTES_DIR = os.path.join(DATA_DIR, 'notes')
UPLOAD_DIR = _env('UPLOAD_DIR', '/tmp/claude-uploads')
NOTIFY_DIR = _env('NOTIFY_DIR', '/tmp/claude-notify')

# ─── tmux ─────────────────────────────────────────────────

TMUX_SESSION = _env('TMUX_SESSION', 'claude')
CLAUDE_CMD = _env('CLAUDE_CMD', 'claude --dangerously-skip-permissions')


def _find_tmux_socket():
    """Auto-detect tmux socket path."""
    custom = _env('TMUX_SOCKET')
    if custom:
        return custom
    uid = os.getuid()
    default = f'/tmp/tmux-{uid}/default'
    if os.path.exists(default):
        return default
    return default


TMUX_SOCKET = _find_tmux_socket()

# ─── Brain directories ────────────────────────────────────

_HOME = os.path.expanduser('~')
_KNOWN_CATEGORIES = ('memory', 'skills', 'agents', 'rules', 'hooks')


def _dir_name_to_path(name):
    """Convert Claude projects dir name to real filesystem path.

    e.g. "-home-jack-dokjaeja" → "/home/jack/dokjaeja"

    Strategy: split on '-', then greedily try the shortest prefix
    that exists as a directory, resolve it, and continue with the rest.
    """
    # "-home-jack-dokjaeja" → ['home', 'jack', 'dokjaeja']
    segments = name.strip('-').split('-')
    if not segments:
        return None

    resolved = ''
    i = 0
    while i < len(segments):
        # Try single segment first, then progressively longer hyphenated names
        matched = False
        for end in range(i + 1, len(segments) + 1):
            candidate = resolved + '/' + '-'.join(segments[i:end])
            if os.path.isdir(candidate):
                resolved = candidate
                i = end
                matched = True
                break
        if not matched:
            # No existing dir found — append remaining as-is
            resolved = resolved + '/' + '-'.join(segments[i:])
            break

    return resolved if os.path.isdir(resolved) else None


def _build_brain_dirs():
    """Auto-discover brain directories from ~/.claude/projects/."""
    dirs = []
    global_claude = os.path.join(_HOME, '.claude')
    projects_dir = os.path.join(global_claude, 'projects')

    # 1. Global scope — scan ~/.claude/ for known categories
    global_cats = {}
    for cat in _KNOWN_CATEGORIES:
        if cat == 'memory':
            continue  # memory lives under projects/
        path = os.path.join(global_claude, cat)
        if os.path.isdir(path):
            global_cats[cat] = path

    # 2. Discover projects from ~/.claude/projects/
    seen_projects = {}  # real_path → project_dir_name
    if os.path.isdir(projects_dir):
        for d in sorted(os.listdir(projects_dir)):
            dpath = os.path.join(projects_dir, d)
            if not os.path.isdir(dpath):
                continue

            # Collect memory dirs into global scope
            mem = os.path.join(dpath, 'memory')
            if os.path.isdir(mem) and os.listdir(mem):
                label = 'memory' if d == '-' else 'memory (' + d + ')'
                global_cats[label] = mem

            # Reverse-map to real project path (skip home dir — already global)
            real_path = _dir_name_to_path(d)
            if real_path and real_path != _HOME and os.path.isdir(real_path):
                seen_projects[real_path] = d

    dirs.append({
        'id': 'global',
        'label': 'Global',
        'categories': global_cats,
    })

    # 3. Project scopes — scan <project>/.claude/ for known categories
    for real_path in sorted(seen_projects.keys()):
        claude_dir = os.path.join(real_path, '.claude')
        if not os.path.isdir(claude_dir):
            continue

        project_cats = {}
        for cat in _KNOWN_CATEGORIES:
            if cat == 'memory':
                continue  # already collected in global
            path = os.path.join(claude_dir, cat)
            if os.path.isdir(path):
                project_cats[cat] = path

        if project_cats:
            name = os.path.basename(real_path)
            dirs.append({
                'id': name,
                'label': name,
                'categories': project_cats,
            })

    return dirs


BRAIN_DIRS = _build_brain_dirs()

# ─── Git repositories (auto-discovered) ──────────────────

def _discover_git_repos():
    """Find git repos from ~/.claude/projects/ directory names."""
    repos = []
    seen = set()
    projects_dir = os.path.join(_HOME, '.claude', 'projects')

    if os.path.isdir(projects_dir):
        for d in sorted(os.listdir(projects_dir)):
            real_path = _dir_name_to_path(d)
            if not real_path or real_path == _HOME or real_path in seen:
                continue
            if os.path.isdir(os.path.join(real_path, '.git')):
                seen.add(real_path)
                repos.append({
                    'id': os.path.basename(real_path),
                    'path': real_path,
                })

    # Also check claude-terminal itself
    if os.path.isdir(os.path.join(_ROOT, '.git')) and _ROOT not in seen:
        repos.append({
            'id': os.path.basename(_ROOT),
            'path': _ROOT,
        })

    return sorted(repos, key=lambda r: r['id'])


GIT_REPOS = _discover_git_repos()

# ─── Default settings ─────────────────────────────────────

DEFAULT_SETTINGS = {
    'general': {'wakeLock': False, 'fontSize': 16, 'notification': False},
    'snippets': []
}
