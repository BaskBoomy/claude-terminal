"""All API route handlers, organized by section."""

import json
import os
import re
import subprocess
import tempfile
import time
import uuid

from . import auth, brain, config


# ─── Helpers ──────────────────────────────────────────────

def _safe_note_id(note_id):
    return bool(re.fullmatch(r'[a-f0-9]{8}', note_id))


def _note_path(note_id):
    return os.path.join(config.NOTES_DIR, f'{note_id}.json')


def _list_notes():
    os.makedirs(config.NOTES_DIR, exist_ok=True)
    notes = []
    for fname in os.listdir(config.NOTES_DIR):
        if not fname.endswith('.json'):
            continue
        note_id = fname[:-5]
        try:
            with open(os.path.join(config.NOTES_DIR, fname)) as f:
                data = json.load(f)
            notes.append({
                'id': note_id,
                'title': data.get('title', ''),
                'preview': (data.get('content', '') or '')[:80],
                'updatedAt': data.get('updatedAt', 0),
                'createdAt': data.get('createdAt', 0),
            })
        except (json.JSONDecodeError, OSError):
            continue
    notes.sort(key=lambda n: n['updatedAt'], reverse=True)
    return notes


def _read_note(note_id):
    try:
        with open(_note_path(note_id)) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _write_note(note_id, data):
    os.makedirs(config.NOTES_DIR, exist_ok=True)
    with open(_note_path(note_id), 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _delete_note(note_id):
    try:
        os.remove(_note_path(note_id))
        return True
    except FileNotFoundError:
        return False


def _run(cmd, timeout=3, cwd=None):
    """Run a subprocess and return stdout."""
    return subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd
    )


def _tmux(*args, timeout=3):
    """Run a tmux command with the configured socket."""
    return _run(['tmux', '-S', config.TMUX_SOCKET] + list(args), timeout=timeout)


# ═══════════════════════════════════════════════════════════
# Authentication
# ═══════════════════════════════════════════════════════════

def auth_check(handler):
    auth.cleanup_sessions()
    token = handler.get_session_token()
    authenticated = auth.validate_session(token) if token else False
    handler.json_response(200, {'authenticated': authenticated})


def auth_login(handler):
    body = handler.read_json_body()
    if not body:
        return
    password = body.get('password', '')

    ip = handler.get_client_ip()
    if not auth.check_rate_limit(ip):
        handler.json_response(429, {'error': 'Too many attempts. Try again later.'})
        return

    if not auth.verify_password(password):
        auth.record_failed_attempt(ip)
        handler.json_response(401, {'error': 'Wrong password'})
        return

    auth.reset_attempts(ip)
    token = auth.create_session(ip)
    handler.json_response(
        200, {'ok': True},
        extra_headers=handler.make_set_cookie(token),
    )


def auth_logout(handler):
    token = handler.get_session_token()
    if token:
        auth.destroy_session(token)
    handler.json_response(
        200, {'ok': True},
        extra_headers=handler.make_clear_cookie(),
    )


# ═══════════════════════════════════════════════════════════
# Settings
# ═══════════════════════════════════════════════════════════

def get_settings(handler):
    try:
        with open(config.SETTINGS_FILE) as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = config.DEFAULT_SETTINGS
    handler.json_response(200, data)


def put_settings(handler):
    body = handler.read_json_body()
    if not body:
        return
    os.makedirs(os.path.dirname(config.SETTINGS_FILE), exist_ok=True)
    # Atomic write
    tmp_fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(config.SETTINGS_FILE))
    try:
        with os.fdopen(tmp_fd, 'w') as f:
            json.dump(body, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, config.SETTINGS_FILE)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    handler.json_response(200, {'ok': True})


# ═══════════════════════════════════════════════════════════
# Terminal / tmux
# ═══════════════════════════════════════════════════════════

def tmux_session(handler):
    try:
        result = _tmux('display-message', '-p', '#S:#I.#W', timeout=2)
        info = result.stdout.strip() or 'unknown'
    except Exception:
        info = 'unknown'
    handler.json_response(200, {'session': info})


