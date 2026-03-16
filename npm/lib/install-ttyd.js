const fs = require('fs');
const os = require('os');
const path = require('path');
const { c, color, S, createSpinner, exec } = require('./ui');
const { resolveArch, safeDownload, isMusl } = require('./shared');

const TTYD_VERSION = '1.7.7';

function findBrew() {
  const paths = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
  for (const p of paths) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
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
  const archInfo = resolveArch();

  // Check musl libc (Alpine) — pre-built binaries may not work
  if (isMusl()) {
    const spinner = createSpinner('Checking ttyd...').start();
    spinner.warn('Alpine Linux (musl) detected — pre-built ttyd may not work');
    console.log(`  ${color(c.dim, '  Try: apk add ttyd')}`);
    // Still try the download, but warn
  }

  const url = `https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${archInfo.ttyd}`;
  const spinner = createSpinner(`Downloading ttyd ${TTYD_VERSION} (${archInfo.ttyd})`).start();

  const tmpPath = path.join(os.tmpdir(), 'ttyd');
  try {
    await safeDownload(url, tmpPath, { timeout: 60000 });
  } catch (err) {
    spinner.fail(`Download failed: ${err.message}`);
    throw new Error(`Failed to download ttyd. Install manually or try: apt install ttyd`);
  }
  fs.chmodSync(tmpPath, 0o755);

  spinner.update('Installing ttyd...');

  // Install to /usr/local/bin
  try {
    await exec(`sudo mv ${tmpPath} /usr/local/bin/ttyd`);
    spinner.succeed('ttyd installed to /usr/local/bin/ttyd');
  } catch {
    const localBin = path.join(os.homedir(), '.local', 'bin');
    fs.mkdirSync(localBin, { recursive: true });
    fs.renameSync(tmpPath, path.join(localBin, 'ttyd'));
    // Ensure ~/.local/bin is in PATH for subsequent findBinary() calls
    if (!process.env.PATH.includes(localBin)) {
      process.env.PATH = `${localBin}:${process.env.PATH}`;
    }
    spinner.succeed(`ttyd installed to ${localBin}/ttyd`);
    console.log(`  ${color(c.yellow, S.warn)} ${color(c.dim, `Add to your shell profile: export PATH="${localBin}:$PATH"`)}`);
  }
}

module.exports = { installTtyd };
