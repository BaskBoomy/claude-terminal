#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
import os, uuid, json, mimetypes

UPLOAD_DIR = '/tmp/claude-uploads'
SETTINGS_FILE = '/home/jack/claude-terminal/settings.json'

DEFAULT_SETTINGS = {
    "general": {"wakeLock": False, "fontSize": 16},
    "snippets": []
}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/settings':
            try:
                with open(SETTINGS_FILE, 'r') as f:
                    data = f.read()
            except FileNotFoundError:
                data = json.dumps(DEFAULT_SETTINGS)
            self._json_response(200, data.encode())
        else:
            self.send_error(404)

    def do_PUT(self):
        if self.path == '/api/settings':
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
        if self.path == '/upload':
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

    def _json_response(self, code, body):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass

HTTPServer(('0.0.0.0', 7682), Handler).serve_forever()
