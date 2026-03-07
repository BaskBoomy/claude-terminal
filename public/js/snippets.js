import { sendText, sendKey, tmuxCmd } from './terminal.js';
import { showConfirm, closeConfirm } from './utils.js';

export const SNIPPET_COLORS = {
    default: { bg: '#2a251d', fg: '#e8e6e3', border: '#3a352b' },
    green:   { bg: '#4caf50', fg: '#1a1815', border: '#4caf50' },
    blue:    { bg: '#C15F3C', fg: '#fff',    border: '#C15F3C' },
    red:     { bg: '#ff6b6b', fg: '#1a1815', border: '#ff6b6b' },
    yellow:  { bg: '#f9e2af', fg: '#1a1815', border: '#f9e2af' },
    purple:  { bg: '#cba6f7', fg: '#1a1815', border: '#cba6f7' },
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
                showConfirm('Run: ' + sn.command + '?', [
                    { label: '\uc2e4\ud589', style: 'primary', action: () => runCmd(sn) },
                    { label: '\ucde8\uc18c', style: 'cancel' }
                ]);
                return;
            }
            runCmd(sn);
        });
        container.appendChild(btn);
    });
}
