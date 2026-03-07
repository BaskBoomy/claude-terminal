const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TTYD_VERSION = '1.7.7';

function getTtydUrl() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux') {
    if (arch === 'arm64' || arch === 'aarch64') {
      return `https://github.com/nicm/tmux/releases/latest/download/ttyd.aarch64`;
    }
    return `https://github.com/nicm/tmux/releases/latest/download/ttyd.x86_64`;
  }
  // macOS — use Homebrew
  return null;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url) => {
      https.get(url, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`));
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

async function installTtyd() {
  console.log('\n  Installing ttyd...');

  if (process.platform === 'darwin') {
    console.log('  Running: brew install ttyd');
    try {
      execSync('brew install ttyd', { stdio: 'inherit' });
      console.log('  ✅ ttyd installed via Homebrew');
    } catch {
      throw new Error('Failed to install ttyd. Please install manually: brew install ttyd');
    }
    return;
  }

  // Linux: download binary from GitHub
  const url = getTtydUrl();
  if (!url) {
    throw new Error('Unsupported platform for ttyd. Please install manually.');
  }

  // Download from tsl0922/ttyd releases
  const arch = (process.arch === 'arm64' || process.arch === 'aarch64') ? 'aarch64' : 'x86_64';
  const realUrl = `https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${arch}`;

  const tmpPath = path.join(os.tmpdir(), 'ttyd');
  console.log(`  Downloading ttyd ${TTYD_VERSION} for ${arch}...`);
  await download(realUrl, tmpPath);

  fs.chmodSync(tmpPath, 0o755);

  // Install to /usr/local/bin
  try {
    execSync(`sudo mv ${tmpPath} /usr/local/bin/ttyd`, { stdio: 'inherit' });
    console.log('  ✅ ttyd installed to /usr/local/bin/ttyd');
  } catch {
    // Try without sudo
    const localBin = path.join(process.env.HOME, '.local', 'bin');
    fs.mkdirSync(localBin, { recursive: true });
    fs.renameSync(tmpPath, path.join(localBin, 'ttyd'));
    console.log(`  ✅ ttyd installed to ${localBin}/ttyd`);
  }
}

module.exports = { installTtyd };
