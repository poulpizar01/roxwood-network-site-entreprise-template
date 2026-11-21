// SOCLE — chiffrement des clés d'abonnement webhook (src/socle/webhooks-cle.ts) : une régression ici rendrait les
// clés déjà enregistrées illisibles, ou laisserait le chiffré d'un type valider l'événement d'un autre type.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chiffrer, dechiffrer } from '../src/socle/webhooks-cle.js';

test('chiffrement puis déchiffrement retrouve la valeur', () => {
  const c = chiffrer('abc123', 'order.updated');
  assert.equal(dechiffrer(c, 'order.updated'), 'abc123');
});

test('un chiffré recopié sur la ligne d’un autre type ne se déchiffre pas (AAD)', () => {
  const c = chiffrer('abc123', 'order.updated');
  assert.equal(dechiffrer(c, 'monitoring.duty'), null);
});

test('un chiffré altéré ne se déchiffre pas', () => {
  const c = chiffrer('abc123', 'order.updated');
  const octets = Buffer.from(c.chiffre, 'base64');
  octets[0] ^= 0xff;
  assert.equal(dechiffrer({ ...c, chiffre: octets.toString('base64') }, 'order.updated'), null);
});

test('deux chiffrements de la même valeur ont la même empreinte mais des nonces différents', () => {
  const a = chiffrer('abc123', 'order.updated'), b = chiffrer('abc123', 'order.updated');
  assert.equal(a.empreinte, b.empreinte);
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(a.chiffre, b.chiffre);
});

test('deux valeurs différentes ont des empreintes différentes', () => {
  assert.notEqual(chiffrer('abc123', 'order.updated').empreinte, chiffrer('abc124', 'order.updated').empreinte);
});
