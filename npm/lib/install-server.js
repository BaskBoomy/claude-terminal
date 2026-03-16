const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { c, color, S, createSpinner, exec, sectionStart, sectionItem, sectionEnd } = require('./ui');
const { resolveArch, safeDownload, shellQuote } = require('./shared');

const REPO = 'BaskBoomy/claude-terminal';

function getAssetName() {
  const platform = process.platform;
  const archInfo = resolveArch();
  const osName = platform === 'darwin' ? 'darwin' : 'linux';

  if (!archInfo.server) {
    // 32-bit ARM: no pre-built server binary
    return null;
  }

  return `claude-terminal-${osName}-${archInfo.server}`;
}

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function getGoVersion() {
  try {
    const data = execSync('curl -sL "https://go.dev/VERSION?m=text"', { encoding: 'utf8', timeout: 10000 });
    const version = data.split('\n')[0].trim();
    if (/^go\d+\.\d+(\.\d+)?$/.test(version)) return version;
  } catch {}
  return 'go1.22.5';
}

async function tryInstallGo() {
  if (process.platform === 'darwin' && commandExists('brew')) {
    const spinner = createSpinner('Installing Go via Homebrew...').start();
    try {
      await exec('brew install go', { timeout: 300000 });
      spinner.succeed('Go installed');
      return true;
    } catch {
      spinner.fail('Failed to install Go');
      return false;
    }
  }

  if (process.platform === 'linux') {
    const archInfo = resolveArch();
    const goVersion = await getGoVersion();
    const goUrl = `https://go.dev/dl/${goVersion}.linux-${archInfo.go}.tar.gz`;
    const spinner = createSpinner(`Installing ${goVersion}...`).start();
    try {
      await exec(`curl -sL ${shellQuote(goUrl)} | sudo tar -C /usr/local -xzf -`, { timeout: 300000 });
      process.env.PATH = `/usr/local/go/bin:${process.env.PATH}`;
      spinner.succeed('Go installed to /usr/local/go');
      return true;
    } catch {
      spinner.fail('Failed to install Go');
      return false;
    }
  }

  return false;
}

