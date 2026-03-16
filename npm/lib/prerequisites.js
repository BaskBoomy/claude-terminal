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
  // Clear corrupted API cache (fixes "Cannot download non-corrupt formula.jws.json")
  const apiCacheDirs = [
    `${process.env.HOME}/Library/Caches/Homebrew/api`,
    '/opt/homebrew/var/homebrew/api',
  ];
  for (const dir of apiCacheDirs) {
    try {
      const entries = fs.readdirSync(dir);
      for (const f of entries) {
        if (f.endsWith('.json') || f.endsWith('.jws.json')) {
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
 * Install a package with spinner feedback.
 * Shows spinning animation during install, ✔/✖ on completion.
 */
async function spinnerInstall(label, cmd, opts = {}) {
  const spinner = createSpinner(label).start();
  try {
    await exec(cmd, { timeout: opts.timeout || 180000 });
    spinner.succeed(label.replace(/\.{3}$/, ''));
    return true;
  } catch (err) {
    // Auto-retry on brew lock error
    const errMsg = (err.stderr || err.message || '').toLowerCase();
    if (opts.brewPath && (errMsg.includes('already locked') || errMsg.includes('already running'))) {
      spinner.update('Brew lock detected — retrying...');
      await fixBrewIfNeeded(opts.brewPath);
      try {
        await exec(cmd, { timeout: opts.timeout || 180000 });
        spinner.succeed(label.replace(/\.{3}$/, ''));
        return true;
      } catch {}
    }
    spinner.fail(label.replace(/\.{3}$/, ' — failed'));
    return false;
  }
}

/**
 * Check a binary with spinner feedback.
 * Returns { found: bool, ver: string|null }
 */
function checkBin(name, versionCmd) {
  const spinner = createSpinner(`Checking ${name}...`).start();
  const path = findBin(name);
  if (path) {
    const ver = versionCmd ? getVersion(versionCmd) : null;
    spinner.succeed(`${name} ${color(c.dim, ver || '')}`);
    return { found: true, ver };
  }
  spinner.warn(`${name} ${color(c.dim, 'not found')}`);
  return { found: false, ver: null };
}

// ── Main ──

async function checkPrerequisites() {
  const plat = detectPlatform();

  sectionStart('Prerequisites');
  sectionItem(color(c.cyan, S.info), `${color(c.bold, plat.os)} ${color(c.dim, plat.arch)}`);
  console.log(`  ${color(c.gray, S.bar)}`);

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
  const tmux = checkBin('tmux', 'tmux -V');
  if (!tmux.found) {
    const cmd = installCmd('tmux', plat);
    let installed = false;
    if (cmd) {
      if (plat.pkg === 'brew') {
        const brewSpinner = createSpinner('Preparing Homebrew...').start();
        await fixBrewIfNeeded(plat.brewPath);
        brewSpinner.succeed('Homebrew ready');
      }
      installed = await spinnerInstall('Installing tmux...', cmd, { brewPath: plat.brewPath });

      // Retry: on brew failure, run brew update to refresh API cache then retry
      if (!installed && plat.pkg === 'brew' && plat.brewPath) {
        const refreshSpinner = createSpinner('Refreshing Homebrew cache...').start();
        await fixBrewIfNeeded(plat.brewPath);
        try { await exec(`${plat.brewPath} update`, { timeout: 120000 }); } catch {}
        refreshSpinner.succeed('Cache refreshed');
        installed = await spinnerInstall('Retrying tmux install...', `${plat.brewPath} install tmux`, { brewPath: plat.brewPath });
      }
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
  const claude = checkBin('claude', 'claude --version');
  if (!claude.found) {
    const npmPath = findBin('npm') || 'npm';
    let installed = await spinnerInstall('Installing Claude Code...', `${npmPath} install -g @anthropic-ai/claude-code`, { timeout: 300000 });
    if (!installed) {
      installed = await spinnerInstall('Retrying with sudo...', `sudo ${npmPath} install -g @anthropic-ai/claude-code`, { timeout: 300000 });
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
  const ttyd = checkBin('ttyd', 'ttyd --version');
  if (ttyd.found) {
    checks.ttyd = true;
  }

  console.log('');
  return checks;
}

module.exports = { checkPrerequisites };
