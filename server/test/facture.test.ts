// ENTREPRISE — factures : paiement constaté en jeu (recevoirFactureMonitoring) et totaux (facturesComptees), vérifiés
// sur la base réelle. Calculs d'argent : chaque cas ci-dessous a déjà produit un mauvais total ou un doublon.
// Lignes de test préfixées « zz-test », retirées à la fin.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les modules dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { facturesComptees, recevoirFactureMonitoring } from '../src/entreprise/facture.js';
import { recevoirRun } from '../src/entreprise/run.js';

const DISCORD = '990000000000000301';
let employeId = 0;

before(async () => {
  employeId = (await prisma.employe.create({ data: { idUnique: 'zz-test-fact', idUniqueNormalise: 'zz-test-fact', prenom: 'Test', nom: 'Facture', gradeCle: 'zz-test', discordId: DISCORD, discordPseudo: 'zz-test-pseudo', discordPseudoNormalise: 'zz-test-pseudo' } })).id;
});
after(async () => {
  await prisma.facture.deleteMany({ where: { clientNom: { startsWith: 'zz-test' } } });
  await prisma.run.deleteMany({ where: { vendeurNom: { startsWith: 'zz-test' } } });
  await prisma.employe.deleteMany({ where: { idUnique: 'zz-test-fact' } });
  await prisma.$disconnect();
});

const evenement = (payload: unknown, sentAt = new Date().toISOString()) => ({ guildId: '1', eventType: 'monitoring.invoice', sentAt, payload });
const paiement = (extra: Record<string, unknown> = {}, parsed: Record<string, unknown> = {}) =>
  ({ jobId: 'zz-job', description: 'zz-test', playerDiscord: DISCORD, playerName: 'zz-test-pseudo', parsed: { payerName: 'zz-test client', amount: 1200, taxPercent: 10, ...parsed }, ...extra });
const lignes = () => prisma.facture.findMany({ where: { clientNom: { startsWith: 'zz-test' }, source: 'monitoring' } });

test('un même événement renvoyé après un échec ne crée qu’une facture', async () => {
  const e = evenement(paiement(), '2026-11-23T10:00:00.000Z');
  await recevoirFactureMonitoring(e);
  await recevoirFactureMonitoring(e);   // nouvelle tentative du bot : même corps, même sentAt
  assert.equal((await lignes()).length, 1);
});

test('le paiement est rattaché par ID Discord, jamais par pseudo (homonyme)', async () => {
  await prisma.facture.deleteMany({ where: { clientNom: { startsWith: 'zz-test' } } });
  await recevoirFactureMonitoring(evenement(paiement({ playerDiscord: '', playerName: 'zz-test-pseudo' }, { payerName: 'zz-test sans id' })));
  await recevoirFactureMonitoring(evenement(paiement({}, { payerName: 'zz-test avec id' })));
  const [sans, avec] = [await prisma.facture.findFirstOrThrow({ where: { clientNom: 'zz-test sans id' } }), await prisma.facture.findFirstOrThrow({ where: { clientNom: 'zz-test avec id' } })];
  assert.equal(sans.employeId, null, 'un pseudo seul ne crédite personne');
  assert.equal(avec.employeId, employeId);
});

test('un montant hors bornes ou nul est ignoré sans erreur (le bot ne réessaie pas)', async () => {
  const avant = (await lignes()).length;
  for (const amount of [0, -5, 3_000_000_000, 'abc']) await recevoirFactureMonitoring(evenement(paiement({}, { payerName: 'zz-test invalide', amount })));
  assert.equal((await lignes()).length, avant);
});

test('facturesComptees : annulée sans avoir exclue, annulée avec avoir comptée (l’avoir la compense)', async () => {
  const base = { source: 'manuel', clientNom: 'zz-test totaux', dateFacture: new Date() };
  await prisma.facture.create({ data: { ...base, numeroFacture: 'zz-annulee', sousTotal: 7000, total: 7000, statutPaiement: 'ANNULEE', employeId } });
  await prisma.facture.create({ data: { ...base, numeroFacture: 'zz-normale', sousTotal: 400, total: 400, statutPaiement: 'EN_ATTENTE', employeId } });
  const remboursee = await prisma.facture.create({ data: { ...base, numeroFacture: 'zz-remboursee', sousTotal: 1500, total: 1500, statutPaiement: 'ANNULEE', employeId } });
  await prisma.facture.create({ data: { ...base, numeroFacture: 'zz-avoir', sousTotal: -1500, total: -1500, statutPaiement: 'PAYEE', avoirDeId: remboursee.id, employeId } });
  const somme = await prisma.facture.aggregate({ where: { clientNom: 'zz-test totaux', ...(await facturesComptees()) }, _sum: { total: true } });
  assert.equal(somme._sum.total, 400, '7000 exclue ; 1500 − 1500 = 0 ; reste la facture normale');
});

test('une vente en jeu (run) est rattachée par ID Discord seulement, comme les factures', async () => {
  const vente = (discord: string) => ({ guildId: '1', eventType: 'monitoring.sale', sentAt: new Date().toISOString(),
    payload: { jobId: 'zz-job', description: 'zz-test', playerDiscord: discord, playerName: 'zz-test-pseudo', parsed: { itemLabel: 'zz', quantity: 2, totalPrice: 100, companyShare: 50 } } });
  await recevoirRun(vente(''));        // pseudo seul : ne crédite personne
  await recevoirRun(vente(DISCORD));
  const runs = await prisma.run.findMany({ where: { vendeurNom: 'zz-test-pseudo' }, orderBy: { id: 'asc' } });
  assert.deepEqual(runs.map(r => r.employeId), [null, employeId]);
});
