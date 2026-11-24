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
