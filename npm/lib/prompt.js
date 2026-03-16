const readline = require('readline');
const crypto = require('crypto');
const { c, color, S, sectionStart, sectionItem, ask, askPassword, info } = require('./ui');
const { expandTilde, validatePort, isInteractive } = require('./shared');

function generatePassword(len) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
  const bytes = crypto.randomBytes(len);
  let pw = '';
  for (let i = 0; i < len; i++) pw += chars[bytes[i] % chars.length];
  return pw;
}

async function prompt(checks) {
  if (!isInteractive()) {
    throw new Error(
      'Interactive terminal required.\n' +
      '  This installer needs user input. Cannot run in CI, Docker, or piped mode.'
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  sectionStart('Configuration');
  console.log(`  ${color(c.gray, S.bar)}   ${color(c.dim, 'Answer below — press Enter to use defaults')}`);
  console.log(`  ${color(c.gray, S.bar)}`);

  const password = await askPassword('Password (Enter = auto-generate)');
  let finalPassword;
  if (!password) {
    finalPassword = generatePassword(16);
    console.log(`  ${color(c.gray, S.bar)} ${color(c.green, S.check)} Generated: ${color(c.bold, finalPassword)}`);
    console.log(`  ${color(c.gray, S.bar)} ${color(c.dim, 'Save this password — you\'ll need it to log in')}`);
  } else {
    // Sanitize: strip control characters
    finalPassword = password.replace(/[\n\r\x00-\x1f]/g, '');
  }

  const portRaw = await ask(rl, 'Port', '7680');
  const ttydPortRaw = await ask(rl, 'ttyd port', '7681');

  const claudeCmd = await ask(rl, 'Claude command', 'claude');
  // Validate: only safe characters for command name
  if (claudeCmd && !/^[a-zA-Z0-9_.\/\-]+$/.test(claudeCmd)) {
    throw new Error(
      'Invalid claude command — only alphanumeric, dots, slashes, hyphens, underscores allowed.\n' +
      `  Got: ${claudeCmd}`
    );
  }

  const domain = await ask(rl, 'Domain', '');

  let tunnel = false;
  if (!domain) {
    console.log(`  ${color(c.gray, S.bar)}`);
    console.log(`  ${color(c.gray, S.barT)} ${color(c.cyan, S.info)} ${color(c.dim, 'No domain? Enable Cloudflare Tunnel for instant')}`);
    console.log(`  ${color(c.gray, S.bar)}   ${color(c.dim, 'HTTPS access from anywhere (test/demo only).')}`);
    console.log(`  ${color(c.gray, S.bar)}   ${color(c.yellow, S.warn)} ${color(c.dim, 'URL changes on service restart.')}`);
    const tunnelAnswer = await ask(rl, 'Enable tunnel?', 'Y');
    tunnel = !tunnelAnswer.toLowerCase().startsWith('n');
  }

  const installDirRaw = await ask(rl, 'Install directory', `${process.env.HOME || require('os').homedir()}/.claude-terminal`);
  const installDir = expandTilde(installDirRaw);

  rl.close();
  console.log('');

  return {
    password: finalPassword,
    port: validatePort(portRaw, 7680),
    ttydPort: validatePort(ttydPortRaw, 7681),
    claudeCmd,
    domain,
    tunnel,
    installDir,
  };
}

module.exports = { prompt };
