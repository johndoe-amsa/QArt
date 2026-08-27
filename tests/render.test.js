/*
 * Vérification du moteur de rendu. Il ne touche pas au DOM : il ne produit
 * qu'une chaîne SVG, ce qui permet de le tester en Node sans navigateur.
 *
 * Le banc de décodage des formes est séparé, dans readability.test.js.
 *
 * Usage : npm test
 */
'use strict';

require('../assets/js/qr.js');
require('../assets/js/render.js');
const QArt = globalThis.QArt;

const failures = [];
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) failures.push(message);
}

const qr = QArt.qr.encode('https://exemple.fr/produit/REF-88421', { ecl: 'H' });

function withLogo(overrides) {
  return QArt.render.toSVG(qr, {
    logo: Object.assign({
      src: 'data:image/svg+xml;base64,PHN2Zy8+',
      aspect: 3,          // logo trois fois plus large que haut
      sizePct: 0.2,
      padding: 0.6,
      backing: 'fit',
      backingRoundness: 0.25,
      backingColor: '#FFFFFF',
      backingTransparent: false,
      knockout: true
    }, overrides)
  });
}

// --- Pastille ajustée : elle épouse les proportions du logo ---------------

const fit = withLogo({ backing: 'fit' });
const square = withLogo({ backing: 'square' });
const circle = withLogo({ backing: 'circle' });

assert(fit.clearedModules < circle.clearedModules,
  `la pastille ajustée devrait neutraliser moins de modules que la ronde ` +
  `(${fit.clearedModules} vs ${circle.clearedModules})`);
assert(circle.clearedModules < square.clearedModules,
  `la pastille ronde devrait neutraliser moins de modules que la carrée ` +
  `(${circle.clearedModules} vs ${square.clearedModules})`);
assert(fit.clearedModules > 0, 'un logo doit neutraliser au moins un module');

// Un logo carré ne doit faire aucune différence entre « ajustée » et « carrée ».
const squareLogoFit = withLogo({ aspect: 1, backing: 'fit' });
const squareLogoSquare = withLogo({ aspect: 1, backing: 'square' });
assert(squareLogoFit.clearedModules === squareLogoSquare.clearedModules,
  'sur un logo carré, les modes ajusté et carré doivent coïncider');

// --- Proportions conservées dans le tracé ---------------------------------

const dims = /<image[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/.exec(fit.svg);
assert(!!dims, 'le logo matriciel doit être émis comme <image> dimensionné');
if (dims) {
  const ratio = Number(dims[1]) / Number(dims[2]);
  assert(Math.abs(ratio - 3) < 0.01,
    `les proportions du logo doivent être conservées (rapport obtenu : ${ratio.toFixed(3)})`);
}

// --- Pastille transparente -------------------------------------------------

const transparent = withLogo({ backingTransparent: true });
assert(transparent.svg.indexOf('qart-logo-backing') === -1,
  'aucune pastille ne doit être tracée lorsqu’elle est transparente');
assert(transparent.clearedModules === fit.clearedModules,
  'une pastille transparente doit définir la même zone neutralisée qu’une pastille visible');

const colored = withLogo({ backingColor: '#F5A623' });
assert(colored.svg.indexOf('#F5A623') !== -1, 'la couleur de pastille doit être appliquée');

// --- Détourage désactivé : l'occultation reste comptée ---------------------

const noKnockout = withLogo({ knockout: false });
assert(noKnockout.clearedModules === fit.clearedModules,
  'les modules recouverts doivent être comptés même sans détourage');
assert(noKnockout.svg.length > fit.svg.length,
  'sans détourage, les modules sous le logo restent tracés');

// --- Zone de silence et dimensions ----------------------------------------

const quiet0 = QArt.render.toSVG(qr, { quietZone: 0 });
const quiet4 = QArt.render.toSVG(qr, { quietZone: 4 });
assert(quiet4.span === quiet0.span + 8, 'la zone de silence doit élargir le tracé de 2 modules par côté');
assert(/width="40mm" height="40mm"/.test(QArt.render.toSVG(qr, { widthMm: 40 }).svg),
  'les dimensions en millimètres doivent être émises');
assert(/width="512" height="512"/.test(QArt.render.toSVG(qr, { widthPx: 512 }).svg),
  'les dimensions en pixels doivent primer lorsqu’elles sont demandées');

// --- Chemins compound ------------------------------------------------------

const plain = QArt.render.toSVG(qr, {});
['qart-modules', 'qart-eye-frames', 'qart-eye-pupils'].forEach((id) => {
  assert(plain.svg.indexOf('id="' + id + '"') !== -1, `le chemin ${id} doit être présent`);
});
assert((plain.svg.match(/<path /g) || []).length === 4,
  'le tracé doit tenir en quatre chemins : fond, modules, cadres, pupilles');
assert(QArt.render.toSVG(qr, { bgTransparent: true }).svg.indexOf('qart-bg') === -1,
  'aucun aplat de fond ne doit être tracé en mode transparent');

console.log(`${failures.length ? 'ÉCHEC' : 'OK   '} Rendu — ${checks} assertions`);
failures.forEach((f) => console.log(`        · ${f}`));
process.exit(failures.length ? 1 : 0);
