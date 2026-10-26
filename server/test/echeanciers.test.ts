// Générateur d'échéancier : répartition d'un total (la dernière échéance absorbe l'arrondi, jamais un centime perdu
// ni en trop) et dates au rythme choisi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { datesGenerees, repartir } from '../src/entreprise/echeanciers.js';

test('répartition : la dernière échéance absorbe l’arrondi, la somme tombe toujours juste', () => {
  assert.deepEqual(repartir(1000, 3), [333, 333, 334]);
  assert.deepEqual(repartir(100, 4), [25, 25, 25, 25]);
  assert.deepEqual(repartir(10, 1), [10]);
  assert.equal(repartir(1000, 3).reduce((s, n) => s + n, 0), 1000);
});

test('dates générées : calées sur le rythme, comme le calendrier des contrats', () => {
  assert.deepEqual(datesGenerees('2026-11-01', 'mensuel', 3), ['2026-11-01', '2026-12-01', '2027-01-01']);
  assert.deepEqual(datesGenerees('2026-10-22', 'hebdomadaire', 2), ['2026-10-22', '2026-10-29']);
  assert.deepEqual(datesGenerees('2026-01-31', 'mensuel', 2), ['2026-01-31', '2026-02-28']);
});