async function installServer(config) {
  const { installDir, password, port, domain, claudeCmd } = config;

  sectionStart('Installing Server');

  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(path.join(installDir, 'data'), { recursive: true });

  // Check latest release
  const assetName = getAssetName();
  const releaseUrl = `https://api.github.com/repos/${REPO}/releases/latest`;

  let downloadUrl;
  const checkSpinner = createSpinner('Checking latest release...').start();

  if (assetName) {
    try {
      const releaseData = execSync(`curl -sL ${shellQuote(releaseUrl)}`, { encoding: 'utf8', timeout: 15000 });
      const release = JSON.parse(releaseData);

      // Guard against API error responses (rate limit, not found, etc.)
      if (release.message) {
        throw new Error(`GitHub API: ${release.message}`);
      }
      if (!release.assets || !Array.isArray(release.assets)) {
        throw new Error('No assets in release data');
      }

      const asset = release.assets.find(a => a.name === assetName);
      if (asset) {
        downloadUrl = asset.browser_download_url;
        checkSpinner.succeed(`Found ${color(c.dim, assetName)}`);
      } else {
        checkSpinner.warn('No pre-built binary — will build from source');
      }
    } catch (err) {
      const reason = err.message ? `: ${err.message}` : '';
      checkSpinner.warn(`Release check failed${reason} — will build from source`);
    }
  } else {
    checkSpinner.warn('No pre-built binary for this architecture — will build from source');
  }

  if (!downloadUrl) {
    // Need Go
    if (!commandExists('go')) {
      if (!await tryInstallGo() || !commandExists('go')) {
        throw new Error(
          'Go is required to build from source. Install: https://go.dev/dl/\n' +
          '  Or create a GitHub release with pre-built binaries.'
        );
      }
    }

    const spinner = createSpinner('Building from source...').start();
    const tmpDir = path.join(os.tmpdir(), 'claude-terminal-build');
    try {
      await exec(`rm -rf ${shellQuote(tmpDir)}`);
      spinner.update('Cloning repository...');
      await exec(`git clone --depth 1 https://github.com/${REPO}.git ${shellQuote(tmpDir)}`, { timeout: 60000 });
      spinner.update('Compiling Go binary...');
      await exec('go build -ldflags="-s -w" -o claude-terminal .', { cwd: tmpDir, timeout: 300000 });
      fs.copyFileSync(path.join(tmpDir, 'claude-terminal'), path.join(installDir, 'claude-terminal'));

      const publicSrc = path.join(tmpDir, 'public');
      if (fs.existsSync(publicSrc) && fs.readdirSync(publicSrc).length > 0) {
        copyDirSync(publicSrc, path.join(installDir, 'public'));
      }

      spinner.succeed('Built from source');
    } catch (err) {
      spinner.fail('Build failed');
      throw err;
    } finally {
      try { await exec(`rm -rf ${shellQuote(tmpDir)}`); } catch {}
    }
  } else {
    // Download binary
    const spinner = createSpinner(`Downloading ${assetName}`).start();
    const binPath = path.join(installDir, 'claude-terminal');
    try {
      await safeDownload(downloadUrl, binPath, { timeout: 180000 });
      fs.chmodSync(binPath, 0o755);
      spinner.succeed('Binary downloaded');
    } catch (err) {
      spinner.fail('Download failed');
      throw err;
    }

    // Frontend assets
    const assetSpinner = createSpinner('Downloading frontend assets...').start();
    const tmpDir = path.join(os.tmpdir(), 'claude-terminal-assets');
    try {
      await exec(`rm -rf ${shellQuote(tmpDir)}`);
      assetSpinner.update('Cloning frontend assets...');
      await exec(`git clone --depth 1 --filter=blob:none --sparse https://github.com/${REPO}.git ${shellQuote(tmpDir)}`, { timeout: 60000 });
      await exec('git sparse-checkout set public', { cwd: tmpDir });

      const publicSrc = path.join(tmpDir, 'public');
      if (!fs.existsSync(publicSrc) || fs.readdirSync(publicSrc).length === 0) {
        throw new Error('Sparse checkout failed: public/ directory is empty or missing');
      }

      copyDirSync(publicSrc, path.join(installDir, 'public'));
      assetSpinner.succeed('Frontend assets downloaded');
    } catch (err) {
      assetSpinner.fail('Failed to download frontend assets');
      throw err;
    } finally {
      try { await exec(`rm -rf ${shellQuote(tmpDir)}`); } catch {}
    }
  }

  fs.chmodSync(path.join(installDir, 'claude-terminal'), 0o755);

  // Create .env (single-quote PASSWORD to prevent shell expansion)
  const safePassword = (password || '').replace(/[\n\r]/g, '');
  const envContent = [
    `PASSWORD='${safePassword.replace(/'/g, "'\\''")}'`,
    `PORT=${port}`,
    `TTYD_PORT=${config.ttydPort || 7681}`,
    `CLAUDE_CMD=${config.claudeCmd || 'claude'}`,
    domain ? `DOMAIN=${domain}` : '# DOMAIN=your.domain.com',
    config.tunnel ? 'TUNNEL=true' : '# TUNNEL=false',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(installDir, '.env'), envContent, { mode: 0o600 });

  // Create ttyd start script (with PATH fix for macOS launchd)
  const ttydScript = `#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:\$PATH"
SESSION=\${TMUX_SESSION:-claude}
CLAUDE_CMD=\${CLAUDE_CMD:-claude}

if tmux has-session -t "$SESSION" 2>/dev/null; then
    exec tmux attach -t "$SESSION"
else
    tmux new-session -d -s "$SESSION"
    tmux send-keys -t "$SESSION" "cd ~ && \$CLAUDE_CMD" Enter
    exec tmux attach -t "$SESSION"
fi
`;
  const scriptPath = path.join(installDir, 'ttyd-start.sh');
  fs.writeFileSync(scriptPath, ttydScript, { mode: 0o755 });

  sectionItem(color(c.green, S.check), `Installed to ${color(c.dim, installDir)}`);
  sectionEnd(color(c.green, S.check), 'Config & scripts created');
  console.log('');
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

module.exports = { installServer };
