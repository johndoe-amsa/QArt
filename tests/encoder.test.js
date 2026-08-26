/*
 * Vérification de l'encodeur.
 *
 *   Test A — matrices comparées bit à bit à node-qrcode, masque imposé, sur
 *            contenus homogènes. Valide la correction d'erreur, l'entrelacement
 *            des blocs, l'implantation des motifs et les bits de format.
 *   Test B — masque automatique et montée de niveau comparés à
 *            nayuki-qr-code-generator, sur contenus homogènes.
 *   Test C — aller-retour encodage puis décodage sur contenus mixtes. C'est le
 *            seul contrôle valable pour la segmentation hétérogène : une
 *            comparaison bit à bit y échouerait à tort, deux découpages de coût
 *            identique restant tous deux conformes.
 *   Test D — optimalité : notre segmentation ne doit jamais produire un symbole
 *            plus grand que celui de node-qrcode.
 *   Test E — capacités par version et refus explicite au-delà.
 *
 * Les tests A et B se limitent aux contenus homogènes parce que notre
 * segmentation optimale et la segmentation simple des bibliothèques de
 * référence n'y peuvent pas diverger.
 *
 * Usage : npm test
 */
'use strict';

const mine = require('../assets/js/qr.js');
const QRCode = require('qrcode');
const Nayuki = require('nayuki-qr-code-generator').default;
const jsQRModule = require('jsqr');
const jsQR = jsQRModule.default || jsQRModule;

const LEVELS = ['L', 'M', 'Q', 'H'];
const NAYUKI_ECC = {
  L: Nayuki.QrCode.Ecc.LOW,
  M: Nayuki.QrCode.Ecc.MEDIUM,
  Q: Nayuki.QrCode.Ecc.QUARTILE,
  H: Nayuki.QrCode.Ecc.HIGH
};
const NAYUKI_NAME = new Map(LEVELS.map((k) => [NAYUKI_ECC[k], k]));

const POOLS = {
  numerique: Array.from('0123456789'),
  alphanumerique: Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ$%*+-./: '),
  octet: Array.from('abcdefghijklmnopqrstuvwxyz~@!"\'^{}[]|<>'),
  utf8: Array.from('éàçùôîœ€漢字あア日本語ñüßЖДЫ'),
  mixte: Array.from('abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789 -_./:?#&=%éàç漢字😀')
};
const HOMOGENEOUS = ['numerique', 'alphanumerique', 'octet', 'utf8'];

function randomText(length, pool) {
  let out = '';
  for (let i = 0; i < length; i++) out += pool[Math.floor(Math.random() * pool.length)];
  return out;
}

function referenceMatrix(text, ecl, mask) {
  const qr = QRCode.create(text, { errorCorrectionLevel: ecl, maskPattern: mask });
  const size = qr.modules.size;
  const grid = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) row.push(!!qr.modules.data[y * size + x]);
    grid.push(row);
  }
  return { size, grid, version: qr.version };
}

/* Peint la matrice dans un tampon RVBA, sans navigateur ni canvas. */
function toImageData(qr, scale, quiet) {
  const span = qr.size + quiet * 2;
  const width = span * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const index = (((y + quiet) * scale + dy) * width + (x + quiet) * scale + dx) * 4;
          data[index] = data[index + 1] = data[index + 2] = 0;
        }
      }
    }
  }
  return { data, width, height: width };
}

function homogeneousCorpus() {
  const texts = [];
  for (const kind of HOMOGENEOUS) {
    const max = kind === 'numerique' ? 600 : 250;
    for (let i = 0; i < 25; i++) {
      texts.push(randomText(1 + Math.floor(Math.random() * max), POOLS[kind]));
    }
  }
  for (let v = 1; v <= 40; v += 3) {
    for (const ecl of LEVELS) texts.push(randomText(Math.max(1, mine.capacityBytes(v, ecl) - 3), POOLS.octet));
  }
  return texts;
}

function mixedCorpus() {
  const texts = [
    'HELLO WORLD', 'A', '0', 'https://example.com',
    'Commande n°12345 — 2026-08-26 https://exemple.fr/ORDER/998877',
    'WIFI:T:WPA;S:Réseau-Café;P:m0tDePass3;;',
    'https://exemple.fr/produit/REF-88421?src=affiche&utm_campaign=automne-2026'
  ];
  for (let i = 0; i < 120; i++) texts.push(randomText(1 + Math.floor(Math.random() * 400), POOLS.mixte));
  return texts;
}

function testA(texts) {
  let compared = 0;
  const failures = [];
  for (const text of texts) {
    for (const ecl of LEVELS) {
      for (let mask = 0; mask < 8; mask++) {
        let ours, theirs;
        try { ours = mine.encode(text, { ecl, boostEcl: false, mask }); } catch (e) { continue; }
        try { theirs = referenceMatrix(text, ecl, mask); } catch (e) { continue; }
        compared++;
        if (ours.version !== theirs.version) {
          failures.push(`version ${ours.version} ≠ ${theirs.version} (${ecl}, masque ${mask})`);
          continue;
        }
        let diff = 0;
        for (let y = 0; y < ours.size; y++) {
          for (let x = 0; x < ours.size; x++) if (ours.modules[y][x] !== theirs.grid[y][x]) diff++;
        }
        if (diff) failures.push(`${diff} modules divergents (${ecl}, masque ${mask}, ${text.length} caractères)`);
      }
    }
  }
  return { name: 'Test A — matrices vs node-qrcode, masque imposé', compared, failures };
}

