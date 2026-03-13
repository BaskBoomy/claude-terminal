// markdown.js — Simple Markdown renderer (shared by brain.js and files.js)
export function renderMarkdown(md) {
    if (!md) return '';
    var html = md
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
            return '<pre><code>' + code.replace(/\n$/, '') + '</code></pre>';
        })
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
        .replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
        .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
        .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
        .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
        .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^---+$/gm, '<hr>')
        .replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, text, url) {
            if (/^https?:\/\//.test(url) || url.startsWith('./') || url.startsWith('/') || url.startsWith('#')) {
                return '<a href="' + url + '">' + text + '</a>';
            }
            return text + ' (' + url + ')';
        });

    // Tables
    html = html.replace(/((?:^\|.+\|$\n?)+)/gm, function(tableBlock) {
        var rows = tableBlock.trim().split('\n').filter(function(r) { return r.trim(); });
        if (rows.length < 2) return tableBlock;
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

    // Lists
    html = html.replace(/((?:^[\t ]*[-*]\s+.+$\n?)+)/gm, function(block) {
        var items = block.trim().split('\n');
        var out = '<ul>';
        items.forEach(function(item) {
            out += '<li>' + item.replace(/^[\t ]*[-*]\s+/, '') + '</li>';
        });
        return out + '</ul>';
    });

    html = html.replace(/<li>\[x\]\s*/gi, '<li style="list-style:none">\u2611 ');
    html = html.replace(/<li>\[ \]\s*/gi, '<li style="list-style:none">\u2610 ');
    html = html.replace(/^(?!<[a-z/])((?!^\s*$).+)$/gm, '<p>$1</p>');
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
}
