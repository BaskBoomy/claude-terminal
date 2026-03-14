/**
 * qr.js — Minimal QR Code generator for terminal display
 * Zero dependencies. Supports byte mode, EC level L, versions 1-10.
 */

// ── GF(256) arithmetic (primitive poly 0x11D) ──────────────────────────────

const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(function () {
  var v = 1;
  for (var i = 0; i < 255; i++) {
    EXP[i] = v;
    LOG[v] = i;
    v = (v << 1) ^ (v >= 128 ? 0x11D : 0);
  }
  EXP[255] = EXP[0];
})();

function gfMul(a, b) {
  return (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255];
}

// ── Reed-Solomon ────────────────────────────────────────────────────────────

function rsEncode(data, numEc) {
  // Build generator: g(x) = ∏(x + α^i), stored highest-degree-first
  var gen = [1];
  for (var i = 0; i < numEc; i++) {
    var next = new Array(gen.length + 1).fill(0);
    for (var j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], EXP[i]);
    }
    gen = next;
  }

  // Polynomial division: data · x^numEc mod gen
  var work = new Uint8Array(data.length + numEc);
  for (var i = 0; i < data.length; i++) work[i] = data[i];

  for (var i = 0; i < data.length; i++) {
    var coef = work[i];
    if (coef !== 0) {
      for (var j = 1; j < gen.length; j++) {
        work[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }

  return work.slice(data.length);
}

// ── Version tables (EC level L only) ────────────────────────────────────────
// [totalCW, ecPerBlock, group1Blocks, group1DataCW, group2Blocks, group2DataCW]

var VERSIONS = [
  null,
  [26, 7, 1, 19, 0, 0],
  [44, 10, 1, 34, 0, 0],
  [70, 15, 1, 55, 0, 0],
  [100, 20, 1, 80, 0, 0],
  [134, 26, 1, 108, 0, 0],
  [172, 18, 2, 68, 0, 0],
  [196, 20, 2, 78, 0, 0],
  [242, 24, 2, 97, 0, 0],
  [292, 30, 2, 116, 0, 0],
  [346, 18, 2, 68, 2, 69],
];

var ALIGN = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// Format info bits: EC level L (01), masks 0-7
var FORMAT_BITS = [
  0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976,
];

// Version info (v7-v10)
var VERSION_INFO = [0, 0, 0, 0, 0, 0, 0, 0x07C94, 0x085B8, 0x09A13, 0x0A4D6];

// ── Encoding ────────────────────────────────────────────────────────────────

function getVersion(dataLen) {
  for (var v = 1; v <= 10; v++) {
    var info = VERSIONS[v];
    var dataCap = info[2] * info[3] + info[4] * info[5];
    var countBits = v <= 9 ? 8 : 16;
    var totalBits = 4 + countBits + dataLen * 8;
    if (totalBits <= dataCap * 8) return v;
  }
  return -1;
}

function encodeData(data, version) {
  var info = VERSIONS[version];
  var dataCap = info[2] * info[3] + info[4] * info[5];
  var countBits = version <= 9 ? 8 : 16;

  var bits = [];
  function addBits(val, len) {
    for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  }

  addBits(0b0100, 4); // byte mode
  addBits(data.length, countBits);
  for (var i = 0; i < data.length; i++) addBits(data[i], 8);
  addBits(0, Math.min(4, dataCap * 8 - bits.length)); // terminator

  while (bits.length % 8 !== 0) bits.push(0);

  var pad = 0;
  while (bits.length < dataCap * 8) {
    addBits(pad === 0 ? 0xEC : 0x11, 8);
    pad ^= 1;
  }

  var bytes = new Uint8Array(dataCap);
  for (var i = 0; i < dataCap; i++) {
    for (var j = 0; j < 8; j++) bytes[i] = (bytes[i] << 1) | bits[i * 8 + j];
  }
  return bytes;
}

// ── Matrix ──────────────────────────────────────────────────────────────────

function createMatrix(version) {
  var size = version * 4 + 17;
  var matrix = [];
  var reserved = [];
  for (var i = 0; i < size; i++) {
    matrix.push(new Int8Array(size));
    reserved.push(new Uint8Array(size));
  }

  function set(row, col, val) {
    if (row >= 0 && row < size && col >= 0 && col < size) {
      matrix[row][col] = val ? 1 : -1;
      reserved[row][col] = 1;
    }
  }

  // Finder patterns
  function finder(row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        var inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        var onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        set(row + r, col + c, inInner || (inOuter && onBorder));
      }
    }
  }
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns
  for (var i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  var pos = ALIGN[version];
  for (var pi = 0; pi < pos.length; pi++) {
    for (var pj = 0; pj < pos.length; pj++) {
      var r = pos[pi], c = pos[pj];
      if (reserved[r][c]) continue;
      for (var dr = -2; dr <= 2; dr++) {
        for (var dc = -2; dc <= 2; dc++) {
          set(r + dr, c + dc, Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0));
        }
      }
    }
  }

  // Dark module
  set(size - 8, 8, true);

  // Reserve format info areas
  for (var i = 0; i < 9; i++) {
    if (!reserved[8][i]) { reserved[8][i] = 1; matrix[8][i] = -1; }
    if (!reserved[i][8]) { reserved[i][8] = 1; matrix[i][8] = -1; }
  }
  for (var i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) { reserved[8][size - 1 - i] = 1; matrix[8][size - 1 - i] = -1; }
    if (!reserved[size - 1 - i][8]) { reserved[size - 1 - i][8] = 1; matrix[size - 1 - i][8] = -1; }
  }

  // Version info (v7+)
  if (version >= 7) {
    var vi = VERSION_INFO[version];
    for (var i = 0; i < 18; i++) {
      var val = (vi >> i) & 1;
      var a = Math.floor(i / 3), b = i % 3;
      set(size - 11 + b, a, !!val);
      set(a, size - 11 + b, !!val);
    }
  }

  return { matrix: matrix, reserved: reserved, size: size };
}

