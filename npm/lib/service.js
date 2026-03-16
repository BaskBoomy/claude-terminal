const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { c, color, S, createSpinner, exec, sectionStart, sectionItem, sectionEnd } = require('./ui');
const { shellQuote, xmlEscape, isPortAvailable } = require('./shared');

function getUser() {
  // Prefer SUDO_USER to avoid services running as root when installed via sudo
  return process.env.SUDO_USER || os.userInfo().username;
}

function findBinary(name) {
  try {
    return execSync(`which ${name}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    // Check common locations before giving up
    const commonPaths = [
      `/usr/local/bin/${name}`,
      `/usr/bin/${name}`,
      `/opt/homebrew/bin/${name}`,
      `${os.homedir()}/.local/bin/${name}`,
    ];
    for (const p of commonPaths) {
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
    }
    throw new Error(`Binary '${name}' not found. Install it first.`);
  }
}

/** Quote a path for systemd service files (uses C-style double quotes). */
function systemdQuote(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

async function setupService(config) {
  const { installDir, port } = config;
  const user = getUser();

  // Pre-flight: check port availability
  const portsToCheck = [config.port, config.ttydPort];
  for (const p of portsToCheck) {
    if (!await isPortAvailable(p)) {
      throw new Error(
        `Port ${p} is already in use.\n` +
        `  Stop the existing service or choose a different port.`
      );
    }
  }

  if (process.platform === 'linux') {
    await setupSystemd(config, user);
  } else if (process.platform === 'darwin') {
    await setupLaunchd(config, user);
  }

  // Wait for tunnel URL if tunnel enabled
  if (config.tunnel) {
    config.tunnelUrl = await waitForTunnelUrl(config);
  }
}

async function setupSystemd(config, user) {
  const { installDir, port, ttydPort } = config;
  const ttydPath = findBinary('ttyd');
  const binPath = path.join(installDir, 'claude-terminal');
  const scriptPath = path.join(installDir, 'ttyd-start.sh');

  const ttydService = `[Unit]
Description=ttyd - Web Terminal for Claude Code
After=network.target

[Service]
Type=simple
User=${user}
ExecStart=${systemdQuote(ttydPath)} -p ${ttydPort} -W -b /ttyd ${systemdQuote(scriptPath)}
Restart=on-failure
RestartSec=5
Environment="CLAUDE_CMD=${config.claudeCmd || 'claude'}"

[Install]
WantedBy=multi-user.target
`;

  const ctService = `[Unit]
Description=Claude Web Terminal - Access Claude Code via Browser
After=network.target ttyd.service

[Service]
Type=simple
User=${user}
WorkingDirectory=${systemdQuote(installDir)}
ExecStart=${systemdQuote(binPath)}
Restart=on-failure
RestartSec=5
Environment="PORT=${config.port}"

[Install]
WantedBy=multi-user.target
`;

  sectionStart('Service Setup');

  // Write service files to installDir (not /tmp) for security
  const ttydServicePath = path.join(installDir, 'ttyd.service');
  const ctServicePath = path.join(installDir, 'claude-terminal.service');
  fs.writeFileSync(ttydServicePath, ttydService, { mode: 0o600 });
  fs.writeFileSync(ctServicePath, ctService, { mode: 0o600 });

  const spinner = createSpinner('Configuring systemd services...').start();

  try {
    // Gracefully stop existing services before replacing
    await exec('sudo systemctl stop claude-terminal 2>/dev/null || true', { timeout: 15000 });
    await exec('sudo systemctl stop ttyd 2>/dev/null || true', { timeout: 15000 });

    await exec(`sudo cp ${shellQuote(ttydServicePath)} /etc/systemd/system/ttyd.service`);
    await exec(`sudo cp ${shellQuote(ctServicePath)} /etc/systemd/system/claude-terminal.service`);
    spinner.update('Reloading daemon...');
    await exec('sudo systemctl daemon-reload');
    spinner.update('Enabling services...');
    await exec('sudo systemctl enable ttyd claude-terminal');
    spinner.update('Starting ttyd...');
    await exec('sudo systemctl start ttyd');

    // Wait for ttyd port to be ready (instead of hardcoded sleep)
    spinner.update('Waiting for ttyd...');
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      const available = await isPortAvailable(config.ttydPort);
      if (!available) break; // Port taken = ttyd is listening
    }

    spinner.update('Starting claude-terminal...');
    await exec('sudo systemctl start claude-terminal');

    // Health check
    await new Promise(r => setTimeout(r, 2000));
    try {
      const status = execSync('systemctl is-active claude-terminal', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (status === 'active') {
        spinner.succeed('systemd services enabled & started');
      } else {
        spinner.warn('Services started but may not be healthy');
        sectionItem(color(c.dim, S.info), color(c.dim, 'Check: journalctl -u claude-terminal -n 20'));
      }
    } catch {
      spinner.warn('Services started but status unknown');
    }
  } catch (err) {
    spinner.warn('Could not auto-start services');
    sectionItem(color(c.dim, S.info), color(c.dim, 'Start manually:'));
    sectionItem(color(c.dim, ' '), color(c.gray, `${ttydPath} -p ${ttydPort} -W -b /ttyd ${scriptPath} &`));
    sectionEnd(color(c.dim, ' '), color(c.gray, `PORT=${config.port} ${binPath} &`));
  }

  // Clean up service files from installDir
  try { fs.unlinkSync(ttydServicePath); } catch {}
  try { fs.unlinkSync(ctServicePath); } catch {}

  // Cloudflare Tunnel service
  if (config.tunnel) {
    let cloudflaredPath;
    try {
      cloudflaredPath = findBinary('cloudflared');
    } catch {
      sectionItem(color(c.red, S.cross), 'cloudflared not found — tunnel service skipped');
      return;
    }

    const cfService = `[Unit]
Description=Cloudflare Tunnel for Claude Terminal
After=claude-terminal.service

[Service]
Type=simple
User=${user}
ExecStart=${systemdQuote(cloudflaredPath)} tunnel --url http://localhost:${config.port} --no-autoupdate
Restart=on-failure
RestartSec=10
StandardOutput=journal

[Install]
WantedBy=multi-user.target
`;
    const cfServicePath = path.join(installDir, 'cloudflared-tunnel.service');
    fs.writeFileSync(cfServicePath, cfService, { mode: 0o600 });

    const cfSpinner = createSpinner('Configuring cloudflared tunnel...').start();
    try {
      await exec(`sudo cp ${shellQuote(cfServicePath)} /etc/systemd/system/cloudflared-tunnel.service`);
      await exec('sudo systemctl daemon-reload');
      await exec('sudo systemctl enable cloudflared-tunnel');
      await exec('sudo systemctl restart cloudflared-tunnel');
      cfSpinner.succeed('cloudflared tunnel enabled & started');
    } catch {
      cfSpinner.warn('Could not auto-start cloudflared tunnel');
      sectionItem(color(c.dim, S.info), color(c.dim, 'Start manually:'));
      sectionEnd(color(c.dim, ' '), color(c.gray, `${cloudflaredPath} tunnel --url http://localhost:${config.port}`));
    }
    try { fs.unlinkSync(cfServicePath); } catch {}
  }
}

