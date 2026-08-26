/*
 * export.js — Sortie des fichiers : SVG, PNG, presse-papier.
 * Tout se fait dans le navigateur, sans requête réseau.
 */
(function (global) {
  'use strict';

  function svgBlob(svg) {
    return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadSVG(svg, name) {
    saveBlob(svgBlob(svg), name + '.svg');
  }

  /*
   * Rasterise le SVG à la taille demandée. Le SVG doit porter des dimensions
   * en pixels : le navigateur s'appuie dessus pour dimensionner l'image
   * source avant l'échantillonnage, et un SVG coté en millimètres produirait
   * un rendu flou sur certains moteurs.
   */
  function toPNGBlob(svg, px) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(svgBlob(svg));
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = px;
        canvas.height = px;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, px, px);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('La conversion PNG a échoué.'));
        }, 'image/png');
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Le SVG n'a pas pu être rasterisé."));
      };
      img.src = url;
    });
  }

  function downloadPNG(svg, px, name) {
    return toPNGBlob(svg, px).then(function (blob) {
      saveBlob(blob, name + '.png');
    });
  }

  // Presse-papier, avec repli sur execCommand hors contexte sécurisé.
  function copyText(text) {
    if (navigator.clipboard && global.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      ok ? resolve() : reject(new Error('Copie impossible dans ce navigateur.'));
    });
  }

  // Nom de fichier sûr, dérivé d'une saisie libre.
  function slugify(value, fallback) {
    var s = String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return s || fallback;
  }

  global.QArt = global.QArt || {};
  global.QArt.exporter = {
    downloadSVG: downloadSVG,
    downloadPNG: downloadPNG,
    toPNGBlob: toPNGBlob,
    copyText: copyText,
    slugify: slugify
  };
})(typeof window !== 'undefined' ? window : globalThis);
