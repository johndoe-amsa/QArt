/*
 * qr.js — Encodeur QR Code conforme ISO/IEC 18004.
 * Versions 1 à 40, niveaux de correction L/M/Q/H, modes numérique /
 * alphanumérique / octet (UTF-8), segmentation optimale par programmation
 * dynamique, masquage automatique par score de pénalité.
 *
 * Aucune dépendance. Expose QArt.qr.
 */
(function (global) {
  'use strict';

  // --- Tables normatives -----------------------------------------------

  // Niveaux de correction : nom, bits de format, index de table.
  var ECC = {
    L: { name: 'L', formatBits: 1, idx: 0, ratio: 0.07 },
    M: { name: 'M', formatBits: 0, idx: 1, ratio: 0.15 },
    Q: { name: 'Q', formatBits: 3, idx: 2, ratio: 0.25 },
    H: { name: 'H', formatBits: 2, idx: 3, ratio: 0.30 }
  };
  var ECC_ORDER = ['L', 'M', 'Q', 'H'];

  // Nombre de codets de correction par bloc, indexé [niveau][version].
  var ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];

  // Nombre de blocs de correction, indexé [niveau][version].
  var NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  var MIN_VERSION = 1;
  var MAX_VERSION = 40;

  var MODE = {
    NUMERIC: { id: 'NUMERIC', label: 'Numérique', bits: 0x1, cc: [10, 12, 14] },
    ALNUM: { id: 'ALNUM', label: 'Alphanumérique', bits: 0x2, cc: [9, 11, 13] },
    BYTE: { id: 'BYTE', label: 'Octet (UTF-8)', bits: 0x4, cc: [8, 16, 16] }
  };
  var MODE_LIST = [MODE.NUMERIC, MODE.ALNUM, MODE.BYTE];

  var ALNUM_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  // --- Utilitaires bas niveau ------------------------------------------

  function charCountBits(mode, version) {
    var group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    return mode.cc[group];
  }

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.codePointAt(i);
      if (code > 0xFFFF) i++;
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code < 0x10000) {
        out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        out.push(
          0xF0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3F),
          0x80 | ((code >> 6) & 0x3F),
          0x80 | (code & 0x3F)
        );
      }
    }
    return out;
  }

  function countUtf8Bytes(codePoint) {
    if (codePoint < 0x80) return 1;
    if (codePoint < 0x800) return 2;
    if (codePoint < 0x10000) return 3;
    return 4;
  }

  function isNumericChar(c) {
    return c >= '0' && c <= '9';
  }

  function isAlnumChar(c) {
    return ALNUM_CHARSET.indexOf(c) !== -1;
  }

  // Tampon de bits : tableau d'entiers 0/1.
  function appendBits(buf, value, len) {
    for (var i = len - 1; i >= 0; i--) buf.push((value >>> i) & 1);
  }

  // --- Segmentation optimale -------------------------------------------

  /*
   * Découpe le texte en segments de modes hétérogènes minimisant le nombre
   * total de bits, par programmation dynamique sur trois états (numérique,
   * alphanumérique, octet). Les coûts sont exprimés en sixièmes de bit pour
   * représenter exactement 10/3 bits par chiffre et 11/2 bits par caractère
   * alphanumérique sans arithmétique flottante approximative.
   */
  function computeCharModes(codePoints, version) {
    var headCosts = MODE_LIST.map(function (m) {
      return (4 + charCountBits(m, version)) * 6;
    });
    var charModes = [];
    var prevCosts = headCosts.slice();

    for (var i = 0; i < codePoints.length; i++) {
      var c = codePoints[i];
      var curCosts = [Infinity, Infinity, Infinity];
      var cModes = [null, null, null];

      curCosts[2] = prevCosts[2] + countUtf8Bytes(c.codePointAt(0)) * 8 * 6;
      cModes[2] = 2;
      if (isAlnumChar(c)) {
        curCosts[1] = prevCosts[1] + 33;
        cModes[1] = 1;
      }
      if (isNumericChar(c)) {
        curCosts[0] = prevCosts[0] + 20;
        cModes[0] = 0;
      }

      // Changements de mode : on arrondit au bit entier avant d'ouvrir un
      // nouvel en-tête de segment.
      for (var to = 0; to < 3; to++) {
        for (var from = 0; from < 3; from++) {
          if (cModes[from] === null) continue;
          var cost = Math.ceil(curCosts[from] / 6) * 6 + headCosts[to];
          if (cost < curCosts[to]) {
            curCosts[to] = cost;
            cModes[to] = from;
          }
        }
      }

      charModes.push(cModes);
      prevCosts = curCosts;
    }

    var best = 0;
    for (var k = 1; k < 3; k++) if (prevCosts[k] < prevCosts[best]) best = k;

    var modes = new Array(codePoints.length);
    var cur = best;
    for (var j = codePoints.length - 1; j >= 0; j--) {
      cur = charModes[j][cur];
      modes[j] = cur;
    }
    return modes;
  }

  function makeSegments(text, version) {
    if (text.length === 0) return [];
    var codePoints = Array.from(text);
    var modes = computeCharModes(codePoints, version);
    var segments = [];
    var start = 0;
    for (var i = 1; i <= modes.length; i++) {
      if (i === modes.length || modes[i] !== modes[start]) {
        segments.push({
          mode: MODE_LIST[modes[start]],
          text: codePoints.slice(start, i).join('')
        });
        start = i;
      }
    }
    return segments;
  }

  function segmentBitLength(seg, version) {
    var n;
    switch (seg.mode.id) {
      case 'NUMERIC':
        n = seg.text.length;
        return 4 + charCountBits(seg.mode, version) + Math.floor(n / 3) * 10 + (n % 3 === 0 ? 0 : n % 3 === 1 ? 4 : 7);
      case 'ALNUM':
        n = seg.text.length;
        return 4 + charCountBits(seg.mode, version) + Math.floor(n / 2) * 11 + (n % 2) * 6;
      default:
        return 4 + charCountBits(seg.mode, version) + utf8Bytes(seg.text).length * 8;
    }
  }

  function writeSegment(buf, seg, version) {
    appendBits(buf, seg.mode.bits, 4);
    var i;
    if (seg.mode.id === 'NUMERIC') {
      appendBits(buf, seg.text.length, charCountBits(seg.mode, version));
      for (i = 0; i < seg.text.length; i += 3) {
        var chunk = seg.text.substr(i, 3);
        appendBits(buf, parseInt(chunk, 10), chunk.length * 3 + 1);
      }
    } else if (seg.mode.id === 'ALNUM') {
      appendBits(buf, seg.text.length, charCountBits(seg.mode, version));
      for (i = 0; i + 1 < seg.text.length; i += 2) {
        appendBits(buf, ALNUM_CHARSET.indexOf(seg.text[i]) * 45 + ALNUM_CHARSET.indexOf(seg.text[i + 1]), 11);
      }
      if (seg.text.length % 2 === 1) {
        appendBits(buf, ALNUM_CHARSET.indexOf(seg.text[seg.text.length - 1]), 6);
      }
    } else {
      var bytes = utf8Bytes(seg.text);
      appendBits(buf, bytes.length, charCountBits(seg.mode, version));
      for (i = 0; i < bytes.length; i++) appendBits(buf, bytes[i], 8);
    }
  }

  // --- Capacités --------------------------------------------------------

  function numRawDataModules(version) {
    var result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var numAlign = Math.floor(version / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }

  function numDataCodewords(version, ecl) {
    return (
      Math.floor(numRawDataModules(version) / 8) -
      ECC_CODEWORDS_PER_BLOCK[ecl.idx][version] * NUM_ERROR_CORRECTION_BLOCKS[ecl.idx][version]
    );
  }

  // --- Corps de Galois GF(256), polynôme primitif 0x11D ------------------

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  function rsDivisor(degree) {
    var result = new Uint8Array(degree);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    var result = new Uint8Array(divisor.length);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (var j = 0; j < result.length; j++) result[j] ^= gfMul(divisor[j], factor);
    }
    return result;
  }

  function addEccAndInterleave(data, version, ecl) {
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.idx][version];
    var blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.idx][version];
    var rawCodewords = Math.floor(numRawDataModules(version) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var divisor = rsDivisor(blockEccLen);
    var blocks = [];
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      var dat = data.slice(k, k + len);
      k += len;
      var ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0); // place réservée, ignorée à l'entrelacement
      blocks.push(dat.concat(Array.from(ecc)));
    }

    var result = [];
    for (var idx = 0; idx < blocks[0].length; idx++) {
      for (var b = 0; b < blocks.length; b++) {
        if (idx !== shortBlockLen - blockEccLen || b >= numShortBlocks) result.push(blocks[b][idx]);
      }
    }
    return result;
  }

  // --- Construction de la matrice ---------------------------------------

  function alignmentPatternPositions(version) {
    if (version === 1) return [];
    var numAlign = Math.floor(version / 7) + 2;
    var step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = version * 4 + 17 - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function makeGrid(size, value) {
    var g = new Array(size);
    for (var i = 0; i < size; i++) {
      g[i] = new Array(size);
      for (var j = 0; j < size; j++) g[i][j] = value;
    }
    return g;
  }

  function QRMatrix(version, ecl) {
    this.version = version;
    this.ecl = ecl;
    this.size = version * 4 + 17;
    this.modules = makeGrid(this.size, false);
    this.isFunction = makeGrid(this.size, false);
  }

  QRMatrix.prototype.setFunctionModule = function (x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  };

  QRMatrix.prototype.drawFinderPattern = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var xx = x + dx;
        var yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };

  QRMatrix.prototype.drawAlignmentPattern = function (x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  QRMatrix.prototype.drawFormatBits = function (mask) {
    var data = (this.ecl.formatBits << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;

    for (i = 0; i <= 5; i++) this.setFunctionModule(8, i, ((bits >>> i) & 1) !== 0);
    this.setFunctionModule(8, 7, ((bits >>> 6) & 1) !== 0);
    this.setFunctionModule(8, 8, ((bits >>> 7) & 1) !== 0);
    this.setFunctionModule(7, 8, ((bits >>> 8) & 1) !== 0);
    for (i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, ((bits >>> i) & 1) !== 0);

    for (i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, ((bits >>> i) & 1) !== 0);
    for (i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, ((bits >>> i) & 1) !== 0);
    this.setFunctionModule(8, this.size - 8, true); // module sombre permanent
  };

  QRMatrix.prototype.drawVersionBits = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (this.version << 12) | rem;
    for (i = 0; i < 18; i++) {
      var bit = ((bits >>> i) & 1) !== 0;
      var a = this.size - 11 + (i % 3);
      var b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  };

  QRMatrix.prototype.drawFunctionPatterns = function () {
    var i;
    for (i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    var pos = alignmentPatternPositions(this.version);
    for (i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var skipCorner =
          (i === 0 && j === 0) ||
          (i === 0 && j === pos.length - 1) ||
          (i === pos.length - 1 && j === 0);
        if (!skipCorner) this.drawAlignmentPattern(pos[i], pos[j]);
      }
    }

    this.drawFormatBits(0);
    this.drawVersionBits();
  };

  QRMatrix.prototype.drawCodewords = function (data) {
    var i = 0; // index de bit dans data
    for (var right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // saute la colonne de synchronisation
      for (var vert = 0; vert < this.size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  };

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
      default: throw new Error('Masque invalide');
    }
  }

  QRMatrix.prototype.applyMask = function (mask) {
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        if (!this.isFunction[y][x] && maskBit(mask, x, y)) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  };

  // Score de pénalité, règles N1=3, N2=3, N3=40, N4=10.
  QRMatrix.prototype.penaltyScore = function () {
    var size = this.size;
    var result = 0;
    var x, y;
    var self = this;

    // Historique des 7 dernières longueurs de plage, utilisé pour détecter le
    // motif 1:1:3:1:1 caractéristique des repères de position.
    function addHistory(runLength, history) {
      if (history[0] === 0) runLength += size; // bordure claire initiale
      history.pop();
      history.unshift(runLength);
    }

    function countPatterns(history) {
      var n = history[1];
      var core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
      return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
        (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
    }

    function terminateAndCount(runColor, runLength, history) {
      if (runColor) {
        addHistory(runLength, history);
        runLength = 0;
      }
      runLength += size; // bordure claire finale
      addHistory(runLength, history);
      return countPatterns(history);
    }

    // N1 (plages) et N3 (motifs de repère) — lignes puis colonnes.
    for (y = 0; y < size; y++) {
      var runColor = false;
      var runLen = 0;
      var history = [0, 0, 0, 0, 0, 0, 0];
      for (x = 0; x < size; x++) {
        if (this.modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) result += 3;
          else if (runLen > 5) result++;
        } else {
          addHistory(runLen, history);
          if (!runColor) result += countPatterns(history) * 40;
          runColor = this.modules[y][x];
          runLen = 1;
        }
      }
      result += terminateAndCount(runColor, runLen, history) * 40;
    }

    for (x = 0; x < size; x++) {
      var runColorY = false;
      var runLenY = 0;
      var historyY = [0, 0, 0, 0, 0, 0, 0];
      for (y = 0; y < size; y++) {
        if (this.modules[y][x] === runColorY) {
          runLenY++;
          if (runLenY === 5) result += 3;
          else if (runLenY > 5) result++;
        } else {
          addHistory(runLenY, historyY);
          if (!runColorY) result += countPatterns(historyY) * 40;
          runColorY = this.modules[y][x];
          runLenY = 1;
        }
      }
      result += terminateAndCount(runColorY, runLenY, historyY) * 40;
    }

    // N2 — blocs 2x2 de même couleur.
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = self.modules[y][x];
        if (c === self.modules[y][x + 1] && c === self.modules[y + 1][x] && c === self.modules[y + 1][x + 1]) {
          result += 3;
        }
      }
    }

    // N4 — déséquilibre entre modules sombres et clairs.
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (self.modules[y][x]) dark++;
    var total = size * size;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * 10;

    return result;
  };

  // --- API publique ------------------------------------------------------

  /*
   * encode(text, options)
   *   options.ecl        : 'L' | 'M' | 'Q' | 'H'  (défaut 'M')
   *   options.minVersion : 1..40 (défaut 1)
   *   options.maxVersion : 1..40 (défaut 40)
   *   options.mask       : -1 (auto) ou 0..7
   *   options.boostEcl   : monte le niveau de correction si la version le
   *                        permet sans grandir (défaut true)
   */
  function encode(text, options) {
    options = options || {};
    var requestedEcl = ECC[options.ecl] || ECC.M;
    var minVersion = clamp(options.minVersion || MIN_VERSION, MIN_VERSION, MAX_VERSION);
    var maxVersion = clamp(options.maxVersion || MAX_VERSION, minVersion, MAX_VERSION);
    var boostEcl = options.boostEcl !== false;
    var forcedMask = typeof options.mask === 'number' ? options.mask : -1;

    // Recherche de la plus petite version acceptant la donnée.
    var version = -1;
    var segments = null;
    var dataUsedBits = 0;
    for (var v = minVersion; v <= maxVersion; v++) {
      var segs = makeSegments(text, v);
      var bits = segs.reduce(function (acc, s) { return acc + segmentBitLength(s, v); }, 0);
      var capacity = numDataCodewords(v, requestedEcl) * 8;
      if (bits <= capacity) {
        version = v;
        segments = segs;
        dataUsedBits = bits;
        break;
      }
    }
    if (version === -1) {
      var maxCap = numDataCodewords(maxVersion, requestedEcl) * 8;
      var err = new Error('Données trop volumineuses : ' +
        Math.ceil(makeSegments(text, maxVersion).reduce(function (a, s) { return a + segmentBitLength(s, maxVersion); }, 0) / 8) +
        ' octets requis pour une capacité de ' + Math.floor(maxCap / 8) + ' octets (version ' + maxVersion + ', niveau ' + requestedEcl.name + ').');
      err.code = 'OVERFLOW';
      throw err;
    }

    // Montée gratuite du niveau de correction à version constante.
    var ecl = requestedEcl;
    if (boostEcl) {
      for (var i = ECC_ORDER.indexOf(requestedEcl.name) + 1; i < ECC_ORDER.length; i++) {
        var candidate = ECC[ECC_ORDER[i]];
        if (dataUsedBits <= numDataCodewords(version, candidate) * 8) ecl = candidate;
      }
    }

    // Sérialisation : segments, terminateur, alignement octet, remplissage.
    var bb = [];
    segments.forEach(function (s) { writeSegment(bb, s, version); });
    var dataCapacityBits = numDataCodewords(version, ecl) * 8;
    appendBits(bb, 0, Math.min(4, dataCapacityBits - bb.length));
    appendBits(bb, 0, (8 - (bb.length % 8)) % 8);
    for (var pad = 0xEC; bb.length < dataCapacityBits; pad ^= 0xEC ^ 0x11) appendBits(bb, pad, 8);

    var dataCodewords = [];
    for (var b = 0; b < bb.length; b += 8) {
      var byte = 0;
      for (var t = 0; t < 8; t++) byte = (byte << 1) | bb[b + t];
      dataCodewords.push(byte);
    }

    var allCodewords = addEccAndInterleave(dataCodewords, version, ecl);

    var qr = new QRMatrix(version, ecl);
    qr.drawFunctionPatterns();
    qr.drawCodewords(allCodewords);

    // Choix du masque : celui qui minimise le score de pénalité.
    var mask = forcedMask;
    var penalties = [];
    var minPenalty = Infinity;
    for (var m = 0; m < 8; m++) {
      qr.applyMask(m);
      qr.drawFormatBits(m);
      var p = qr.penaltyScore();
      penalties.push(p);
      if (forcedMask === -1 && p < minPenalty) {
        minPenalty = p;
        mask = m;
      }
      qr.applyMask(m); // involution : on annule
    }
    qr.applyMask(mask);
    qr.drawFormatBits(mask);

    return {
      size: qr.size,
      modules: qr.modules,
      isFunction: qr.isFunction,
      version: version,
      ecl: ecl.name,
      requestedEcl: requestedEcl.name,
      eclBoosted: ecl.name !== requestedEcl.name,
      mask: mask,
      maskAuto: forcedMask === -1,
      penalty: penalties[mask],
      maskPenalties: penalties,
      segments: segments.map(function (s) {
        return { mode: s.mode.id, label: s.mode.label, length: Array.from(s.text).length };
      }),
      usedBits: dataUsedBits,
      capacityBits: dataCapacityBits,
      dataCodewords: numDataCodewords(version, ecl),
      eccCodewords: ECC_CODEWORDS_PER_BLOCK[ecl.idx][version] * NUM_ERROR_CORRECTION_BLOCKS[ecl.idx][version],
      eccBlocks: NUM_ERROR_CORRECTION_BLOCKS[ecl.idx][version],
      correctionRatio: ECC[ecl.name].ratio
    };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // Capacité utile en octets pour une version et un niveau donnés.
  function capacityBytes(version, eclName) {
    return numDataCodewords(version, ECC[eclName] || ECC.M);
  }

  global.QArt = global.QArt || {};
  global.QArt.qr = {
    encode: encode,
    capacityBytes: capacityBytes,
    MIN_VERSION: MIN_VERSION,
    MAX_VERSION: MAX_VERSION,
    ECC_ORDER: ECC_ORDER
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).QArt.qr;
}