function placeData(matrix, reserved, size, codewords) {
  var bitIdx = 0;
  var right = size - 1;
  var upward = true;

  while (right >= 0) {
    if (right === 6) right--;

    for (var i = 0; i < size; i++) {
      var row = upward ? size - 1 - i : i;
      var cols = [right, right - 1];
      for (var ci = 0; ci < cols.length; ci++) {
        var col = cols[ci];
        if (col < 0 || reserved[row][col]) continue;
        var byteIdx = bitIdx >> 3;
        var bitPos = 7 - (bitIdx & 7);
        if (byteIdx < codewords.length) {
          matrix[row][col] = ((codewords[byteIdx] >> bitPos) & 1) ? 1 : -1;
        } else {
          matrix[row][col] = -1;
        }
        bitIdx++;
      }
    }
    upward = !upward;
    right -= 2;
  }
}

// ── Masking ─────────────────────────────────────────────────────────────────

var MASK_FNS = [
  function (r, c) { return (r + c) % 2 === 0; },
  function (r, c) { return r % 2 === 0; },
  function (r, c) { return c % 3 === 0; },
  function (r, c) { return (r + c) % 3 === 0; },
  function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
  function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
  function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
  function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; },
];

function applyMask(matrix, reserved, size, maskIdx) {
  var result = matrix.map(function (row) { return Int8Array.from(row); });
  var fn = MASK_FNS[maskIdx];
  for (var r = 0; r < size; r++) {
    for (var c = 0; c < size; c++) {
      if (!reserved[r][c] && fn(r, c)) {
        result[r][c] = result[r][c] === 1 ? -1 : 1;
      }
    }
  }
  return result;
}

