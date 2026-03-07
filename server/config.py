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
GIT_DIR = _env('GIT_DIR') or None

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


def _build_brain_dirs():
    """Build list of brain directory configurations."""
    dirs = []

    # Global scope — always included
    global_claude = os.path.join(_HOME, '.claude')
    # Find the project memory dir (convention: ~/.claude/projects/-home-<user>/memory/)
    projects_dir = os.path.join(global_claude, 'projects')
    memory_dir = None
    if os.path.isdir(projects_dir):
        for d in os.listdir(projects_dir):
            mem = os.path.join(projects_dir, d, 'memory')
            if os.path.isdir(mem):
                memory_dir = mem
                break

    dirs.append({
        'id': 'global',
        'label': 'Global',
        'categories': {
            'memory': memory_dir,
            'skills': _dir_or_none(global_claude, 'skills'),
            'agents': _dir_or_none(global_claude, 'agents'),
            'hooks': _dir_or_none(global_claude, 'hooks'),
        }
    })

    # Project-specific scopes
    project_dirs_str = _env('PROJECT_DIRS')
    if project_dirs_str:
        for pdir in project_dirs_str.split(','):
            pdir = pdir.strip()
            if not pdir:
                continue
            pdir = os.path.expanduser(pdir)
            name = os.path.basename(pdir)
            claude_dir = os.path.join(pdir, '.claude')
            if os.path.isdir(claude_dir):
                dirs.append({
                    'id': name,
                    'label': name,
                    'categories': {
                        'skills': _dir_or_none(claude_dir, 'skills'),
                        'agents': _dir_or_none(claude_dir, 'agents'),
                        'rules': _dir_or_none(claude_dir, 'rules'),
                    }
                })

    return dirs


def _dir_or_none(base, sub):
    path = os.path.join(base, sub)
    return path if os.path.isdir(path) else None


BRAIN_DIRS = _build_brain_dirs()

# ─── Default settings ─────────────────────────────────────

DEFAULT_SETTINGS = {
    'general': {'wakeLock': False, 'fontSize': 16, 'notification': False},
    'snippets': []
}
