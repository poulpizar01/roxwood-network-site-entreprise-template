// SOCLE — état et journal des abonnements vérifiés sur PostgreSQL avec un serveur Express éphémère.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { entreprise } from '../src/entreprise/index.js';
import { prisma } from '../src/socle/db.js';
import { webhooksAbonnements } from '../src/socle/routes/webhooks-abonnements.js';
import { chiffrer, dechiffrerCleActive } from '../src/socle/webhooks-cle.js';

const TYPE_ETAT = 'zz-test.abonnement-etat';
const TYPE_ECHEC = 'zz-test.abonnement-historique';
const TYPE_CONCURRENT = 'zz-test.abonnement-concurrent';
const TYPES = [TYPE_ETAT, TYPE_ECHEC, TYPE_CONCURRENT];
const DISCORD = '97' + crypto.randomBytes(8).readBigUInt64BE().toString().padStart(20, '0');
let serveur: Server;
let url: string;

const cle = () => crypto.randomBytes(32).toString('hex');
const abonnement = (type: string) => prisma.abonnementWebhook.findUnique({ where: { type } });
const historique = (type: string) => prisma.historiqueAbonnementWebhook.findMany({ where: { type }, orderBy: { id: 'asc' } });
const enregistrer = (type: string, valeur: string) => fetch(url + '/' + type + '/cle', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cle: valeur }),
});
const retirer = (type: string) => fetch(url + '/' + type, { method: 'DELETE' });

before(async () => {
  for (const type of TYPES) entreprise.webhooks![type] = { libelle: type, description: 'test', traiter: async () => {} };
  const compte = await prisma.compte.create({
    data: { discordId: DISCORD, pseudo: 'zz-test-webhooks', statut: 'valide', proprietaire: true, connecteLe: new Date() },
  });
  const app = express();
  const session: RequestHandler = (req, _res, next) => {
    req.session = { compteId: compte.id } as typeof req.session;
    next();
  };
  const erreur: ErrorRequestHandler = (_err, _req, res, _next) => { res.sendStatus(500); };
  app.use(express.json(), session, webhooksAbonnements, erreur);
  serveur = app.listen(0);
  url = 'http://127.0.0.1:' + (serveur.address() as AddressInfo).port + '/api/webhooks/abonnements';
});

after(async () => {
  serveur?.close();
  for (const type of TYPES) delete entreprise.webhooks![type];
  await prisma.webhookRecu.deleteMany({ where: { type: { in: TYPES } } });
  await prisma.abonnementWebhook.deleteMany({ where: { type: { in: TYPES } } });
  await prisma.historiqueAbonnementWebhook.deleteMany({ where: { type: { in: TYPES } } });
  await prisma.compte.deleteMany({ where: { discordId: DISCORD } });
});

test('une clé illisible est signalée même après une livraison réussie', async () => {
  const lire = async () => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    return (await response.json()).abonnements.find((a: { type: string }) => a.type === TYPE_ETAT);
  };
  assert.equal((await lire()).etat, 'non_configure');
  const valeur = cle();
  assert.equal((await enregistrer(TYPE_ETAT, valeur)).status, 200);
  assert.equal((await lire()).etat, 'en_attente');
  await prisma.webhookRecu.create({ data: { type: TYPE_ETAT, empreinte: cle(), contenu: {}, traite: true } });
  assert.equal((await lire()).etat, 'actif');

  const lieeAutreType = chiffrer(valeur, TYPE_ECHEC);
  await prisma.abonnementWebhook.update({
    where: { type: TYPE_ETAT },
    data: { cleChiffree: lieeAutreType.chiffre, cleNonce: lieeAutreType.nonce },
  });
  const etat = await lire();
  assert.equal(etat.etat, 'cle_illisible');
  assert.ok(etat.dernierRecuLe);
  assert.ok(!JSON.stringify(etat).includes(lieeAutreType.chiffre));
  assert.equal((await enregistrer(TYPE_ETAT, cle())).status, 200);
  assert.equal((await lire()).etat, 'actif');
});

test('un échec du journal annule la création, le remplacement et le retrait', async () => {
  const valeur = cle();
  const bloquer = () => prisma.$executeRaw`
    ALTER TABLE historique_abonnements_webhooks ADD CONSTRAINT zz_test_webhook_historique
    CHECK (type <> 'zz-test.abonnement-historique') NOT VALID`;
  const debloquer = () => prisma.$executeRaw`
    ALTER TABLE historique_abonnements_webhooks DROP CONSTRAINT IF EXISTS zz_test_webhook_historique`;
  await bloquer();
  try {
    assert.equal((await enregistrer(TYPE_ECHEC, valeur)).status, 500);
    assert.equal(await abonnement(TYPE_ECHEC), null);
    assert.deepEqual(await historique(TYPE_ECHEC), []);
  } finally { await debloquer(); }

  assert.equal((await enregistrer(TYPE_ECHEC, valeur)).status, 200);
  const initial = await abonnement(TYPE_ECHEC);
  await bloquer();
  try {
    assert.equal((await enregistrer(TYPE_ECHEC, cle())).status, 500);
    assert.deepEqual(await abonnement(TYPE_ECHEC), initial);
    assert.equal((await retirer(TYPE_ECHEC)).status, 500);
    assert.deepEqual(await abonnement(TYPE_ECHEC), initial);
    assert.deepEqual((await historique(TYPE_ECHEC)).map(h => h.action), ['creation']);
  } finally { await debloquer(); }

  assert.equal((await retirer(TYPE_ECHEC)).status, 200);
  assert.equal(await abonnement(TYPE_ECHEC), null);
  assert.deepEqual((await historique(TYPE_ECHEC)).map(h => h.action), ['creation', 'retrait']);
});

test('deux enregistrements puis deux retraits simultanés gardent un historique cohérent', async () => {
  const valeurs = [cle(), cle()];
  const reponses = await Promise.all(valeurs.map(v => enregistrer(TYPE_CONCURRENT, v)));
  assert.deepEqual(reponses.map(r => r.status), [200, 200]);
  const a = await abonnement(TYPE_CONCURRENT);
  assert.ok(a);
  const journal = await historique(TYPE_CONCURRENT);
  assert.deepEqual(journal.map(h => h.action), ['creation', 'remplacement']);
  assert.equal(a.ancienneCleEmpreinte, journal[0].empreinte);
  assert.equal(a.cleEmpreinte, journal[1].empreinte);
  assert.ok(valeurs.includes(dechiffrerCleActive(a)!));

  const retraits = await Promise.all([retirer(TYPE_CONCURRENT), retirer(TYPE_CONCURRENT)]);
  assert.deepEqual(retraits.map(r => r.status), [200, 200]);
  assert.equal(await abonnement(TYPE_CONCURRENT), null);
  assert.deepEqual((await historique(TYPE_CONCURRENT)).map(h => h.action), ['creation', 'remplacement', 'retrait']);
});
