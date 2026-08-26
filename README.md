# QArt — générateur de QR Code vectoriel

Générateur de QR Code entièrement local, conçu pour la chaîne graphique : contrôle
fin de la redondance, personnalisation des formes et des couleurs, intégration
d'un logo, export SVG et PNG exploitables dans Illustrator et InDesign.

Aucune donnée ne quitte le navigateur : encodage, rendu et export sont calculés
côté client. Le site est un ensemble de fichiers statiques, sans étape de
construction ni dépendance d'exécution.

**En ligne :** https://johndoe-amsa.github.io/qart/

---

## Ce que fait l'outil

### Contrôle technique du symbole

| Réglage | Plage | Effet |
|---|---|---|
| Niveau de correction | L, M, Q, H | Part du symbole restituable après dégradation : 7, 15, 25 ou 30 %. |
| Élévation automatique | activé / désactivé | Monte le niveau vers Q ou H tant que la version du symbole ne change pas — de la redondance gratuite. |
| Version minimale | automatique, 1 à 40 | Force une matrice plus grande, par exemple pour un rendu plus fin ou pour réserver de la place au logo. |
| Masque | automatique, 0 à 7 | Le masque automatique est celui qui minimise le score de pénalité normatif. Le forçage sert au diagnostic. |
| Zone de silence | 0 à 8 modules | 4 modules par défaut, conformément à ISO/IEC 18004. |

L'encodage choisit seul le mode le plus économique et découpe le contenu en
segments hétérogènes (numérique, alphanumérique, octet UTF-8) par programmation
dynamique. Un contenu du type `Commande 12345 https://exemple.fr/A1B2` produit
donc un symbole plus compact qu'un encodage en octets d'un bout à l'autre.

### Personnalisation

- **Modules** : carré, arrondi, feuille, fluide (modules soudés), point, barres
  verticales ou horizontales. Arrondi et épaisseur réglables.
- **Couleur** : aplat, dégradé linéaire orientable ou dégradé radial. Fond opaque
  ou transparent.
- **Repères de position** : forme et arrondi du cadre et de la pupille réglables
  séparément, couleurs propres ou héritées des modules.
- **Logo** : import SVG, PNG, JPG ou WebP. Taille, marge de sécurité, pastille de
  fond et effacement des modules recouverts. **Un logo SVG reste vectoriel
  jusque dans l'export** : son contenu est réinjecté dans le fichier de sortie,
  pas converti en image.

### Export

- **SVG** : dimensions en millimètres, prêt à placer. Le fichier contient trois
  chemins compound — modules, cadres des repères, pupilles — plus un quatrième
  pour le fond lorsqu'il est opaque. Soit trois ou quatre objets vectoriels à
  l'ouverture dans Illustrator, et non plusieurs centaines de rectangles à
  fusionner à la main.
- **PNG** : taille définie en millimètres et DPI (72 à 600) ou directement en
  pixels. Fond transparent possible.
- **Copie du code SVG** dans le presse-papier, collable directement dans un plan
  de travail Illustrator.

### Contrôle de lisibilité

Un panneau permanent évalue les réglages en cours et signale ce qui met la
lecture en péril : contraste insuffisant ou inversé, zone de silence réduite,
budget de correction consommé par le logo, formes à risque, module trop petit
pour l'impression retenue. Les seuils ne sont pas arbitraires — voir plus bas.

---

## Déploiement sur GitHub Pages

Deux voies, au choix.

**Par le workflow fourni.** `.github/workflows/deploy.yml` publie la racine du
dépôt à chaque poussée sur `main`. Dans *Settings → Pages*, régler *Source* sur
**GitHub Actions**. Rien d'autre à faire.

**Par branche.** Dans *Settings → Pages*, régler *Source* sur **Deploy from a
branch**, choisir la branche et le dossier `/ (root)`. Le fichier `.nojekyll`
présent à la racine évite le passage par Jekyll.

En local, aucun serveur n'est nécessaire : ouvrir `index.html` directement dans
un navigateur suffit. Les scripts sont chargés en scripts classiques, sans
modules ES, précisément pour que le protocole `file://` fonctionne.

---

## Structure

```
index.html              Structure de la page
assets/css/app.css      Tokens de design et composants
assets/js/qr.js         Encodeur ISO/IEC 18004 — aucune dépendance
assets/js/render.js     Matrice vers SVG : formes, dégradés, repères, logo
assets/js/export.js     SVG, PNG, presse-papier
assets/js/app.js        État de l'interface, aperçu, diagnostic
tests/                  Bancs de vérification (voir ci-dessous)
```

