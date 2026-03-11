// i18n.js — Lightweight internationalization module (ES module)
//
// Usage:
//   import { t, setLocale, getLocale, onLocaleReady } from './i18n.js';
//   await onLocaleReady;          // wait for locale to load
//   t('notes.empty')              // → "메모가 없습니다" (ko) or "No notes" (en)
//   t('launch.done', {n: 5})      // → "5개 완료" — simple {n} interpolation
//

var _strings = {};
var _locale = 'en';
var _ready = null;
var _resolveReady = null;

// Promise that resolves when locale is loaded
_ready = new Promise(function(resolve) { _resolveReady = resolve; });

/**
 * Translate a key. Supports dot-separated paths and simple {var} interpolation.
 * Returns the key itself if not found (makes missing translations visible).
 */
export function t(key, vars) {
    var val = _resolve(key);
    if (val === undefined || val === null) return key;
    if (vars) {
        Object.keys(vars).forEach(function(k) {
            val = val.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
        });
    }
    return val;
}

function _resolve(key) {
    var parts = key.split('.');
    var obj = _strings;
    for (var i = 0; i < parts.length; i++) {
        if (obj == null) return undefined;
        obj = obj[parts[i]];
    }
    return typeof obj === 'string' ? obj : undefined;
}

/**
 * Get current locale code.
 */
export function getLocale() {
    return _locale;
}

/**
 * Set locale and load the corresponding JSON file.
 * Returns a promise that resolves when loaded.
 */
export function setLocale(locale) {
    _locale = locale || 'en';
    return fetch('/locales/' + _locale + '.json?v=' + Date.now())
        .then(function(r) {
            if (!r.ok) throw new Error('locale not found: ' + _locale);
            return r.json();
        })
        .then(function(data) {
            _strings = data;
            document.documentElement.lang = _locale;
        })
        .catch(function(err) {
            console.warn('[i18n] failed to load locale:', _locale, err);
            // Fallback: try loading en if not already
            if (_locale !== 'en') {
                return fetch('/locales/en.json')
                    .then(function(r) { return r.json(); })
                    .then(function(data) { _strings = data; })
                    .catch(function() {});
            }
        });
}

/**
 * Initialize i18n from settings. Call once at startup.
 */
export function initI18n(settingsLocale) {
    _locale = settingsLocale || 'en';
    return setLocale(_locale).then(function() {
        _resolveReady();
    });
}

/**
 * Promise that resolves when locale is loaded and ready.
 */
export var onLocaleReady = _ready;

/**
 * Apply translations to DOM elements with data-i18n attribute.
 * <span data-i18n="common.save">Save</span>
 * <input data-i18n-placeholder="notes.titlePlaceholder" placeholder="제목 없음">
 * <button data-i18n-title="preview.back" title="뒤로">
 */
export function translateDOM(root) {
    root = root || document;

    // Text content
    root.querySelectorAll('[data-i18n]').forEach(function(el) {
        var key = el.getAttribute('data-i18n');
        var val = t(key);
        if (val !== key) el.textContent = val;
    });

    // Placeholder
    root.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
        var key = el.getAttribute('data-i18n-placeholder');
        var val = t(key);
        if (val !== key) el.placeholder = val;
    });

    // Title attribute
    root.querySelectorAll('[data-i18n-title]').forEach(function(el) {
        var key = el.getAttribute('data-i18n-title');
        var val = t(key);
        if (val !== key) el.title = val;
    });
}
