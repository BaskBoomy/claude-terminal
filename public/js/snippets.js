import { sendText, sendKey, tmuxCmd } from './terminal.js';
import { showConfirm, closeConfirm } from './utils.js';
import { t } from './i18n.js';
import { T } from './theme.js';

export const SNIPPET_COLORS = {
    get default() { return { bg: T.bgRaised(), fg: T.text(), border: T.border() }; },
    green:   { bg: '#4caf50', fg: '#1A1917', border: '#4caf50' },
    get blue() { return { bg: T.accent(), fg: T.white(), border: T.accent() }; },
    get red() { return { bg: T.danger(), fg: '#1A1917', border: T.danger() }; },
    yellow:  { bg: '#f9e2af', fg: '#1A1917', border: '#f9e2af' },
    purple:  { bg: '#cba6f7', fg: '#1A1917', border: '#cba6f7' },
    teal:    { bg: '#388e3c', fg: '#fff',    border: '#388e3c' },
};

function runCmd(snippet) {
    if (snippet.newWindow) {
        tmuxCmd('c', 67); // Ctrl-B c = new window
        setTimeout(() => { sendText(snippet.command + '\r'); }, 200);
    } else {
        sendText(snippet.command + '\r');
    }
}

export function renderSnippets(snippets) {
    const container = document.getElementById('snippet-btns');
    container.innerHTML = '';
    snippets.forEach((sn) => {
        if (sn.hidden) return;
        const btn = document.createElement('button');
        btn.className = 'tool-btn';
        btn.textContent = sn.label;
        const colors = SNIPPET_COLORS[sn.color] || SNIPPET_COLORS.default;
        btn.style.background = colors.bg;
        btn.style.color = colors.fg;
        btn.style.borderColor = colors.border;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (sn.confirm) {
                showConfirm(t('snippets.runConfirm', { cmd: sn.command }), [
                    { label: t('snippets.run'), style: 'primary', action: () => runCmd(sn) },
                    { label: t('common.cancel'), style: 'cancel' }
                ]);
                return;
            }
            runCmd(sn);
        });
        container.appendChild(btn);
    });
}
