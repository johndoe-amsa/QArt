/*
 * app.js — État de l'interface, aperçu temps réel, diagnostic de lisibilité.
 */
(function () {
  'use strict';

  var qrlib = window.QArt.qr;
  var renderer = window.QArt.render;
  var exporter = window.QArt.exporter;

  // --- État ---------------------------------------------------------------

  var DEFAULT_STATE = {
    content: 'https://exemple.fr/campagne-automne',
    ecl: 'M',
    boostEcl: true,
    minVersion: 0, // 0 = automatique
    mask: -1,
    quietZone: 4,

    moduleShape: 'square',
    moduleRoundness: 40,
    moduleScale: 100,

    fgType: 'solid',
    fgColor: '#111111',
    fgColor2: '#4B5563',
    gradAngle: 45,

    bgColor: '#FFFFFF',
    bgTransparent: false,

    eyeFrameShape: 'square',
    eyeFrameRoundness: 35,
    eyePupilShape: 'square',
    eyePupilRoundness: 40,
    eyeFrameColor: '#111111',
    eyeFrameInherit: true,
    eyePupilColor: '#111111',
    eyePupilInherit: true,

    logo: null, // { src, name, bytes, vector, aspect }
    logoSizePct: 20,
    logoPadding: 6, // dixièmes de module
    logoBacking: 'fit',
    logoBackingRoundness: 25,
    logoBackingColor: '#FFFFFF',
    logoBackingInherit: true,
    logoBackingTransparent: false,
    logoKnockout: true,

    unit: 'mm',
    widthMm: 40,
    dpi: 300,
    widthPx: 1024,
    filename: 'qrcode'
  };

  var state = Object.assign({}, DEFAULT_STATE);
  var lastEncoded = null;
  var lastEncodeKey = '';
  var lastRender = null;

  var el = {};
  ['content', 'byte-count', 'mode-summary', 'content-error', 'ecc-group', 'boost-ecl',
    'min-version', 'mask', 'quiet', 'quiet-val',
    'module-shape', 'module-roundness', 'module-roundness-val', 'module-scale', 'module-scale-val',
    'roundness-field', 'fill-group', 'fg-color', 'fg-hex', 'fg2-field', 'fg-color2', 'fg-hex2',
    'angle-field', 'grad-angle', 'grad-angle-val', 'bg-color', 'bg-hex', 'bg-transparent',
    'eye-frame-shape', 'eye-frame-roundness', 'eye-frame-roundness-val',
    'eye-pupil-shape', 'eye-pupil-roundness', 'eye-pupil-roundness-val',
    'eye-frame-color', 'eye-frame-inherit', 'eye-pupil-color', 'eye-pupil-inherit',
    'dropzone', 'logo-input', 'logo-browse', 'logo-preview', 'logo-thumb', 'logo-name',
    'logo-size', 'logo-remove', 'logo-settings', 'logo-size-pct', 'logo-size-val',
    'logo-padding', 'logo-padding-val', 'logo-backing', 'logo-backing-round-field',
    'logo-backing-roundness', 'logo-backing-roundness-val', 'logo-knockout',
    'logo-backing-color', 'logo-backing-hex', 'logo-backing-inherit', 'logo-backing-transparent',
    'unit-group', 'mm-fields', 'width-mm', 'dpi', 'px-field', 'width-px', 'dimension-hint',
    'filename', 'dl-svg', 'dl-png', 'dl-svg-2', 'dl-png-2', 'copy-svg', 'reset-all',
    'stage', 'readout', 'fill-bar', 'fill-text', 'checks', 'theme-toggle', 'toast', 'toast-text'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  // --- Utilitaires --------------------------------------------------------

  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
    if (!m) return null;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  function normalizeHex(value, fallback) {
    var v = String(value || '').trim();
    if (/^[a-f\d]{6}$/i.test(v)) v = '#' + v;
    if (/^#[a-f\d]{3}$/i.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return /^#[a-f\d]{6}$/i.test(v) ? v.toUpperCase() : fallback;
  }

  function luminance(rgb) {
    var c = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrastRatio(a, b) {
    var l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function fmt(value, decimals) {
    return value.toFixed(decimals === undefined ? 1 : decimals).replace('.', ',');
  }

  function bytesLabel(v) {
    return v < 1024 ? v + ' o' : v < 1048576 ? fmt(v / 1024) + ' Ko' : fmt(v / 1048576) + ' Mo';
  }

  var toastTimer = null;
  function toast(message) {
    el['toast-text'].textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 4000);
  }

  // --- Construction du style de rendu -------------------------------------

  // Couleur effective de la pastille : héritée du fond du symbole ou choisie.
  function backingColor() {
    if (!state.logoBackingInherit) return state.logoBackingColor;
    return state.bgTransparent ? '#FFFFFF' : state.bgColor;
  }

  function buildStyle(overrides) {
    var logo = null;
    if (state.logo) {
      logo = {
        src: state.logo.src,
        vector: state.logo.vector,
        aspect: state.logo.aspect,
        sizePct: state.logoSizePct / 100,
        padding: state.logoPadding / 10,
        backing: state.logoBacking,
        backingRoundness: state.logoBackingRoundness / 100,
        backingColor: backingColor(),
        backingTransparent: state.logoBackingTransparent,
        knockout: state.logoKnockout
      };
    }
    return Object.assign({
      moduleShape: state.moduleShape,
      moduleRoundness: state.moduleRoundness / 100,
      moduleScale: state.moduleScale / 100,
      eyeFrameShape: state.eyeFrameShape,
      eyeFrameRoundness: state.eyeFrameRoundness / 100,
      eyePupilShape: state.eyePupilShape,
      eyePupilRoundness: state.eyePupilRoundness / 100,
      fgType: state.fgType,
      fgColor: state.fgColor,
      fgColor2: state.fgColor2,
      gradAngle: state.gradAngle,
      gradientOnEyes: true,
      eyeFrameColor: state.eyeFrameInherit ? '' : state.eyeFrameColor,
      eyePupilColor: state.eyePupilInherit ? '' : state.eyePupilColor,
      bgColor: state.bgColor,
      bgTransparent: state.bgTransparent,
      quietZone: state.quietZone,
      logo: logo,
      widthMm: state.widthMm
    }, overrides || {});
  }

  function encode() {
    var key = [state.content, state.ecl, state.boostEcl, state.minVersion, state.mask].join(' ');
    if (key === lastEncodeKey && lastEncoded) return lastEncoded;
    var result = qrlib.encode(state.content, {
      ecl: state.ecl,
      boostEcl: state.boostEcl,
      minVersion: state.minVersion || 1,
      mask: state.mask
    });
    lastEncodeKey = key;
    lastEncoded = result;
    return result;
  }

  // --- Diagnostic de lisibilité -------------------------------------------

  /*
   * Seuils calés sur un banc de décodage : chaque variante de forme a été
   * rendue puis relue par un décodeur sur les versions 1 à 20. Les taux cités
   * proviennent de ces mesures, documentées dans le README.
   */
  /*
   * Encres réellement présentes dans le symbole. Les repères de position n'y
   * figurent que lorsqu'ils ne suivent pas la couleur des modules — sans quoi
   * une couleur de repère mal choisie passerait sous le radar.
   */
  function symbolInks() {
    var inks = [{ label: 'les modules', rgb: hexToRgb(state.fgColor) || [0, 0, 0], critical: false }];
    if (state.fgType !== 'solid') {
      inks.push({ label: 'la seconde couleur du dégradé', rgb: hexToRgb(state.fgColor2) || [0, 0, 0], critical: false });
    }
    if (!state.eyeFrameInherit) {
      inks.push({ label: 'le cadre des repères', rgb: hexToRgb(state.eyeFrameColor) || [0, 0, 0], critical: true });
    }
    if (!state.eyePupilInherit) {
      inks.push({ label: 'la pupille des repères', rgb: hexToRgb(state.eyePupilColor) || [0, 0, 0], critical: true });
    }
    return inks;
  }

  var FINDER_NOTE = ' Les repères de position amorcent la détection : s\u2019ils se fondent dans le fond, le symbole n\u2019est pas trouvé du tout.';

  function buildChecks(qr, rendered) {
    var checks = [];
    var bg = state.bgTransparent ? [255, 255, 255] : (hexToRgb(state.bgColor) || [255, 255, 255]);
    var inks = symbolInks();
    var note = state.bgTransparent ? ' Fond transparent : mesure faite sur blanc.' : '';

    // 1. Contraste : on retient l'encre la moins contrastée, repères compris.
    var worst = inks[0];
    inks.forEach(function (ink) {
      if (contrastRatio(ink.rgb, bg) < contrastRatio(worst.rgb, bg)) worst = ink;
    });
    var ratio = contrastRatio(worst.rgb, bg);
    var subject = inks.length > 1 ? ' Élément le moins contrasté : ' + worst.label + '.' : '';
    var finderNote = worst.critical ? FINDER_NOTE : '';
    if (ratio < 3) {
      checks.push(['error', 'Contraste insuffisant',
        'Rapport ' + fmt(ratio) + ':1. En dessous de 3:1, la plupart des lecteurs échouent.' +
        subject + note + finderNote]);
    } else if (ratio < 5) {
      checks.push(['warn', 'Contraste limite',
        'Rapport ' + fmt(ratio) + ':1. Viser 7:1 pour une lecture fiable en conditions dégradées.' +
        subject + note + finderNote]);
    } else {
      checks.push(['ok', 'Contraste suffisant', 'Rapport ' + fmt(ratio) + ':1.' + subject + note]);
    }

    // 2. Sens du contraste : toute encre plus claire que le fond disparaît.
    var lighter = inks.filter(function (ink) { return luminance(ink.rgb) > luminance(bg); });
    if (lighter.length) {
      var names = lighter.map(function (ink) { return ink.label; }).join(' et ');
      checks.push(['error', 'Encre plus claire que le fond',
        'Un symbole inversé n\u2019est pas reconnu par une partie des lecteurs mobiles. En cause : ' +
        names + '.' + (lighter.some(function (i) { return i.critical; }) ? FINDER_NOTE : '')]);
    }

    // 3. Zone de silence.
    if (state.quietZone < 4) {
      checks.push(['warn', 'Zone de silence réduite',
        state.quietZone + ' module' + (state.quietZone > 1 ? 's' : '') +
        ' au lieu des 4 exigés par la norme ISO/IEC 18004.']);
    }

    /*
     * 4. Budget de correction consommé par le logo. Le décompte vaut que les
     * modules soient effacés du tracé ou seulement recouverts : dans les deux
     * cas le lecteur ne les voit plus.
     */
    if (state.logo && rendered.clearedModules > 0) {
      var occluded = rendered.clearedModules / rendered.darkModules;
      var consumed = occluded / qr.correctionRatio;
      var detail = fmt(occluded * 100) + ' % des modules sombres neutralisés, pour une capacité de correction de ' +
        Math.round(qr.correctionRatio * 100) + ' % (niveau ' + qr.ecl + ').';
      if (consumed > 1) {
        checks.push(['error', 'Logo trop grand pour ce niveau',
          'Budget de correction dépassé (' + Math.round(consumed * 100) + ' %). ' + detail +
          ' Réduire le logo ou passer au niveau H.']);
      } else if (consumed > 0.6) {
        checks.push(['warn', 'Logo proche de la limite',
          Math.round(consumed * 100) + ' % du budget de correction consommé. ' + detail]);
      } else {
        checks.push(['ok', 'Logo dans le budget',
          Math.round(consumed * 100) + ' % du budget de correction consommé.']);
      }
    }

    // 5. Formes dont la lecture est mesurée comme moins sûre.
    if (state.moduleShape === 'dot') {
      checks.push(['warn', 'Modules ronds',
        'Les modules détachés réduisent la surface encrée : 14 décodages réussis sur 21 au banc, contre 21 sur 21 en carré.']);
    }
    if (state.moduleShape === 'rounded' && state.moduleRoundness > 85) {
      checks.push(['warn', 'Arrondi proche du cercle',
        'Au-delà de 85 %, les modules se détachent comme des points et la lecture se dégrade.']);
    }
    if (state.moduleScale < 90) {
      checks.push(['warn', 'Modules amincis',
        state.moduleScale + ' % de l\u2019épaisseur nominale : les blancs s\u2019élargissent et la marge de lecture diminue.']);
    }
    if (state.eyeFrameRoundness > 80 || state.eyePupilRoundness > 80) {
      checks.push(['warn', 'Repères quasi circulaires',
        'Les repères de position servent de gabarit de détection. Très arrondis, ils sortent du rapport 1:1:3:1:1 attendu : 6 décodages sur 21 au banc, contre 21 sur 21 à 35 % d\u2019arrondi.']);
    }

    // 6. Taille physique du module à l'impression.
    var moduleMm = state.widthMm / rendered.span;
    if (moduleMm < 0.4) {
      checks.push(['error', 'Module trop petit à l\u2019impression',
        'Chaque module mesurerait ' + fmt(moduleMm, 2) + ' mm. En dessous de 0,4 mm le trait ne tient plus en offset.']);
    } else if (moduleMm < 0.6) {
      checks.push(['warn', 'Module de petite taille',
        fmt(moduleMm, 2) + ' mm par module. Prévoir ' + fmt(rendered.span * 0.6, 0) + ' mm de large pour rester confortable.']);
    }

    var hasIssue = checks.some(function (c) { return c[0] !== 'ok'; });
    if (!hasIssue) {
      checks.push(['ok', 'Aucun risque détecté',
        'Les réglages restent dans les marges mesurées comme fiables.']);
    }
    return checks;
  }

  var ICONS = { ok: 'i-ok', warn: 'i-alert', error: 'i-alert', info: 'i-info' };

  function renderChecks(checks) {
    el.checks.textContent = '';
    checks.forEach(function (c) {
      var li = document.createElement('li');
      li.setAttribute('data-level', c[0]);
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'icon');
      svg.setAttribute('aria-hidden', 'true');
      var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#' + ICONS[c[0]]);
      svg.appendChild(use);
      var body = document.createElement('div');
      var title = document.createElement('b');
      title.textContent = c[1];
      var text = document.createElement('small');
      text.textContent = c[2];
      body.appendChild(title);
      body.appendChild(text);
      li.appendChild(svg);
      li.appendChild(body);
      el.checks.appendChild(li);
    });
  }

  // --- Relevé technique ---------------------------------------------------

  function renderReadout(qr, rendered) {
    var modes = qr.segments.map(function (s) { return s.label + ' (' + s.length + ')'; }).join(' + ') || '—';
    var rows = [
      ['Version', qr.version + ' — ' + qr.size + ' × ' + qr.size],
      ['Correction', qr.ecl + (qr.eclBoosted ? ' (élevé depuis ' + qr.requestedEcl + ')' : '') +
        ' — ' + Math.round(qr.correctionRatio * 100) + ' %'],
      ['Masque', qr.mask + (qr.maskAuto ? ' (auto)' : ' (imposé)')],
      ['Encodage', modes],
      ['Codets de données', String(qr.dataCodewords)],
      ['Codets de correction', qr.eccCodewords + ' en ' + qr.eccBlocks + ' bloc' + (qr.eccBlocks > 1 ? 's' : '')],
      ['Module imprimé', fmt(state.widthMm / rendered.span, 2) + ' mm']
    ];
    el.readout.textContent = '';
    rows.forEach(function (r) {
      var dt = document.createElement('dt');
      dt.textContent = r[0];
      var dd = document.createElement('dd');
      dd.textContent = r[1];
      el.readout.appendChild(dt);
      el.readout.appendChild(dd);
    });

    var pct = Math.round((qr.usedBits / qr.capacityBits) * 100);
    el['fill-bar'].style.width = Math.min(100, pct) + '%';
    el['fill-text'].textContent = 'Remplissage ' + pct + ' % — ' + Math.ceil(qr.usedBits / 8) +
      ' octets sur ' + Math.floor(qr.capacityBits / 8) + ' disponibles';
  }

  function showEmptyState(title, description) {
    el.stage.classList.remove('is-transparent');
    el.stage.textContent = '';
    var wrap = document.createElement('div');
    wrap.className = 'empty';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon icon--24');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-info');
    svg.appendChild(use);
    var h = document.createElement('p');
    h.className = 'empty__title';
    h.textContent = title;
    var p = document.createElement('p');
    p.className = 'empty__text';
    p.textContent = description;
    wrap.appendChild(svg);
    wrap.appendChild(h);
    wrap.appendChild(p);
    el.stage.appendChild(wrap);

    el.readout.textContent = '';
    el.checks.textContent = '';
    el['fill-bar'].style.width = '0%';
    el['fill-text'].textContent = '—';
  }

  // --- Rendu --------------------------------------------------------------

  function update() {
    var bytes = new TextEncoder().encode(state.content).length;
    el['byte-count'].textContent = Array.from(state.content).length;

    if (!state.content) {
      el['mode-summary'].textContent = '—';
      el['content-error'].hidden = true;
      el.content.classList.remove('is-error');
      showEmptyState('Aucun contenu', 'Saisir une URL ou un texte pour générer le symbole.');
      return;
    }

    var qr;
    try {
      qr = encode();
    } catch (e) {
      el['content-error'].textContent = e.message;
      el['content-error'].hidden = false;
      el.content.classList.add('is-error');
      el['mode-summary'].textContent = bytesLabel(bytes);
      showEmptyState('Capacité dépassée', e.message);
      return;
    }

    el['content-error'].hidden = true;
    el.content.classList.remove('is-error');
    el['mode-summary'].textContent = bytesLabel(bytes) + ' · ' +
      qr.segments.map(function (s) { return s.label; }).join(' + ');

    var rendered = renderer.toSVG(qr, buildStyle());
    lastRender = { qr: qr, rendered: rendered };

    el.stage.classList.toggle('is-transparent', state.bgTransparent);
    el.stage.innerHTML = rendered.svg;

    renderReadout(qr, rendered);
    renderChecks(buildChecks(qr, rendered));
    updateDimensionHint(rendered);
    if (state.logo) syncBackingColorDisplay();
  }

  function exportPixelWidth() {
    if (state.unit === 'px') return Math.round(state.widthPx);
    return Math.round((state.widthMm / 25.4) * state.dpi);
  }

  function updateDimensionHint(rendered) {
    var px = exportPixelWidth();
    var effectiveDpi = state.unit === 'px'
      ? Math.round(px / (state.widthMm / 25.4))
      : state.dpi;
    el['dimension-hint'].textContent =
      'SVG : ' + fmt(state.widthMm, 0) + ' × ' + fmt(state.widthMm, 0) + ' mm. ' +
      'PNG : ' + px + ' × ' + px + ' px, soit ' + effectiveDpi + ' DPI à cette largeur. ' +
      rendered.span + ' modules de large, zone de silence comprise.';
  }

  var updateTimer = null;
  function scheduleUpdate(delay) {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, delay === undefined ? 0 : delay);
  }

  // --- Liaisons d'interface -----------------------------------------------

  function bindTabs() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) {
          var active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', String(active));
          document.getElementById(b.getAttribute('aria-controls')).hidden = !active;
        });
      });
    });
  }

  function syncSegmented(group, value) {
    Array.prototype.slice.call(group.querySelectorAll('.seg__btn')).forEach(function (b) {
      var active = b.getAttribute('data-value') === String(value);
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-checked', String(active));
    });
  }

  function bindSegmented(group, key, onChange) {
    group.addEventListener('click', function (e) {
      var btn = e.target.closest('.seg__btn');
      if (!btn) return;
      state[key] = btn.getAttribute('data-value');
      syncSegmented(group, state[key]);
      if (onChange) onChange();
      scheduleUpdate();
    });
  }

  function bindRange(input, label, key, format) {
    input.addEventListener('input', function () {
      state[key] = Number(input.value);
      label.textContent = format ? format(state[key]) : state[key];
      scheduleUpdate();
    });
  }

  function bindColor(picker, hexInput, key) {
    picker.addEventListener('input', function () {
      state[key] = picker.value.toUpperCase();
      if (hexInput) hexInput.value = state[key];
      scheduleUpdate();
    });
    if (!hexInput) return;
    hexInput.addEventListener('input', function () {
      var v = normalizeHex(hexInput.value, null);
      hexInput.classList.toggle('is-error', !v && hexInput.value.length > 0);
      if (!v) return;
      state[key] = v;
      picker.value = v;
      scheduleUpdate();
    });
    hexInput.addEventListener('blur', function () {
      hexInput.value = state[key];
      hexInput.classList.remove('is-error');
    });
  }

  function syncFillControls() {
    el['fg2-field'].hidden = state.fgType === 'solid';
    el['angle-field'].hidden = state.fgType !== 'linear';
  }

  function syncShapeControls() {
    var usesRoundness = ['rounded', 'leaf', 'fluid'].indexOf(state.moduleShape) !== -1;
    el['roundness-field'].hidden = !usesRoundness;
  }

  function syncLogoControls() {
    var has = !!state.logo;
    el['logo-preview'].hidden = !has;
    el['logo-settings'].hidden = !has;
    el.dropzone.hidden = has;
    // L'arrondi n'a de sens que sur une pastille rectangulaire.
    el['logo-backing-round-field'].hidden = state.logoBacking === 'circle';

    var transparent = state.logoBackingTransparent;
    el['logo-backing-inherit'].disabled = transparent;
    el['logo-backing-color'].disabled = transparent || state.logoBackingInherit;
    el['logo-backing-hex'].disabled = transparent || state.logoBackingInherit;
    syncBackingColorDisplay();
  }

  // Quand la couleur est héritée, les champs reflètent la teinte effective.
  function syncBackingColorDisplay() {
    if (!state.logoBackingInherit) return;
    var effective = backingColor();
    el['logo-backing-color'].value = effective;
    el['logo-backing-hex'].value = effective;
  }

  function syncUnitControls() {
    el['px-field'].hidden = state.unit !== 'px';
    el.dpi.disabled = state.unit === 'px';
  }

  // --- Logo ---------------------------------------------------------------

  var LOGO_MAX_BYTES = 2 * 1024 * 1024;

  function readLogo(file) {
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      toast('Logo trop volumineux (' + bytesLabel(file.size) + '). Limite : 2 Mo.');
      return;
    }
    var isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    var reader = new FileReader();
    reader.onload = function () {
      var payload = { name: file.name, bytes: file.size, vector: null, src: '', aspect: 1 };
      if (isSvg) {
        var parsed = parseSvgLogo(String(reader.result));
        if (!parsed) {
          toast('Ce fichier SVG n\u2019a pas pu être analysé.');
          return;
        }
        payload.vector = parsed;
        payload.aspect = parsed.viewBox.w / parsed.viewBox.h;
        payload.src = 'data:image/svg+xml;base64,' +
          btoa(unescape(encodeURIComponent(String(reader.result))));
        applyLogo(payload, true);
      } else {
        payload.src = String(reader.result);
        // Les proportions d'une image matricielle ne sont connues qu'une fois
        // décodée : le logo n'est appliqué qu'à ce moment-là.
        var probe = new Image();
        probe.onload = function () {
          payload.aspect = probe.naturalWidth && probe.naturalHeight
            ? probe.naturalWidth / probe.naturalHeight
            : 1;
          applyLogo(payload, false);
        };
        probe.onerror = function () { toast('Ce fichier image n\u2019a pas pu être décodé.'); };
        probe.src = payload.src;
      }
    };
    reader.onerror = function () { toast('Lecture du fichier impossible.'); };
    if (isSvg) reader.readAsText(file);
    else reader.readAsDataURL(file);
  }

  function describeAspect(aspect) {
    if (!(aspect > 0)) return 'proportions inconnues';
    if (Math.abs(aspect - 1) < 0.02) return 'carré';
    return aspect > 1 ? 'paysage ' + fmt(aspect, 2) + ':1' : 'portrait 1:' + fmt(1 / aspect, 2);
  }

  function applyLogo(payload, isSvg) {
    state.logo = payload;
    el['logo-thumb'].src = payload.src;
    el['logo-name'].textContent = payload.name;
    el['logo-size'].textContent = bytesLabel(payload.bytes) +
      (isSvg ? ' · vectoriel conservé' : ' · image matricielle') +
      ' · ' + describeAspect(payload.aspect);
    syncLogoControls();
    update();
  }

  /*
   * Extrait le contenu d'un SVG importé pour le réinjecter tel quel dans
   * l'export : le logo reste vectoriel jusque dans Illustrator. Les
   * identifiants sont préfixés pour ne pas entrer en collision avec ceux du
   * symbole, et les éléments actifs sont retirés.
   */
  function parseSvgLogo(source) {
    var doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;
    var root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return null;

    Array.prototype.slice.call(root.querySelectorAll('script,foreignObject')).forEach(function (node) {
      node.parentNode.removeChild(node);
    });

    var prefix = 'qart-logo-';
    Array.prototype.slice.call(root.querySelectorAll('[id]')).forEach(function (node) {
      node.setAttribute('id', prefix + node.getAttribute('id'));
    });

    var content = root.innerHTML
      .replace(/url\(#([^)]+)\)/g, 'url(#' + prefix + '$1)')
      .replace(/(xlink:href="|href=")#([^"]+)"/g, '$1#' + prefix + '$2"');

    var box;
    var viewBox = root.getAttribute('viewBox');
    if (viewBox) {
      var parts = viewBox.trim().split(/[\s,]+/).map(Number);
      box = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    } else {
      box = {
        x: 0, y: 0,
        w: parseFloat(root.getAttribute('width')) || 100,
        h: parseFloat(root.getAttribute('height')) || 100
      };
    }
    if (!box.w || !box.h || !isFinite(box.w) || !isFinite(box.h)) return null;
    return { viewBox: box, content: content };
  }

  function clearLogo() {
    state.logo = null;
    el['logo-input'].value = '';
    el['logo-thumb'].removeAttribute('src');
    syncLogoControls();
    update();
  }

  // --- Export -------------------------------------------------------------

  function currentName() {
    return exporter.slugify(el.filename.value, 'qrcode');
  }

  function exportSVG() {
    if (!lastRender) return;
    var out = renderer.toSVG(lastRender.qr, buildStyle({ widthMm: state.widthMm, widthPx: null }));
    exporter.downloadSVG(out.svg, currentName());
    toast('SVG exporté à ' + fmt(state.widthMm, 0) + ' mm de côté.');
  }

  function exportPNG() {
    if (!lastRender) return;
    var px = exportPixelWidth();
    var out = renderer.toSVG(lastRender.qr, buildStyle({ widthPx: px }));
    exporter.downloadPNG(out.svg, px, currentName())
      .then(function () { toast('PNG exporté en ' + px + ' × ' + px + ' px.'); })
      .catch(function (e) { toast(e.message); });
  }

  function copySVG() {
    if (!lastRender) return;
    var out = renderer.toSVG(lastRender.qr, buildStyle({ widthMm: state.widthMm, widthPx: null }));
    exporter.copyText(out.svg)
      .then(function () { toast('Code SVG copié.'); })
      .catch(function (e) { toast(e.message); });
  }

  // --- Thème --------------------------------------------------------------

  var THEME_KEY = 'qart-theme';

  function applyTheme(theme) {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }

  function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { stored = null; }
    applyTheme(stored);
    el['theme-toggle'].addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = current ? (current === 'dark' ? 'light' : 'dark') : (systemDark ? 'light' : 'dark');
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* stockage indisponible */ }
    });
  }

  // --- Initialisation -----------------------------------------------------

  function populateVersions() {
    var frag = document.createDocumentFragment();
    var auto = document.createElement('option');
    auto.value = '0';
    auto.textContent = 'Automatique';
    frag.appendChild(auto);
    for (var v = 1; v <= qrlib.MAX_VERSION; v++) {
      var o = document.createElement('option');
      o.value = String(v);
      o.textContent = 'Version ' + v + ' — ' + (v * 4 + 17) + ' modules';
      frag.appendChild(o);
    }
    el['min-version'].appendChild(frag);
  }

  function applyStateToDOM() {
    el.content.value = state.content;
    el['boost-ecl'].checked = state.boostEcl;
    el['min-version'].value = String(state.minVersion);
    el.mask.value = String(state.mask);
    el.quiet.value = state.quietZone;
    el['quiet-val'].textContent = state.quietZone;

    el['module-shape'].value = state.moduleShape;
    el['module-roundness'].value = state.moduleRoundness;
    el['module-roundness-val'].textContent = state.moduleRoundness;
    el['module-scale'].value = state.moduleScale;
    el['module-scale-val'].textContent = state.moduleScale;

    el['fg-color'].value = state.fgColor;
    el['fg-hex'].value = state.fgColor;
    el['fg-color2'].value = state.fgColor2;
    el['fg-hex2'].value = state.fgColor2;
    el['grad-angle'].value = state.gradAngle;
    el['grad-angle-val'].textContent = state.gradAngle;

    el['bg-color'].value = state.bgColor;
    el['bg-hex'].value = state.bgColor;
    el['bg-transparent'].checked = state.bgTransparent;

    el['eye-frame-shape'].value = state.eyeFrameShape;
    el['eye-frame-roundness'].value = state.eyeFrameRoundness;
    el['eye-frame-roundness-val'].textContent = state.eyeFrameRoundness;
    el['eye-pupil-shape'].value = state.eyePupilShape;
    el['eye-pupil-roundness'].value = state.eyePupilRoundness;
    el['eye-pupil-roundness-val'].textContent = state.eyePupilRoundness;
    el['eye-frame-color'].value = state.eyeFrameColor;
    el['eye-frame-inherit'].checked = state.eyeFrameInherit;
    el['eye-frame-color'].disabled = state.eyeFrameInherit;
    el['eye-pupil-color'].value = state.eyePupilColor;
    el['eye-pupil-inherit'].checked = state.eyePupilInherit;
    el['eye-pupil-color'].disabled = state.eyePupilInherit;

    el['logo-size-pct'].value = state.logoSizePct;
    el['logo-size-val'].textContent = state.logoSizePct;
    el['logo-padding'].value = state.logoPadding;
    el['logo-padding-val'].textContent = fmt(state.logoPadding / 10);
    el['logo-backing'].value = state.logoBacking;
    el['logo-backing-roundness'].value = state.logoBackingRoundness;
    el['logo-backing-roundness-val'].textContent = state.logoBackingRoundness;
    el['logo-backing-color'].value = state.logoBackingColor;
    el['logo-backing-hex'].value = state.logoBackingColor;
    el['logo-backing-inherit'].checked = state.logoBackingInherit;
    el['logo-backing-transparent'].checked = state.logoBackingTransparent;
    el['logo-knockout'].checked = state.logoKnockout;

    el['width-mm'].value = state.widthMm;
    el.dpi.value = String(state.dpi);
    el['width-px'].value = state.widthPx;
    el.filename.value = state.filename;

    syncSegmented(el['ecc-group'], state.ecl);
    syncSegmented(el['fill-group'], state.fgType);
    syncSegmented(el['unit-group'], state.unit);
    syncFillControls();
    syncShapeControls();
    syncLogoControls();
    syncUnitControls();
  }

  function bindAll() {
    bindTabs();

    el.content.addEventListener('input', function () {
      state.content = el.content.value;
      scheduleUpdate(120);
    });

    bindSegmented(el['ecc-group'], 'ecl');
    bindSegmented(el['fill-group'], 'fgType', syncFillControls);
    bindSegmented(el['unit-group'], 'unit', syncUnitControls);

    el['boost-ecl'].addEventListener('change', function () {
      state.boostEcl = el['boost-ecl'].checked;
      scheduleUpdate();
    });
    el['min-version'].addEventListener('change', function () {
      state.minVersion = Number(el['min-version'].value);
      scheduleUpdate();
    });
    el.mask.addEventListener('change', function () {
      state.mask = Number(el.mask.value);
      scheduleUpdate();
    });

    bindRange(el.quiet, el['quiet-val'], 'quietZone');
    bindRange(el['module-roundness'], el['module-roundness-val'], 'moduleRoundness');
    bindRange(el['module-scale'], el['module-scale-val'], 'moduleScale');
    bindRange(el['grad-angle'], el['grad-angle-val'], 'gradAngle');
    bindRange(el['eye-frame-roundness'], el['eye-frame-roundness-val'], 'eyeFrameRoundness');
    bindRange(el['eye-pupil-roundness'], el['eye-pupil-roundness-val'], 'eyePupilRoundness');
    bindRange(el['logo-size-pct'], el['logo-size-val'], 'logoSizePct');
    bindRange(el['logo-padding'], el['logo-padding-val'], 'logoPadding', function (v) { return fmt(v / 10); });
    bindRange(el['logo-backing-roundness'], el['logo-backing-roundness-val'], 'logoBackingRoundness');

    el['module-shape'].addEventListener('change', function () {
      state.moduleShape = el['module-shape'].value;
      syncShapeControls();
      scheduleUpdate();
    });
    el['eye-frame-shape'].addEventListener('change', function () {
      state.eyeFrameShape = el['eye-frame-shape'].value;
      scheduleUpdate();
    });
    el['eye-pupil-shape'].addEventListener('change', function () {
      state.eyePupilShape = el['eye-pupil-shape'].value;
      scheduleUpdate();
    });

    bindColor(el['fg-color'], el['fg-hex'], 'fgColor');
    bindColor(el['fg-color2'], el['fg-hex2'], 'fgColor2');
    bindColor(el['bg-color'], el['bg-hex'], 'bgColor');
    bindColor(el['eye-frame-color'], null, 'eyeFrameColor');
    bindColor(el['eye-pupil-color'], null, 'eyePupilColor');

    el['bg-transparent'].addEventListener('change', function () {
      state.bgTransparent = el['bg-transparent'].checked;
      scheduleUpdate();
    });
    el['eye-frame-inherit'].addEventListener('change', function () {
      state.eyeFrameInherit = el['eye-frame-inherit'].checked;
      el['eye-frame-color'].disabled = state.eyeFrameInherit;
      scheduleUpdate();
    });
    el['eye-pupil-inherit'].addEventListener('change', function () {
      state.eyePupilInherit = el['eye-pupil-inherit'].checked;
      el['eye-pupil-color'].disabled = state.eyePupilInherit;
      scheduleUpdate();
    });

    el['logo-browse'].addEventListener('click', function (e) {
      e.stopPropagation();
      el['logo-input'].click();
    });
    el.dropzone.addEventListener('click', function () { el['logo-input'].click(); });
    el['logo-input'].addEventListener('change', function () { readLogo(el['logo-input'].files[0]); });
    ['dragenter', 'dragover'].forEach(function (type) {
      el.dropzone.addEventListener(type, function (e) {
        e.preventDefault();
        el.dropzone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      el.dropzone.addEventListener(type, function (e) {
        e.preventDefault();
        el.dropzone.classList.remove('is-over');
      });
    });
    el.dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) readLogo(e.dataTransfer.files[0]);
    });
    el['logo-remove'].addEventListener('click', clearLogo);
    el['logo-backing'].addEventListener('change', function () {
      state.logoBacking = el['logo-backing'].value;
      syncLogoControls();
      scheduleUpdate();
    });
    el['logo-knockout'].addEventListener('change', function () {
      state.logoKnockout = el['logo-knockout'].checked;
      scheduleUpdate();
    });
    bindColor(el['logo-backing-color'], el['logo-backing-hex'], 'logoBackingColor');
    el['logo-backing-inherit'].addEventListener('change', function () {
      state.logoBackingInherit = el['logo-backing-inherit'].checked;
      syncLogoControls();
      scheduleUpdate();
    });
    el['logo-backing-transparent'].addEventListener('change', function () {
      state.logoBackingTransparent = el['logo-backing-transparent'].checked;
      syncLogoControls();
      scheduleUpdate();
    });

    el['width-mm'].addEventListener('input', function () {
      var v = Number(el['width-mm'].value);
      if (!(v > 0)) return;
      state.widthMm = v;
      scheduleUpdate();
    });
    el['width-px'].addEventListener('input', function () {
      var v = Number(el['width-px'].value);
      if (!(v > 0)) return;
      state.widthPx = v;
      scheduleUpdate();
    });
    el.dpi.addEventListener('change', function () {
      state.dpi = Number(el.dpi.value);
      scheduleUpdate();
    });
    el.filename.addEventListener('input', function () { state.filename = el.filename.value; });

    [el['dl-svg'], el['dl-svg-2']].forEach(function (b) { b.addEventListener('click', exportSVG); });
    [el['dl-png'], el['dl-png-2']].forEach(function (b) { b.addEventListener('click', exportPNG); });
    el['copy-svg'].addEventListener('click', copySVG);

    el['reset-all'].addEventListener('click', function () {
      state = Object.assign({}, DEFAULT_STATE);
      lastEncodeKey = '';
      el['logo-input'].value = '';
      el['logo-thumb'].removeAttribute('src');
      applyStateToDOM();
      update();
      toast('Réglages rétablis.');
    });
  }

  populateVersions();
  applyStateToDOM();
  bindAll();
  initTheme();
  update();
})();
