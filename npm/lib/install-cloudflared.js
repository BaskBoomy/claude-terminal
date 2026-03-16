const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSpinner, exec } = require('./ui');
const { resolveArch, safeDownload } = require('./shared');

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
      const archInfo = resolveArch();
      const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${archInfo.cloudflared}`;
      const tmpPath = path.join(os.tmpdir(), 'cloudflared');

      await safeDownload(url, tmpPath, { timeout: 60000 });
      fs.chmodSync(tmpPath, 0o755);

      try {
        await exec(`sudo mv ${tmpPath} /usr/local/bin/cloudflared`);
      } catch {
        const localBin = path.join(os.homedir(), '.local', 'bin');
        fs.mkdirSync(localBin, { recursive: true });
        fs.copyFileSync(tmpPath, path.join(localBin, 'cloudflared'));
        fs.chmodSync(path.join(localBin, 'cloudflared'), 0o755);
        try { fs.unlinkSync(tmpPath); } catch {}
        if (!process.env.PATH.includes(localBin)) {
          process.env.PATH = `${localBin}:${process.env.PATH}`;
        }
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
