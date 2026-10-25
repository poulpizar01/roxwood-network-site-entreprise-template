// Participation à l'agenda : un événement à venir ne compte ni comme présence ni comme absence (present vaut true par
// défaut, il gonflerait le taux).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evenementPasse } from '../src/entreprise/participants.js';

const a = (iso: string) => new Date(iso);

test('événement avec horaire : terminé à son heure de fin, heure de Paris', () => {
  // 25 oct. 2026 : heure d'hiver à Paris dès 3 h (UTC+1) ; 18:00 Paris = 17:00 UTC
  assert.equal(evenementPasse('2026-10-25', '18:00', a('2026-10-25T16:59:00Z')), false);
  assert.equal(evenementPasse('2026-10-25', '18:00', a('2026-10-25T17:00:00Z')), true);
  // en été (UTC+2) : 18:00 Paris = 16:00 UTC
  assert.equal(evenementPasse('2026-07-10', '18:00', a('2026-07-10T16:00:00Z')), true);
});

test('événement sans horaire : terminé à la fin de son dernier jour', () => {
  assert.equal(evenementPasse('2026-10-24', null, a('2026-10-24T20:00:00Z')), false);
  assert.equal(evenementPasse('2026-10-24', null, a('2026-10-24T23:00:00Z')), true);
});