async function setupLaunchd(config, user) {
  const { installDir, port } = config;
  const binPath = path.join(installDir, 'claude-terminal');
  const ttydPath = findBinary('ttyd');
  const scriptPath = path.join(installDir, 'ttyd-start.sh');
  const logDir = path.join(installDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(launchAgentsDir, { recursive: true });

  const ttydPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.claude-terminal.ttyd</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xmlEscape(ttydPath)}</string>
        <string>-p</string><string>${config.ttydPort}</string>
        <string>-W</string>
        <string>-b</string><string>/ttyd</string>
        <string>${xmlEscape(scriptPath)}</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>`;

  const ctPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.claude-terminal</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xmlEscape(binPath)}</string>
    </array>
    <key>WorkingDirectory</key><string>${xmlEscape(installDir)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key><string>${port}</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>`;

  sectionStart('Service Setup');

  const ttydPlistPath = path.join(launchAgentsDir, 'com.claude-terminal.ttyd.plist');
  const ctPlistPath = path.join(launchAgentsDir, 'com.claude-terminal.plist');

  fs.writeFileSync(ttydPlistPath, ttydPlist);
  fs.writeFileSync(ctPlistPath, ctPlist);

  const uid = process.getuid ? process.getuid() : 501;
  const domain = `gui/${uid}`;

  const spinner = createSpinner('Configuring launchd services...').start();

  try {
    // Unload existing services first (ignore errors if not loaded)
    await exec(`launchctl bootout ${domain}/${path.basename(ttydPlistPath, '.plist')} 2>/dev/null || true`);
    await exec(`launchctl bootout ${domain}/${path.basename(ctPlistPath, '.plist')} 2>/dev/null || true`);

    await exec(`launchctl bootstrap ${domain} ${shellQuote(ttydPlistPath)}`);
    spinner.update('Loading claude-terminal...');
    await exec(`launchctl bootstrap ${domain} ${shellQuote(ctPlistPath)}`);
    spinner.succeed('launchd services loaded');
  } catch {
    spinner.warn('Could not load services');
    sectionItem(color(c.dim, S.info), color(c.dim, 'Load manually:'));
    sectionItem(color(c.dim, ' '), color(c.gray, `launchctl bootstrap ${domain} ${ttydPlistPath}`));
    sectionEnd(color(c.dim, ' '), color(c.gray, `launchctl bootstrap ${domain} ${ctPlistPath}`));
  }

  // Cloudflare Tunnel launchd service (with log file for URL detection)
  if (config.tunnel) {
    let cloudflaredPath;
    try {
      cloudflaredPath = findBinary('cloudflared');
    } catch {
      sectionItem(color(c.red, S.cross), 'cloudflared not found — tunnel service skipped');
      return;
    }

    const cfLogPath = path.join(logDir, 'cloudflared.log');
    config._cfLogPath = cfLogPath;

    const cfPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.claude-terminal.cloudflared</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xmlEscape(cloudflaredPath)}</string>
        <string>tunnel</string>
        <string>--url</string><string>http://localhost:${config.port}</string>
        <string>--no-autoupdate</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${xmlEscape(cfLogPath)}</string>
    <key>StandardErrorPath</key><string>${xmlEscape(cfLogPath)}</string>
</dict>
</plist>`;

    const cfPlistPath = path.join(launchAgentsDir, 'com.claude-terminal.cloudflared.plist');
    fs.writeFileSync(cfPlistPath, cfPlist);

    // Clear old log so we only read the new tunnel URL
    fs.writeFileSync(cfLogPath, '');

    const cfSpinner = createSpinner('Configuring cloudflared tunnel...').start();
    try {
      await exec(`launchctl bootout ${domain}/com.claude-terminal.cloudflared 2>/dev/null || true`);
      await exec(`launchctl bootstrap ${domain} ${shellQuote(cfPlistPath)}`);
      cfSpinner.succeed('cloudflared tunnel loaded');
    } catch {
      cfSpinner.warn('Could not load cloudflared tunnel');
      sectionEnd(color(c.dim, ' '), color(c.gray, `launchctl bootstrap ${domain} ${cfPlistPath}`));
    }
  }
}

/**
 * Wait for cloudflared to establish tunnel and return the URL.
 * Polls logs for up to 30 seconds.
 */
async function waitForTunnelUrl(config) {
  const spinner = createSpinner('Waiting for tunnel URL...').start();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    spinner.update(`Waiting for tunnel URL... (${i + 1}s)`);

    const url = parseTunnelUrl(config);
    if (url) {
      spinner.succeed(`Tunnel URL ready`);
      return url;
    }
  }

  spinner.warn('Tunnel URL not detected yet');
  return null;
}

/**
 * Parse tunnel URL from logs (systemd journal or launchd log file).
 * Supports trycloudflare.com and cfargotunnel.com domains.
 */
function parseTunnelUrl(config) {
  let logText = '';

  if (process.platform === 'linux') {
    try {
      logText = execSync(
        'sudo journalctl -u cloudflared-tunnel --no-pager -n 50 --output=cat 2>/dev/null',
        { encoding: 'utf8', timeout: 5000 }
      );
    } catch {}
  } else if (config._cfLogPath) {
    try {
      logText = fs.readFileSync(config._cfLogPath, 'utf8');
    } catch {}
  }

  let found = null;
  for (const line of logText.split('\n')) {
    const idx = line.indexOf('https://');
    if (idx >= 0) {
      let url = line.substring(idx);
      // Match cloudflare tunnel domains
      if (url.includes('trycloudflare.com') || url.includes('cfargotunnel.com')) {
        const sp = url.search(/[\s"']/);
        if (sp >= 0) url = url.substring(0, sp);
        found = url;
      }
    }
  }
  return found;
}

module.exports = { setupService };
