/**
 * ui.js — Zero-dependency CLI styling utilities
 * ANSI colors, spinners, box drawing, styled prompts
 */

const readline = require('readline');

// ─── ANSI Colors ─────────────────────────────────────────────────────────────

const ESC = '\x1b[';
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

  return {
    start() {
      timer = setInterval(() => {
        const frame = color(c.brand, SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]);
        stream.write(`\r  ${frame} ${color(c.dim, text)}`);
      }, 80);
      return this;
    },
    succeed(msg) {
      clearInterval(timer);
      stream.write(`\r  ${color(c.green, S.check)} ${msg || text}\n`);
      return this;
    },
    fail(msg) {
      clearInterval(timer);
      stream.write(`\r  ${color(c.red, S.cross)} ${msg || text}\n`);
      return this;
    },
    warn(msg) {
      clearInterval(timer);
      stream.write(`\r  ${color(c.yellow, S.warn)} ${msg || text}\n`);
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
  return str.replace(/\x1b\[[0-9;]*m/g, '');
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
  const hint = defaultVal ? color(c.gray, ` (${defaultVal})`) : '';
  return new Promise(resolve => {
    const prompt = `  ${color(c.brand, S.bullet)} ${color(c.bold, label)}${hint}\n  ${color(c.gray, S.bar)} `;
    rl.question(prompt, answer => {
      // Move cursor up and rewrite with the answer
      const val = answer.trim() || defaultVal || '';
      const display = val || color(c.gray, 'skipped');
      process.stdout.write(`\x1b[1A\r  ${color(c.gray, S.bar)} ${display}\n`);
      resolve(val);
    });
  });
}

function askPassword(label) {
  return new Promise(resolve => {
    const hint = '';
    process.stdout.write(`  ${color(c.brand, S.bullet)} ${color(c.bold, label)}${hint}\n  ${color(c.gray, S.bar)} `);

    const stdin = process.stdin;
    const oldRawMode = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);

    let password = '';
    const onData = (ch) => {
      const char = ch.toString();
      if (char === '\n' || char === '\r') {
        if (stdin.setRawMode) stdin.setRawMode(oldRawMode);
        stdin.removeListener('data', onData);
        const masked = '●'.repeat(password.length);
        process.stdout.write(`\r  ${color(c.gray, S.bar)} ${masked}\n`);
        resolve(password);
      } else if (char === '\x7f' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (char === '\x03') {
        console.log('\n');
        process.exit(0);
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
      stdio = ['inherit', 'ignore', 'pipe'];
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
      child.stderr.on('data', d => { stderr += d.toString(); });
    }

    let killed = false;
    const timer = opts.timeout ? setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, opts.timeout) : null;

    child.on('close', code => {
      if (timer) clearTimeout(timer);
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
