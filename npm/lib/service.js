const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { c, color, S, createSpinner, exec, sectionStart, sectionItem, sectionEnd } = require('./ui');

function getUser() {
  return os.userInfo().username;
}

async function setupService(config) {
  const { installDir, port } = config;
  const user = getUser();

  if (process.platform === 'linux') {
    await setupSystemd(config, user);
  } else if (process.platform === 'darwin') {
    await setupLaunchd(config, user);
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
ExecStart=${ttydPath} -p ${ttydPort} -W -b /ttyd ${scriptPath}
Restart=on-failure
RestartSec=5
Environment=CLAUDE_CMD=${config.claudeCmd || 'claude'}

[Install]
WantedBy=multi-user.target
`;

  const ctService = `[Unit]
Description=Claude Web Terminal - Access Claude Code via Browser
After=network.target ttyd.service

[Service]
Type=simple
User=${user}
WorkingDirectory=${installDir}
ExecStart=${binPath}
Restart=on-failure
RestartSec=5
Environment=PORT=${config.port}

[Install]
WantedBy=multi-user.target
`;

  sectionStart('Service Setup');

  const ttydServicePath = '/tmp/ttyd.service';
  const ctServicePath = '/tmp/claude-terminal.service';
  fs.writeFileSync(ttydServicePath, ttydService);
  fs.writeFileSync(ctServicePath, ctService);

  const spinner = createSpinner('Configuring systemd services...').start();

  try {
    await exec(`sudo cp ${ttydServicePath} /etc/systemd/system/ttyd.service`);
    await exec(`sudo cp ${ctServicePath} /etc/systemd/system/claude-terminal.service`);
    spinner.update('Reloading daemon...');
    await exec('sudo systemctl daemon-reload');
    spinner.update('Enabling services...');
    await exec('sudo systemctl enable ttyd claude-terminal');
    spinner.update('Starting ttyd...');
    await exec('sudo systemctl start ttyd');
    spinner.update('Starting claude-terminal...');
    await exec('sleep 1 && sudo systemctl start claude-terminal');
    spinner.succeed('systemd services enabled & started');
  } catch (err) {
    spinner.warn('Could not auto-start services');
    sectionItem(color(c.dim, S.info), color(c.dim, 'Start manually:'));
    sectionItem(color(c.dim, ' '), color(c.gray, `${ttydPath} -p ${ttydPort} -W -b /ttyd ${scriptPath} &`));
    sectionEnd(color(c.dim, ' '), color(c.gray, `PORT=${config.port} ${binPath} &`));
  }

  fs.unlinkSync(ttydServicePath);
  fs.unlinkSync(ctServicePath);

  // Cloudflare Tunnel service
  if (config.tunnel) {
    const cloudflaredPath = findBinary('cloudflared');
    const cfService = `[Unit]
Description=Cloudflare Tunnel for Claude Terminal
After=claude-terminal.service

[Service]
Type=simple
User=${user}
ExecStart=${cloudflaredPath} tunnel --url http://localhost:${config.port} --no-autoupdate
Restart=on-failure
RestartSec=10
StandardOutput=journal

[Install]
WantedBy=multi-user.target
`;
    const cfServicePath = '/tmp/cloudflared-tunnel.service';
    fs.writeFileSync(cfServicePath, cfService);

    const cfSpinner = createSpinner('Configuring cloudflared tunnel...').start();
    try {
      await exec(`sudo cp ${cfServicePath} /etc/systemd/system/cloudflared-tunnel.service`);
      await exec('sudo systemctl daemon-reload');
      await exec('sudo systemctl enable cloudflared-tunnel');
      await exec('sudo systemctl start cloudflared-tunnel');
      cfSpinner.succeed('cloudflared tunnel enabled & started');
    } catch {
      cfSpinner.warn('Could not auto-start cloudflared tunnel');
      sectionItem(color(c.dim, S.info), color(c.dim, 'Start manually:'));
      sectionEnd(color(c.dim, ' '), color(c.gray, `${cloudflaredPath} tunnel --url http://localhost:${config.port}`));
    }
    fs.unlinkSync(cfServicePath);
  }
}

async function setupLaunchd(config, user) {
  const { installDir, port } = config;
  const binPath = path.join(installDir, 'claude-terminal');
  const ttydPath = findBinary('ttyd');
  const scriptPath = path.join(installDir, 'ttyd-start.sh');

  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(launchAgentsDir, { recursive: true });

  const ttydPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.claude-terminal.ttyd</string>
    <key>ProgramArguments</key>
    <array>
        <string>${ttydPath}</string>
        <string>-p</string><string>${config.ttydPort}</string>
        <string>-W</string>
        <string>-b</string><string>/ttyd</string>
        <string>${scriptPath}</string>
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
        <string>${binPath}</string>
    </array>
    <key>WorkingDirectory</key><string>${installDir}</string>
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

  const spinner = createSpinner('Configuring launchd services...').start();

  try {
    await exec(`launchctl load ${ttydPlistPath}`);
    spinner.update('Loading claude-terminal...');
    await exec(`launchctl load ${ctPlistPath}`);
    spinner.succeed('launchd services loaded');
  } catch {
    spinner.warn('Could not load services');
    sectionItem(color(c.dim, S.info), color(c.dim, 'Load manually:'));
    sectionItem(color(c.dim, ' '), color(c.gray, `launchctl load ${ttydPlistPath}`));
    sectionEnd(color(c.dim, ' '), color(c.gray, `launchctl load ${ctPlistPath}`));
  }

  // Cloudflare Tunnel launchd service
  if (config.tunnel) {
    const cloudflaredPath = findBinary('cloudflared');
    const cfPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.claude-terminal.cloudflared</string>
    <key>ProgramArguments</key>
    <array>
        <string>${cloudflaredPath}</string>
        <string>tunnel</string>
        <string>--url</string><string>http://localhost:${config.port}</string>
        <string>--no-autoupdate</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>`;

    const cfPlistPath = path.join(launchAgentsDir, 'com.claude-terminal.cloudflared.plist');
    fs.writeFileSync(cfPlistPath, cfPlist);

    const cfSpinner = createSpinner('Configuring cloudflared tunnel...').start();
    try {
      await exec(`launchctl load ${cfPlistPath}`);
      cfSpinner.succeed('cloudflared tunnel loaded');
    } catch {
      cfSpinner.warn('Could not load cloudflared tunnel');
      sectionEnd(color(c.dim, ' '), color(c.gray, `launchctl load ${cfPlistPath}`));
    }
  }
}

function findBinary(name) {
  try {
    return execSync(`which ${name}`, { encoding: 'utf8' }).trim();
  } catch {
    return name;
  }
}

module.exports = { setupService };
