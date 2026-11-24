// ENTREPRISE — salon Discord d'un contrat (facture.ts, salon-discord.ts) : un envoi vers un salon que Discord ne connaît
// plus pose le repère « salon introuvable » sur le contrat, une nouvelle saisie du salon l'efface. Le bot de dev est
// simulé (DISCORD_BOT_TOKEN=simulation) : un identifiant inconnu y répond 404 comme Discord. Base réelle, lignes « zz-test »
// retirées à la fin.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { botDiscordConfigure } from '../src/socle/discord.js';
import { modifierContrat } from '../src/entreprise/contrats.js';
import { contratsAvecSalon, envoyerFactureManuel } from '../src/entreprise/facture.js';

const contrats: number[] = [];
const donnees = { partenaire: 'zz-test salon', partie: 'client', montant: 100, periodicite: 'hebdomadaire', dateDebut: '2026-01-05' };
after(async () => {
  await prisma.facture.deleteMany({ where: { numeroFacture: { startsWith: 'zz-test' } } });
  await prisma.echeancier.deleteMany({ where: { contratId: { in: contrats } } });
  await prisma.contrat.deleteMany({ where: { id: { in: contrats } } });
  await prisma.$disconnect();
});

test('salon introuvable : le repère se pose sur le contrat à un envoi en 404, et s’efface avec un nouveau salon', { skip: !botDiscordConfigure() && 'bot Discord non configuré' }, async () => {
  const c = await prisma.contrat.create({ data: { ...donnees, dateDebut: new Date('2026-01-05'), salonDiscordId: '999999999999999991' } });
  contrats.push(c.id);
  const f = await prisma.facture.create({ data: { source: 'manuel', numeroFacture: 'zz-test', clientNom: 'zz-test', total: 100, contratId: c.id } });
  await assert.rejects(envoyerFactureManuel(f.id, ''), (e: unknown) => (e as { statut?: number }).statut === 404);
  assert.ok((await prisma.contrat.findUniqueOrThrow({ where: { id: c.id } })).salonIntrouvableLe, 'repère posé');
  // changer le salon efface le repère ; garder le même ne l'efface pas
  await modifierContrat(c.id, { ...donnees, salonDiscordId: '999999999999999991' });
  assert.ok((await prisma.contrat.findUniqueOrThrow({ where: { id: c.id } })).salonIntrouvableLe, 'même salon : repère gardé');
  await modifierContrat(c.id, { ...donnees, salonDiscordId: '999999999999999992' });
  assert.equal((await prisma.contrat.findUniqueOrThrow({ where: { id: c.id } })).salonIntrouvableLe, null, 'salon changé : repère effacé');
});

test('envoi : sans salon du contrat, l’identifiant donné doit être valide ; un salon invalide est refusé à la saisie du contrat', async () => {
  const f = await prisma.facture.create({ data: { source: 'manuel', numeroFacture: 'zz-test', clientNom: 'zz-test', total: 100 } });
  await assert.rejects(envoyerFactureManuel(f.id, 'pas-un-salon'), /identifiant du salon/);
  await assert.rejects(envoyerFactureManuel(999999999, '123456789012345678'), /introuvable/);
  const c = await prisma.contrat.create({ data: { ...donnees, dateDebut: new Date('2026-01-05') } });
  contrats.push(c.id);
  await assert.rejects(modifierContrat(c.id, { ...donnees, salonDiscordId: 'abc' }), /invalide/);
  assert.deepEqual([...await contratsAvecSalon([c.id])], []);
  await modifierContrat(c.id, { ...donnees, salonDiscordId: '123456789012345678' });
  assert.deepEqual([...await contratsAvecSalon([c.id])], [c.id]);
});

// ---- confirmation de lecture par le client (accusé de lecture prouvé par Discord) ----
import type { AddressInfo } from 'node:net';
import express from 'express';
import { compta } from '../src/entreprise/routes/compta.js';
import { valeurCookieIdentite } from '../src/socle/routes/discord-leger.js';
import { envoyerLienSignature, factureSignable, infoLienSignature, signerFacture } from '../src/entreprise/facture.js';

