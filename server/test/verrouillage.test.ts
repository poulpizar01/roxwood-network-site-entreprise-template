// ENTREPRISE — rattrapage du verrouillage automatique de la DOT : une panne se rattrape dans l'ordre, un site qui n'a
// jamais verrouillé de semaine ne voit figer que la semaine précédente (jamais des mois d'historique).
import test from 'node:test';
import assert from 'node:assert/strict';
import { semainesARattraper } from '../src/entreprise/stats/verrouillage.js';

test('verrouillage : aucune semaine verrouillée, seule la semaine précédente est figée', () => {
  assert.deepEqual(semainesARattraper('2026-11-23', null), ['2026-11-16']);
  assert.deepEqual(semainesARattraper('2027-01-04', null), ['2026-12-28']);   // à cheval sur deux années
});

test('verrouillage : la semaine précédente quand la dernière verrouillée la précède', () => {
  assert.deepEqual(semainesARattraper('2026-11-23', '2026-11-09'), ['2026-11-16']);
});

test('verrouillage : déjà à jour, ou jamais la semaine en cours', () => {
  assert.deepEqual(semainesARattraper('2026-11-23', '2026-11-16'), []);
  assert.deepEqual(semainesARattraper('2026-11-23', '2026-11-23'), []);
});

test('verrouillage : une panne rattrape dans l’ordre, avec une limite', () => {
  assert.deepEqual(semainesARattraper('2027-01-11', '2026-12-14'), ['2026-12-21', '2026-12-28', '2027-01-04']);
  assert.equal(semainesARattraper('2030-01-07', '2026-01-05').length, 52);
});
