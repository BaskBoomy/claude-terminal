#!/usr/bin/env node

const { checkPrerequisites } = require('../lib/prerequisites');
const { prompt } = require('../lib/prompt');
const { installTtyd } = require('../lib/install-ttyd');
const { installServer } = require('../lib/install-server');
const { setupService } = require('../lib/service');

const BANNER = `
   _____ _                 _        _____                   _             _
  / ____| |               | |      |_   _|                 (_)           | |
 | |    | | __ _ _   _  __| | ___    | |  ___ _ __ _ __ ___ _ _ __   __ _| |
 | |    | |/ _\` | | | |/ _\` |/ _ \\   | | / _ \\ '__| '_ \` _ \\ | '_ \\ / _\` | |
 | |____| | (_| | |_| | (_| |  __/   | ||  __/ |  | | | | | | | | | (_| | |
  \\_____|_|\\__,_|\\__,_|\\__,_|\\___|   \\_/ \\___|_|  |_| |_| |_|_|_| |_|\\__,_|_|
`;

async function main() {
  console.log(BANNER);
  console.log('  Access Claude Code from anywhere via browser\n');

  // 1. Check prerequisites
  const checks = checkPrerequisites();
  if (!checks.ok) {
    process.exit(1);
  }

  // 2. Interactive prompts
  const config = await prompt(checks);

  // 3. Install ttyd if needed
  if (!checks.ttyd) {
    await installTtyd();
  }

  // 4. Download and install Go server binary
  await installServer(config);

  // 5. Set up systemd/launchd service
  await setupService(config);

  console.log('\n  ✅ Claude Terminal is running!\n');
  if (config.domain) {
    console.log(`  🌐 https://${config.domain}\n`);
  } else {
    console.log(`  🌐 http://localhost:${config.port}\n`);
    console.log('  Tip: Access from other devices on your network:');
    console.log(`       http://<your-ip>:${config.port}\n`);
  }
  console.log('  Commands:');
  console.log('    sudo systemctl status claude-terminal');
  console.log('    sudo systemctl restart claude-terminal');
  console.log('    journalctl -u claude-terminal -f\n');
}

main().catch(err => {
  console.error('\n  ❌ Error:', err.message);
  process.exit(1);
});
