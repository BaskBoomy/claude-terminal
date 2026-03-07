const readline = require('readline');

function ask(rl, question, defaultVal) {
  const display = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
  return new Promise(resolve => {
    rl.question('  ' + display, answer => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function askPassword(rl, question) {
  return new Promise(resolve => {
    process.stdout.write('  ' + question + ': ');
    const stdin = process.stdin;
    const oldRawMode = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);

    let password = '';
    const onData = (ch) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        if (stdin.setRawMode) stdin.setRawMode(oldRawMode);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (c === '\x7f' || c === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c === '\x03') {
        process.exit(0);
      } else {
        password += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
    stdin.resume();
  });
}

async function prompt(checks) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('  Configuration\n');

  const password = await askPassword(rl, 'Password');
  if (!password) {
    console.log('\n  ❌ Password is required');
    process.exit(1);
  }

  const port = await ask(rl, 'Port', '7680');
  const domain = await ask(rl, 'Domain (optional, for HTTPS)', '');
  const installDir = await ask(rl, 'Install directory', `${process.env.HOME}/.claude-terminal`);

  rl.close();

  return {
    password,
    port: parseInt(port, 10) || 7680,
    domain,
    installDir,
  };
}

module.exports = { prompt };
