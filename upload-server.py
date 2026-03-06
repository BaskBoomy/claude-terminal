#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
import os, uuid, json, mimetypes, secrets, hashlib, time

UPLOAD_DIR = '/tmp/claude-uploads'
SETTINGS_FILE = '/home/jack/claude-terminal/settings.json'
NOTES_DIR = '/home/jack/claude-terminal/notes'
TMUX_SOCKET = '/tmp/tmux-1000/default'

# --- Brain (Claude Code memory) config ---
BRAIN_DIRS = [
    {
        'id': 'global',
        'label': 'Global (~/.claude/)',
        'memory': os.path.expanduser('~/.claude/projects/-home-jack/memory'),
        'skills': os.path.expanduser('~/.claude/skills'),
        'agents': os.path.expanduser('~/.claude/agents'),
        'hooks': os.path.expanduser('~/.claude/hooks'),
    },
    {
        'id': 'dokjaeja',
        'label': 'Dokjaeja Project',
        'memory': None,
        'skills': os.path.expanduser('~/dokjaeja/.claude/skills'),
        'agents': os.path.expanduser('~/dokjaeja/.claude/agents'),
        'hooks': None,
        'rules': os.path.expanduser('~/dokjaeja/.claude/rules'),
    },
]

DEFAULT_SETTINGS = {
    "general": {"wakeLock": False, "fontSize": 16},
    "snippets": []
}

# --- Auth config ---
PASSWORD_SALT = bytes.fromhex('616b76223e08750cb9c6766f48d6c63934699767567fe72a66e6406ea06f7880')
PASSWORD_HASH = '0a8f6ff79bdd949bea53425aed99392dd0b9fa837936de3ef6816474b4f2ca16'
PBKDF2_ITERATIONS = 600000
SESSION_MAX_AGE = 86400  # 24 hours
COOKIE_NAME = '__claude_session'

# In-memory session store: {token: {created, last_active, ip}}
sessions = {}

# Rate limiting: {ip: {count, first_attempt}}
login_attempts = {}
RATE_LIMIT_WINDOW = 900  # 15 minutes
RATE_LIMIT_MAX = 5


def verify_password(password):
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), PASSWORD_SALT, PBKDF2_ITERATIONS)
    return dk.hex() == PASSWORD_HASH


def cleanup_sessions():
    now = time.time()
    expired = [t for t, s in sessions.items() if now - s['created'] > SESSION_MAX_AGE]
    for t in expired:
        del sessions[t]


def check_rate_limit(ip):
    now = time.time()
    entry = login_attempts.get(ip)
    if not entry:
        return True
    if now - entry['first_attempt'] > RATE_LIMIT_WINDOW:
        del login_attempts[ip]
        return True
    return entry['count'] < RATE_LIMIT_MAX


def record_failed_attempt(ip):
    now = time.time()
    entry = login_attempts.get(ip)
    if not entry or now - entry['first_attempt'] > RATE_LIMIT_WINDOW:
        login_attempts[ip] = {'count': 1, 'first_attempt': now}
    else:
        entry['count'] += 1


def reset_attempts(ip):
    login_attempts.pop(ip, None)


# --- Notes helpers ---
import re

def _safe_note_id(note_id):
    return bool(re.match(r'^[a-f0-9]{8}$', note_id or ''))

def _note_path(note_id):
    return os.path.join(NOTES_DIR, note_id + '.json')

def _list_notes():
    os.makedirs(NOTES_DIR, exist_ok=True)
    notes = []
    for fname in os.listdir(NOTES_DIR):
        if not fname.endswith('.json'):
            continue
        try:
            with open(os.path.join(NOTES_DIR, fname), 'r') as f:
                data = json.load(f)
            content = data.get('content', '')
            preview = content.split('\n')[0][:80] if content else ''
            notes.append({
                'id': fname[:-5],
                'title': data.get('title', ''),
                'preview': preview,
                'updatedAt': data.get('updatedAt', data.get('createdAt', 0)),
                'createdAt': data.get('createdAt', 0),
            })
        except Exception:
            continue
    notes.sort(key=lambda n: n['updatedAt'], reverse=True)
    return notes

