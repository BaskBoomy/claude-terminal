export function showToast(msg, duration = 2500) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

export function showConfirm(msg, buttons) {
    const backdrop = document.getElementById('confirm-backdrop');
    const dialog = document.getElementById('confirm-dialog');
    const msgEl = document.getElementById('confirm-msg');
    const actions = document.getElementById('confirm-actions');
    msgEl.textContent = msg;
    actions.innerHTML = '';
    buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.textContent = b.label;
        btn.className = 'confirm-btn' + (b.className ? ' ' + b.className : '');
        if (b.className && b.className.includes('primary')) {
            btn.style.background = '#C15F3C';
        }
        btn.onclick = () => { closeConfirm(); if (b.action) b.action(); };
        actions.appendChild(btn);
    });
    backdrop.onclick = (e) => { if (e.target === backdrop) closeConfirm(); };
    backdrop.classList.add('open');
    dialog.classList.add('open');
}

export function closeConfirm() {
    document.getElementById('confirm-backdrop').classList.remove('open');
    document.getElementById('confirm-dialog').classList.remove('open');
}

export function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function formatDate(ts) {
    const d = new Date(ts + 9 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
}

export function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function colorForPct(pct) {
    if (pct > 80) return '#ff6b6b';
    if (pct > 60) return '#e8b84b';
    return '#8ab563';
}

export function colorForTemp(t) {
    if (t > 70) return '#ff6b6b';
    if (t > 60) return '#e8b84b';
    return '#8ab563';
}