L'encodeur et le moteur de rendu sont indépendants de l'interface et
réutilisables tels quels :

```js
const qr = QArt.qr.encode('https://exemple.fr', { ecl: 'H', boostEcl: true });
const { svg } = QArt.render.toSVG(qr, { moduleShape: 'fluid', fgColor: '#0B1F3A' });
```

---

## Vérification

Les tests ne sont pas nécessaires au fonctionnement du site ; ils ne servent qu'à
valider l'encodeur, qui est écrit de zéro.

```bash
npm install          # dépendances de test uniquement
npm test             # encodeur
npm run test:lisibilite   # banc de décodage des formes (nécessite Chromium)
```

Pour le banc de lisibilité, installer le navigateur avec `npx playwright install
chromium`, ou pointer un binaire existant via la variable `CHROMIUM_PATH`.

### Ce que couvre `npm test`

| Banc | Cas | Ce qui est vérifié |
|---|---|---|
| A | 4 832 | Matrices comparées bit à bit à `node-qrcode`, masque imposé de 0 à 7, contenus homogènes. Valide correction d'erreur, entrelacement des blocs, motifs, bits de format et de version. |
| B | 1 208 | Masque automatique et élévation de niveau comparés à `nayuki-qr-code-generator`. |
| C | 508 | Aller-retour encodage puis décodage sur contenus mixtes, tous niveaux. |
| D | 508 | Optimalité : notre segmentation ne produit jamais un symbole plus grand que celui de la référence. |
| E | 169 | Capacités des 40 versions aux 4 niveaux, refus explicite au-delà, respect de la version minimale et du masque imposés. |

Les bancs A et B se limitent volontairement aux contenus homogènes : sur du texte
mixte, notre segmentation optimale et la segmentation des bibliothèques de
référence peuvent aboutir à deux découpages de coût identique, tous deux
conformes mais donnant des matrices différentes. Une comparaison bit à bit y
échouerait à tort ; c'est le banc C, qui relit réellement le symbole, qui fait
foi dans ce cas.

### Ce que mesure `npm run test:lisibilite`

Chaque variante de forme est rendue, rasterisée puis relue par un décodeur, sur
les versions 1 à 20, avec un corpus commun de 21 symboles. Mesures relevées :

| Variante | Décodages | Variante | Décodages |
|---|---|---|---|
| Modules carrés | 21/21 | Barres verticales | 21/21 |
| Modules arrondis 40 % | 21/21 | Barres horizontales | 21/21 |
| Modules arrondis 85 % | 20/21 | Modules amincis à 85 % | 21/21 |
| Modules feuille | 21/21 | Cadre arrondi 35 % | 21/21 |
| Modules fluides | 21/21 | **Cadre arrondi 100 %** | **6/21** |
| **Modules ronds** | **14/21** | **Pupille arrondie 100 %** | **6/21** |

Ce sont ces chiffres qui fixent les seuils du panneau de lisibilité : avertir
au-delà de 85 % d'arrondi des modules, au-delà de 80 % d'arrondi des repères, et
sur la forme « point ». Le décodeur employé est plus sévère qu'un lecteur
mobile : ces taux servent à classer les formes entre elles, pas à prédire un taux
de lecture terrain.

Deux formes envisagées ont été retirées à la suite de ces mesures, parce
qu'elles ne se décodaient quasiment jamais : les modules en losange (3/21) et la
pupille en losange (0/10). L'arrondi à 100 % reste accessible au curseur, mais
signalé, parce qu'il produit exactement le rendu circulaire que beaucoup
recherchent.

---

## Notes pour la chaîne graphique

- **Taille d'impression.** Prévoir au moins 0,6 mm par module ; l'outil indique
  la taille de module obtenue et alerte en dessous. Un symbole de version 10
  fait 57 modules de côté, 65 avec la zone de silence : il demande donc environ
  39 mm de large.
- **Distance de lecture.** Compter environ dix fois la largeur du symbole.
- **Colorimétrie.** L'export est en RVB. La conversion CMJN se fait dans
  Illustrator ou InDesign ; vérifier que le contraste reste suffisant après
  conversion, un noir riche et un fond papier ne se comportant pas comme à
  l'écran.
- **Fond transparent.** À réserver aux supports clairs et unis. Le contrôle de
  lisibilité calcule alors le contraste sur blanc, ce qui est optimiste.
- **Toujours tester le fichier final** avec plusieurs téléphones avant de partir
  en impression, en particulier si un logo occupe le centre.
