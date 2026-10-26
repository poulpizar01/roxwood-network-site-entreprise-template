// SOCLE — dépendances entre permissions (src/socle/droits.ts, requiert sur Permission) : cocher une permission qui
// en exige une autre doit toujours entraîner celle-ci, même si l'interface a été contournée. Utilise les vraies
// clés déclarées par ce site (server/src/entreprise/permissions.ts) pour rester vrai après un changement de code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { completerPermissions } from '../src/socle/droits.js';

test('une permission complète avec ce qu’elle exige', () => {
  assert.deepEqual(new Set(completerPermissions(['rh-modifier'])), new Set(['rh-modifier', 'rh-voir']));
});

test('une chaîne de dépendances se complète en cascade', () => {
  // rh-sanctionner exige rh-voir ET rh-sanctions-voir
  assert.deepEqual(new Set(completerPermissions(['rh-sanctionner'])), new Set(['rh-sanctionner', 'rh-voir', 'rh-sanctions-voir']));
  // services-corriger exige services
  assert.deepEqual(new Set(completerPermissions(['services-corriger'])), new Set(['services-corriger', 'services']));
});

test('une permission déjà présente ne se double pas', () => {
  assert.deepEqual(new Set(completerPermissions(['rh-voir', 'rh-modifier'])), new Set(['rh-voir', 'rh-modifier']));
});

test('une permission sans dépendance reste seule', () => {
  assert.deepEqual(completerPermissions(['parametres']), ['parametres']);
});

test('une clé inconnue est filtrée', () => {
  assert.deepEqual(completerPermissions(['rh-voir', 'nimporte-quoi']), ['rh-voir']);
});
