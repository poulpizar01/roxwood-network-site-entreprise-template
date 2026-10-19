// Relevé Tablettes et impôt de la DOT (src/entreprise/stats/releve.ts) : CA brut, montants collés, tranche du barème.
// De l'argent RP déclaré : une erreur ici ne se voit pas à l'écran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { caBrutReleve, estLigneTotal, impotDot, montantReleve } from '../src/entreprise/stats/releve.js';

test('montants collés : séparateurs de milliers et décimales', () => {
  assert.equal(montantReleve('12 500 $'), 12500);
  assert.equal(montantReleve('12 500 $'), 12500);
  assert.equal(montantReleve('$1,500'), 1500);            // jamais 1,5
  assert.equal(montantReleve('1,234,567'), 1234567);
  assert.equal(montantReleve('1.234.567'), 1234567);
  assert.equal(montantReleve('1,234.56'), 1234.56);
  assert.equal(montantReleve('1.234,5'), 1234.5);
  assert.equal(montantReleve('12,50'), 12.5);
  assert.equal(montantReleve('-2 000'), -2000);
  for (const vide of ['', '-', 'abc', null, undefined]) assert.equal(montantReleve(vide), 0, String(vide));
});

test('ligne récap : TOTAL ou Totaux, jamais un membre', () => {
  assert.ok(estLigneTotal(['TOTAL', '-', '5']));
  assert.ok(estLigneTotal([' Totaux ']));
  assert.ok(!estLigneTotal(['Total Silva']));
});

test('CA brut : somme des membres, sans la ligne TOTAL (fausse après un retrait)', () => {
  const colonnes = ['Nom', 'Rang', 'Total run', 'Total entreprise'];
  const lignes = [
    ['Javier Silva', 'Co-patron', '999', '12 000 $'],
    ['Lina Morel', 'Stagiaire', '1', '3,500'],
    ['TOTAL', '-', '1000', '99 999'],
  ];
  assert.equal(caBrutReleve(colonnes, lignes), 15500);    // « Total entreprise » avant « total », TOTAL ignorée
  assert.equal(caBrutReleve(['Nom', 'Total'], [['A', '10'], ['Totaux', '10']]), 10);
  assert.equal(caBrutReleve(['Nom', 'Factures'], [['A', '10']]), null);
});

const BAREME = [
  { seuilMin: 10000, seuilMax: 29999, taux: 0.09 },
  { seuilMin: 100, seuilMax: 9999, taux: 0.07 },          // ordre quelconque en base
  { seuilMin: 5000000, seuilMax: 99000000, taux: 0.49 },
];

test('impôt : taux de la tranche sur tout le bénéfice', () => {
  assert.deepEqual(impotDot(100, BAREME), { tranche: BAREME[1], impots: 7 });
  assert.deepEqual(impotDot(9999, BAREME), { tranche: BAREME[1], impots: 700 });
  assert.deepEqual(impotDot(10000, BAREME), { tranche: BAREME[0], impots: 900 });
  assert.deepEqual(impotDot(120000000, BAREME), { tranche: BAREME[2], impots: 58800000 });   // au-delà : la dernière
});

test('impôt : rien sous la première tranche ni en perte (jamais le taux de la dernière, jamais négatif)', () => {
  for (const b of [0, 99, -50000]) assert.deepEqual(impotDot(b, BAREME), { tranche: null, impots: 0 }, String(b));
  assert.deepEqual(impotDot(5000, []), { tranche: null, impots: 0 });
});
