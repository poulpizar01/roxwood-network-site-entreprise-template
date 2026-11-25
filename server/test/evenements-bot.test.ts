// ENTREPRISE — événements du bot : date de l'événement (pas de la réception), vente non comptée deux fois si le bot réessaie, valeurs
// invalides ignorées, ancienne livraison d'une commande sans effet sur un état plus récent. Base réelle, lignes « zz-test » retirées.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { instantEvenement } from '../src/entreprise/texte.js';
import { recevoirRun } from '../src/entreprise/run.js';
import { recevoirFactureCommande } from '../src/entreprise/facture.js';

const maintenant = () => new Date().toISOString();
const il_y_a = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const vente = (extra: Record<string, unknown> = {}, parsed: Record<string, unknown> = {}) => ({
  guildId: '', eventType: 'monitoring.sale', sentAt: il_y_a(60),
  payload: { jobId: 'zz-test', playerDiscord: '900000000000000911', playerName: 'zz-test', description: 'zz-test vente', logTimestamp: il_y_a(90), parsed: { itemLabel: 'zz', quantity: 2, totalPrice: 100, companyShare: 40, ...parsed }, ...extra },
});

after(async () => {
  await prisma.run.deleteMany({ where: { jobId: 'zz-test' } });
  await prisma.facture.deleteMany({ where: { idBot: { startsWith: 'zz-test' } } });
});

test('instantEvenement : l’horodatage du log, sinon l’envoi, sinon la réception ; jamais le futur ni une date très ancienne', () => {
  const log = il_y_a(90), envoi = il_y_a(60);
  assert.equal(instantEvenement({ logTimestamp: log }, envoi).toISOString(), log);
  assert.equal(instantEvenement({ logTimestamp: 'n’importe quoi' }, envoi).toISOString(), envoi);
  assert.equal(instantEvenement(null, envoi).toISOString(), envoi);
  const apres = Date.now();
  assert.ok(instantEvenement({ logTimestamp: '2001-01-01T00:00:00Z' }, '2001-01-01T00:00:00Z').getTime() >= apres - 1000);
  assert.ok(instantEvenement({}, new Date(Date.now() + 3_600_000).toISOString()).getTime() <= Date.now() + 1000);
});

test('vente : datée du log, enregistrée une seule fois si le bot renvoie le même événement', async () => {
  const e = vente();
  await recevoirRun(e); await recevoirRun(e);
  const lignes = await prisma.run.findMany({ where: { jobId: 'zz-test' } });
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].creeLe.toISOString(), (e.payload as { logTimestamp: string }).logTimestamp);
});

test('vente : quantité nulle ou valeur hors des bornes ignorée sans erreur (le bot ne réessaiera pas)', async () => {
  for (const parsed of [{ quantity: 0 }, { quantity: -3 }, { totalPrice: 3_000_000_000 }, { companyShare: -1 }]) {
    await recevoirRun(vente({ description: `zz-test ${JSON.stringify(parsed)}` }, parsed));
  }
  assert.equal(await prisma.run.count({ where: { jobId: 'zz-test', description: { contains: '{' } } }), 0);
});

test('commande : une ancienne livraison arrivée après une plus récente ne la remplace pas ; un article vide est ignoré', async () => {
  const commande = (sentAt: string, paymentStatus: string, items: unknown[] = []) => ({ guildId: '', eventType: 'order.updated', sentAt, payload: { orderId: 'zz-test-cmd', paymentStatus, total: 10, subtotal: 10, items } });
  await recevoirFactureCommande(commande(il_y_a(10), 'PAID', [null, { name: 'a', unitPrice: 5, quantity: 2 }]));
  await recevoirFactureCommande(commande(il_y_a(60), 'UNPAID'));   // nouvelle tentative d'un événement plus ancien
  const f = await prisma.facture.findUnique({ where: { idBot: 'zz-test-cmd' } });
  assert.equal(f?.statutPaiement, 'PAID');
  assert.equal((f?.details as { articles: unknown[] }).articles.length, 1);
});