def tmux_capture(handler):
    params = handler.query_params()
    try:
        cmd = ['capture-pane', '-p']
        if params.get('history') == '1':
            cmd += ['-S', '-500']
        result = _tmux(*cmd)
        handler.json_response(200, {'text': result.stdout})
    except Exception as e:
        handler.json_response(500, {'error': str(e)})


def claude_sessions(handler):
    """List active tmux panes that look like Claude sessions."""
    try:
        fmt = '#{session_name}:#{window_index}.#{pane_index}|||#{pane_title}|||#{pane_current_command}'
        result = _tmux('list-panes', '-a', '-F', fmt)
        sessions = []
        for line in result.stdout.strip().split('\n'):
            if not line.strip():
                continue
            parts = line.split('|||')
            if len(parts) < 3:
                continue
            target, title, cmd = parts[0], parts[1], parts[2]
            sessions.append({
                'target': target,
                'title': title or cmd,
                'rawTitle': title,
            })
        handler.json_response(200, {'sessions': sessions})
    except Exception:
        handler.json_response(200, {'sessions': []})


def claude_send(handler):
    """Send text to a specific tmux pane via buffer."""
    body = handler.read_json_body()
    if not body:
        return
    target = body.get('target', '')
    text = body.get('text', '')

    if not re.fullmatch(r'[\w-]+:\d+\.\d+', target):
        handler.json_response(400, {'error': 'Invalid target'})
        return

    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as tf:
            tf.write(text)
            tf_path = tf.name
        try:
            _tmux('load-buffer', tf_path)
            _tmux('paste-buffer', '-t', target)
        finally:
            os.unlink(tf_path)
        handler.json_response(200, {'ok': True})
    except Exception as e:
        handler.json_response(500, {'error': str(e)})


def claude_new(handler):
    """Create a new tmux window with Claude piped input."""
    body = handler.read_json_body()
    if not body:
        return
    text = body.get('text', '')

    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as tf:
            tf.write(text)
            tf_path = tf.name

        cmd = f"cat '{tf_path}' | {config.CLAUDE_CMD} -p; rm -f '{tf_path}'"
        result = _tmux(
            'new-window', '-P', '-F', '#{window_index}',
            '-n', 'claude', f'bash -c "{cmd}"',
            timeout=5,
        )
        window_idx = result.stdout.strip()
        if window_idx:
            _tmux('select-window', '-t', f':{window_idx}')
        handler.json_response(200, {'ok': True, 'window': window_idx})
    except Exception as e:
        handler.json_response(500, {'error': str(e)})


# ═══════════════════════════════════════════════════════════
# Notes
# ═══════════════════════════════════════════════════════════

def list_notes(handler):
    handler.json_response(200, {'notes': _list_notes()})


def get_note(handler, note_id):
    if not _safe_note_id(note_id):
        handler.json_response(400, {'error': 'Invalid note ID'})
        return
    note = _read_note(note_id)
    if not note:
        handler.json_response(404, {'error': 'Note not found'})
        return
    handler.json_response(200, note)


def create_note(handler):
    body = handler.read_json_body()
    note_id = uuid.uuid4().hex[:8]
    now = int(time.time() * 1000)
    data = {
        'title': (body or {}).get('title', ''),
        'content': (body or {}).get('content', ''),
        'createdAt': now,
        'updatedAt': now,
    }
    _write_note(note_id, data)
    handler.json_response(200, {'id': note_id})


def update_note(handler, note_id):
    if not _safe_note_id(note_id):
        handler.json_response(400, {'error': 'Invalid note ID'})
        return
    existing = _read_note(note_id)
    if not existing:
        handler.json_response(404, {'error': 'Note not found'})
        return
    body = handler.read_json_body()
    if not body:
        return
    existing['title'] = body.get('title', existing.get('title', ''))
    existing['content'] = body.get('content', existing.get('content', ''))
    existing['updatedAt'] = int(time.time() * 1000)
    _write_note(note_id, existing)
    handler.json_response(200, {'ok': True})


def delete_note(handler, note_id):
    if not _safe_note_id(note_id):
        handler.json_response(400, {'error': 'Invalid note ID'})
        return
    if _delete_note(note_id):
        handler.json_response(200, {'ok': True})
    else:
        handler.json_response(404, {'error': 'Note not found'})


