// ENTREPRISE — avis publics (avis.ts) : pagination pure (l'épinglé occupe une place à part sur la page 1, jamais répété), dépôt
// qui exige une identité Discord et limite à un avis en attente par personne, modération (épingle unique, jamais
// l'identifiant Discord dans les réponses), section de l'accueil échappée. Base réelle, lignes « zz-test » retirées à la fin.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import {
  AVIS_PAR_PAGE, calculerPageAvis, creerAvis, epinglerAvis, injecterAvis, listerAvisAccueil, listerAvisGestion, publierAvis, refuserAvis,
} from '../src/entreprise/avis.js';

const DISCORD = '900000000000000901';
const identite = { id: DISCORD, pseudo: 'zz-test-pseudo' };
const avisIds: number[] = [];
after(async () => {
  await prisma.avis.deleteMany({ where: { discordId: DISCORD } });
  await prisma.$disconnect();
});

test('page 1, avec épinglé : 1 place de moins pour les autres, rien à sauter', () => {
  const r = calculerPageAvis(10, 1, true);
  assert.deepEqual([r.page, r.skip, r.take, r.avecEpingle], [1, 0, AVIS_PAR_PAGE - 1, true]);
});
test('page 1, sans épinglé : toute la page pour les autres', () => {
  const r = calculerPageAvis(10, 1, false);
  assert.deepEqual([r.skip, r.take, r.avecEpingle], [0, AVIS_PAR_PAGE, false]);
});
test('page 2 : reprend juste après la page 1, épinglé non recompté', () => {
  assert.equal(calculerPageAvis(20, 2, true).skip, AVIS_PAR_PAGE - 1);
  assert.equal(calculerPageAvis(20, 2, false).skip, AVIS_PAR_PAGE);
});
test('page hors bornes (0, négative, trop grande, décimale) : ramenée dans [1, totalPages]', () => {
  const total = AVIS_PAR_PAGE * 3;
  for (const [demandee, attendue] of [[0, 1], [-5, 1], [99, 3], [1.5, 1], [NaN, 1]]) assert.equal(calculerPageAvis(total, demandee, false).page, attendue);
  assert.equal(calculerPageAvis(0, 1, false).totalPages, 1);
});

test('dépôt : sans identité Discord, refusé (401) ; champs contrôlés', async () => {
  await assert.rejects(creerAvis({ nom: 'x', texte: 'y', note: 5 }, null), (e: { status?: number }) => e.status === 401);
  await assert.rejects(creerAvis({ nom: '', texte: 'y', note: 5 }, identite), /nom/);
  await assert.rejects(creerAvis({ nom: 'x', texte: '', note: 5 }, identite), /avis est obligatoire/);
  for (const note of [0, 6, 2.5, 'a']) await assert.rejects(creerAvis({ nom: 'x', texte: 'y', note }, identite), /note/);
});

test('dépôt : un seul avis en attente par personne, l’identifiant Discord ne sort jamais', async () => {
  const a = await creerAvis({ nom: 'zz-test Alice', texte: 'Très bien', note: 5 }, identite);
  avisIds.push(a.id);
  await assert.rejects(creerAvis({ nom: 'zz-test Alice', texte: 'Encore', note: 4 }, identite), (e: { status?: number }) => e.status === 409);
  const ligne = (await listerAvisGestion()).find(x => x.id === a.id)!;
  assert.equal(ligne.pseudoDiscord, 'zz-test-pseudo');
  assert.ok(!('discordId' in ligne));
  // une fois modéré, la personne peut en redéposer un
  await refuserAvis(a.id);
  const b = await creerAvis({ nom: 'zz-test Alice', texte: 'Autre', note: 3 }, identite);
  avisIds.push(b.id);
});

test('modération : seul un avis publié s’épingle, un seul épinglé à la fois, rien d’épinglé hors publication', async () => {
  const [a, b] = avisIds.slice(-2).length === 2 ? avisIds.slice(-2) : [0, 0];
  await assert.rejects(epinglerAvis(b), /publié/);
  await publierAvis(b);
  await epinglerAvis(b);
  assert.equal((await prisma.avis.count({ where: { epingle: true } })), 1);
  const accueil = await listerAvisAccueil();
  assert.equal(accueil[0].epingle, true);
  assert.ok(!('discordId' in accueil[0]) && !('statut' in accueil[0]));
  await refuserAvis(b);   // un avis refusé perd son épingle
  assert.equal((await prisma.avis.findUnique({ where: { id: b } }))!.epingle, false);
  assert.ok(a);
});

test('injecterAvis : saisies échappées, section montrée même sans avis', () => {
  const page = '<section data-si-avis hidden><div class="avis" id="avis-liste"></div></section>';
  const vide = injecterAvis(page, []);
  assert.ok(vide.includes('Aucun avis publié') && !vide.includes('hidden'));
  const html = injecterAvis(page, [{ nom: '<b>x</b>', entreprise: null, note: 4, texte: '"><script>', epingle: true, creeLe: new Date('2026-01-05T12:00:00Z') }]);
  assert.ok(!html.includes('<b>x') && !html.includes('<script>'));
  assert.ok(html.includes('Avis mis en avant') && html.includes('4 sur 5'));
});
