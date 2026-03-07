const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

  // ttyd service
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

  // claude-terminal service
  const ctService = `[Unit]
Description=Claude Terminal - Web UI for Claude Code
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

  console.log('\n  Setting up systemd services...');

  const ttydServicePath = '/tmp/ttyd.service';
  const ctServicePath = '/tmp/claude-terminal.service';
  fs.writeFileSync(ttydServicePath, ttydService);
  fs.writeFileSync(ctServicePath, ctService);

  try {
    execSync(`sudo cp ${ttydServicePath} /etc/systemd/system/ttyd.service`, { stdio: 'inherit' });
    execSync(`sudo cp ${ctServicePath} /etc/systemd/system/claude-terminal.service`, { stdio: 'inherit' });
    execSync('sudo systemctl daemon-reload', { stdio: 'inherit' });
    execSync('sudo systemctl enable ttyd claude-terminal', { stdio: 'inherit' });
    execSync('sudo systemctl start ttyd', { stdio: 'inherit' });
    // Small delay for ttyd to start
    execSync('sleep 1');
    execSync('sudo systemctl start claude-terminal', { stdio: 'inherit' });
    console.log('  ✅ systemd services enabled and started');
  } catch (err) {
    console.log('  ⚠️  Could not set up systemd. Start manually:');
    console.log(`     ${ttydPath} -p ${ttydPort} -W -b /ttyd ${scriptPath} &`);
    console.log(`     PORT=${config.port} ${binPath} &`);
  }

  fs.unlinkSync(ttydServicePath);
  fs.unlinkSync(ctServicePath);
}

async function setupLaunchd(config, user) {
  const { installDir, port } = config;
  const binPath = path.join(installDir, 'claude-terminal');
  const ttydPath = findBinary('ttyd');
  const scriptPath = path.join(installDir, 'ttyd-start.sh');

  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(launchAgentsDir, { recursive: true });

  // ttyd plist
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

  // claude-terminal plist
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

  console.log('\n  Setting up launchd services...');

  const ttydPlistPath = path.join(launchAgentsDir, 'com.claude-terminal.ttyd.plist');
  const ctPlistPath = path.join(launchAgentsDir, 'com.claude-terminal.plist');

  fs.writeFileSync(ttydPlistPath, ttydPlist);
  fs.writeFileSync(ctPlistPath, ctPlist);

  try {
    execSync(`launchctl load ${ttydPlistPath}`, { stdio: 'inherit' });
    execSync(`launchctl load ${ctPlistPath}`, { stdio: 'inherit' });
    console.log('  ✅ launchd services loaded');
  } catch {
    console.log('  ⚠️  Could not load launchd services. Load manually:');
    console.log(`     launchctl load ${ttydPlistPath}`);
    console.log(`     launchctl load ${ctPlistPath}`);
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
