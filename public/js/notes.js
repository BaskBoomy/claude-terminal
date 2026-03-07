import { showToast, showConfirm, closeConfirm, escapeHtml, formatDate } from './utils.js';

// --- DOM refs ---
let notesContainer;
let notesListView;
let notesEditorView;
let notesItems;
let notesNewBtn;
let notesBackBtn;
let notesTitleInput;
let notesEditorTextarea;
let notesEditorStatus;
let notesDeleteBtn;
let notesSendClaudeBtn;

// --- State ---
let notesSaveTimer = null;
let notesListLoaded = false;
let currentNoteId = null;
let _switchView = null;

/**
 * Set a callback to switch the main view (e.g. to 'terminal').
 * Called after sending a note to Claude.
 */
export function setViewSwitcher(fn) {
    _switchView = fn;
}

function formatNoteDate(ts) {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
}

function renderNotesList(notes) {
    if (!notes.length) {
        notesItems.innerHTML = '<div class="note-item-empty">메모가 없습니다</div>';
        return;
    }
    notesItems.innerHTML = '';
    notes.forEach(n => {
        const el = document.createElement('div');
        el.className = 'note-item';
        el.innerHTML =
            '<div class="note-item-title">' + escapeHtml(n.title || '제목 없음') + '</div>' +
            '<div class="note-item-preview">' + escapeHtml(n.preview || '') + '</div>' +
            '<div class="note-item-date">' + formatNoteDate(n.updatedAt) + '</div>';
        el.addEventListener('click', () => openNote(n.id));
        notesItems.appendChild(el);
    });
}

function scheduleNoteSave() {
    notesEditorStatus.textContent = '수정됨';
    notesEditorStatus.classList.remove('saved');
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(saveCurrentNote, 1500);
}

// --- Exported functions ---

export function initNotes() {
    notesContainer = document.getElementById('notes-container');
    notesListView = document.getElementById('notes-list-view');
    notesEditorView = document.getElementById('notes-editor-view');
    notesItems = document.getElementById('notes-items');
    notesNewBtn = document.getElementById('notes-new-btn');
    notesBackBtn = document.getElementById('notes-back-btn');
    notesTitleInput = document.getElementById('notes-title-input');
    notesEditorTextarea = document.getElementById('notes-editor-textarea');
    notesEditorStatus = document.getElementById('notes-editor-status');
    notesDeleteBtn = document.getElementById('notes-delete-btn');
    notesSendClaudeBtn = document.getElementById('notes-send-claude-btn');

    // Auto-save on input
    notesEditorTextarea.addEventListener('input', scheduleNoteSave);
    notesTitleInput.addEventListener('input', scheduleNoteSave);

    // Back button
    notesBackBtn.addEventListener('click', () => {
        clearTimeout(notesSaveTimer);
        if (currentNoteId && notesEditorStatus.textContent !== '저장됨') {
            saveCurrentNote();
        }
        currentNoteId = null;
        notesEditorView.style.display = 'none';
        notesListView.style.display = 'flex';
        loadNotesList();
    });

    // New note
    notesNewBtn.addEventListener('click', () => {
        fetch('/api/notes', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: '', content: '' })
        })
            .then(r => r.json())
            .then(data => {
                if (data.id) openNote(data.id);
            });
    });

    // Delete note
    notesDeleteBtn.addEventListener('click', () => {
        if (!currentNoteId) return;
        showConfirm('이 메모를 삭제하시겠습니까?', [
            {
                label: '삭제', className: 'primary', action: () => {
                    fetch('/api/notes/' + currentNoteId, {
                        method: 'DELETE',
                        credentials: 'same-origin'
                    }).then(() => {
                        currentNoteId = null;
                        notesEditorView.style.display = 'none';
                        notesListView.style.display = 'flex';
                        loadNotesList();
                    });
                }
            },
            { label: '취소', className: 'cancel' }
        ]);
    });

    // Send to Claude
    notesSendClaudeBtn.addEventListener('click', () => sendNoteToClaudeDialog());
}

export function loadNotesList() {
    fetch('/api/notes', { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => {
            notesListLoaded = true;
            renderNotesList(data.notes || []);
        })
        .catch(() => { notesListLoaded = true; });
}

export function openNote(id) {
    fetch('/api/notes/' + id, { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => {
            currentNoteId = id;
            notesTitleInput.value = data.title || '';
            notesEditorTextarea.value = data.content || '';
            notesEditorStatus.textContent = '저장됨';
            notesEditorStatus.classList.add('saved');
            notesListView.style.display = 'none';
            notesEditorView.style.display = 'flex';
        });
}

export function saveCurrentNote() {
    if (!currentNoteId) return;
    notesEditorStatus.textContent = '저장 중...';
    notesEditorStatus.classList.remove('saved');
    fetch('/api/notes/' + currentNoteId, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: notesTitleInput.value,
            content: notesEditorTextarea.value
        })
    }).then(r => {
        if (r.ok) {
            notesEditorStatus.textContent = '저장됨';
            notesEditorStatus.classList.add('saved');
        } else {
            notesEditorStatus.textContent = '저장 실패';
            notesEditorStatus.classList.remove('saved');
        }
    }).catch(() => {
        notesEditorStatus.textContent = '저장 실패';
        notesEditorStatus.classList.remove('saved');
    });
}

export function sendNoteToClaudeDialog() {
    const title = notesTitleInput.value.trim();
    const content = notesEditorTextarea.value.trim();
    if (!content) return;

    // Save before sending
    if (notesEditorStatus.textContent !== '저장됨') {
        clearTimeout(notesSaveTimer);
        saveCurrentNote();
    }

    const noteText = '--- Note: ' + (title || '제목 없음') + ' ---\n' + content;

    // Fetch running Claude sessions
    fetch('/api/claude-sessions', { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => {
            const sessions = data.sessions || [];
            const buttons = [];

            // Option for each running session
            sessions.forEach(s => {
                buttons.push({
                    label: s.title,
                    className: 'secondary',
                    action: () => {
                        fetch('/api/claude-send', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ target: s.target, text: noteText })
                        }).then(r => {
                            if (r.ok && _switchView) _switchView('terminal');
                        });
                    }
                });
            });

            // New session option
            buttons.push({
                label: '+ 새 세션',
                className: 'primary',
                action: () => {
                    fetch('/api/claude-new', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: noteText })
                    }).then(r => {
                        if (r.ok && _switchView) _switchView('terminal');
                    });
                }
            });

            buttons.push({ label: '취소', className: 'cancel' });

            const dialogTitle = sessions.length > 0
                ? '전송할 Claude 세션 선택 (' + sessions.length + '개 실행 중)'
                : '실행 중인 Claude 세션이 없습니다';
            showConfirm(dialogTitle, buttons);
        })
        .catch(() => {
            showConfirm('Claude Code에 전송', [
                {
                    label: '새 세션으로 실행', className: 'primary', action: () => {
                        fetch('/api/claude-new', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: noteText })
                        }).then(r => {
                            if (r.ok && _switchView) _switchView('terminal');
                        });
                    }
                },
                { label: '취소', className: 'cancel' }
            ]);
        });
}