function testB(texts) {
  let compared = 0;
  const failures = [];
  for (const text of texts) {
    for (const ecl of LEVELS) {
      for (const boost of [false, true]) {
        let ours, theirs;
        try { ours = mine.encode(text, { ecl, boostEcl: boost }); } catch (e) { continue; }
        try {
          theirs = Nayuki.QrCode.encodeSegments(
            Nayuki.QrSegment.makeSegments(text), NAYUKI_ECC[ecl], 1, 40, -1, boost);
        } catch (e) { continue; }
        compared++;
        if (ours.version !== theirs.version) {
          failures.push(`version ${ours.version} ≠ ${theirs.version} (${ecl}, boost ${boost})`);
          continue;
        }
        if (ours.ecl !== NAYUKI_NAME.get(theirs.errorCorrectionLevel)) {
          failures.push(`niveau ${ours.ecl} ≠ ${NAYUKI_NAME.get(theirs.errorCorrectionLevel)} (${ecl})`);
        }
        if (ours.mask !== theirs.mask) {
          failures.push(`masque ${ours.mask} ≠ ${theirs.mask} (${ecl}, boost ${boost})`);
        }
        let diff = 0;
        for (let y = 0; y < ours.size; y++) {
          for (let x = 0; x < ours.size; x++) if (ours.modules[y][x] !== theirs.getModule(x, y)) diff++;
        }
        if (diff) failures.push(`${diff} modules divergents (${ecl}, boost ${boost})`);
      }
    }
  }
  return { name: 'Test B — masque et niveau vs nayuki-qr-code-generator', compared, failures };
}

function testC(texts) {
  let compared = 0;
  const failures = [];
  for (const text of texts) {
    for (const ecl of LEVELS) {
      let ours;
      try { ours = mine.encode(text, { ecl }); } catch (e) { continue; }
      compared++;
      const image = toImageData(ours, 6, 4);
      const decoded = jsQR(image.data, image.width, image.height);
      if (!decoded) {
        failures.push(`non décodé (${ecl}, v${ours.version}, ${Array.from(text).length} caractères)`);
      } else if (decoded.data !== text) {
        failures.push(`contenu altéré (${ecl}, v${ours.version}) : ${JSON.stringify(decoded.data.slice(0, 40))}`);
      }
    }
  }
  return { name: 'Test C — aller-retour encodage/décodage, contenus mixtes', compared, failures };
}

function testD(texts) {
  let compared = 0;
  let better = 0;
  const failures = [];
  for (const text of texts) {
    for (const ecl of LEVELS) {
      let ours, theirs;
      try { ours = mine.encode(text, { ecl, boostEcl: false }); } catch (e) { continue; }
      try { theirs = QRCode.create(text, { errorCorrectionLevel: ecl }); } catch (e) { continue; }
      compared++;
      if (ours.version > theirs.version) {
        failures.push(`version ${ours.version} > ${theirs.version} (${ecl}, ${Array.from(text).length} caractères)`);
      } else if (ours.version < theirs.version) {
        better++;
      }
    }
  }
  return {
    name: 'Test D — optimalité de la segmentation',
    compared,
    failures,
    note: `${better} symboles strictement plus compacts que la référence`
  };
}

function testE() {
  const failures = [];
  let compared = 0;
  for (let v = 1; v <= 40; v++) {
    for (const ecl of LEVELS) {
      const fits = randomText(Math.max(1, mine.capacityBytes(v, ecl) - 3), POOLS.octet);
      compared++;
      const encoded = mine.encode(fits, { ecl, boostEcl: false });
      if (encoded.version > v) failures.push(`version ${encoded.version} > ${v} attendue (${ecl})`);
      if (encoded.usedBits > encoded.capacityBits) {
        failures.push(`débordement : ${encoded.usedBits} bits pour ${encoded.capacityBits} (v${v}, ${ecl})`);
      }
    }
  }
  try {
    mine.encode(randomText(mine.capacityBytes(40, 'H') + 200, POOLS.octet), { ecl: 'H' });
    failures.push('aucune erreur levée au-delà de la capacité maximale');
  } catch (e) {
    if (e.code !== 'OVERFLOW') failures.push(`code d'erreur inattendu : ${e.code}`);
  }
  // La version minimale imposée doit être respectée.
  const forced = mine.encode('court', { ecl: 'M', minVersion: 12 });
  compared++;
  if (forced.version !== 12) failures.push(`version minimale ignorée : ${forced.version} au lieu de 12`);
  // Le masque imposé doit être respecté.
  for (let m = 0; m < 8; m++) {
    compared++;
    if (mine.encode('https://exemple.fr', { ecl: 'M', mask: m }).mask !== m) {
      failures.push(`masque imposé ${m} ignoré`);
    }
  }
  return { name: 'Test E — capacités, version minimale, masque imposé', compared, failures };
}

const homogeneous = homogeneousCorpus();
const mixed = mixedCorpus();
const suites = [
  testA(homogeneous),
  testB(homogeneous),
  testC(mixed),
  testD(mixed),
  testE()
];

let failed = 0;
for (const suite of suites) {
  console.log(`${suite.failures.length ? 'ÉCHEC' : 'OK   '} ${suite.name} — ${suite.compared} cas` +
    (suite.note ? ` (${suite.note})` : ''));
  suite.failures.slice(0, 10).forEach((f) => console.log(`        · ${f}`));
  if (suite.failures.length > 10) console.log(`        · … ${suite.failures.length - 10} autres`);
  failed += suite.failures.length;
}
process.exit(failed ? 1 : 0);
