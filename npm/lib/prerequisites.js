const { execSync } = require('child_process');
const fs = require('fs');
const { c, color, S, createSpinner, exec, sectionStart, sectionItem, sectionEnd } = require('./ui');

// ── Helpers ──

function findBin(cmd) {
  try {
    return execSync(`which ${cmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {}
  const known = {
    brew: ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'],
    tmux: ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'],
    claude: ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
    ttyd: ['/opt/homebrew/bin/ttyd', '/usr/local/bin/ttyd'],
    npm: ['/opt/homebrew/bin/npm', '/usr/local/bin/npm'],
  };
  for (const p of (known[cmd] || [])) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}

function getVersion(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function ensurePath() {
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/local/go/bin'];
  for (const dir of dirs) {
    if (!process.env.PATH.includes(dir)) {
      process.env.PATH = `${dir}:${process.env.PATH}`;
    }
  }
}

function detectPlatform() {
  const platform = process.platform;
  const arch = process.arch;
  ensurePath();

  if (platform === 'darwin') {
    const brewPath = findBin('brew');
    return { os: 'macOS', arch, platform, pkg: brewPath ? 'brew' : null, brewPath };
  }

  if (platform === 'linux') {
    let distro = 'Linux';
    try {
      const release = fs.readFileSync('/etc/os-release', 'utf8');
      const match = release.match(/^PRETTY_NAME="?(.+?)"?$/m);
      if (match) distro = match[1];
    } catch {}

    let pkg = null;
    if (findBin('apt-get')) pkg = 'apt';
    else if (findBin('dnf')) pkg = 'dnf';
    else if (findBin('yum')) pkg = 'yum';
    else if (findBin('pacman')) pkg = 'pacman';
    else if (findBin('apk')) pkg = 'apk';
    else if (findBin('zypper')) pkg = 'zypper';

    return { os: distro, arch, platform, pkg, brewPath: null };
  }

  return { os: platform, arch, platform, pkg: null, brewPath: null };
}

function installCmd(name, plat) {
  const brew = plat.brewPath || 'brew';
  const cmds = {
    brew:    `HOMEBREW_NO_AUTO_UPDATE=1 ${brew} install ${name}`,
    apt:     `sudo apt-get install -y ${name}`,
    dnf:     `sudo dnf install -y ${name}`,
    yum:     `sudo yum install -y ${name}`,
    pacman:  `sudo pacman -S --noconfirm ${name}`,
    apk:     `sudo apk add ${name}`,
    zypper:  `sudo zypper install -y ${name}`,
  };
  return cmds[plat.pkg] || null;
}

/**
 * Fix common brew issues before install.
 */
async function fixBrewIfNeeded(brewPath) {
  if (!brewPath) return;
  // Kill stale brew lock / ruby processes
  try {
    await exec('pkill -f "brew vendor-install" 2>/dev/null || true', { timeout: 5000 });
  } catch {}
  // Remove stale lock files
  const lockDirs = [
    `${process.env.HOME}/Library/Caches/Homebrew`,
    '/opt/homebrew/var/homebrew/locks',
    '/usr/local/var/homebrew/locks',
  ];
  for (const dir of lockDirs) {
    try {
      const entries = fs.readdirSync(dir);
      for (const f of entries) {
        if (f.endsWith('.lock')) {
          try { fs.unlinkSync(`${dir}/${f}`); } catch {}
        }
      }
    } catch {}
  }
  // Quick brew cleanup
  try {
    await exec(`${brewPath} cleanup 2>/dev/null || true`, { timeout: 15000 });
  } catch {}
}

/**
 * Install a package with live terminal output.
 * Spinner stops → real output shown → result displayed.
 */
async function liveInstall(label, cmd, opts = {}) {
  console.log(`  ${color(c.gray, S.bar)}`);
  console.log(`  ${color(c.gray, S.barT)} ${color(c.yellow, S.warn)} ${label}`);
  console.log(`  ${color(c.gray, S.bar)}   ${color(c.dim, '$ ' + cmd)}`);
  console.log(`  ${color(c.gray, S.bar)}`);

  try {
    await exec(cmd, { live: true, timeout: 180000 });
    console.log(`  ${color(c.gray, S.bar)}`);
    return true;
  } catch (err) {
    console.log(`  ${color(c.gray, S.bar)}`);

    // Auto-retry on brew lock error
    const errMsg = (err.stderr || err.message || '').toLowerCase();
    if (opts.brewPath && (errMsg.includes('already locked') || errMsg.includes('already running'))) {
      console.log(`  ${color(c.gray, S.bar)}   ${color(c.yellow, 'Brew lock detected — cleaning up and retrying...')}`);
      await fixBrewIfNeeded(opts.brewPath);
      console.log(`  ${color(c.gray, S.bar)}`);
      try {
        await exec(cmd, { live: true, timeout: 180000 });
        console.log(`  ${color(c.gray, S.bar)}`);
        return true;
      } catch {}
    }

    return false;
  }
}

// ── Main ──

async function checkPrerequisites() {
  const plat = detectPlatform();

  sectionStart('Prerequisites');
  sectionItem(color(c.cyan, S.info), `${color(c.bold, plat.os)} ${color(c.dim, plat.arch)}`);

  if (plat.platform === 'darwin' && !plat.brewPath) {
    sectionItem(color(c.yellow, S.warn), `Homebrew not found ${color(c.dim, '— some auto-installs may fail')}`);
    console.log(`  ${color(c.gray, S.bar)}   ${color(c.dim, '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"')}`);
  }

  const checks = { ok: true, ttyd: false };

  if (plat.platform !== 'linux' && plat.platform !== 'darwin') {
    sectionEnd(color(c.red, S.cross), `${plat.platform} ${color(c.red, 'not supported')} ${color(c.dim, '— Linux and macOS only')}`);
    checks.ok = false;
    return checks;
  }

  // ── tmux ──
  if (findBin('tmux')) {
    const ver = getVersion('tmux -V');
    sectionItem(color(c.green, S.check), `tmux ${color(c.dim, ver || '')}`);
  } else {
    const cmd = installCmd('tmux', plat);
    let installed = false;
    if (cmd) {
      if (plat.pkg === 'brew') await fixBrewIfNeeded(plat.brewPath);
      installed = await liveInstall('tmux not found — installing', cmd, { brewPath: plat.brewPath });
    }
    if (installed && findBin('tmux')) {
      const ver = getVersion('tmux -V');
      sectionItem(color(c.green, S.check), `tmux ${color(c.dim, ver || 'installed')}`);
    } else {
      sectionItem(color(c.red, S.cross), 'tmux — install failed');
      const hint = installCmd('tmux', plat) || 'apt install tmux / brew install tmux';
      console.log(`  ${color(c.gray, S.bar)}   ${color(c.dim, 'Try manually: ' + hint)}`);
      checks.ok = false;
    }
  }

  // ── Claude Code ──
  if (findBin('claude')) {
    const ver = getVersion('claude --version');
    sectionItem(color(c.green, S.check), `Claude Code ${color(c.dim, ver || '')}`);
  } else {
    const npmPath = findBin('npm') || 'npm';
    let installed = await liveInstall('Claude Code not found — installing', `${npmPath} install -g @anthropic-ai/claude-code`);
    if (!installed) {
      installed = await liveInstall('Retrying with sudo', `sudo ${npmPath} install -g @anthropic-ai/claude-code`);
    }
    if (installed && findBin('claude')) {
      const ver = getVersion('claude --version');
      sectionItem(color(c.green, S.check), `Claude Code ${color(c.dim, ver || 'installed')}`);
    } else {
      sectionItem(color(c.red, S.cross), 'Claude Code — install failed');
      console.log(`  ${color(c.gray, S.bar)}   ${color(c.dim, 'npm install -g @anthropic-ai/claude-code')}`);
      checks.ok = false;
    }
  }

  // ── ttyd (optional) ──
  if (findBin('ttyd')) {
    const ver = getVersion('ttyd --version');
    sectionEnd(color(c.green, S.check), `ttyd ${color(c.dim, ver || '')}`);
    checks.ttyd = true;
  } else {
    sectionEnd(color(c.yellow, S.warn), `ttyd ${color(c.dim, 'will install automatically')}`);
  }

  console.log('');
  return checks;
}

module.exports = { checkPrerequisites };
