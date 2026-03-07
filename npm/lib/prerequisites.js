const { execSync } = require('child_process');

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getVersion(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function checkPrerequisites() {
  console.log('  Checking prerequisites...\n');

  const checks = { ok: true, ttyd: false };

  // tmux
  if (commandExists('tmux')) {
    const ver = getVersion('tmux -V');
    console.log(`  ✅ tmux ${ver || ''}`);
  } else {
    console.log('  ❌ tmux not found');
    console.log('     Install: sudo apt install tmux (Debian/Ubuntu)');
    console.log('              brew install tmux (macOS)\n');
    checks.ok = false;
  }

  // Claude Code
  if (commandExists('claude')) {
    const ver = getVersion('claude --version');
    console.log(`  ✅ Claude Code ${ver || ''}`);
  } else {
    console.log('  ❌ Claude Code not found');
    console.log('     Install: npm install -g @anthropic-ai/claude-code\n');
    checks.ok = false;
  }

  // ttyd (optional — we can install it)
  if (commandExists('ttyd')) {
    const ver = getVersion('ttyd --version');
    console.log(`  ✅ ttyd ${ver || ''}`);
    checks.ttyd = true;
  } else {
    console.log('  ⚠️  ttyd not found (will install automatically)');
  }

  // OS check
  const platform = process.platform;
  const arch = process.arch;
  if (platform !== 'linux' && platform !== 'darwin') {
    console.log(`\n  ❌ Unsupported platform: ${platform}`);
    console.log('     Claude Terminal supports Linux and macOS\n');
    checks.ok = false;
  } else {
    console.log(`  ✅ ${platform}/${arch}`);
  }

  console.log('');
  return checks;
}

module.exports = { checkPrerequisites };
