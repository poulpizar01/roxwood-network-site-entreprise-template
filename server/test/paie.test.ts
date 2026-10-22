// Paie (src/entreprise/paie.ts) : salaire de base + primes par palier de run et de facture, seul le palier le plus
// haut atteint compte, jamais cumulé ; les deux primes (run, facture) s'additionnent. De l'argent RP : une erreur ici
// ne se voit pas à l'écran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculerPaie, primeDePalier } from '../src/entreprise/paie.js';

const PALIERS = [{ seuil: 10, prime: 50 }, { seuil: 20, prime: 120 }, { seuil: 30, prime: 200 }];

test('primeDePalier : seul le palier le plus haut atteint, jamais cumulé', () => {
  assert.equal(primeDePalier(PALIERS, 0), 0);
  assert.equal(primeDePalier(PALIERS, 9), 0);
  assert.equal(primeDePalier(PALIERS, 10), 50);
  assert.equal(primeDePalier(PALIERS, 19), 50);
  assert.equal(primeDePalier(PALIERS, 20), 120);
  assert.equal(primeDePalier(PALIERS, 35), 200);
  assert.equal(primeDePalier([], 100), 0, 'aucun palier réglé : rien');
});

test('calculerPaie : salaire de base + prime run + prime facture (additionnées)', () => {
  const r = calculerPaie({ salaireFixe: 1000, salaireActif: true, paliersRun: PALIERS, runs: 20, paliersFacture: PALIERS, factures: 10 });
  assert.deepEqual(r, { salaireBase: 1000, primeRun: 120, primeFacture: 50, total: 1170 });
});

test('calculerPaie : salaire de base inactif ou absent ne compte pas', () => {
  assert.equal(calculerPaie({ salaireFixe: 1000, salaireActif: false, paliersRun: [], runs: 0, paliersFacture: [], factures: 0 }).salaireBase, 0);
  assert.equal(calculerPaie({ salaireFixe: null, salaireActif: true, paliersRun: [], runs: 0, paliersFacture: [], factures: 0 }).salaireBase, 0);
});