# ═══════════════════════════════════════════════════════════
# Brain (Claude Code memory/skills/agents)
# ═══════════════════════════════════════════════════════════

def brain_tree(handler):
    handler.json_response(200, {'scopes': brain.scan()})


def brain_read(handler):
    params = handler.query_params()
    dirpath = params.get('dir', '')
    filename = params.get('file', '')

    full_path, writable = brain.resolve_path(dirpath, filename)
    if not full_path:
        handler.json_response(404, {'error': 'File not found'})
        return

    try:
        with open(full_path, encoding='utf-8') as f:
            content = f.read()
        handler.json_response(200, {
            'content': content,
            'path': full_path,
            'size': os.path.getsize(full_path),
            'writable': writable,
        })
    except Exception as e:
        handler.json_response(500, {'error': str(e)})


def brain_write(handler):
    body = handler.read_json_body()
    if not body:
        return

    dirpath = body.get('dir', '')
    filename = body.get('file', '')
    content = body.get('content', '')

    full_path, writable = brain.resolve_path(dirpath, filename)
    if not full_path:
        handler.json_response(404, {'error': 'File not found'})
        return
    if not writable:
        handler.json_response(403, {'error': 'File is read-only'})
        return

    try:
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)
        handler.json_response(200, {'ok': True})
    except Exception as e:
        handler.json_response(500, {'error': str(e)})


# ═══════════════════════════════════════════════════════════
# System (server status, git, usage, notifications)
# ═══════════════════════════════════════════════════════════

def server_status(handler):
    """Get server metrics from procfs."""
    try:
        # CPU load
        with open('/proc/loadavg') as f:
            load_avg = float(f.read().split()[0])
        cpu_count = os.cpu_count() or 1
        cpu_pct = round(load_avg / cpu_count * 100, 1)

        # Memory
        mem_info = {}
        with open('/proc/meminfo') as f:
            for line in f:
                parts = line.split()
                if parts[0] in ('MemTotal:', 'MemAvailable:'):
                    mem_info[parts[0][:-1]] = int(parts[1])
        total_kb = mem_info.get('MemTotal', 1)
        avail_kb = mem_info.get('MemAvailable', 0)
        used_kb = total_kb - avail_kb
        mem_pct = round(used_kb / total_kb * 100, 1)

        # Disk
        st = os.statvfs('/')
        disk_total = st.f_blocks * st.f_frsize
        disk_free = st.f_bavail * st.f_frsize
        disk_pct = round((1 - disk_free / disk_total) * 100, 1) if disk_total else 0

        # Temperature
        temp = None
        try:
            with open('/sys/class/thermal/thermal_zone0/temp') as f:
                temp = round(int(f.read().strip()) / 1000, 1)
        except (FileNotFoundError, ValueError):
            pass

        handler.json_response(200, {
            'cpu': cpu_pct,
            'mem': mem_pct,
            'memUsedGB': round(used_kb / 1048576, 1),
            'memTotalGB': round(total_kb / 1048576, 1),
            'disk': disk_pct,
            'temp': temp,
            'loadAvg': load_avg,
        })
    except Exception as e:
        handler.json_response(500, {'error': str(e)})


