#!/usr/bin/env node

const { c, color, S, banner, box, success, error } = require('../lib/ui');
const { checkPrerequisites } = require('../lib/prerequisites');
const { prompt } = require('../lib/prompt');
const { installTtyd } = require('../lib/install-ttyd');
const { installServer } = require('../lib/install-server');
const { setupService } = require('../lib/service');
const pkg = require('../package.json');

async function main() {
  banner(pkg.version);

  // 1. Check prerequisites
  const checks = await checkPrerequisites();
  if (!checks.ok) {
    process.exit(1);
  }

  // 2. Interactive prompts
  const config = await prompt(checks);

  // 3. Install ttyd if needed
  if (!checks.ttyd) {
    await installTtyd();
  }

  // 3.5 Install cloudflared if tunnel enabled
  if (config.tunnel) {
    const { installCloudflared } = require('../lib/install-cloudflared');
    await installCloudflared();
  }

  // 4. Download and install Go server binary
  await installServer(config);

  // 5. Set up systemd/launchd service
  await setupService(config);

  // Final success
  const url = config.domain
    ? `https://${config.domain}`
    : `http://localhost:${config.port}`;

  const lines = [
    `${color(c.green + c.bold, S.check)}  ${color(c.bold, 'Claude Web Terminal is running!')}`,
    '',
    `${color(c.cyan, S.pointer)} ${color(c.bold, url)}`,
  ];

  if (!config.domain) {
    lines.push(`${color(c.gray, '  Also: http://<your-ip>:' + config.port)}`);
  }

  lines.push('');
  lines.push(`${color(c.dim, 'Manage:')}`);

  if (process.platform === 'linux') {
    lines.push(`${color(c.gray, '  systemctl status claude-terminal')}`);
    lines.push(`${color(c.gray, '  systemctl restart claude-terminal')}`);
    lines.push(`${color(c.gray, '  journalctl -u claude-terminal -f')}`);
  } else {
    lines.push(`${color(c.gray, '  launchctl list | grep claude')}`);
  }

  if (config.tunnel) {
    lines.push('');
    lines.push(`${color(c.cyan, S.info)} ${color(c.bold, 'Tunnel active')} ${color(c.dim, '— check URL:')}`);
    if (process.platform === 'linux') {
      lines.push(`${color(c.gray, '  sudo journalctl -u cloudflared-tunnel --no-pager -n 5')}`);
    } else {
      lines.push(`${color(c.gray, '  launchctl list | grep cloudflared')}`);
    }
    lines.push('');
    lines.push(`${color(c.yellow, S.warn)} ${color(c.dim, 'Tunnel URL changes on restart — for testing only.')}`);
    lines.push(`${color(c.dim, '  For a permanent domain, set DOMAIN in .env')}`);
  }

  console.log('\n' + box(lines, { color: c.green }) + '\n');
}

main().catch(err => {
  error(err.message);
  process.exit(1);
});
