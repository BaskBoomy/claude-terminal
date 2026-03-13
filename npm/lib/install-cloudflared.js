const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSpinner, exec } = require('./ui');

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findBrew() {
  const paths = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
  for (const p of paths) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return 'brew';
}

async function installCloudflared() {
  if (commandExists('cloudflared')) {
    return true;
  }

  const spinner = createSpinner('Installing cloudflared...').start();

  try {
    if (process.platform === 'linux') {
      const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
      const realArch = process.arch === 'arm' ? 'arm' : arch;
      const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${realArch}`;
      await exec(`curl -sL "${url}" -o /tmp/cloudflared && chmod +x /tmp/cloudflared`, { timeout: 60000 });
      try {
        await exec('sudo mv /tmp/cloudflared /usr/local/bin/cloudflared');
      } catch {
        const localBin = path.join(os.homedir(), '.local', 'bin');
        fs.mkdirSync(localBin, { recursive: true });
        fs.copyFileSync('/tmp/cloudflared', path.join(localBin, 'cloudflared'));
        fs.chmodSync(path.join(localBin, 'cloudflared'), 0o755);
        fs.unlinkSync('/tmp/cloudflared');
      }
      spinner.succeed('cloudflared installed');
      return true;
    } else if (process.platform === 'darwin') {
      const brew = findBrew();
      if (commandExists(brew)) {
        await exec(`HOMEBREW_NO_AUTO_UPDATE=1 ${brew} install cloudflared`, { timeout: 120000 });
        spinner.succeed('cloudflared installed');
        return true;
      }
    }
    spinner.fail('Could not install cloudflared');
    return false;
  } catch (err) {
    spinner.fail('cloudflared installation failed');
    return false;
  }
}

module.exports = { installCloudflared };
