// Theme — read CSS custom properties for use in JS inline styles
const s = getComputedStyle(document.documentElement);
const v = (name) => s.getPropertyValue(name).trim();

export const T = {
    bg:          () => v('--bg'),
    bgRaised:    () => v('--bg-raised'),
    bgDeep:      () => v('--bg-deep'),
    border:      () => v('--border'),
    borderLight: () => v('--border-light'),
    text:        () => v('--text'),
    textMuted:   () => v('--text-muted'),
    textSubtle:  () => v('--text-subtle'),
    accent:      () => v('--accent'),
    accentHover: () => v('--accent-hover'),
    danger:      () => v('--danger'),
    success:     () => v('--success'),
    successText: () => v('--success-text'),
    white:       () => v('--white'),
    warn:        '#e8b84b',
};
