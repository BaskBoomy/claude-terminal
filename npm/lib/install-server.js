const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { c, color, S, createSpinner, exec, sectionStart, sectionItem, sectionEnd } = require('./ui');

const REPO = 'BaskBoomy/claude-terminal';

function getAssetName() {
  const platform = process.platform;
  const arch = process.arch;

  const osName = platform === 'darwin' ? 'darwin' : 'linux';
  let archName;
  if (arch === 'arm64' || arch === 'aarch64') {
    archName = 'arm64';
  } else if (arch === 'x64') {
    archName = 'amd64';
  } else {
    throw new Error(`Unsupported architecture: ${arch}`);
  }

  return `claude-terminal-${osName}-${archName}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url) => {
      const proto = url.startsWith('https') ? https : require('http');
      proto.get(url, { headers: { 'User-Agent': 'create-claude-terminal' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode} ${url}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    };
    follow(url);
  });
}

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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
    const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
    const goUrl = `https://go.dev/dl/go1.22.5.linux-${arch}.tar.gz`;
    const spinner = createSpinner('Installing Go...').start();
    try {
      await exec(`curl -sL ${goUrl} | sudo tar -C /usr/local -xzf -`, { timeout: 300000 });
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
  try {
    const releaseData = execSync(`curl -sL ${releaseUrl}`, { encoding: 'utf8', timeout: 15000 });
    const release = JSON.parse(releaseData);
    const asset = release.assets.find(a => a.name === assetName);
    if (asset) {
      downloadUrl = asset.browser_download_url;
      checkSpinner.succeed(`Found ${color(c.dim, assetName)}`);
    } else {
      checkSpinner.warn('No pre-built binary — will build from source');
    }
  } catch {
    checkSpinner.warn('No release found — will build from source');
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
      await exec(`rm -rf ${tmpDir}`);
      spinner.update('Cloning repository...');
      await exec(`git clone --depth 1 https://github.com/${REPO}.git ${tmpDir}`, { timeout: 60000 });
      spinner.update('Compiling Go binary...');
      await exec('go build -ldflags="-s -w" -o claude-terminal .', { cwd: tmpDir, timeout: 300000 });
      fs.copyFileSync(path.join(tmpDir, 'claude-terminal'), path.join(installDir, 'claude-terminal'));
      copyDirSync(path.join(tmpDir, 'public'), path.join(installDir, 'public'));
      await exec(`rm -rf ${tmpDir}`);
      spinner.succeed('Built from source');
    } catch (err) {
      spinner.fail('Build failed');
      throw err;
    }
  } else {
    // Download binary
    const spinner = createSpinner(`Downloading ${assetName}`).start();
    const binPath = path.join(installDir, 'claude-terminal');
    await download(downloadUrl, binPath);
    fs.chmodSync(binPath, 0o755);
    spinner.succeed('Binary downloaded');

    // Frontend assets
    const assetSpinner = createSpinner('Downloading frontend assets...').start();
    const tmpDir = path.join(os.tmpdir(), 'claude-terminal-assets');
    try {
      await exec(`rm -rf ${tmpDir}`);
      assetSpinner.update('Cloning frontend assets...');
      await exec(`git clone --depth 1 --filter=blob:none --sparse https://github.com/${REPO}.git ${tmpDir}`, { timeout: 60000 });
      await exec('git sparse-checkout set public', { cwd: tmpDir });
      copyDirSync(path.join(tmpDir, 'public'), path.join(installDir, 'public'));
      await exec(`rm -rf ${tmpDir}`);
      assetSpinner.succeed('Frontend assets downloaded');
    } catch (err) {
      assetSpinner.fail('Failed to download frontend assets');
      throw err;
    }
  }

  fs.chmodSync(path.join(installDir, 'claude-terminal'), 0o755);

  // Create .env
  const envContent = [
    `PASSWORD=${password}`,
    `PORT=${port}`,
    `TTYD_PORT=${config.ttydPort || 7681}`,
    `CLAUDE_CMD=${config.claudeCmd || 'claude'}`,
    domain ? `DOMAIN=${domain}` : '# DOMAIN=your.domain.com',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(installDir, '.env'), envContent, { mode: 0o600 });

  // Create ttyd start script
  const ttydScript = `#!/bin/bash
SESSION=\${TMUX_SESSION:-claude}
CLAUDE_CMD=\${CLAUDE_CMD:-claude}

if tmux has-session -t "$SESSION" 2>/dev/null; then
    exec tmux attach -t "$SESSION"
else
    tmux new-session -d -s "$SESSION"
    tmux send-keys -t "$SESSION" "cd ~ && $CLAUDE_CMD" Enter
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
