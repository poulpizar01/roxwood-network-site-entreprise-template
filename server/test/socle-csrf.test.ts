// SOCLE — contrôle d'origine des requêtes qui modifient des données (src/socle/csrf.ts). « Origin: null » (navigateur du
// jeu) n'est accepté qu'avec le jeton de la session et seulement quand FolkOS est configuré : un autre site, ou une iframe
// isolée qui produit aussi « null », ne doit jamais passer sans le jeton.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nouveauJetonCsrf, origineAcceptee } from '../src/socle/csrf.js';

const SITE = 'https://monsite.fbfa.fr';
const base = { methode: 'POST', origineSite: SITE, jetonSession: 'jeton-de-la-session', jetonRecu: undefined as string | undefined, jetonAutorise: true };
const ok = (o: Partial<typeof base> & { origineRecue?: string }) => origineAcceptee({ ...base, origineRecue: undefined, ...o });

test('lectures : jamais contrôlées', () => {
  assert.equal(ok({ methode: 'GET', origineRecue: 'https://evil.example' }), true);
  assert.equal(ok({ methode: 'HEAD', origineRecue: 'null' }), true);
});

test('écriture depuis le site, ou sans en-tête Origin (curl, script) : acceptée, comme avant', () => {
  assert.equal(ok({ origineRecue: SITE }), true);
  assert.equal(ok({ origineRecue: undefined }), true);
});

test('écriture depuis un autre site : refusée, jeton ou non', () => {
  assert.equal(ok({ origineRecue: 'https://evil.example' }), false);
  assert.equal(ok({ origineRecue: 'https://evil.example', jetonRecu: 'jeton-de-la-session' }), false);
});

test('Origin: null : refusée sans jeton, avec un mauvais jeton, ou sans jeton de session', () => {
  assert.equal(ok({ origineRecue: 'null' }), false);
  assert.equal(ok({ origineRecue: 'null', jetonRecu: 'autre-jeton-de-meme-taille' }), false);
  assert.equal(ok({ origineRecue: 'null', jetonRecu: 'court' }), false);
  assert.equal(ok({ origineRecue: 'null', jetonSession: undefined, jetonRecu: 'jeton-de-la-session' }), false);
});

test('Origin: null avec le jeton de la session : acceptée', () => {
  assert.equal(ok({ origineRecue: 'null', jetonRecu: 'jeton-de-la-session' }), true);
});

test('Origin: null refusée même avec le bon jeton quand FolkOS n’est pas configuré', () => {
  assert.equal(ok({ origineRecue: 'null', jetonRecu: 'jeton-de-la-session', jetonAutorise: false }), false);
});

test('jeton : 48 caractères hexadécimaux, différent à chaque session', () => {
  assert.match(nouveauJetonCsrf(), /^[0-9a-f]{48}$/);
  assert.notEqual(nouveauJetonCsrf(), nouveauJetonCsrf());
});
