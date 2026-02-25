#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
import os, uuid, json, mimetypes, secrets, hashlib, time

UPLOAD_DIR = '/tmp/claude-uploads'
SETTINGS_FILE = '/home/jack/claude-terminal/settings.json'

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
                    ['tmux', 'display-message', '-p', '#S:#I.#W'],
                    capture_output=True, text=True, timeout=2
                )
                info = result.stdout.strip() or 'unknown'
            except Exception:
                info = 'disconnected'
            self._json_response(200, json.dumps({'session': info}).encode())

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
                self._json_response(200, data)
            except Exception as e:
                self._json_response(200, json.dumps({'error': str(e)}).encode())

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

    def log_message(self, format, *args):
        pass

HTTPServer(('0.0.0.0', 7682), Handler).serve_forever()
