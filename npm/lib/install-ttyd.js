const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSpinner, exec } = require('./ui');

const TTYD_VERSION = '1.7.7';

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

function findBrew() {
  const paths = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
  for (const p of paths) {
    try { require('fs').accessSync(p, require('fs').constants.X_OK); return p; } catch {}
  }
  return 'brew';
}

async function installTtyd() {
  if (process.platform === 'darwin') {
    const brew = findBrew();
    const spinner = createSpinner('Installing ttyd via Homebrew...').start();
    try {
      await exec(`HOMEBREW_NO_AUTO_UPDATE=1 ${brew} install ttyd`, { timeout: 120000 });
      spinner.succeed('ttyd installed via Homebrew');
    } catch {
      spinner.fail('Failed to install ttyd');
      throw new Error('Please install manually: brew install ttyd');
    }
    return;
  }

  // Linux: download binary
  const arch = (process.arch === 'arm64' || process.arch === 'aarch64') ? 'aarch64' : 'x86_64';
  const url = `https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${arch}`;

  const spinner = createSpinner(`Downloading ttyd ${TTYD_VERSION} (${arch})`).start();

  const tmpPath = path.join(os.tmpdir(), 'ttyd');
  await download(url, tmpPath);
  fs.chmodSync(tmpPath, 0o755);

  spinner.update('Installing ttyd...');

  // Install to /usr/local/bin
  try {
    await exec(`sudo mv ${tmpPath} /usr/local/bin/ttyd`);
    spinner.succeed('ttyd installed to /usr/local/bin/ttyd');
  } catch {
    const localBin = path.join(process.env.HOME, '.local', 'bin');
    fs.mkdirSync(localBin, { recursive: true });
    fs.renameSync(tmpPath, path.join(localBin, 'ttyd'));
    spinner.succeed(`ttyd installed to ${localBin}/ttyd`);
  }
}

module.exports = { installTtyd };
