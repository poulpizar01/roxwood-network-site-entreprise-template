// SOCLE — deux garde-fous de route vérifiés de bout en bout (base réelle, serveur Express éphémère) :
// webhooks : une livraison encore en cours de traitement répond 503 (le bot réessaie), pas « déjà traité » en 200 ;
// comptes : on n'attribue pas un grade qui porte des permissions qu'on ne détient pas soi-même.
// Les lignes créées portent un préfixe « zz-test » et sont retirées à la fin.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { config } from '../src/socle/config.js';
import { prisma } from '../src/socle/db.js';
import { chiffrer } from '../src/socle/webhooks-cle.js';
import { chargerGrades } from '../src/socle/droits.js';
import { webhooks } from '../src/socle/routes/webhooks.js';
import { comptes } from '../src/socle/routes/comptes.js';
import { entreprise } from '../src/entreprise/index.js';

const TYPE = 'zz-test.lent', CLE = crypto.randomBytes(32).toString('hex');
const GRADES = ['zz-test-a', 'zz-test-b', 'zz-test-c'];
const DISCORD = { acteur: '990000000000000001', cible: '990000000000000002' };
let appWebhooks: ReturnType<typeof ecouter>, appComptes: ReturnType<typeof ecouter>;
let acteurId = 0, cibleId = 0, executions = 0;

function ecouter(app: express.Express) {
  const srv = app.listen(0);
  return { srv, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
}

before(async () => {
  // webhooks : un abonnement de test et un traitement volontairement lent
  const c = chiffrer(CLE, TYPE);
  await prisma.abonnementWebhook.upsert({ where: { type: TYPE }, create: { type: TYPE, cleChiffree: c.chiffre, cleNonce: c.nonce, cleEmpreinte: c.empreinte }, update: {} });
  entreprise.webhooks[TYPE] = { libelle: 'test', description: 'test', traiter: async () => { executions++; await new Promise(r => setTimeout(r, 400)); } };
  const w = express(); w.use(webhooks); appWebhooks = ecouter(w);

  // comptes : a (acteur, peut gérer les comptes) > b (porte « grades », que l'acteur n'a pas) > c (sans permission)
  await prisma.grade.createMany({ data: [
    { cle: GRADES[0], libelle: 'Test A', position: 900, permissions: ['comptes'] },
    { cle: GRADES[1], libelle: 'Test B', position: 901, permissions: ['grades'] },
    { cle: GRADES[2], libelle: 'Test C', position: 902, permissions: [] },
  ] });
  await chargerGrades();
  acteurId = (await prisma.compte.create({ data: { discordId: DISCORD.acteur, pseudo: 'zz-test-acteur', statut: 'valide', gradeCle: GRADES[0] } })).id;
  cibleId = (await prisma.compte.create({ data: { discordId: DISCORD.cible, pseudo: 'zz-test-cible', statut: 'attente' } })).id;
  const c2 = express();
  c2.use(express.json());
  c2.use((req, _res, next) => { (req as unknown as { session: unknown }).session = { compteId: acteurId }; next(); });
  c2.use(comptes);
  appComptes = ecouter(c2);
});

after(async () => {
  appWebhooks?.srv.close(); appComptes?.srv.close();
  delete entreprise.webhooks[TYPE];
  await prisma.webhookRecu.deleteMany({ where: { type: TYPE } });
  await prisma.abonnementWebhook.deleteMany({ where: { type: TYPE } });
  await prisma.compte.deleteMany({ where: { discordId: { in: Object.values(DISCORD) } } });
  await prisma.grade.deleteMany({ where: { cle: { in: GRADES } } });
  await chargerGrades();
  await prisma.$disconnect();
});

function envoi(corps: string) {
  const signature = crypto.createHmac('sha256', CLE).update(corps).digest('hex');
  return fetch(`${appWebhooks.url}/webhooks/bot`, { method: 'POST', headers: { 'x-signature-256': signature, 'content-type': 'application/json' }, body: corps });
}

test('webhook : une livraison en cours répond 503 avec Retry-After, le traitement ne part qu’une fois, puis « déjà traité »', async () => {
  const corps = JSON.stringify({ guildId: config.discord.guildId || '1', eventType: TYPE, sentAt: new Date().toISOString(), payload: {} });
  const [a, b] = await Promise.all([envoi(corps), envoi(corps)]);
  const statuts = [a.status, b.status].sort();
  assert.deepEqual(statuts, [200, 503]);
  assert.equal((a.status === 503 ? a : b).headers.get('retry-after'), '5');
  assert.equal(executions, 1);
  const apres = await envoi(corps);
  assert.equal(apres.status, 200);
  assert.deepEqual(await apres.json(), { ok: true, deja: true });
  assert.equal(executions, 1);
});

function attribuer(grade: string) {
  return fetch(`${appComptes.url}/api/comptes/${cibleId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', origin: config.baseUrl }, body: JSON.stringify({ grade }),
  });
}

test('comptes : attribuer un grade qui porte des permissions qu’on n’a pas → 403 ; sans permission → accepté', async () => {
  const refus = await attribuer(GRADES[1]);
  assert.equal(refus.status, 403);
  assert.match((await refus.json() as { error: string }).error, /permissions que tu ne détiens pas/);
  assert.equal((await prisma.compte.findUnique({ where: { id: cibleId } }))!.gradeCle, null);

  const ok = await attribuer(GRADES[2]);
  assert.equal(ok.status, 200);
  assert.equal((await prisma.compte.findUnique({ where: { id: cibleId } }))!.gradeCle, GRADES[2]);
});