test('signature : lien à usage unique, 7 jours, copie figée, identité Discord enregistrée', async () => {
  const c = await prisma.contrat.create({ data: { ...donnees, dateDebut: new Date('2026-01-05'), salonDiscordId: '999999999999999996' } });
  contrats.push(c.id);
  const f = await prisma.facture.create({ data: { source: 'manuel', numeroFacture: 'zz-test', clientNom: 'zz-test', total: 100, sousTotal: 100, contratId: c.id } });
  assert.equal(factureSignable(f), true);
  assert.equal(factureSignable({ contratId: null, source: 'monitoring', clientNom: 'X' }), false, 'un paiement en jeu n’a personne à qui envoyer un lien');
  // l'envoi échoue (salon inconnu du bot simulé) mais le lien existe déjà : posé avant l'envoi
  await assert.rejects(envoyerLienSignature(f.id));
  const pose = await prisma.facture.findUniqueOrThrow({ where: { id: f.id } });
  assert.ok(pose.signatureJeton && pose.signatureExpireLe);
  assert.ok(Math.abs(pose.signatureExpireLe.getTime() - (Date.now() + 7 * 24 * 3600e3)) < 60_000, 'valable 7 jours');
  const jeton = pose.signatureJeton;
  assert.equal((await infoLienSignature(jeton)).total, 100);
  await assert.rejects(signerFacture('0'.repeat(48), { id: '123456789012345678', pseudo: 'x' }), /n’existe pas/);
  await signerFacture(jeton, { id: '123456789012345678', pseudo: 'client.discord' });
  const signee = await prisma.facture.findUniqueOrThrow({ where: { id: f.id } });
  assert.equal(signee.signatureJeton, null, 'jeton effacé : usage unique');
  assert.equal(signee.signatureDiscordId, '123456789012345678');
  assert.equal(signee.signatureDiscordPseudo, 'client.discord');
  assert.equal((signee.signatureDocumentFige as { total: number }).total, 100);
  await assert.rejects(signerFacture(jeton, { id: '123456789012345678', pseudo: 'x' }), /n’existe pas|déjà servi/);
  // la copie reste celle qui a été lue, même si la facture change ensuite
  await prisma.facture.update({ where: { id: f.id }, data: { total: 999 } });
  assert.equal(((await prisma.facture.findUniqueOrThrow({ where: { id: f.id } })).signatureDocumentFige as { total: number }).total, 100);
  await assert.rejects(envoyerLienSignature(f.id), /déjà signée/);
});

test('signature : un lien périmé est refusé ; la route exige une connexion Discord et ne montre jamais le jeton', async () => {
  const f = await prisma.facture.create({ data: { source: 'manuel', numeroFacture: 'zz-test', clientNom: 'zz-test', total: 50 } });
  const jeton = 'a'.repeat(48);
  await prisma.facture.update({ where: { id: f.id }, data: { signatureJeton: jeton, signatureExpireLe: new Date(Date.now() - 1000) } });
  await assert.rejects(infoLienSignature(jeton), /expiré/);
  await prisma.facture.update({ where: { id: f.id }, data: { signatureExpireLe: new Date(Date.now() + 60_000) } });

  const app = express();
  app.use(express.json());
  app.use(compta);
  const srv = app.listen(0);
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const lire = await fetch(`${url}/api/compta/factures/signature/${jeton}`);
    assert.equal(lire.status, 200);
    const corps = await lire.json() as { facture: { total: number }; discord: unknown };
    assert.equal(corps.facture.total, 50);
    assert.equal(corps.discord, null);
    assert.equal(JSON.stringify(corps).includes(jeton), false, 'le jeton n’est jamais renvoyé');
    const sansIdentite = await fetch(`${url}/api/compta/factures/signature/${jeton}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(sansIdentite.status, 401);
    // cookie falsifié : refusé comme s'il n'y en avait pas
    const faux = await fetch(`${url}/api/compta/factures/signature/${jeton}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'discord_leger=123456789012345678.9999999999999.x.deadbeef' }, body: '{}' });
    assert.equal(faux.status, 401);
    const bon = await fetch(`${url}/api/compta/factures/signature/${jeton}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `discord_leger=${encodeURIComponent(valeurCookieIdentite('123456789012345679', 'client.vrai'))}` }, body: '{}' });
    assert.equal(bon.status, 200);
    assert.equal((await prisma.facture.findUniqueOrThrow({ where: { id: f.id } })).signatureDiscordPseudo, 'client.vrai');
  } finally { srv.close(); }
});
