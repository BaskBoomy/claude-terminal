import { showConfirm, closeConfirm, escapeHtml, formatBytes } from './utils.js';

let treeView, editorView, treeItems, refreshBtn, backBtn;
let fileTitle, editToggle, rendered, textarea;
let editorFooter, editorStatus, sendClaudeBtn;

let brainData = null;
let currentFile = null; // { dir, file, writable }
let isEditing = false;
let saveTimer = null;
let viewSwitcherFn = null;

const CAT_ICONS = {
    memory: '\u{1F9E0}', skills: '\u26A1', agents: '\u{1F916}', rules: '\u{1F4CF}', hooks: '\u{1FA9D}'
};

function formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    return (bytes / 1024).toFixed(1) + 'KB';
}

// --- Simple Markdown renderer ---
function renderMarkdown(md) {
    if (!md) return '';
    var html = md
        // Escape HTML
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        // Code blocks (``` ... ```)
        .replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
            return '<pre><code>' + code.replace(/\n$/, '') + '</code></pre>';
        })
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Headers
        .replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
        .replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
        .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
        .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
        .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
        .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
        // Bold & italic
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Horizontal rule
        .replace(/^---+$/gm, '<hr>')
        // Blockquote
        .replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>')
        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Tables
    html = html.replace(/((?:^\|.+\|$\n?)+)/gm, function(tableBlock) {
        var rows = tableBlock.trim().split('\n').filter(function(r) { return r.trim(); });
        if (rows.length < 2) return tableBlock;
        // Check if second row is separator
        if (!/^\|[\s\-:|]+\|$/.test(rows[1])) return tableBlock;
        var headerCells = rows[0].split('|').filter(function(c) { return c.trim() !== ''; });
        var out = '<table><thead><tr>';
        headerCells.forEach(function(c) { out += '<th>' + c.trim() + '</th>'; });
        out += '</tr></thead><tbody>';
        for (var i = 2; i < rows.length; i++) {
            var cells = rows[i].split('|').filter(function(c) { return c.trim() !== ''; });
            out += '<tr>';
            cells.forEach(function(c) { out += '<td>' + c.trim() + '</td>'; });
            out += '</tr>';
        }
        out += '</tbody></table>';
        return out;
    });

    // Lists (simple)
    html = html.replace(/((?:^[\t ]*[-*]\s+.+$\n?)+)/gm, function(block) {
        var items = block.trim().split('\n');
        var out = '<ul>';
        items.forEach(function(item) {
            out += '<li>' + item.replace(/^[\t ]*[-*]\s+/, '') + '</li>';
        });
        return out + '</ul>';
    });

    // Checkbox lists
    html = html.replace(/<li>\[x\]\s*/gi, '<li style="list-style:none">\u2611 ');
    html = html.replace(/<li>\[ \]\s*/gi, '<li style="list-style:none">\u2610 ');

    // Paragraphs — wrap remaining loose lines
    html = html.replace(/^(?!<[a-z/])((?!^\s*$).+)$/gm, '<p>$1</p>');
    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
}

function renderTree() {
    var ptr = treeItems.querySelector('[data-ptr]');
    treeItems.innerHTML = '';
    if (ptr) treeItems.insertBefore(ptr, treeItems.firstChild);
    brainData.forEach(function(scope) {
        if (!scope.categories.length) return;
        var label = document.createElement('div');
        label.className = 'brain-scope-label';
        label.textContent = scope.label;
        treeItems.appendChild(label);

        scope.categories.forEach(function(cat) {
            var catEl = document.createElement('div');
            catEl.className = 'brain-cat';
            catEl.innerHTML =
                '<span class="brain-cat-icon">' + (CAT_ICONS[cat.name] || '\u{1F4C4}') + '</span>' +
                '<span class="brain-cat-name">' + cat.name + '</span>' +
                '<span class="brain-cat-count">' + cat.files.length + '</span>' +
                '<span class="brain-cat-arrow">\u25B6</span>';
            treeItems.appendChild(catEl);

            var filesEl = document.createElement('div');
            filesEl.className = 'brain-files';
            cat.files.forEach(function(f) {
                var item = document.createElement('div');
                item.className = 'brain-file-item';
                item.innerHTML =
                    '<span class="brain-file-name">' + escapeHtml(f.name) + '</span>' +
                    '<span class="brain-file-size">' + formatSize(f.size) + '</span>';
                item.addEventListener('click', function() {
                    openBrainFile(cat.dir, f.name);
                });
                filesEl.appendChild(item);
            });
            treeItems.appendChild(filesEl);

            catEl.addEventListener('click', function() {
                var open = filesEl.classList.toggle('open');
                catEl.querySelector('.brain-cat-arrow').textContent = open ? '\u25BC' : '\u25B6';
            });
        });
    });
}

