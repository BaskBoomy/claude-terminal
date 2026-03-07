"""Authentication: password verification, session management, rate limiting."""

import hashlib
import secrets
import time

from . import config

# ─── In-memory session store ──────────────────────────────

sessions = {}  # {token: {created, last_active, ip}}


def verify_password(password):
    """Verify password against stored hash using PBKDF2-SHA256."""
    test_hash = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode(),
        bytes.fromhex(config.PASSWORD_SALT),
        config.PBKDF2_ITERATIONS,
    ).hex()
    return secrets.compare_digest(test_hash, config.PASSWORD_HASH)


def create_session(ip):
    """Create a new session token and return it."""
    token = secrets.token_hex(32)
    sessions[token] = {
        'created': time.time(),
        'last_active': time.time(),
        'ip': ip,
    }
    return token


def validate_session(token):
    """Check if a session token is valid and update last_active."""
    if not token or token not in sessions:
        return False
    session = sessions[token]
    if time.time() - session['created'] > config.SESSION_MAX_AGE:
        sessions.pop(token, None)
        return False
    session['last_active'] = time.time()
    return True


def destroy_session(token):
    """Remove a session."""
    sessions.pop(token, None)


def cleanup_sessions():
    """Remove all expired sessions."""
    now = time.time()
    expired = [
        t for t, s in sessions.items()
        if now - s['created'] > config.SESSION_MAX_AGE
    ]
    for t in expired:
        del sessions[t]


# ─── Rate limiting ────────────────────────────────────────

_attempts = {}  # {ip: {count, first_attempt}}


def check_rate_limit(ip):
    """Return True if the IP is within rate limits."""
    info = _attempts.get(ip)
    if not info:
        return True
    if time.time() - info['first_attempt'] > config.RATE_LIMIT_WINDOW:
        _attempts.pop(ip, None)
        return True
    return info['count'] < config.RATE_LIMIT_MAX


def record_failed_attempt(ip):
    """Record a failed login attempt."""
    info = _attempts.get(ip)
    now = time.time()
    if not info or now - info['first_attempt'] > config.RATE_LIMIT_WINDOW:
        _attempts[ip] = {'count': 1, 'first_attempt': now}
    else:
        info['count'] += 1


def reset_attempts(ip):
    """Clear rate limit for an IP after successful login."""
    _attempts.pop(ip, None)
