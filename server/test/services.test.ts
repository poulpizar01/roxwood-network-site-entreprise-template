// Membres en service (src/entreprise/services-duty.ts) : lecture d'un événement « monitoring.duty » du bot entreprise,
// forme reprise de son code (src/services/monitoringService.ts). Rien n'est deviné : une forme inattendue est ignorée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lireDuty } from '../src/entreprise/services-duty.js';

const SENT = '2026-10-12T18:04:00.000Z';
const charge = (direction: unknown, extra: Record<string, unknown> = {}) => ({
  jobId: 'dynasty8', playerDiscord: '411111111111111111', playerName: 'Grey Brook', description: 'prise de service (Dynasty 8)', parsed: { direction }, ...extra,
});

test('prise et fin de service lues', () => {
  const debut = lireDuty(charge('in'), SENT);
  assert.equal(debut?.sens, 'debut');
  assert.equal(debut?.discordId, '411111111111111111');
  assert.equal(debut?.nom, 'Grey Brook');
  assert.equal(debut?.instant.toISOString(), SENT);
  assert.equal(lireDuty(charge('out'), SENT)?.sens, 'fin');
});

test('même événement renvoyé : même identifiant (rien de créé deux fois)', () => {
  assert.equal(lireDuty(charge('in'), SENT)?.serviceId, lireDuty(charge('in'), SENT)?.serviceId);
  assert.notEqual(lireDuty(charge('in'), SENT)?.serviceId, lireDuty(charge('in'), '2026-10-12T19:00:00.000Z')?.serviceId);
});

test('forme inattendue : ignorée', () => {
  assert.equal(lireDuty(charge(null), SENT), null);                                   // journal non reconnu par le bot
  assert.equal(lireDuty(charge('sideways'), SENT), null);
  assert.equal(lireDuty(charge('in', { playerDiscord: 'abc' }), SENT), null);         // pas un identifiant Discord
  assert.equal(lireDuty(charge('in'), 'pas une date'), null);
  assert.equal(lireDuty('texte', SENT), null);
  assert.equal(lireDuty(null, SENT), null);
});

test('nom nettoyé : ni mise en forme ni mention', () => {
  assert.equal(lireDuty(charge('in', { playerName: '**@everyone** <Grey>' }), SENT)?.nom, 'everyone Grey');
});
