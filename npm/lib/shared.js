/**
 * shared.js — Cross-cutting utilities for the installer
 * Eliminates duplication and centralizes correctness.
 */

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Shell & XML Escaping ─────────────────────────────────────────────────────

/** Wrap a path in single quotes with proper escaping for shell commands. */
function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/** Escape special characters for XML/plist values. */
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Architecture Detection ───────────────────────────────────────────────────

/**
 * Canonical architecture detection.
 * Returns arch names for each tool's expected format.
 * Throws on truly unsupported architectures.
 */
function resolveArch() {
  const arch = process.arch;
  const platform = process.platform;

  if (arch === 'arm64') {
    return { go: 'arm64', server: 'arm64', ttyd: 'aarch64', cloudflared: 'arm64', generic: 'arm64' };
  }
  if (arch === 'x64') {
    return { go: 'amd64', server: 'amd64', ttyd: 'x86_64', cloudflared: 'amd64', generic: 'amd64' };
  }
  if (arch === 'arm') {
    // 32-bit ARM (Raspberry Pi 2/3 with 32-bit OS)
    return { go: 'armv6l', server: null, ttyd: 'armhf', cloudflared: 'arm', generic: 'arm' };
  }

  throw new Error(
    `Unsupported architecture: ${arch}\n` +
    `  Supported: x64, arm64, arm (32-bit)\n` +
    `  You may need to build from source.`
  );
}

// ── Path Utilities ───────────────────────────────────────────────────────────

/** Expand ~ to HOME directory. */
function expandTilde(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// ── Port Validation ──────────────────────────────────────────────────────────

/** Validate and parse port number. Returns default if invalid. */
function validatePort(input, defaultVal) {
  const n = parseInt(input, 10);
  if (isNaN(n) || n < 1 || n > 65535 || String(n) !== String(input).trim()) {
    return parseInt(defaultVal, 10);
  }
  return n;
}

/** Check if a port is available for binding. */
function isPortAvailable(port) {
  const net = require('net');
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}

// ── Safe Download ────────────────────────────────────────────────────────────

/**
 * Download a file with proper error handling.
 * - Timeout (default 120s)
 * - Redirect limit (default 10)
 * - File write error handling (disk full, permissions)
 * - Partial file cleanup on failure
 */
function safeDownload(url, dest, opts = {}) {
  const timeout = opts.timeout || 120000;
  const maxRedirects = opts.maxRedirects || 10;

  return new Promise((resolve, reject) => {
    let redirects = 0;
    let timer;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const follow = (currentUrl) => {
      if (redirects++ > maxRedirects) {
        return fail(new Error(`Too many redirects (>${maxRedirects})`));
      }
      const proto = currentUrl.startsWith('https') ? https : require('http');
      const req = proto.get(currentUrl, { headers: { 'User-Agent': 'create-claude-terminal' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          follow(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error(`HTTP ${res.statusCode}: ${currentUrl}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        file.on('error', (err) => {
          res.destroy();
          fail(new Error(`File write error: ${err.message}`));
        });
        res.on('error', (err) => {
          file.destroy();
          fail(new Error(`Download stream error: ${err.message}`));
        });
        res.pipe(file);
        file.on('finish', () => file.close(succeed));
      });
      req.on('error', (err) => fail(err));
      req.on('timeout', () => { req.destroy(); fail(new Error('Connection timed out')); });
    };

    timer = setTimeout(() => {
      fail(new Error(`Download timed out after ${Math.round(timeout / 1000)}s`));
    }, timeout);

    follow(url);
  });
}

// ── Musl Detection ───────────────────────────────────────────────────────────

/** Detect Alpine Linux / musl libc (pre-built glibc binaries won't work). */
function isMusl() {
  try {
    const ldd = require('child_process').execSync('ldd --version 2>&1 || true', { encoding: 'utf8' });
    return ldd.toLowerCase().includes('musl');
  } catch {
    try {
      return fs.readFileSync('/etc/os-release', 'utf8').includes('Alpine');
    } catch { return false; }
  }
}

// ── Interactive Detection ────────────────────────────────────────────────────

/** Check if running in an interactive terminal (not CI/Docker/pipe). */
function isInteractive() {
  return process.stdin.isTTY === true;
}

module.exports = {
  shellQuote,
  xmlEscape,
  resolveArch,
  expandTilde,
  validatePort,
  isPortAvailable,
  safeDownload,
  isMusl,
  isInteractive,
};