export function initBrain() {
    treeView = document.getElementById('brain-tree-view');
    editorView = document.getElementById('brain-editor-view');
    treeItems = document.getElementById('brain-tree-items');
    refreshBtn = document.getElementById('brain-refresh-btn');
    backBtn = document.getElementById('brain-back-btn');
    fileTitle = document.getElementById('brain-file-title');
    editToggle = document.getElementById('brain-edit-toggle');
    rendered = document.getElementById('brain-rendered');
    textarea = document.getElementById('brain-textarea');
    editorFooter = document.getElementById('brain-editor-footer');
    editorStatus = document.getElementById('brain-editor-status');
    sendClaudeBtn = document.getElementById('brain-send-claude-btn');

    refreshBtn.addEventListener('click', function() { loadBrainTree(); });

    editToggle.addEventListener('click', function() {
        isEditing = !isEditing;
        if (isEditing) {
            editToggle.textContent = '\uBBF8\uB9AC\uBCF4\uAE30';
            editToggle.classList.add('editing');
            rendered.style.display = 'none';
            textarea.style.display = 'block';
            editorFooter.style.display = 'flex';
            textarea.focus();
        } else {
            editToggle.textContent = '\uD3B8\uC9D1';
            editToggle.classList.remove('editing');
            rendered.innerHTML = renderMarkdown(textarea.value);
            rendered.style.display = '';
            textarea.style.display = 'none';
            editorFooter.style.display = 'none';
        }
    });

    textarea.addEventListener('input', function() {
        editorStatus.textContent = '\uC218\uC815\uB428';
        editorStatus.classList.remove('saved');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveBrainFile, 1500);
    });

    backBtn.addEventListener('click', function() {
        clearTimeout(saveTimer);
        if (isEditing && editorStatus.textContent === '\uC218\uC815\uB428') {
            saveBrainFile();
        }
        currentFile = null;
        isEditing = false;
        editorView.style.display = 'none';
        treeView.style.display = 'flex';
    });

    // Send to Claude
    sendClaudeBtn.addEventListener('click', function() {
        var content = textarea.value.trim();
        if (!content) return;
        if (isEditing && editorStatus.textContent !== '\uC800\uC7A5\uB428') {
            clearTimeout(saveTimer);
            saveBrainFile();
        }
        fetch('/api/claude-sessions', { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var sessions = data.sessions || [];
                var buttons = [];
                sessions.forEach(function(s) {
                    buttons.push({
                        label: s.title,
                        className: 'secondary',
                        action: function() {
                            fetch('/api/claude-send', {
                                method: 'POST', credentials: 'same-origin',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ target: s.target, text: content })
                            }).then(function(r) {
                                if (r.ok && viewSwitcherFn) viewSwitcherFn('terminal');
                            });
                        }
                    });
                });
                buttons.push({
                    label: '+ \uC0C8 \uC138\uC158', className: 'primary',
                    action: function() {
                        fetch('/api/claude-new', {
                            method: 'POST', credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: content })
                        }).then(function(r) {
                            if (r.ok && viewSwitcherFn) viewSwitcherFn('terminal');
                        });
                    }
                });
                buttons.push({ label: '\uCDE8\uC18C', className: 'cancel' });
                showConfirm(
                    sessions.length ? '\uC804\uC1A1\uD560 Claude \uC138\uC158 (' + sessions.length + '\uAC1C)' : '\uC2E4\uD589 \uC911\uC778 \uC138\uC158 \uC5C6\uC74C',
                    buttons
                );
            });
    });
}

export function loadBrainTree(done) {
    fetch('/api/brain', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            brainData = data.scopes || [];
            renderTree();
            if (done) done();
        })
        .catch(function() {
            var ptr = treeItems.querySelector('[data-ptr]');
            treeItems.innerHTML = '<div style="padding:40px 16px;text-align:center;color:#4a4538">\uB85C\uB4DC \uC2E4\uD328</div>';
            if (ptr) treeItems.insertBefore(ptr, treeItems.firstChild);
            if (done) done();
        });
}

export function openBrainFile(dir, file) {
    var url = '/api/brain/read?dir=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(file);
    fetch(url, { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            currentFile = { dir: dir, file: file, writable: data.writable };
            fileTitle.textContent = file;
            textarea.value = data.content || '';
            rendered.innerHTML = renderMarkdown(data.content || '');
            // Reset to view mode
            isEditing = false;
            editToggle.textContent = '\uD3B8\uC9D1';
            editToggle.classList.remove('editing');
            editToggle.style.display = data.writable ? '' : 'none';
            rendered.style.display = '';
            textarea.style.display = 'none';
            editorFooter.style.display = 'none';
            editorStatus.textContent = '';
            // Switch views
            treeView.style.display = 'none';
            editorView.style.display = 'flex';
        });
}

export function saveBrainFile() {
    if (!currentFile) return;
    editorStatus.textContent = '\uC800\uC7A5 \uC911...';
    fetch('/api/brain/write', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            dir: currentFile.dir,
            file: currentFile.file,
            content: textarea.value
        })
    }).then(function(r) {
        if (r.ok) {
            editorStatus.textContent = '\uC800\uC7A5\uB428';
            editorStatus.classList.add('saved');
        } else {
            editorStatus.textContent = '\uC800\uC7A5 \uC2E4\uD328';
        }
    }).catch(function() {
        editorStatus.textContent = '\uC800\uC7A5 \uC2E4\uD328';
    });
}

export function setViewSwitcher(fn) {
    viewSwitcherFn = fn;
}
