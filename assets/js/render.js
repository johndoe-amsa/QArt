/*
 * render.js — Rendu vectoriel d'une matrice QR en SVG.
 *
 * Toute la géométrie est émise sous forme de chemins compound (`<path>`) :
 * un chemin pour les modules, un pour le contour des repères, un pour leurs
 * pupilles. À l'ouverture dans Illustrator ou InDesign, chaque groupe est
 * donc un seul objet vectoriel, et non plusieurs centaines de rectangles.
 *
 * Unité interne : 10 unités par module, ce qui garde des coordonnées
 * entières pour les formes carrées et une décimale pour les arrondis.
 */
(function (global) {
  'use strict';

  var U = 10; // unités SVG par module

  // Arrondit et supprime les décimales inutiles.
  function n(v) {
    var r = Math.round(v * 100) / 100;
    return String(r);
  }

  function pathRect(x, y, w, h) {
    return 'M' + n(x) + ' ' + n(y) + 'h' + n(w) + 'v' + n(h) + 'h' + n(-w) + 'Z';
  }

  function pathRoundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    if (r <= 0) return pathRect(x, y, w, h);
    return 'M' + n(x + r) + ' ' + n(y) +
      'h' + n(w - 2 * r) + 'a' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(r) + ' ' + n(r) +
      'v' + n(h - 2 * r) + 'a' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(-r) + ' ' + n(r) +
      'h' + n(-(w - 2 * r)) + 'a' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(-r) + ' ' + n(-r) +
      'v' + n(-(h - 2 * r)) + 'a' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(r) + ' ' + n(-r) + 'Z';
  }

  function pathCircle(cx, cy, r) {
    return 'M' + n(cx - r) + ' ' + n(cy) +
      'a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(2 * r) + ' 0' +
      'a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(-2 * r) + ' 0Z';
  }

  // Rectangle dont chaque coin est arrondi ou non, dans l'ordre
  // haut-gauche, haut-droite, bas-droite, bas-gauche.
  function pathRectCorners(x, y, w, h, r, corners) {
    r = Math.min(r, w / 2, h / 2);
    var tl = corners[0] ? r : 0, tr = corners[1] ? r : 0;
    var br = corners[2] ? r : 0, bl = corners[3] ? r : 0;
    var d = 'M' + n(x + tl) + ' ' + n(y);
    d += 'H' + n(x + w - tr);
    if (tr) d += 'A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(x + w) + ' ' + n(y + tr);
    d += 'V' + n(y + h - br);
    if (br) d += 'A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(x + w - br) + ' ' + n(y + h);
    d += 'H' + n(x + bl);
    if (bl) d += 'A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(x) + ' ' + n(y + h - bl);
    d += 'V' + n(y + tl);
    if (tl) d += 'A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(x + tl) + ' ' + n(y);
    return d + 'Z';
  }

  // --- Modules -----------------------------------------------------------

  function isEyeCell(x, y, size) {
    return (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
  }

  /*
   * Construit le chemin compound de tous les modules de données.
   * `keep(x, y)` filtre les modules à dessiner (logo détouré, par exemple).
   */
  function modulesPath(matrix, size, style, keep) {
    var d = [];
    var scale = style.moduleScale;
    var inset = ((1 - scale) * U) / 2;
    var w = U * scale;
    var shape = style.moduleShape;

    function on(x, y) {
      if (x < 0 || y < 0 || x >= size || y >= size) return false;
      if (isEyeCell(x, y, size)) return false;
      if (!matrix[y][x]) return false;
      return keep(x, y);
    }

    if (shape === 'bars-v' || shape === 'bars-h') {
      var horizontal = shape === 'bars-h';
      var outer = horizontal ? size : size;
      for (var a = 0; a < outer; a++) {
        var run = 0;
        for (var b = 0; b <= size; b++) {
          var x0 = horizontal ? b : a;
          var y0 = horizontal ? a : b;
          var filled = b < size && on(x0, y0);
          if (filled) {
            run++;
          } else if (run > 0) {
            var startB = b - run;
            var px = (horizontal ? startB : a) * U + inset;
            var py = (horizontal ? a : startB) * U + inset;
            var pw = (horizontal ? run * U - 2 * inset : w);
            var ph = (horizontal ? w : run * U - 2 * inset);
            d.push(pathRoundRect(px, py, pw, ph, Math.min(pw, ph) / 2));
            run = 0;
          }
        }
      }
      return d.join('');
    }

    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (!on(x, y)) continue;
        var px2 = x * U + inset;
        var py2 = y * U + inset;
        switch (shape) {
          case 'dot':
            d.push(pathCircle(px2 + w / 2, py2 + w / 2, w / 2));
            break;
          case 'rounded':
            d.push(pathRoundRect(px2, py2, w, w, (w / 2) * style.moduleRoundness));
            break;
          case 'leaf':
            d.push(pathRectCorners(px2, py2, w, w, (w / 2) * style.moduleRoundness,
              [true, false, true, false]));
            break;
          case 'fluid':
            // Coin arrondi uniquement lorsque les deux voisins orthogonaux
            // sont absents : les modules contigus se soudent visuellement.
            d.push(pathRectCorners(px2, py2, w, w, (w / 2) * style.moduleRoundness, [
              !on(x, y - 1) && !on(x - 1, y),
              !on(x, y - 1) && !on(x + 1, y),
              !on(x, y + 1) && !on(x + 1, y),
              !on(x, y + 1) && !on(x - 1, y)
            ]));
            break;
          default:
            d.push(pathRect(px2, py2, w, w));
        }
      }
    }
    return d.join('');
  }

  // --- Repères de position (« yeux ») ------------------------------------

  function eyeFramePath(ox, oy, shape, roundness) {
    var x = ox * U, y = oy * U, s = 7 * U;
    var hx = x + U, hy = y + U, hs = 5 * U; // trou intérieur
    var outer, inner;
    switch (shape) {
      case 'leaf': // deux coins opposés carrés
        outer = pathRectCorners(x, y, s, s, (s / 2) * roundness, [true, false, true, false]);
        inner = pathRectCorners(hx, hy, hs, hs, (hs / 2) * roundness, [true, false, true, false]);
        break;
      case 'drop': // un seul coin carré
        outer = pathRectCorners(x, y, s, s, (s / 2) * roundness, [false, true, true, true]);
        inner = pathRectCorners(hx, hy, hs, hs, (hs / 2) * roundness, [false, true, true, true]);
        break;
      case 'rounded':
        outer = pathRoundRect(x, y, s, s, (s / 2) * roundness);
        inner = pathRoundRect(hx, hy, hs, hs, (hs / 2) * roundness);
        break;
      default:
        outer = pathRect(x, y, s, s);
        inner = pathRect(hx, hy, hs, hs);
    }
    return outer + inner; // fill-rule="evenodd" creuse le trou
  }

  function eyePupilPath(ox, oy, shape, roundness) {
    var x = (ox + 2) * U, y = (oy + 2) * U, s = 3 * U;
    switch (shape) {
      case 'leaf': return pathRectCorners(x, y, s, s, (s / 2) * roundness, [true, false, true, false]);
      case 'rounded': return pathRoundRect(x, y, s, s, (s / 2) * roundness);
      default: return pathRect(x, y, s, s);
    }
  }

  // --- Dégradés ----------------------------------------------------------

  function gradientDef(id, style, x0, y0, side) {
    var stops = '<stop offset="0" stop-color="' + esc(style.fgColor) + '"/>' +
      '<stop offset="1" stop-color="' + esc(style.fgColor2) + '"/>';
    var cx = x0 + side / 2, cy = y0 + side / 2;
    if (style.fgType === 'radial') {
      return '<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + n(cx) +
        '" cy="' + n(cy) + '" r="' + n(side / 2) + '">' + stops + '</radialGradient>';
    }
    var rad = (style.gradAngle * Math.PI) / 180;
    var reach = (side / 2) * (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad)));
    return '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' +
      n(cx - Math.cos(rad) * reach) + '" y1="' + n(cy - Math.sin(rad) * reach) + '" x2="' +
      n(cx + Math.cos(rad) * reach) + '" y2="' + n(cy + Math.sin(rad) * reach) + '">' +
      stops + '</linearGradient>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Logo ---------------------------------------------------------------

  // Zone (en modules) recouverte par le logo, marge comprise.
  function logoBox(size, logo) {
    var span = size * logo.sizePct;
    var pad = logo.padding * 2;
    var total = span + pad;
    var start = (size - total) / 2;
    return { start: start, end: start + total, span: span, total: total };
  }

  function logoMarkup(size, quiet, logo, bgColor) {
    if (!logo || !logo.src) return '';
    var box = logoBox(size, logo);
    var px = (quiet + box.start) * U;
    var total = box.total * U;
    var imgSize = box.span * U;
    var imgPos = px + (total - imgSize) / 2;
    var out = '';

    if (logo.backing !== 'none') {
      var backFill = esc(logo.backingColor || bgColor || '#FFFFFF');
      out += '<path d="' + (logo.backing === 'circle'
        ? pathCircle(px + total / 2, px + total / 2, total / 2)
        : pathRoundRect(px, px, total, total, (total / 2) * logo.backingRoundness)) +
        '" fill="' + backFill + '"/>';
    }

    if (logo.vector) {
      // Logo SVG : on conserve le vectoriel en transposant le viewBox.
      var vb = logo.vector.viewBox;
      var k = imgSize / Math.max(vb.w, vb.h);
      var tx = imgPos + (imgSize - vb.w * k) / 2 - vb.x * k;
      var ty = imgPos + (imgSize - vb.h * k) / 2 - vb.y * k;
      out += '<g transform="translate(' + n(tx) + ' ' + n(ty) + ') scale(' + n(k) + ')">' +
        logo.vector.content + '</g>';
    } else {
      out += '<image href="' + esc(logo.src) + '" xlink:href="' + esc(logo.src) +
        '" x="' + n(imgPos) + '" y="' + n(imgPos) + '" width="' + n(imgSize) +
        '" height="' + n(imgSize) + '" preserveAspectRatio="xMidYMid meet"/>';
    }
    return out;
  }

  // --- Rendu principal ----------------------------------------------------

  var DEFAULTS = {
    moduleShape: 'square',
    moduleRoundness: 0.4,
    moduleScale: 1,
    eyeFrameShape: 'square',
    eyeFrameRoundness: 0.35,
    eyePupilShape: 'square',
    eyePupilRoundness: 0.4,
    fgType: 'solid',
    fgColor: '#000000',
    fgColor2: '#000000',
    gradAngle: 45,
    gradientOnEyes: true,
    eyeFrameColor: '',
    eyePupilColor: '',
    bgColor: '#FFFFFF',
    bgTransparent: false,
    quietZone: 4,
    logo: null,
    widthMm: 40,
    widthPx: null
  };

  function toSVG(qr, options) {
    var style = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      style[k] = options && options[k] !== undefined ? options[k] : DEFAULTS[k];
    });

    var size = qr.size;
    var quiet = style.quietZone;
    var span = size + quiet * 2;
    var viewSize = span * U;
    var codeOrigin = quiet * U;
    var codeSide = size * U;

    // Détourage des modules sous le logo.
    var underLogo = function () { return false; };
    if (style.logo && style.logo.src && style.logo.knockout) {
      var box = logoBox(size, style.logo);
      underLogo = function (x, y) {
        return x + 0.5 > box.start && x + 0.5 < box.end &&
          y + 0.5 > box.start && y + 0.5 < box.end;
      };
    }
    var keep = function (x, y) { return !underLogo(x, y); };

    // Comptage indépendant du rendu : `keep` est aussi interrogé pour les
    // voisins (forme fluide), il ne peut donc pas servir de compteur.
    var darkModules = 0;
    var cleared = 0;
    for (var sy = 0; sy < size; sy++) {
      for (var sx = 0; sx < size; sx++) {
        if (isEyeCell(sx, sy, size) || !qr.modules[sy][sx]) continue;
        darkModules++;
        if (underLogo(sx, sy)) cleared++;
      }
    }

    var dModules = modulesPath(qr.modules, size, style, keep);
    var eyes = [[0, 0], [size - 7, 0], [0, size - 7]];
    var dFrames = eyes.map(function (p) {
      return eyeFramePath(p[0], p[1], style.eyeFrameShape, style.eyeFrameRoundness);
    }).join('');
    var dPupils = eyes.map(function (p) {
      return eyePupilPath(p[0], p[1], style.eyePupilShape, style.eyePupilRoundness);
    }).join('');

    var defs = '';
    var fgPaint = esc(style.fgColor);
    if (style.fgType !== 'solid') {
      defs += gradientDef('qart-fg', style, codeOrigin, codeOrigin, codeSide);
      fgPaint = 'url(#qart-fg)';
    }
    var framePaint = style.eyeFrameColor ? esc(style.eyeFrameColor)
      : (style.fgType !== 'solid' && !style.gradientOnEyes ? esc(style.fgColor) : fgPaint);
    var pupilPaint = style.eyePupilColor ? esc(style.eyePupilColor)
      : (style.fgType !== 'solid' && !style.gradientOnEyes ? esc(style.fgColor) : fgPaint);

    var body = '';
    if (!style.bgTransparent) {
      body += '<path id="qart-bg" d="' + pathRect(0, 0, viewSize, viewSize) +
        '" fill="' + esc(style.bgColor) + '"/>';
    }
    var shift = 'translate(' + n(codeOrigin) + ' ' + n(codeOrigin) + ')';
    body += '<g transform="' + shift + '">';
    body += '<path id="qart-modules" d="' + dModules + '" fill="' + fgPaint + '"/>';
    body += '<path id="qart-eye-frames" d="' + dFrames + '" fill="' + framePaint + '" fill-rule="evenodd"/>';
    body += '<path id="qart-eye-pupils" d="' + dPupils + '" fill="' + pupilPaint + '"/>';
    body += '</g>';
    body += logoMarkup(size, quiet, style.logo, style.bgTransparent ? null : style.bgColor);

    // Dimensions physiques pour la chaîne print, ou pixels pour la rasterisation.
    var sizeAttr = style.widthPx
      ? ' width="' + n(style.widthPx) + '" height="' + n(style.widthPx) + '"'
      : ' width="' + n(style.widthMm) + 'mm" height="' + n(style.widthMm) + 'mm"';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' +
      sizeAttr +
      ' viewBox="0 0 ' + n(viewSize) + ' ' + n(viewSize) + '"' +
      ' shape-rendering="geometricPrecision">' +
      (defs ? '<defs>' + defs + '</defs>' : '') + body + '</svg>';

    return {
      svg: svg,
      clearedModules: cleared,
      darkModules: darkModules,
      viewSize: viewSize,
      span: span
    };
  }

  global.QArt = global.QArt || {};
  global.QArt.render = { toSVG: toSVG, UNIT: U };
})(typeof window !== 'undefined' ? window : globalThis);
