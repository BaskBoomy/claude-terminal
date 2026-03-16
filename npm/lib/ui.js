/**
 * ui.js — Zero-dependency CLI styling utilities
 * ANSI colors, spinners, box drawing, styled prompts
 */

const readline = require('readline');

// ─── ANSI Colors ─────────────────────────────────────────────────────────────

const ESC = '\x1b[';
const useColor = !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const c = {
  reset:   `${ESC}0m`,
  bold:    `${ESC}1m`,
  dim:     `${ESC}2m`,
  italic:  `${ESC}3m`,
  under:   `${ESC}4m`,
  // Foreground
  black:   `${ESC}30m`,
  red:     `${ESC}31m`,
  green:   `${ESC}32m`,
  yellow:  `${ESC}33m`,
  blue:    `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan:    `${ESC}36m`,
  white:   `${ESC}37m`,
  gray:    `${ESC}90m`,
  // Brand color (approximate #C96442 as 256-color)
  brand:   `${ESC}38;5;166m`,
  brandBg: `${ESC}48;5;166m`,
};

function color(style, text) {
  if (!useColor) return String(text);
  return `${style}${text}${c.reset}`;
}

// ─── Symbols ─────────────────────────────────────────────────────────────────

const isWindows = process.platform === 'win32';
const S = {
  check:   isWindows ? '√' : '✔',
  cross:   isWindows ? '×' : '✖',
  warn:    isWindows ? '!' : '▲',
  info:    isWindows ? 'i' : '●',
  bullet:  isWindows ? '*' : '◆',
  pointer: isWindows ? '>' : '▸',
  bar:     '│',
  barEnd:  '└',
  barT:    '├',
  corner:  '┌',
};

// ─── Spinner ─────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['◒', '◐', '◓', '◑'];

function createSpinner(text) {
  let i = 0;
  let timer = null;
  const stream = process.stderr;
  const isTTY = stream.isTTY;

  return {
    start() {
      if (!isTTY) return this;
      timer = setInterval(() => {
        const frame = color(c.brand, SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]);
        stream.write(`\r  ${frame} ${color(c.dim, text)}`);
      }, 80);
      return this;
    },
    succeed(msg) {
      clearInterval(timer);
      timer = null;
      if (isTTY) {
        stream.write(`\r  ${color(c.green, S.check)} ${msg || text}\n`);
      } else {
        stream.write(`  ${S.check} ${msg || text}\n`);
      }
      return this;
    },
    fail(msg) {
      clearInterval(timer);
      timer = null;
      if (isTTY) {
        stream.write(`\r  ${color(c.red, S.cross)} ${msg || text}\n`);
      } else {
        stream.write(`  ${S.cross} ${msg || text}\n`);
      }
      return this;
    },
    warn(msg) {
      clearInterval(timer);
      timer = null;
      if (isTTY) {
        stream.write(`\r  ${color(c.yellow, S.warn)} ${msg || text}\n`);
      } else {
        stream.write(`  ${S.warn} ${msg || text}\n`);
      }
      return this;
    },
    update(newText) {
      text = newText;
      return this;
    },
  };
}

// ─── Box Drawing ─────────────────────────────────────────────────────────────

function box(lines, opts = {}) {
  const brandColor = opts.color || c.brand;
  const padding = opts.padding || 2;
  const maxLen = Math.max(...lines.map(l => stripAnsi(l).length));
  const w = maxLen + padding * 2;
  const pad = ' '.repeat(padding);
  const hr = '─'.repeat(w);

  const out = [];
  out.push(`  ${color(brandColor, '╭' + hr + '╮')}`);
  out.push(`  ${color(brandColor, '│')}${' '.repeat(w)}${color(brandColor, '│')}`);
  for (const line of lines) {
    const visible = stripAnsi(line).length;
    const right = w - visible - padding;
    out.push(`  ${color(brandColor, '│')}${pad}${line}${' '.repeat(Math.max(0, right))}${color(brandColor, '│')}`);
  }
  out.push(`  ${color(brandColor, '│')}${' '.repeat(w)}${color(brandColor, '│')}`);
  out.push(`  ${color(brandColor, '╰' + hr + '╯')}`);
  return out.join('\n');
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07/g, '');
}

// ─── Section Headers ─────────────────────────────────────────────────────────

function sectionStart(title) {
  console.log(`\n  ${color(c.brand, S.corner)} ${color(c.bold, title)}`);
  console.log(`  ${color(c.gray, S.bar)}`);
}

function sectionItem(icon, text) {
  console.log(`  ${color(c.gray, S.barT)} ${icon} ${text}`);
}

function sectionEnd(icon, text) {
  console.log(`  ${color(c.gray, S.barEnd)} ${icon} ${text}`);
}

function sectionBlank() {
  console.log(`  ${color(c.gray, S.bar)}`);
}

// ─── Styled Prompts ──────────────────────────────────────────────────────────

function ask(rl, label, defaultVal) {
  const hint = defaultVal ? color(c.gray, ` [${defaultVal}]`) : color(c.gray, ' (optional)');
  return new Promise(resolve => {
    const prompt = `  ${color(c.brand, S.bullet)} ${color(c.bold, label)}${hint}${color(c.dim, ': ')}`;
    rl.question(prompt, answer => {
      const val = answer.trim() || defaultVal || '';
      const display = val || color(c.gray, 'skipped');
      process.stdout.write(`\x1b[1A\r  ${color(c.green, S.check)} ${label}: ${display}\n`);
      resolve(val);
    });
  });
}

function askPassword(label) {
  return new Promise(resolve => {
    process.stdout.write(`  ${color(c.brand, S.bullet)} ${color(c.bold, label)}${color(c.dim, ': ')}`);

    const stdin = process.stdin;
    const oldRawMode = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);

    // Safety: always restore raw mode on process exit
    const restore = () => {
      if (stdin.setRawMode) {
        try { stdin.setRawMode(oldRawMode); } catch {}
      }
    };
    process.once('exit', restore);

    let password = '';
    const onData = (ch) => {
      const char = ch.toString();
      if (char === '\n' || char === '\r') {
        restore();
        process.removeListener('exit', restore);
        stdin.removeListener('data', onData);
        const masked = password.length > 0 ? '●'.repeat(password.length) : color(c.dim, 'auto-generate');
        process.stdout.write(`\r  ${color(c.green, S.check)} Password: ${masked}\n`);
        resolve(password);
      } else if (char === '\x7f' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (char === '\x03') {
        restore();
        process.removeListener('exit', restore);
        stdin.removeListener('data', onData);
        console.log('\n');
        process.exit(130);
      } else {
        password += char;
        process.stdout.write('●');
      }
    };
    stdin.on('data', onData);
    stdin.resume();
  });
}

// ─── Banner ──────────────────────────────────────────────────────────────────

function banner(version) {
  const lines = [
    `${color(c.brand + c.bold, S.bullet)}  ${color(c.bold, 'Claude Web Terminal')}  ${color(c.gray, `v${version}`)}`,
    '',
    `${color(c.dim, 'Access Claude Code from')}`,
    `${color(c.dim, 'anywhere via browser')}`,
  ];
  console.log('\n' + box(lines));
  console.log('');
}

// ─── Async Exec (non-blocking, keeps spinner alive) ─────────────────────────

const MAX_STDERR = 64 * 1024;

/**
 * Async exec — non-blocking so spinners keep animating.
 * opts.live = true  → stdio: 'inherit' (show real output, for installs)
 * opts.stdin = true → inherit stdin only (for sudo password)
 * default           → capture stderr, resolve/reject with it
 */
function exec(cmd, opts = {}) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    let stdio;
    if (opts.live) {
      stdio = 'inherit';
    } else if (cmd.startsWith('sudo ') || opts.stdin) {
      stdio = ['inherit', 'inherit', 'pipe'];
    } else {
      stdio = ['ignore', 'ignore', 'pipe'];
    }

    const child = spawn('sh', ['-c', cmd], {
      stdio,
      cwd: opts.cwd || undefined,
      env: opts.env || process.env,
    });

    let stderr = '';
    if (child.stderr) {
      child.stderr.on('data', d => {
        if (stderr.length < MAX_STDERR) {
          stderr += d.toString();
          if (stderr.length > MAX_STDERR) {
            stderr = stderr.slice(0, MAX_STDERR) + '\n...(truncated)';
          }
        }
      });
    }

    let killed = false;
    let killTimer = null;
    const timer = opts.timeout ? setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      // Escalate to SIGKILL after 5s if process ignores SIGTERM
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 5000);
      killTimer.unref();
    }, opts.timeout) : null;

    child.on('close', code => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (killed) return reject(new Error(`Timed out: ${cmd}`));
      if (code !== 0) {
        const err = new Error(`Exit code ${code}: ${cmd}`);
        err.stderr = stderr.trim();
        return reject(err);
      }
      resolve(stderr.trim());
    });
    child.on('error', reject);
  });
}

// ─── Log Helpers ─────────────────────────────────────────────────────────────

function success(text) { console.log(`  ${color(c.green, S.check)} ${text}`); }
function error(text)   { console.log(`  ${color(c.red, S.cross)} ${text}`); }
function warn(text)    { console.log(`  ${color(c.yellow, S.warn)} ${text}`); }
function info(text)    { console.log(`  ${color(c.gray, S.info)} ${text}`); }
function log(text)     { console.log(`  ${text}`); }

module.exports = {
  c, color, S,
  createSpinner, exec,
  box, stripAnsi,
  sectionStart, sectionItem, sectionEnd, sectionBlank,
  ask, askPassword,
  banner,
  success, error, warn, info, log,
};