def _read_note(note_id):
    try:
        with open(_note_path(note_id), 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return None

def _write_note(note_id, data):
    os.makedirs(NOTES_DIR, exist_ok=True)
    with open(_note_path(note_id), 'w') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def _delete_note(note_id):
    try:
        os.remove(_note_path(note_id))
        return True
    except FileNotFoundError:
        return False


# --- Brain helpers ---
def _brain_scan():
    """Scan all brain directories and return structured tree."""
    result = []
    for conf in BRAIN_DIRS:
        scope = {'id': conf['id'], 'label': conf['label'], 'categories': []}
        for cat in ('memory', 'skills', 'agents', 'rules', 'hooks'):
            dirpath = conf.get(cat)
            if not dirpath or not os.path.isdir(dirpath):
                continue
            files = []
            for root, dirs, fnames in os.walk(dirpath):
                for fname in sorted(fnames):
                    if not fname.endswith(('.md', '.sh')):
                        continue
                    full = os.path.join(root, fname)
                    rel = os.path.relpath(full, dirpath)
                    try:
                        stat = os.stat(full)
                        size = stat.st_size
                        mtime = int(stat.st_mtime * 1000)
                    except Exception:
                        size = 0
                        mtime = 0
                    files.append({'name': rel, 'size': size, 'mtime': mtime})
            if files:
                scope['categories'].append({'name': cat, 'dir': dirpath, 'files': files})
        result.append(scope)
    return result

def _brain_resolve_path(dirpath, filename):
    """Safely resolve a brain file path, preventing directory traversal."""
    base = os.path.realpath(dirpath)
    full = os.path.realpath(os.path.join(dirpath, filename))
    if not full.startswith(base + os.sep) and full != base:
        return None
    if not full.endswith(('.md', '.sh')):
        return None
    return full


class Handler(BaseHTTPRequestHandler):

    def _get_client_ip(self):
        forwarded = self.headers.get('X-Forwarded-For')
        if forwarded:
            return forwarded.split(',')[0].strip()
        return self.client_address[0]

    def _get_session_token(self):
        cookie_header = self.headers.get('Cookie', '')
        for part in cookie_header.split(';'):
            part = part.strip()
            if part.startswith(COOKIE_NAME + '='):
                return part[len(COOKIE_NAME) + 1:]
        return None

    def _require_auth(self):
        cleanup_sessions()
        token = self._get_session_token()
        if token and token in sessions:
            sessions[token]['last_active'] = time.time()
            return True
        self._json_response(401, json.dumps({'error': 'unauthorized'}).encode())
        return False

    def _set_session_cookie(self, token):
        cookie = '{}={}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age={}'.format(
            COOKIE_NAME, token, SESSION_MAX_AGE
        )
        self.send_header('Set-Cookie', cookie)

    def _clear_session_cookie(self):
        cookie = '{}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'.format(COOKIE_NAME)
        self.send_header('Set-Cookie', cookie)

    def _json_response(self, code, body, extra_headers=None):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        if extra_headers:
            extra_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/auth/check':
            cleanup_sessions()
            token = self._get_session_token()
            authenticated = token is not None and token in sessions
            if authenticated:
                sessions[token]['last_active'] = time.time()
            self._json_response(200, json.dumps({'authenticated': authenticated}).encode())

        elif self.path == '/api/settings':
            if not self._require_auth():
                return
            try:
                with open(SETTINGS_FILE, 'r') as f:
                    data = f.read()
            except FileNotFoundError:
                data = json.dumps(DEFAULT_SETTINGS)
            self._json_response(200, data.encode())

        elif self.path == '/api/tmux-session':
            if not self._require_auth():
                return
            import subprocess
            try:
                result = subprocess.run(
                    ['tmux', '-S', TMUX_SOCKET, 'display-message', '-p', '#S:#I.#W'],
                    capture_output=True, text=True, timeout=2
                )
                info = result.stdout.strip() or 'unknown'
            except Exception:
                info = 'disconnected'
            self._json_response(200, json.dumps({'session': info}).encode())

        elif self.path.startswith('/api/tmux-capture'):
            if not self._require_auth():
                return
            import subprocess
            # Parse ?lines=N (default: visible pane only)
            start = '-'  # visible pane start
            history = False
            if '?' in self.path:
                for param in self.path.split('?')[1].split('&'):
                    if param.startswith('history=1'):
                        history = True
            try:
                cmd = ['tmux', '-S', TMUX_SOCKET, 'capture-pane', '-p']
                if history:
                    cmd.extend(['-S', '-500'])  # last 500 lines of scrollback
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
                text = result.stdout
            except Exception as e:
                text = f'Error: {e}'
            self._json_response(200, json.dumps({'text': text}).encode())

        elif self.path.startswith('/api/notifications'):
            if not self._require_auth():
                return
            import glob as g
            # Parse ?since=<timestamp_ms>
            since = 0
            if '?' in self.path:
                for param in self.path.split('?')[1].split('&'):
                    if param.startswith('since='):
                        try:
                            since = int(param.split('=')[1])
                        except ValueError:
                            pass
            notify_dir = '/tmp/claude-notify'
            items = []
            try:
                for f in sorted(g.glob(os.path.join(notify_dir, '*.json'))):
                    basename = os.path.basename(f)
                    try:
                        file_ts = int(basename.replace('.json', ''))
                    except ValueError:
                        continue
                    if file_ts > since:
                        with open(f) as fh:
                            items.append(json.loads(fh.read()))
            except Exception:
                pass
            self._json_response(200, json.dumps({'notifications': items}).encode())

        elif self.path == '/api/server-status':
            if not self._require_auth():
                return
            status = {}
            # CPU: load average → percentage (4 cores)
            try:
                with open('/proc/loadavg') as f:
                    load1 = float(f.read().split()[0])
                status['cpu'] = min(round(load1 / 4 * 100), 100)
            except Exception:
                status['cpu'] = None
            # Memory
            try:
                meminfo = {}
                with open('/proc/meminfo') as f:
                    for line in f:
                        parts = line.split()
                        if parts[0] in ('MemTotal:', 'MemAvailable:'):
                            meminfo[parts[0][:-1]] = int(parts[1])
                total = meminfo['MemTotal']
                avail = meminfo['MemAvailable']
                status['mem'] = round((total - avail) / total * 100)
                status['memUsedGB'] = round((total - avail) / 1048576, 1)
                status['memTotalGB'] = round(total / 1048576, 1)
            except Exception:
                status['mem'] = None
                status['memUsedGB'] = None
                status['memTotalGB'] = None
            # Disk
            try:
                st = os.statvfs('/')
                total_d = st.f_blocks * st.f_frsize
                free_d = st.f_bavail * st.f_frsize
                status['disk'] = round((total_d - free_d) / total_d * 100)
            except Exception:
                status['disk'] = None
            # Temperature
            try:
                with open('/sys/class/thermal/thermal_zone0/temp') as f:
                    status['temp'] = round(int(f.read().strip()) / 1000)
            except Exception:
                status['temp'] = None
            # Load average (raw)
            try:
                with open('/proc/loadavg') as f:
                    status['loadAvg'] = float(f.read().split()[0])
            except Exception:
                status['loadAvg'] = None
            self._json_response(200, json.dumps(status).encode())

        elif self.path == '/api/claude-usage':
            if not self._require_auth():
                return
            import urllib.request
            # Server-side cache: 60s success, 300s on error (avoid hammering on 429)
            now = time.time()
            cache_ttl = 60 if getattr(Handler, '_usage_ok', True) else 300
            if hasattr(Handler, '_usage_cache') and Handler._usage_cache and now - Handler._usage_cache_ts < cache_ttl:
                self._json_response(200, Handler._usage_cache)
                return
            try:
                creds = json.load(open(os.path.expanduser('~/.claude/.credentials.json')))
                token = creds['claudeAiOauth']['accessToken']
                req = urllib.request.Request(
                    'https://api.anthropic.com/api/oauth/usage',
                    headers={
                        'Authorization': 'Bearer ' + token,
                        'anthropic-beta': 'oauth-2025-04-20',
                        'User-Agent': 'claude-code/1.0'
                    }
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = resp.read()
                Handler._usage_cache = data
                Handler._usage_cache_ts = now
                Handler._usage_ok = True
                self._json_response(200, data)
            except Exception as e:
                err_data = json.dumps({'error': str(e)}).encode()
                Handler._usage_cache = err_data
                Handler._usage_cache_ts = now
                Handler._usage_ok = False
                self._json_response(200, err_data)

        elif self.path == '/api/claude-sessions':
            if not self._require_auth():
                return
            import subprocess
            sessions_list = []
            try:
                result = subprocess.run(
                    ['tmux', '-S', TMUX_SOCKET, 'list-panes', '-a', '-F',
                     '#{session_name}:#{window_index}.#{pane_index}|#{pane_current_command}|#{pane_title}'],
                    capture_output=True, text=True, timeout=3
                )
                for line in result.stdout.strip().split('\n'):
                    if not line:
                        continue
                    parts = line.split('|', 2)
                    if len(parts) < 3:
                        continue
                    target, cmd, title = parts
                    if cmd == 'claude':
                        # Clean spinner chars from title
                        clean_title = title.strip()
                        for ch in '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠐⠂✳':
                            clean_title = clean_title.replace(ch, '').strip()
                        sessions_list.append({
                            'target': target,
                            'title': clean_title or 'Claude Code',
                            'rawTitle': title,
                        })
            except Exception:
                pass
            self._json_response(200, json.dumps({'sessions': sessions_list}).encode())

        elif self.path == '/api/notes':
            if not self._require_auth():
                return
            self._json_response(200, json.dumps({'notes': _list_notes()}).encode())

        elif self.path.startswith('/api/notes/'):
            if not self._require_auth():
                return
            note_id = self.path.split('/api/notes/')[1].split('?')[0]
            if not _safe_note_id(note_id):
                self.send_error(400, 'Invalid note ID')
                return
            note = _read_note(note_id)
            if not note:
                self.send_error(404, 'Note not found')
                return
            self._json_response(200, json.dumps(note).encode())

        elif self.path.startswith('/api/git-status'):
            if not self._require_auth():
                return
            import subprocess
            # Parse ?dir=<path> (default: ~/dokjaeja)
            git_dir = os.path.expanduser('~/dokjaeja')
            if '?' in self.path:
                import urllib.parse as up
                params = up.parse_qs(self.path.split('?', 1)[1])
                d = params.get('dir', [''])[0]
                if d:
                    git_dir = d
            result = {}
            try:
                def git(*args):
                    r = subprocess.run(
                        ['git'] + list(args),
                        cwd=git_dir, capture_output=True, text=True, timeout=5
                    )
                    return r.stdout.strip()
                result['branch'] = git('branch', '--show-current')
                # Status summary
                status_raw = git('status', '--porcelain')
                lines = [l for l in status_raw.split('\n') if l.strip()] if status_raw else []
                staged = sum(1 for l in lines if l[0] not in (' ', '?'))
                unstaged = sum(1 for l in lines if len(l) > 1 and l[1] in ('M', 'D'))
                untracked = sum(1 for l in lines if l.startswith('??'))
                result['changes'] = {
                    'total': len(lines), 'staged': staged,
                    'unstaged': unstaged, 'untracked': untracked
                }
                result['files'] = lines[:30]  # max 30 lines
                # Recent commits
                log_raw = git('log', '--oneline', '--no-merges', '-10',
                              '--format=%h|%s|%ar|%an')
                commits = []
                for line in (log_raw.split('\n') if log_raw else []):
                    parts = line.split('|', 3)
                    if len(parts) == 4:
                        commits.append({
                            'hash': parts[0], 'message': parts[1],
                            'ago': parts[2], 'author': parts[3]
                        })
                result['commits'] = commits
                # Ahead/behind
                try:
                    ab = git('rev-list', '--left-right', '--count', '@{u}...HEAD')
                    behind, ahead = ab.split('\t')
                    result['ahead'] = int(ahead)
                    result['behind'] = int(behind)
                except Exception:
                    result['ahead'] = 0
                    result['behind'] = 0
            except Exception as e:
                result['error'] = str(e)
            self._json_response(200, json.dumps(result).encode())

        elif self.path == '/api/brain':
            if not self._require_auth():
                return
            self._json_response(200, json.dumps({'scopes': _brain_scan()}).encode())

        elif self.path.startswith('/api/brain/read?'):
            if not self._require_auth():
                return
            import urllib.parse
            params = urllib.parse.parse_qs(self.path.split('?', 1)[1])
            dirpath = params.get('dir', [''])[0]
            filename = params.get('file', [''])[0]
            if not dirpath or not filename:
                self.send_error(400, 'Missing dir or file')
                return
            full = _brain_resolve_path(dirpath, filename)
            if not full or not os.path.isfile(full):
                self.send_error(404, 'File not found')
                return
            try:
                with open(full, 'r', encoding='utf-8') as f:
                    content = f.read()
                self._json_response(200, json.dumps({
                    'content': content,
                    'path': full,
                    'size': len(content),
                    'writable': os.access(full, os.W_OK)
                }).encode())
            except Exception as e:
                self._json_response(500, json.dumps({'error': str(e)}).encode())

        else:
            self.send_error(404)

    def do_PUT(self):
        if self.path == '/api/settings':
            if not self._require_auth():
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                settings = json.loads(body)
                with open(SETTINGS_FILE, 'w') as f:
                    json.dump(settings, f, indent=2, ensure_ascii=False)
                self._json_response(200, json.dumps({'ok': True}).encode())
            except json.JSONDecodeError:
                self.send_error(400, 'Invalid JSON')

        elif self.path.startswith('/api/notes/'):
            if not self._require_auth():
                return
            note_id = self.path.split('/api/notes/')[1].split('?')[0]
            if not _safe_note_id(note_id):
                self.send_error(400, 'Invalid note ID')
                return
            existing = _read_note(note_id)
            if not existing:
                self.send_error(404, 'Note not found')
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                existing['title'] = data.get('title', existing.get('title', ''))
                existing['content'] = data.get('content', existing.get('content', ''))
                existing['updatedAt'] = int(time.time() * 1000)
                _write_note(note_id, existing)
                self._json_response(200, json.dumps({'ok': True}).encode())
            except json.JSONDecodeError:
                self.send_error(400, 'Invalid JSON')

        elif self.path == '/api/brain/write':
            if not self._require_auth():
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_error(400, 'Invalid JSON')
                return
            dirpath = data.get('dir', '')
            filename = data.get('file', '')
            content = data.get('content', '')
            if not dirpath or not filename:
                self.send_error(400, 'Missing dir or file')
                return
            full = _brain_resolve_path(dirpath, filename)
            if not full:
                self.send_error(400, 'Invalid path')
                return
            if not os.path.isfile(full):
                self.send_error(404, 'File not found')
                return
            if not os.access(full, os.W_OK):
                self.send_error(403, 'File not writable')
                return
            try:
                with open(full, 'w', encoding='utf-8') as f:
                    f.write(content)
                self._json_response(200, json.dumps({'ok': True}).encode())
            except Exception as e:
                self._json_response(500, json.dumps({'error': str(e)}).encode())

        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == '/api/auth/login':
            ip = self._get_client_ip()
            if not check_rate_limit(ip):
                self._json_response(429, json.dumps({
                    'error': 'Too many attempts. Try again later.'
                }).encode())
                return

            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_error(400, 'Invalid JSON')
                return

            password = data.get('password', '')
            if verify_password(password):
                reset_attempts(ip)
                token = secrets.token_hex(32)
                sessions[token] = {
                    'created': time.time(),
                    'last_active': time.time(),
                    'ip': ip
                }
                self._json_response(200, json.dumps({'ok': True}).encode(),
                    extra_headers=lambda: self._set_session_cookie(token))
            else:
                record_failed_attempt(ip)
                self._json_response(401, json.dumps({
                    'error': 'Wrong password'
                }).encode())

        elif self.path == '/api/auth/logout':
            token = self._get_session_token()
            if token and token in sessions:
                del sessions[token]
            self._json_response(200, json.dumps({'ok': True}).encode(),
                extra_headers=lambda: self._clear_session_cookie())

        elif self.path == '/api/notes':
            if not self._require_auth():
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body) if length > 0 else {}
            except json.JSONDecodeError:
                data = {}
            note_id = uuid.uuid4().hex[:8]
            now = int(time.time() * 1000)
            note = {
                'title': data.get('title', ''),
                'content': data.get('content', ''),
                'createdAt': now,
                'updatedAt': now,
            }
            _write_note(note_id, note)
            self._json_response(200, json.dumps({'id': note_id}).encode())

        elif self.path == '/api/claude-send':
            if not self._require_auth():
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_error(400, 'Invalid JSON')
                return
            target = data.get('target', '')
            text = data.get('text', '')
            if not target or not text:
                self.send_error(400, 'Missing target or text')
                return
            # Validate target format (session:window.pane)
            if not re.match(r'^[\w-]+:\d+\.\d+$', target):
                self.send_error(400, 'Invalid target format')
                return
            import subprocess
            try:
                # Write text to a temp file to avoid shell escaping issues
                import tempfile
                with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as tf:
                    tf.write(text)
                    tf_path = tf.name
                # Use tmux load-buffer + paste-buffer for safe text transfer
                subprocess.run(['tmux', '-S', TMUX_SOCKET, 'load-buffer', tf_path], check=True, timeout=3)
                subprocess.run(['tmux', '-S', TMUX_SOCKET, 'paste-buffer', '-t', target], check=True, timeout=3)
                os.unlink(tf_path)
                self._json_response(200, json.dumps({'ok': True}).encode())
            except Exception as e:
                try:
                    os.unlink(tf_path)
                except Exception:
                    pass
                self._json_response(500, json.dumps({'error': str(e)}).encode())

        elif self.path == '/api/claude-new':
            if not self._require_auth():
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body) if length > 0 else {}
            except json.JSONDecodeError:
                data = {}
            text = data.get('text', '')
            import subprocess, tempfile
            try:
                # Write content to temp file
                with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as tf:
                    tf.write(text)
                    tf_path = tf.name
                # Create new tmux window and run claude with piped input
                cmd = "cat '{}' | claude --dangerously-skip-permissions -p; rm -f '{}'".format(tf_path, tf_path)
                # -P prints the new window target (e.g. "main:3")
                result = subprocess.run(
                    ['tmux', '-S', TMUX_SOCKET, 'new-window', '-P', '-F', '#{window_index}', '-n', 'claude', cmd],
                    check=True, timeout=3, capture_output=True, text=True
                )
                win_index = result.stdout.strip()
                # Switch the attached client to the new window
                subprocess.run(
                    ['tmux', '-S', TMUX_SOCKET, 'select-window', '-t', ':{}'.format(win_index)],
                    check=True, timeout=3
                )
                self._json_response(200, json.dumps({'ok': True, 'window': win_index}).encode())
            except Exception as e:
                try:
                    os.unlink(tf_path)
                except Exception:
                    pass
                self._json_response(500, json.dumps({'error': str(e)}).encode())

        elif self.path == '/upload':
            if not self._require_auth():
                return
            length = int(self.headers.get('Content-Length', 0))
            content_type = self.headers.get('Content-Type', 'application/octet-stream')
            body = self.rfile.read(length)
            ext = mimetypes.guess_extension(content_type) or '.bin'
            if ext == '.jpe': ext = '.jpg'
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            filename = uuid.uuid4().hex[:8] + ext
            filepath = os.path.join(UPLOAD_DIR, filename)
            with open(filepath, 'wb') as f:
                f.write(body)
            self._json_response(200, json.dumps({'path': filepath}).encode())

        else:
            self.send_error(404)

    def do_DELETE(self):
        if self.path.startswith('/api/notes/'):
            if not self._require_auth():
                return
            note_id = self.path.split('/api/notes/')[1].split('?')[0]
            if not _safe_note_id(note_id):
                self.send_error(400, 'Invalid note ID')
                return
            if _delete_note(note_id):
                self._json_response(200, json.dumps({'ok': True}).encode())
            else:
                self.send_error(404, 'Note not found')
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        if '/api/notifications' in (args[0] if args else ''):
            import sys
            sys.stderr.write('[NOTIFY] %s\n' % (format % args))
            sys.stderr.flush()

HTTPServer(('0.0.0.0', 7682), Handler).serve_forever()
