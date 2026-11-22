// SOCLE — connexion « IG » (src/socle/folkos-sso.ts) : liaison du ticket au navigateur (nonces) et validation de « next ».
// Ce sont des contrôles de sécurité : une redirection ouverte ou un nonce mal lu se voient en production, pas à l'écran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivee, cheminSur, noncesFolkos, prefixeNonces } from '../src/socle/folkos-sso.js';

const N16 = 'a'.repeat(16);

test('préfixe des cookies : client_id en minuscules, caractères spéciaux remplacés par un tiret', () => {
  assert.equal(prefixeNonces('MonSite'), 'fbfa_sso_monsite_');
  assert.equal(prefixeNonces('mon_site.v2'), 'fbfa_sso_mon-site-v2_');
});

test('nonces : seuls les cookies du site, de 16 à 128 caractères', () => {
  const entete = `a=1; fbfa_sso_monsite_ab12cd34=${N16}; fbfa_sso_autre_ab12cd34=${N16}; fbfa_sso_monsite_court=abc; fbfa_sso_monsite_long=${'b'.repeat(129)}`;
  assert.deepEqual(noncesFolkos(entete, 'monsite'), [N16]);
});

test('nonces : les 16 plus récents (les derniers de l’en-tête), dans l’ordre', () => {
  const valeurs = Array.from({ length: 20 }, (_, i) => String(i).padStart(2, '0').repeat(8));
  const entete = valeurs.map((v, i) => `fbfa_sso_s_${i}=${v}`).join('; ');
  assert.deepEqual(noncesFolkos(entete, 's'), valeurs.slice(-16));
});

test('nonces : aucun cookie, ou en-tête absent → liste vide (la connexion sera refusée, jamais une erreur)', () => {
  assert.deepEqual(noncesFolkos(undefined, 'monsite'), []);
  assert.deepEqual(noncesFolkos('session=abc', 'monsite'), []);
});

test('nonces : la valeur est gardée telle quelle, « = » compris', () => {
  assert.deepEqual(noncesFolkos(`fbfa_sso_s_1=${N16}==`, 's'), [`${N16}==`]);
});

test('next : chemin relatif du site accepté, avec sa query', () => {
  assert.equal(cheminSur('/gestion/rh.html?onglet=2', '/'), '/gestion/rh.html?onglet=2');
});

test('next : URL absolue, « //hote », barre oblique inverse, espace → page par défaut', () => {
  for (const v of ['https://evil.example/', '//evil.example', '/' + String.fromCharCode(92) + 'evil.example', '/a b', 'javascript:alert(1)', '', undefined, 42])
    assert.equal(cheminSur(v, '/defaut'), '/defaut', String(v));
});

test('next : trop long ou route de passage (API, connexion) → page par défaut', () => {
  assert.equal(cheminSur('/' + 'a'.repeat(600), '/defaut'), '/defaut');
  for (const v of ['/api/moi', '/auth/discord', '/api?x=1']) assert.equal(cheminSur(v, '/defaut'), '/defaut', v);
  assert.equal(cheminSur('/apiculteur', '/defaut'), '/apiculteur');   // seul le préfixe de route compte, pas un nom qui commence pareil
});

test('arrivée : paramètre jetable ajouté avec ? ou &, différent à chaque fois', () => {
  assert.match(arrivee('/gestion/accueil.html'), /^\/gestion\/accueil\.html\?_sso=[0-9a-f]{8}$/);
  assert.match(arrivee('/gestion/rh.html?onglet=2'), /^\/gestion\/rh\.html\?onglet=2&_sso=[0-9a-f]{8}$/);
  assert.notEqual(arrivee('/x'), arrivee('/x'));
});
