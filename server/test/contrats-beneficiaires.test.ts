// Bénéficiaires d'un contrat : collages réels des deux tablettes (onglet des membres, Ctrl+A, Copier), et contrôle
// d'une liste avant enregistrement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dedoublonner, lireBeneficiaires, lireCollage, MAX_BENEFICIAIRES } from '../src/entreprise/contrats-beneficiaires.js';

// tablette illégale (F7 > Membres) : tel que copié, avec le texte parasite de fin de collage
const ILLEGALE = `Rechercher...
14
ID UNIQUE\tNOM\tRANG\tACTION
277514\tAndréas Kyros\t
Baroni
203134\tBass Carter\t
Fedeli
88509\tBilly Rossi\t
Sicario
308063\tBrandon Spencer\t
Associati
350864\tDayon Reas\t
Fedeli
131299\tJavier Silva\t
Braccio Destro
181250\tKaleo Maranzano\t
Baroni
54946\tLeandro Maranzano\t
Sicario
279390\tLiam Zayn\t
Associati
271020\tLov Moni\t
Chef
266951\tMarco Acuña\t
Associati
267234\tRaymond Carter\t
Braccio Destro
281653\tTiago Rodrigues\t
Associati
184233\tWesley Jones\t
Sicario
\t
  `;

// tablette entreprise (F6 > Gestion des employés)
const ENTREPRISE = `Rechercher...
ID UNIQUE\tNOM\tRANG
DERNIÈRE PRISE DE SERVICE\tACTION
200540\tJavier Silva\t
Patron
10/10/2026\t
131299\tJavier Silva\t
Co-patron
24/10/2026\t
271020\tLov Moni\t
Responsable Marketing
09/09/2026\t
267234\tRaymond Carter\t
Responsable DEV - BOT
17/10/2026\t
203134\tBass Carter\t
Développeur en essai
08/09/2026

\t
`;

test('tablette illégale : 14 personnes avec leur ID, rangs et titres ignorés', () => {
  const l = lireCollage(ILLEGALE);
  assert.equal(l.format, 'illegale');
  assert.equal(l.personnes.length, 14);
  assert.deepEqual(l.personnes[0], { nom: 'Andréas Kyros', idUnique: '277514' });
  assert.deepEqual(l.personnes[10], { nom: 'Marco Acuña', idUnique: '266951' });
  assert.ok(!l.personnes.some(p => /Baroni|Sicario|Rechercher/.test(p.nom)));
  assert.equal(l.doublons, 0);
  assert.deepEqual(l.illisibles, []);
});

test('tablette entreprise : deux homonymes d’ID différents restent deux, dates ignorées', () => {
  const l = lireCollage(ENTREPRISE);
  assert.equal(l.format, 'entreprise');
  assert.deepEqual(l.personnes.map(p => p.idUnique), ['200540', '131299', '271020', '267234', '203134']);
  assert.equal(l.personnes.filter(p => p.nom === 'Javier Silva').length, 2);
});

test('fins de ligne Windows, espaces en trop, ligne collée deux fois', () => {
  const l = lireCollage('ID UNIQUE\tNOM\tRANG\r\n12\t  Jean   Dupont \t\r\nChef\r\n12\tJean Dupont\t\r\n');
  assert.deepEqual(l.personnes, [{ nom: 'Jean Dupont', idUnique: '12' }]);
  assert.equal(l.doublons, 1);
});

test('ligne de personne illisible : signalée, pas ajoutée', () => {
  const l = lireCollage('ID UNIQUE\tNOM\n12\t\t\n13\t<script>\t\n14\tLéa Martin\t');
  assert.deepEqual(l.personnes, [{ nom: 'Léa Martin', idUnique: '14' }]);
  assert.equal(l.illisibles.length, 2);
});

test('simple liste de noms : un par ligne, deux mots au moins', () => {
  const l = lireCollage('Liste\nJean Dupont\n\nMarie-Anne O’Neil\njean   dupont\n42');
  assert.equal(l.format, 'liste');
  assert.deepEqual(l.personnes, [{ nom: 'Jean Dupont', idUnique: null }, { nom: 'Marie-Anne O’Neil', idUnique: null }]);
  assert.equal(l.doublons, 1);
  assert.deepEqual(l.illisibles, ['Liste', '42']);
});

test('rien de reconnu', () => {
  assert.equal(lireCollage('   \n\t\n').format, null);
  assert.equal(lireCollage('').personnes.length, 0);
});

test('dédoublonnage : un nom sans ID qui retrouve le même nom avec ID est la même personne', () => {
  const r = dedoublonner([{ nom: 'Javier Silva', idUnique: null }, { nom: 'javier  silva', idUnique: '131299' }, { nom: 'Javier Silva', idUnique: '200540' }]);
  assert.deepEqual(r.liste.map(p => p.idUnique), ['131299', '200540']);
  assert.equal(r.doublons, 1);
});

test('liste à enregistrer : refus explicites, jamais de troncature', () => {
  assert.deepEqual(lireBeneficiaires([{ nom: ' Jean  Dupont ', idUnique: '12' }, '  ', 'Léa Martin']), { liste: [{ nom: 'Jean Dupont', idUnique: '12' }, { nom: 'Léa Martin', idUnique: null }] });
  assert.ok('refus' in lireBeneficiaires([{ nom: 'A'.repeat(81) }]));
  assert.ok('refus' in lireBeneficiaires([{ nom: 'Jean <b>' }]));
  assert.ok('refus' in lireBeneficiaires([{ nom: 'Jean Dupont', idUnique: '12a' }]));
  assert.ok('refus' in lireBeneficiaires('Jean'));
  const trop = Array.from({ length: MAX_BENEFICIAIRES + 1 }, (_, i) => ({ nom: 'Personne Numero', idUnique: String(i + 1) }));
  assert.match((lireBeneficiaires(trop) as { refus: string }).refus, /retirez-en 1/);
});
