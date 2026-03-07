#!/usr/bin/env python3
"""Claude Terminal — HTTP server with API routing and static file serving."""

import json
import mimetypes
import os
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from . import config, auth, routes

# MIME types for static files
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/css', '.css')


class Handler(BaseHTTPRequestHandler):
    """HTTP request handler with JSON helpers and cookie-based auth."""

    # ─── Helper methods ───────────────────────────────────

    def get_client_ip(self):
        forwarded = self.headers.get('X-Forwarded-For')
        if forwarded:
            return forwarded.split(',')[0].strip()
        return self.client_address[0]

    def get_session_token(self):
        cookie = self.headers.get('Cookie', '')
        for part in cookie.split(';'):
            part = part.strip()
            if part.startswith(f'{config.COOKIE_NAME}='):
                return part[len(config.COOKIE_NAME) + 1:]
        return None

    def require_auth(self):
        """Check authentication. Returns True if authorized, sends 401 if not."""
        token = self.get_session_token()
        if token and auth.validate_session(token):
            return True
        self.json_response(401, {'error': 'Unauthorized'})
        return False

    def json_response(self, code, data, extra_headers=None):
        """Send a JSON response."""
        if isinstance(data, (dict, list)):
            body = json.dumps(data).encode()
        elif isinstance(data, str):
            body = data.encode()
        else:
            body = data

        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        """Read and parse JSON request body. Returns dict or None on error."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0:
                return {}
            body = self.rfile.read(length)
            return json.loads(body)
        except (ValueError, json.JSONDecodeError):
            self.json_response(400, {'error': 'Invalid JSON'})
            return None

    def query_params(self):
        """Parse query string parameters."""
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        return {k: v[0] for k, v in params.items()}

    def make_set_cookie(self, token):
        cookie = (
            f'{config.COOKIE_NAME}={token}; '
            f'Max-Age={config.SESSION_MAX_AGE}; '
            f'Path=/; HttpOnly; Secure; SameSite=Strict'
        )
        return {'Set-Cookie': cookie}

    def make_clear_cookie(self):
        cookie = (
            f'{config.COOKIE_NAME}=; '
            f'Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict'
        )
        return {'Set-Cookie': cookie}

    # ─── Routing ──────────────────────────────────────────

    # Route table: (method, pattern) → handler
    # Pattern can be exact string or regex with named groups
    _ROUTES = None

    @classmethod
    def _build_routes(cls):
        """Build route table on first request."""
        cls._ROUTES = {
            # Auth (no auth required)
            ('GET', '/api/auth/check'): (routes.auth_check, False),
            ('POST', '/api/auth/login'): (routes.auth_login, False),
            ('POST', '/api/auth/logout'): (routes.auth_logout, False),

            # Settings
            ('GET', '/api/settings'): (routes.get_settings, True),
            ('PUT', '/api/settings'): (routes.put_settings, True),

            # Terminal / tmux
            ('GET', '/api/tmux-session'): (routes.tmux_session, True),
            ('GET', '/api/tmux-capture'): (routes.tmux_capture, True),
            ('GET', '/api/claude-sessions'): (routes.claude_sessions, True),
            ('POST', '/api/claude-send'): (routes.claude_send, True),
            ('POST', '/api/claude-new'): (routes.claude_new, True),

            # Notes
            ('GET', '/api/notes'): (routes.list_notes, True),
            ('POST', '/api/notes'): (routes.create_note, True),

            # Brain
            ('GET', '/api/brain'): (routes.brain_tree, True),
            ('GET', '/api/brain/read'): (routes.brain_read, True),
            ('PUT', '/api/brain/write'): (routes.brain_write, True),

            # System
            ('GET', '/api/server-status'): (routes.server_status, True),
            ('GET', '/api/git-status'): (routes.git_status, True),
            ('GET', '/api/claude-usage'): (routes.claude_usage, True),
            ('GET', '/api/notifications'): (routes.notifications, True),

            # Upload
            ('POST', '/upload'): (routes.upload_file, True),
        }

    def _match_route(self, method):
        """Match request to route handler. Returns (handler_func, note_id) or None."""
        if self._ROUTES is None:
            self._build_routes()

        path = self.path.split('?')[0]

        # Exact match first
        key = (method, path)
        if key in self._ROUTES:
            return self._ROUTES[key], {}

        # Parameterized notes routes: /api/notes/<id>
        if method in ('GET', 'PUT', 'DELETE') and path.startswith('/api/notes/'):
            note_id = path.split('/api/notes/')[1].split('?')[0].split('/')[0]
            if note_id:
                return {
                    'GET': (routes.get_note, True),
                    'PUT': (routes.update_note, True),
                    'DELETE': (routes.delete_note, True),
                }.get(method), {'note_id': note_id}

        return None, {}

    def _handle_request(self, method):
        """Main request dispatcher."""
        match, params = self._match_route(method)

        if match:
            handler_func, needs_auth = match
            if needs_auth and not self.require_auth():
                return
            if params:
                handler_func(self, **params)
            else:
                handler_func(self)
            return

        # Static file serving (GET only)
        if method == 'GET':
            self._serve_static()
            return

        self.send_error(404)

    def _serve_static(self):
        """Serve static files from public/ directory."""
        parsed = urlparse(self.path)
        path = parsed.path

        # Default to index.html
        if path == '/' or path == '':
            path = '/index.html'

        # Security: prevent directory traversal
        safe_path = os.path.normpath(path.lstrip('/'))
        if safe_path.startswith('..'):
            self.send_error(403)
            return

        file_path = os.path.join(config.PUBLIC_DIR, safe_path)
        if not os.path.isfile(file_path):
            # SPA fallback: serve index.html for non-API, non-file paths
            file_path = os.path.join(config.PUBLIC_DIR, 'index.html')
            if not os.path.isfile(file_path):
                self.send_error(404)
                return

        content_type, _ = mimetypes.guess_type(file_path)
        content_type = content_type or 'application/octet-stream'

        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', len(content))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.end_headers()
            self.wfile.write(content)
        except OSError:
            self.send_error(500)

    # ─── HTTP method handlers ─────────────────────────────

    def do_GET(self):
        self._handle_request('GET')

    def do_POST(self):
        self._handle_request('POST')

    def do_PUT(self):
        self._handle_request('PUT')

    def do_DELETE(self):
        self._handle_request('DELETE')

    def log_message(self, fmt, *args):
        """Custom log: suppress noisy notification polling."""
        first = str(args[0]) if args else ''
        if '/api/notifications' in first:
            return
        import sys
        sys.stderr.write(f'{self.client_address[0]} - {fmt % args}\n')
        sys.stderr.flush()


def run():
    """Start the HTTP server."""
    os.makedirs(config.DATA_DIR, exist_ok=True)
    os.makedirs(config.NOTES_DIR, exist_ok=True)
    os.makedirs(config.UPLOAD_DIR, exist_ok=True)

    server = HTTPServer((config.HOST, config.PORT), Handler)
    print(f'Claude Terminal server running on http://{config.HOST}:{config.PORT}')
    if config.DOMAIN:
        print(f'  Domain: https://{config.DOMAIN}')
    print(f'  Public dir: {config.PUBLIC_DIR}')
    print(f'  Data dir: {config.DATA_DIR}')
    print(f'  tmux socket: {config.TMUX_SOCKET}')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down...')
        server.server_close()


if __name__ == '__main__':
    run()