def git_status(handler):
    """Get git repository status."""
    params = handler.query_params()
    git_dir = params.get('dir', '') or config.GIT_DIR
    if not git_dir:
        handler.json_response(200, {'error': 'No GIT_DIR configured'})
        return

    git_dir = os.path.expanduser(git_dir)
    if not os.path.isdir(git_dir):
        handler.json_response(200, {'error': f'Directory not found: {git_dir}'})
        return

    # Security: validate path is not traversing outside home
    real_dir = os.path.realpath(git_dir)
    home = os.path.expanduser('~')
    if not real_dir.startswith(home):
        handler.json_response(400, {'error': 'Path not allowed'})
        return

    try:
        branch_result = _run(['git', 'branch', '--show-current'], cwd=git_dir)
        branch = branch_result.stdout.strip()

        status_result = _run(['git', 'status', '--porcelain'], cwd=git_dir, timeout=5)
        lines = [l for l in status_result.stdout.split('\n') if l.strip()]

        staged = modified = untracked = 0
        files = []
        for line in lines:
            code = line[:2]
            fname = line[3:]
            if code[0] in 'AMDR':
                staged += 1
            if code[1] in 'MD':
                modified += 1
            if code == '??':
                untracked += 1
            files.append({'status': code.strip(), 'file': fname})

        # Recent commits
        log_result = _run(
            ['git', 'log', '--oneline', '--no-merges', '-10',
             '--format=%h|||%s|||%ar'],
            cwd=git_dir, timeout=5,
        )
        commits = []
        for line in log_result.stdout.strip().split('\n'):
            if '|||' not in line:
                continue
            parts = line.split('|||')
            if len(parts) >= 3:
                commits.append({
                    'hash': parts[0],
                    'message': parts[1],
                    'time': parts[2],
                })

        # Ahead/behind
        ahead = behind = 0
        try:
            ab_result = _run(
                ['git', 'rev-list', '--left-right', '--count', '@{u}...HEAD'],
                cwd=git_dir, timeout=5,
            )
            parts = ab_result.stdout.strip().split()
            if len(parts) == 2:
                behind, ahead = int(parts[0]), int(parts[1])
        except Exception:
            pass

        handler.json_response(200, {
            'branch': branch,
            'changes': {'staged': staged, 'modified': modified, 'untracked': untracked},
            'files': files[:50],
            'commits': commits,
            'ahead': ahead,
            'behind': behind,
        })
    except Exception as e:
        handler.json_response(500, {'error': str(e)})


# Claude usage cache
_usage_cache = None
_usage_cache_ts = 0
_usage_ok = True


def claude_usage(handler):
    """Fetch Claude API usage with server-side caching."""
    global _usage_cache, _usage_cache_ts, _usage_ok

    now = time.time()
    cache_ttl = 60 if _usage_ok else 300
    if _usage_cache and now - _usage_cache_ts < cache_ttl:
        handler.json_response(200, _usage_cache)
        return

    try:
        creds_path = os.path.expanduser('~/.claude/.credentials.json')
        with open(creds_path) as f:
            creds = json.load(f)
        token = creds['claudeAiOauth']['accessToken']

        import urllib.request
        req = urllib.request.Request(
            'https://api.claude.ai/api/organizations/usage',
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json',
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())

        _usage_cache = data
        _usage_cache_ts = now
        _usage_ok = True
        handler.json_response(200, data)
    except Exception as e:
        _usage_ok = False
        _usage_cache_ts = now
        handler.json_response(500, {'error': str(e)})


def notifications(handler):
    """Poll notification files from NOTIFY_DIR."""
    params = handler.query_params()
    since = int(params.get('since', '0'))
    result = []

    notify_dir = config.NOTIFY_DIR
    if os.path.isdir(notify_dir):
        for fname in sorted(os.listdir(notify_dir)):
            if not fname.endswith('.json'):
                continue
            try:
                ts = int(fname[:-5])
                if ts <= since:
                    continue
                with open(os.path.join(notify_dir, fname)) as f:
                    data = json.load(f)
                data['timestamp'] = ts
                result.append(data)
            except (ValueError, json.JSONDecodeError, OSError):
                continue

    handler.json_response(200, {'notifications': result})


# ═══════════════════════════════════════════════════════════
# File upload
# ═══════════════════════════════════════════════════════════

def upload_file(handler):
    """Handle binary file upload."""
    import mimetypes

    length = int(handler.headers.get('Content-Length', 0))
    if length <= 0:
        handler.json_response(400, {'error': 'No content'})
        return
    if length > 100 * 1024 * 1024:  # 100MB limit
        handler.json_response(413, {'error': 'File too large'})
        return

    body = handler.rfile.read(length)
    content_type = handler.headers.get('Content-Type', 'application/octet-stream')
    ext = mimetypes.guess_extension(content_type) or '.bin'
    if ext == '.jpe':
        ext = '.jpg'

    os.makedirs(config.UPLOAD_DIR, exist_ok=True)
    filename = uuid.uuid4().hex[:8] + ext
    filepath = os.path.join(config.UPLOAD_DIR, filename)
    with open(filepath, 'wb') as f:
        f.write(body)

    handler.json_response(200, {'path': filepath})
