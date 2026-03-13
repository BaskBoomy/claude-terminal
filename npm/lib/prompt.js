const readline = require('readline');
const crypto = require('crypto');
const { c, color, S, sectionStart, sectionItem, ask, askPassword, info } = require('./ui');

function generatePassword(len) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
  const bytes = crypto.randomBytes(len);
  let pw = '';
  for (let i = 0; i < len; i++) pw += chars[bytes[i] % chars.length];
  return pw;
}

async function prompt(checks) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  sectionStart('Configuration');

  const password = await askPassword('Password (Enter = auto-generate)');
  let finalPassword;
  if (!password) {
    finalPassword = generatePassword(16);
    console.log(`  ${color(c.gray, S.bar)} ${color(c.green, S.check)} Generated: ${color(c.bold, finalPassword)}`);
    console.log(`  ${color(c.gray, S.bar)} ${color(c.dim, 'Save this password — you\'ll need it to log in')}`);
  } else {
    finalPassword = password;
  }

  const port = await ask(rl, 'Port', '7680');
  const ttydPort = await ask(rl, 'ttyd port', '7681');
  const claudeCmd = await ask(rl, 'Claude command', 'claude');
  const domain = await ask(rl, 'Domain (optional)', '');

  let tunnel = false;
  if (!domain) {
    console.log(`  ${color(c.gray, S.bar)}`);
    console.log(`  ${color(c.gray, S.barT)} ${color(c.cyan, S.info)} ${color(c.dim, 'No domain? Enable Cloudflare Tunnel for instant')}`);
    console.log(`  ${color(c.gray, S.bar)}   ${color(c.dim, 'HTTPS access from anywhere (test/demo only).')}`);
    console.log(`  ${color(c.gray, S.bar)}   ${color(c.yellow, S.warn)} ${color(c.dim, 'URL changes on service restart.')}`);
    const tunnelAnswer = await ask(rl, 'Enable tunnel?', 'Y');
    tunnel = tunnelAnswer.toLowerCase() !== 'n';
  }

  const installDir = await ask(rl, 'Install directory', `${process.env.HOME}/.claude-terminal`);

  rl.close();
  console.log('');

  return {
    password: finalPassword,
    port: parseInt(port, 10) || 7680,
    ttydPort: parseInt(ttydPort, 10) || 7681,
    claudeCmd,
    domain,
    tunnel,
    installDir,
  };
}

module.exports = { prompt };