function penalty(matrix, size) {
  var score = 0;

  // Rule 1: runs of same color
  for (var r = 0; r < size; r++) {
    var run = 1;
    for (var c = 1; c < size; c++) {
      if (matrix[r][c] === matrix[r][c - 1]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score++;
      } else run = 1;
    }
  }
  for (var c = 0; c < size; c++) {
    var run = 1;
    for (var r = 1; r < size; r++) {
      if (matrix[r][c] === matrix[r - 1][c]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score++;
      } else run = 1;
    }
  }

  // Rule 2: 2x2 blocks
  for (var r = 0; r < size - 1; r++) {
    for (var c = 0; c < size - 1; c++) {
      var v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  return score;
}

function addFormatInfo(matrix, size, maskIdx) {
  var bits = FORMAT_BITS[maskIdx];
  for (var i = 0; i < 15; i++) {
    var val = ((bits >> (14 - i)) & 1) ? 1 : -1;
    if (i < 6) matrix[8][i] = val;
    else if (i === 6) matrix[8][7] = val;
    else if (i === 7) matrix[8][8] = val;
    else if (i === 8) matrix[7][8] = val;
    else matrix[14 - i][8] = val;

    if (i < 8) matrix[size - 1 - i][8] = val;
    else matrix[8][size - 15 + i] = val;
  }
}

// ── Generate ────────────────────────────────────────────────────────────────

function generateQR(text) {
  var data = Buffer.from(text, 'utf8');
  var version = getVersion(data.length);
  if (version < 0) return null;

  var info = VERSIONS[version];
  var dataBytes = encodeData(data, version);

  // Split into blocks, compute EC
  var ecPerBlock = info[1];
  var blocks1 = info[2], dataCW1 = info[3];
  var blocks2 = info[4], dataCW2 = info[5];
  var dataBlocks = [], ecBlocks = [];
  var offset = 0;

  for (var i = 0; i < blocks1; i++) {
    var block = dataBytes.slice(offset, offset + dataCW1);
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
    offset += dataCW1;
  }
  for (var i = 0; i < blocks2; i++) {
    var block = dataBytes.slice(offset, offset + dataCW2);
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
    offset += dataCW2;
  }

  // Interleave
  var totalBlocks = blocks1 + blocks2;
  var maxDataCW = Math.max(dataCW1, dataCW2 || 0);
  var interleaved = [];

  for (var i = 0; i < maxDataCW; i++) {
    for (var b = 0; b < totalBlocks; b++) {
      if (i < dataBlocks[b].length) interleaved.push(dataBlocks[b][i]);
    }
  }
  for (var i = 0; i < ecPerBlock; i++) {
    for (var b = 0; b < totalBlocks; b++) {
      interleaved.push(ecBlocks[b][i]);
    }
  }

  var codewords = new Uint8Array(interleaved);

  // Build matrix
  var m = createMatrix(version);
  placeData(m.matrix, m.reserved, m.size, codewords);

  // Pick best mask
  var bestMask = 0, bestPenalty = Infinity;
  for (var mask = 0; mask < 8; mask++) {
    var masked = applyMask(m.matrix, m.reserved, m.size, mask);
    var p = penalty(masked, m.size);
    if (p < bestPenalty) { bestPenalty = p; bestMask = mask; }
  }

  var finalMatrix = applyMask(m.matrix, m.reserved, m.size, bestMask);
  addFormatInfo(finalMatrix, m.size, bestMask);

  return { matrix: finalMatrix, size: m.size };
}

// ── Render to terminal (Unicode half-blocks) ────────────────────────────────

function renderQR(text, opts) {
  opts = opts || {};
  var qr = generateQR(text);
  if (!qr) return null;

  var matrix = qr.matrix, size = qr.size;
  var q = 2; // quiet zone
  var total = size + q * 2;
  var lines = [];

  var FG = '\x1b[30m'; // black foreground
  var BG = '\x1b[47m'; // white background
  var R = '\x1b[0m';

  function isDark(r, c) {
    var mr = r - q, mc = c - q;
    if (mr < 0 || mr >= size || mc < 0 || mc >= size) return false;
    return matrix[mr][mc] === 1;
  }

  for (var r = 0; r < total; r += 2) {
    var line = FG + BG;
    for (var c = 0; c < total; c++) {
      var top = isDark(r, c);
      var bot = (r + 1 < total) ? isDark(r + 1, c) : false;

      if (!top && !bot) line += ' ';
      else if (top && bot) line += '\u2588';
      else if (top) line += '\u2580';
      else line += '\u2584';
    }
    line += R;
    lines.push(line);
  }

  return lines;
}

module.exports = { renderQR };
