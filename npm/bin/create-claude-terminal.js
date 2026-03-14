#!/usr/bin/env node

const { c, color, S, banner, box, success, error } = require('../lib/ui');
const { checkPrerequisites } = require('../lib/prerequisites');
const { prompt } = require('../lib/prompt');
const { installTtyd } = require('../lib/install-ttyd');
const { installServer } = require('../lib/install-server');
const { setupService } = require('../lib/service');
const { renderQR } = require('../lib/qr');
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

  // 5. Set up systemd/launchd service (+ waits for tunnel URL)
  await setupService(config);

  // Final success
  const localUrl = `http://localhost:${config.port}`;
  const primaryUrl = config.domain
    ? `https://${config.domain}`
    : config.tunnelUrl || localUrl;

  const lines = [
    `${color(c.green + c.bold, S.check)}  ${color(c.bold, 'Claude Web Terminal is running!')}`,
    '',
  ];

  if (config.tunnelUrl) {
    // Tunnel URL is the star — show it prominently
    lines.push(`${color(c.cyan, S.pointer)} ${color(c.bold, config.tunnelUrl)}`);
    lines.push(`${color(c.gray, '  Local: ' + localUrl)}`);
    lines.push('');
    lines.push(`${color(c.yellow, S.warn)} ${color(c.dim, 'Tunnel URL changes on restart — for testing only.')}`);
    lines.push(`${color(c.dim, '  Set DOMAIN in .env for a permanent address,')}`);
    lines.push(`${color(c.dim, '  or configure it in Settings > Server Access.')}`);
  } else if (config.tunnel) {
    // Tunnel enabled but URL not detected yet — show fallback commands
    lines.push(`${color(c.cyan, S.pointer)} ${color(c.bold, localUrl)}`);
    lines.push('');
    lines.push(`${color(c.yellow, S.warn)} ${color(c.dim, 'Tunnel is starting — URL not ready yet.')}`);
    lines.push(`${color(c.dim, '  Check in a few seconds:')}`);
    if (process.platform === 'linux') {
      lines.push(`${color(c.gray, '  sudo journalctl -u cloudflared-tunnel --no-pager -n 10 | grep trycloudflare')}`);
    } else {
      lines.push(`${color(c.gray, '  cat ~/.claude-terminal/logs/cloudflared.log | grep trycloudflare')}`);
    }
  } else if (config.domain) {
    lines.push(`${color(c.cyan, S.pointer)} ${color(c.bold, 'https://' + config.domain)}`);
  } else {
    lines.push(`${color(c.cyan, S.pointer)} ${color(c.bold, localUrl)}`);
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

  console.log('\n' + box(lines, { color: c.green }) + '\n');

  // Show QR code for easy mobile access
  if (config.tunnelUrl) {
    try {
      const qrLines = renderQR(config.tunnelUrl);
      console.log(color(c.dim, '  Scan to open on mobile:\n'));
      qrLines.forEach(l => console.log('    ' + l));
      console.log('');
    } catch {
      // QR generation failed silently — URL is already shown above
    }
  }
}

main().catch(err => {
  error(err.message);
  process.exit(1);
});
