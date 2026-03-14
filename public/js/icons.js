// icons.js — Centralized SVG icon definitions
// All icons use stroke-based design with currentColor for theme compatibility.
// Usage: import { I } from './icons.js'; then use I.chevronLeft, I.refresh, etc.

var S = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';

export var I = {
    // Navigation arrows
    chevronLeft:    S + '<path d="M10 3L5 8l5 5"/></svg>',
    chevronRight:   S + '<path d="M6 3l5 5-5 5"/></svg>',
    chevronUp:      S + '<path d="M3 10l5-5 5 5"/></svg>',
    chevronDown:    S + '<path d="M3 6l5 5 5-5"/></svg>',

    // Arrow keys (for keyboard)
    arrowUp:        S + '<path d="M8 13V3"/><path d="M3.5 7.5L8 3l4.5 4.5"/></svg>',
    arrowDown:      S + '<path d="M8 3v10"/><path d="M3.5 8.5L8 13l4.5-4.5"/></svg>',
    arrowLeft:      S + '<path d="M13 8H3"/><path d="M7.5 3.5L3 8l4.5 4.5"/></svg>',
    arrowRight:     S + '<path d="M3 8h10"/><path d="M8.5 3.5L13 8l-4.5 4.5"/></svg>',

    // Actions
    refresh:        S + '<path d="M13 8A5 5 0 1 1 8 3h3"/><path d="M11 1l2 2-2 2"/></svg>',
    x:              S + '<path d="M4 4l8 8"/><path d="M12 4l-8 8"/></svg>',
    xCircle:        S + '<circle cx="8" cy="8" r="6"/><path d="M6 6l4 4"/><path d="M10 6l-4 4"/></svg>',
    externalLink:   S + '<path d="M11 3h3v3"/><path d="M14 3L7 10"/><path d="M12 9v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"/></svg>',
    plus:           S + '<path d="M8 3v10"/><path d="M3 8h10"/></svg>',
    minus:          S + '<path d="M3 8h10"/></svg>',

    // Stars
    star:           S + '<path d="M8 2l1.8 3.6 4 .6-2.9 2.8.7 4L8 11.2 4.4 13l.7-4-2.9-2.8 4-.6z"/></svg>',
    starFilled:     S + '<path d="M8 2l1.8 3.6 4 .6-2.9 2.8.7 4L8 11.2 4.4 13l.7-4-2.9-2.8 4-.6z" fill="currentColor"/></svg>',

    // Menu / UI
    moreHorizontal: S + '<circle cx="4" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/></svg>',
    menu:           S + '<path d="M3 4h10"/><path d="M3 8h10"/><path d="M3 12h10"/></svg>',
    gripVertical:   S + '<circle cx="6" cy="4" r="0.8" fill="currentColor" stroke="none"/><circle cx="10" cy="4" r="0.8" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r="0.8" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="0.8" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r="0.8" fill="currentColor" stroke="none"/><circle cx="10" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg>',
    smartphone:     S + '<rect x="4" y="1" width="8" height="14" rx="1.5"/><path d="M7 12.5h2"/></svg>',
    power:          S + '<path d="M8 2v5"/><path d="M5 3.5a5.5 5.5 0 1 0 6 0"/></svg>',

    // Clipboard / File
    clipboard:      S + '<rect x="4" y="3" width="8" height="11" rx="1"/><path d="M6 3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/></svg>',
    clipboardList:  S + '<rect x="4" y="3" width="8" height="11" rx="1"/><path d="M6 3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/><path d="M7 7h3"/><path d="M7 9.5h3"/></svg>',
    fileText:       S + '<path d="M5 2h6l3 3v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M11 2v3h3"/><path d="M7 8h4"/><path d="M7 10.5h2"/></svg>',
    camera:         S + '<rect x="2" y="5" width="12" height="9" rx="1.5"/><circle cx="8" cy="9.5" r="2.5"/><path d="M6 5l.5-2h3l.5 2"/></svg>',
    paperclip:      S + '<path d="M12.5 7L7 12.5a2.8 2.8 0 0 1-4-4L8.5 3a1.8 1.8 0 0 1 2.5 2.5L6.5 10"/></svg>',

    // Clock / History
    clock:          S + '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>',

    // Keyboard keys
    cornerDownLeft: S + '<path d="M12 3v5a2 2 0 0 1-2 2H5"/><path d="M7 7.5L4.5 10 7 12.5"/></svg>',
    deleteKey:      S + '<path d="M6 3l-4 5 4 5h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H6z"/><path d="M9 6.5l3 3"/><path d="M12 6.5l-3 3"/></svg>',
    spaceBar:       S + '<path d="M3 10v2h10v-2"/></svg>',

    // Eye
    eye:            S + '<path d="M1.5 8s2.5-5 6.5-5 6.5 5 6.5 5-2.5 5-6.5 5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
    eyeOff:         S + '<path d="M2 2l12 12"/><path d="M6.5 6.5a2 2 0 0 0 3 3"/><path d="M1.5 8s2-4 5.5-4.8"/><path d="M14.5 8s-2 4-5.5 4.8"/></svg>',

    // Terminal / Monitor
    terminal:       S + '<rect x="2" y="2" width="12" height="10" rx="1.5"/><path d="M5 6l2.5 2L5 10"/><path d="M9 10h3"/><path d="M5 14h6"/><path d="M8 12v2"/></svg>',

    // Brain tab categories
    brain:          S + '<path d="M8 14V9"/><path d="M5.5 4C4 4 3 5 3 6.5S4 9 5.5 9H8"/><path d="M10.5 4C12 4 13 5 13 6.5S12 9 10.5 9H8"/><path d="M5 9c-1.2.5-2 1.5-2 3"/><path d="M11 9c1.2.5 2 1.5 2 3"/><circle cx="5.5" cy="4" r="1.5"/><circle cx="10.5" cy="4" r="1.5"/></svg>',
    zap:            S + '<path d="M9.5 2L4 9h4l-1 5 5.5-7H9l.5-5z" fill="currentColor" stroke="none"/></svg>',
    bot:            S + '<rect x="3" y="5" width="10" height="8" rx="2"/><circle cx="6" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="9" r="1" fill="currentColor" stroke="none"/><path d="M8 2v3"/><circle cx="8" cy="1.5" r="1"/></svg>',
    ruler:          S + '<rect x="2" y="5" width="12" height="6" rx="1"/><path d="M5 5v3"/><path d="M8 5v3"/><path d="M11 5v3"/></svg>',
    hook:           S + '<path d="M8 2v7a3 3 0 0 1-3 3H4"/><path d="M4 10l-2 2 2 2"/><circle cx="8" cy="2" r="1.5"/></svg>',
    fileDoc:        S + '<path d="M5 2h6l3 3v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M11 2v3h3"/></svg>',

    // Launch tracker area icons
    settings:       S + '<circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2"/><path d="M8 12.5v2"/><path d="M1.5 8h2"/><path d="M12.5 8h2"/><path d="M3.4 3.4l1.4 1.4"/><path d="M11.2 11.2l1.4 1.4"/><path d="M3.4 12.6l1.4-1.4"/><path d="M11.2 4.8l1.4-1.4"/></svg>',
    creditCard:     S + '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M1.5 7h13"/><path d="M4 10h3"/></svg>',
    building:       S + '<path d="M5 14V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11"/><path d="M3 14h10"/><path d="M7 5h2"/><path d="M7 7.5h2"/><path d="M7 10h2"/></svg>',
    lock:           S + '<rect x="4" y="7" width="8" height="7" rx="1"/><path d="M6 7V5a2 2 0 0 1 4 0v2"/></svg>',
    scale:          S + '<path d="M8 2v12"/><path d="M3 5l5-2 5 2"/><path d="M1.5 9.5a1.5 1.5 0 0 0 3 0L3 5"/><path d="M11.5 9.5a1.5 1.5 0 0 0 3 0L13 5"/></svg>',
    barChart:       S + '<path d="M4 14V8"/><path d="M8 14V4"/><path d="M12 14V6"/></svg>',
    testTube:       S + '<path d="M6 2v8l-2.5 4h9L10 10V2"/><path d="M5 2h6"/><path d="M4.5 10h7"/></svg>',
    megaphone:      S + '<path d="M12 4L4 7h2v4l6 2V4z"/><path d="M4 7v3"/><path d="M12 4c1 0 2 1.5 2 3.5S13 11 12 11"/></svg>',
    refreshCw:      S + '<path d="M2 8a6 6 0 0 1 10.5-4"/><path d="M14 8a6 6 0 0 1-10.5 4"/><path d="M12.5 1v3h-3"/><path d="M3.5 15v-3h3"/></svg>',
    messageCircle:  S + '<path d="M14 8a6 6 0 0 1-6 6l-4 2 1-3A6 6 0 1 1 14 8z"/></svg>',
    bookOpen:       S + '<path d="M2 3h5a3 3 0 0 1 1 .2V14a2 2 0 0 0-1-.2H2V3z"/><path d="M14 3H9a3 3 0 0 0-1 .2V14a2 2 0 0 1 1-.2h5V3z"/></svg>',
    package:        S + '<path d="M2 5l6-3 6 3v6l-6 3-6-3V5z"/><path d="M2 5l6 3 6-3"/><path d="M8 8v6"/></svg>',
    search:         S + '<circle cx="7" cy="7" r="5"/><path d="M11.5 11.5L14.5 14.5"/></svg>',
    trendingUp:     S + '<path d="M2 12l4-4 3 3 5-5"/><path d="M10 6h4v4"/></svg>',
    buildingOffice: S + '<rect x="3" y="2" width="10" height="12" rx="1"/><path d="M6 5h1"/><path d="M9 5h1"/><path d="M6 8h1"/><path d="M9 8h1"/><path d="M6 11h4v3H6z"/></svg>',

    // Launch overview section icons
    alertTriangle:  S + '<path d="M8 2L1.5 13h13L8 2z"/><path d="M8 6v3"/><circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none"/></svg>',
    checkCircle:    S + '<circle cx="8" cy="8" r="6"/><path d="M5.5 8l2 2 3.5-3.5"/></svg>',
    rocket:         S + '<path d="M8 14s-3-2-3-7C5 3 8 1 8 1s3 2 3 6c0 5-3 7-3 7z"/><path d="M5.5 10.5L3 12l1-3"/><path d="M10.5 10.5L13 12l-1-3"/><circle cx="8" cy="6" r="1"/></svg>',
    pencil:         S + '<path d="M11 2l3 3-8.5 8.5H2.5v-3L11 2z"/></svg>',

    // Download / Save / Link
    download:       S + '<path d="M2 10v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3"/><path d="M8 2v8"/><path d="M5 7.5L8 10.5l3-3"/></svg>',
    save:           S + '<path d="M3 2h8l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M5 2v3h5V2"/><rect x="5" y="9" width="6" height="4" rx="0.5"/></svg>',
    link:           S + '<path d="M6.5 9.5a3 3 0 0 0 4.2.3l2-2a3 3 0 0 0-4.2-4.3L7 5"/><path d="M9.5 6.5a3 3 0 0 0-4.2-.3l-2 2a3 3 0 0 0 4.2 4.3L9 11"/></svg>',
    checkSquare:    S + '<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 8l2.5 2.5L11 6"/></svg>',
};

// Helper: return icon SVG with custom size
export function icon(name, size) {
    var svg = I[name] || '';
    if (size && size !== 16) {
        svg = svg.replace(/width="16"/, 'width="' + size + '"').replace(/height="16"/, 'height="' + size + '"');
    }
    return svg;
}
