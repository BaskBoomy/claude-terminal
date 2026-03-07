const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

async function installServer(config) {
  const { installDir, password, port, domain } = config;

  console.log(`\n  Installing Claude Terminal to ${installDir}...`);
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(path.join(installDir, 'data'), { recursive: true });

  // Download binary from GitHub releases
  const assetName = getAssetName();
  const releaseUrl = `https://api.github.com/repos/${REPO}/releases/latest`;

  let downloadUrl;
  try {
    const releaseData = execSync(`curl -sL ${releaseUrl}`, { encoding: 'utf8' });
    const release = JSON.parse(releaseData);
    const asset = release.assets.find(a => a.name === assetName);
    if (asset) {
      downloadUrl = asset.browser_download_url;
    }
  } catch {
    // Fallback: no release yet
  }

  if (!downloadUrl) {
    // No release yet — clone and build
    console.log('  No pre-built binary found. Cloning and building...');
    const tmpDir = path.join(os.tmpdir(), 'claude-terminal-build');
    execSync(`rm -rf ${tmpDir}`);
    execSync(`git clone --depth 1 https://github.com/${REPO}.git ${tmpDir}`, { stdio: 'inherit' });
    execSync('go build -ldflags="-s -w" -o claude-terminal .', { cwd: tmpDir, stdio: 'inherit' });
    fs.copyFileSync(path.join(tmpDir, 'claude-terminal'), path.join(installDir, 'claude-terminal'));

    // Copy public directory
    copyDirSync(path.join(tmpDir, 'public'), path.join(installDir, 'public'));

    execSync(`rm -rf ${tmpDir}`);
  } else {
    console.log(`  Downloading ${assetName}...`);
    const binPath = path.join(installDir, 'claude-terminal');
    await download(downloadUrl, binPath);
    fs.chmodSync(binPath, 0o755);

    // Also need public dir — clone it
    console.log('  Downloading frontend assets...');
    const tmpDir = path.join(os.tmpdir(), 'claude-terminal-assets');
    execSync(`rm -rf ${tmpDir}`);
    execSync(`git clone --depth 1 --filter=blob:none --sparse https://github.com/${REPO}.git ${tmpDir}`, { stdio: 'ignore' });
    execSync('git sparse-checkout set public', { cwd: tmpDir, stdio: 'ignore' });
    copyDirSync(path.join(tmpDir, 'public'), path.join(installDir, 'public'));
    execSync(`rm -rf ${tmpDir}`);
  }

  fs.chmodSync(path.join(installDir, 'claude-terminal'), 0o755);

  // Create .env
  const envContent = [
    `PASSWORD=${password}`,
    `PORT=${port}`,
    domain ? `DOMAIN=${domain}` : '# DOMAIN=your.domain.com',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(installDir, '.env'), envContent, { mode: 0o600 });

  // Create ttyd start script
  const ttydScript = `#!/bin/bash
if tmux has-session -t claude 2>/dev/null; then
    exec tmux attach -t claude
else
    tmux new-session -d -s claude
    tmux send-keys -t claude 'cd ~ && claude --dangerously-skip-permissions' Enter
    exec tmux attach -t claude
fi
`;
  const scriptPath = path.join(installDir, 'ttyd-start.sh');
  fs.writeFileSync(scriptPath, ttydScript, { mode: 0o755 });

  console.log('  ✅ Server installed');
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
