import { showToast, showConfirm, closeConfirm, escapeHtml, formatDate } from './utils.js';
import { t } from './i18n.js';

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
let notesPinBtn;
let notesSendClaudeBtn;

// --- State ---
let notesSaveTimer = null;
let notesListLoaded = false;
let currentNoteId = null;
let currentNotePinned = false;
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

var PIN_SVG = '<svg class="note-pin-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M5.5 2.5l5 1.5L9 7.5l2 5-7-4.5L7 5z"/></svg>';

function renderNotesList(notes) {
    if (!notes.length) {
        notesItems.innerHTML = '<div class="note-item-empty">' + t('notes.empty') + '</div>';
        return;
    }
    notesItems.innerHTML = '';
    notes.forEach(n => {
        const el = document.createElement('div');
        el.className = 'note-item' + (n.pinned ? ' pinned' : '');
        el.dataset.id = n.id;
        el.dataset.pinned = n.pinned ? '1' : '0';
        el.innerHTML =
            (n.pinned ? PIN_SVG : '') +
            '<div class="note-item-title">' + escapeHtml(n.title || t('notes.untitled')) + '</div>' +
            '<div class="note-item-preview">' + escapeHtml(n.preview || '') + '</div>' +
            '<div class="note-item-date">' + formatNoteDate(n.updatedAt) + '</div>';
        el.addEventListener('click', () => openNote(n.id));
        notesItems.appendChild(el);
    });
}

function togglePin(pinned) {
    if (!currentNoteId) return;
    currentNotePinned = pinned;
    updatePinUI();
    fetch('/api/notes/' + currentNoteId, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: pinned })
    });
}

function updatePinUI() {
    notesPinBtn.classList.toggle('active', currentNotePinned);
    notesPinBtn.title = currentNotePinned ? t('notes.unpin') : t('notes.pin');
}

function scheduleNoteSave() {
    notesEditorStatus.textContent = t('notes.modified');
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
    notesPinBtn = document.getElementById('notes-pin-btn');
    notesSendClaudeBtn = document.getElementById('notes-send-claude-btn');

    // Pin toggle
    notesPinBtn.addEventListener('click', () => togglePin(!currentNotePinned));

    // Auto-save on input
    notesEditorTextarea.addEventListener('input', scheduleNoteSave);
    notesTitleInput.addEventListener('input', scheduleNoteSave);

    // Back button
    notesBackBtn.addEventListener('click', () => {
        clearTimeout(notesSaveTimer);
        if (currentNoteId && notesEditorStatus.textContent !== t('notes.saved')) {
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
        showConfirm(t('notes.deleteConfirm'), [
            {
                label: t('common.delete'), className: 'primary', action: () => {
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
            { label: t('common.cancel'), className: 'cancel' }
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
            currentNotePinned = !!data.pinned;
            notesTitleInput.value = data.title || '';
            notesEditorTextarea.value = data.content || '';
            notesEditorStatus.textContent = t('notes.saved');
            notesEditorStatus.classList.add('saved');
            updatePinUI();
            notesListView.style.display = 'none';
            notesEditorView.style.display = 'flex';
        });
}

export function saveCurrentNote() {
    if (!currentNoteId) return;
    notesEditorStatus.textContent = t('notes.saving');
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
            notesEditorStatus.textContent = t('notes.saved');
            notesEditorStatus.classList.add('saved');
        } else {
            notesEditorStatus.textContent = t('notes.saveFailed');
            notesEditorStatus.classList.remove('saved');
        }
    }).catch(() => {
        notesEditorStatus.textContent = t('notes.saveFailed');
        notesEditorStatus.classList.remove('saved');
    });
}

export function sendNoteToClaudeDialog() {
    const title = notesTitleInput.value.trim();
    const content = notesEditorTextarea.value.trim();
    if (!content) return;

    // Save before sending
    if (notesEditorStatus.textContent !== t('notes.saved')) {
        clearTimeout(notesSaveTimer);
        saveCurrentNote();
    }

    const noteText = '--- Note: ' + (title || t('notes.untitled')) + ' ---\n' + content;

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
                label: t('notes.newSession'),
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

            buttons.push({ label: t('common.cancel'), className: 'cancel' });

            const dialogTitle = sessions.length > 0
                ? t('notes.selectSession', { n: sessions.length })
                : t('notes.noSession');
            showConfirm(dialogTitle, buttons);
        })
        .catch(() => {
            showConfirm(t('notes.sendToClaudeTitle'), [
                {
                    label: t('notes.runNewSession'), className: 'primary', action: () => {
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
                { label: t('common.cancel'), className: 'cancel' }
            ]);
        });
}
