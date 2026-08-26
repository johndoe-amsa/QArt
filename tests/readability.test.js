/*
 * Banc de lisibilité : chaque variante de forme est rendue en SVG, rasterisée
 * dans un navigateur puis relue par un décodeur. C'est ce banc qui fixe les
 * seuils du panneau « Contrôle de lisibilité » de l'application.
 *
 * Le décodeur employé (jsQR) est nettement plus strict qu'un lecteur mobile :
 * les taux ci-dessous servent à classer les formes entre elles, pas à prédire
 * un taux de lecture terrain.
 *
 * Usage : npm run test:lisibilite
 * Variable d'environnement facultative : CHROMIUM_PATH
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SOURCES = ['qr.js', 'render.js'].map((f) =>
  fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', f), 'utf8'));
const JSQR = fs.readFileSync(require.resolve('jsqr/dist/jsQR.js'), 'utf8');

const VERSIONS = [1, 2, 4, 6, 9, 13, 20];
const REPEATS = 3;
const RASTER_PX = 1000;

const VARIANTS = [
  ['modules carrés',            { moduleShape: 'square' }],
  ['modules arrondis 40 %',     { moduleShape: 'rounded', moduleRoundness: 0.4 }],
  ['modules arrondis 85 %',     { moduleShape: 'rounded', moduleRoundness: 0.85 }],
  ['modules feuille',           { moduleShape: 'leaf', moduleRoundness: 0.6 }],
  ['modules fluides',           { moduleShape: 'fluid', moduleRoundness: 1 }],
  ['modules ronds',             { moduleShape: 'dot' }],
  ['barres verticales',         { moduleShape: 'bars-v' }],
  ['barres horizontales',       { moduleShape: 'bars-h' }],
  ['modules amincis 85 %',      { moduleShape: 'square', moduleScale: 0.85 }],
  ['cadre arrondi 35 %',        { eyeFrameShape: 'rounded', eyeFrameRoundness: 0.35 }],
  ['cadre arrondi 100 %',       { eyeFrameShape: 'rounded', eyeFrameRoundness: 1 }],
  ['cadre feuille',             { eyeFrameShape: 'leaf' }],
  ['cadre goutte',              { eyeFrameShape: 'drop' }],
  ['pupille arrondie 40 %',     { eyePupilShape: 'rounded', eyePupilRoundness: 0.4 }],
  ['pupille arrondie 100 %',    { eyePupilShape: 'rounded', eyePupilRoundness: 1 }],
  ['zone de silence 1 module',  { quietZone: 1 }],
  ['zone de silence 4 modules', { quietZone: 4 }]
];

(async () => {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  for (const src of SOURCES) await page.addScriptTag({ content: src });
  await page.addScriptTag({ content: JSQR });

  const rows = await page.evaluate(async ({ variants, versions, repeats, px }) => {
    const pool = Array.from('abcdefghijklmnopqrstuvwxyz0123456789-./:');
    const rnd = (n) => {
      let s = '';
      for (let i = 0; i < n; i++) s += pool[Math.floor(Math.random() * pool.length)];
      return s;
    };

    async function decode(svg) {
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, px, px);
      ctx.drawImage(img, 0, 0, px, px);
      URL.revokeObjectURL(url);
      const data = ctx.getImageData(0, 0, px, px);
      return jsQR(data.data, px, px);
    }

    // Corpus commun à toutes les variantes, pour que les taux soient comparables.
    const corpus = [];
    for (let k = 0; k < repeats; k++) {
      for (const v of versions) {
        const bytes = Math.max(1, QArt.qr.capacityBytes(v, 'M') - 3);
        const text = 'https://x.fr/' + rnd(Math.max(1, bytes - 13));
        const qr = QArt.qr.encode(text, { ecl: 'M', boostEcl: false });
        if (qr.version === v) corpus.push({ text, qr });
      }
    }

    const out = [];
    for (const [name, style] of variants) {
      let ok = 0;
      for (const item of corpus) {
        const base = { fgColor: '#000000', bgColor: '#FFFFFF', quietZone: 4 };
        const { svg } = QArt.render.toSVG(item.qr, Object.assign(base, style));
        const decoded = await decode(svg);
        if (decoded && decoded.data === item.text) ok++;
      }
      out.push({ name, ok, total: corpus.length });
    }
    return out;
  }, { variants: VARIANTS, versions: VERSIONS, repeats: REPEATS, px: RASTER_PX });

  await browser.close();

  console.log('variante                       décodages   taux');
  let degraded = 0;
  for (const r of rows) {
    const rate = r.ok / r.total;
    if (rate < 1) degraded++;
    console.log(
      r.name.padEnd(30),
      (r.ok + '/' + r.total).padStart(9),
      (Math.round(rate * 100) + ' %').padStart(7));
  }
  console.log(`\n${rows.length - degraded} variantes sur ${rows.length} décodées intégralement.`);

  // Les formes conservatrices doivent rester à 100 % : une régression y est un bogue.
  const mustBePerfect = ['modules carrés', 'modules fluides', 'barres verticales',
    'barres horizontales', 'cadre arrondi 35 %', 'zone de silence 4 modules'];
  const regressions = rows.filter((r) => mustBePerfect.includes(r.name) && r.ok !== r.total);
  if (regressions.length) {
    console.log('\nRÉGRESSION sur des formes réputées sûres :');
    regressions.forEach((r) => console.log(`  · ${r.name} : ${r.ok}/${r.total}`));
    process.exit(1);
  }
})();
