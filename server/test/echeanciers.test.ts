// ENTREPRISE — échéanciers (echeanciers.ts) : la reprise des contrats d'avant ne change aucune facture, relie chaque
// période déjà facturée à sa facture, libère celles qui sont annulées ou annulées par un avoir, et se rejoue sans effet.
// Une erreur ici facture deux fois une période, ou en oublie une. Base réelle, lignes « zz-test » retirées à la fin.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { creerContrat, modifierContrat } from '../src/entreprise/contrats.js';
import { etatsPeriodes, periode, type FactureContrat } from '../src/entreprise/contrats-periodes.js';
import {
  creerEcheancierPaiement, echeanciersDeContrats, facturerEcheances, marquerEcheancePayee, planPaiementDeFacture, modifierEcheance, supprimerEcheancier,
  facturerEtEnvoyerAutomatique, prolongerEcheanciers, repartir, reprendreContratsExistants, synchroniserEcheancierContrat,
} from '../src/entreprise/echeanciers.js';
import { jourParis, versDate, versJour } from '../src/entreprise/texte.js';

const contrats: number[] = [];
const ajouter = (jours: number) => versJour(new Date(versDate(jourParis()).getTime() + jours * 864e5));
// contrat hebdomadaire commencé il y a 8 semaines : 9 périodes commencées (0 à 8)
const DEBUT = ajouter(-56);
const nouveauContrat = async (extra: object = {}) => {
  const c = await prisma.contrat.create({ data: { partenaire: 'zz-test client', partie: 'client', montant: 1000, periodicite: 'hebdomadaire', dateDebut: versDate(DEBUT), ...extra } });
  contrats.push(c.id); return c;
};
const facture = (contratId: number, i: number, j: number | null, extra: object = {}) => prisma.facture.create({
  data: {
    source: 'manuel', numeroFacture: 'zz-test', clientNom: 'zz-test client', sousTotal: 0, total: 3001, statutPaiement: 'EN_ATTENTE', contratId,
    periodeDebut: versDate(periode(DEBUT, 'hebdomadaire', i).debut), periodeFin: versDate(periode(DEBUT, 'hebdomadaire', j ?? i).fin), ...extra,
  },
});
const lignes = async (contratId: number) => prisma.echeance.findMany({ where: { echeancier: { contratId } }, orderBy: { periodeDebut: 'asc' } });

after(async () => {
  await prisma.echeancier.deleteMany({ where: { OR: [{ contratId: { in: contrats } }, { partenaire: { startsWith: 'zz-test' } }] } });
  await prisma.facture.deleteMany({ where: { numeroFacture: { startsWith: 'zz-test' } } });
  await prisma.contrat.deleteMany({ where: { id: { in: contrats } } });
  await prisma.$disconnect();
});

test('repartir : la somme des parts est toujours le total, la dernière absorbe le reste', () => {
  assert.deepEqual(repartir(3001, 3), [1000, 1000, 1001]);
  assert.deepEqual(repartir(100, 1), [100]);
  assert.equal(repartir(7, 4).reduce((s, x) => s + x, 0), 7);
  assert.deepEqual(repartir(10, 0), []);
});

test('reprise : périodes facturées reliées, annulées et avoirs libérés, hors calendrier ignorée, mêmes factures avant et après', async () => {
  const c = await nouveauContrat();
  const A = await facture(c.id, 0, 2);                       // 3 périodes, 3001
  const B = await facture(c.id, 3, null, { total: 1000, statutPaiement: 'PAYEE' });
  await facture(c.id, 4, null, { total: 1000, statutPaiement: 'ANNULEE' });
  const D = await facture(c.id, 5, null, { total: 1000 });
  await prisma.facture.create({ data: { source: 'manuel', numeroFacture: 'zz-test', clientNom: 'zz-test client', total: -1000, statutPaiement: 'PAYEE', avoirDeId: D.id } });
  const E = await facture(c.id, 6, null, { total: 1000, periodeDebut: versDate(ajouter(-56 + 6 * 7 + 1)) });   // début décalé d'un jour : hors calendrier

  const avant = await prisma.facture.findMany({ where: { numeroFacture: 'zz-test' }, orderBy: { id: 'asc' } });
  const bilan = await reprendreContratsExistants();
  assert.ok(bilan.ignorees >= 1, 'la facture hors calendrier est signalée');
  const l = await lignes(c.id);
  const parPeriode = (i: number) => l.find(x => versJour(x.periodeDebut) === periode(DEBUT, 'hebdomadaire', i).debut)!;
  assert.deepEqual([0, 1, 2].map(i => parPeriode(i).factureId), [A.id, A.id, A.id]);
  assert.deepEqual([0, 1, 2].map(i => parPeriode(i).montant), [1000, 1000, 1001], 'le total de la facture est réparti sans reste');
  assert.equal(parPeriode(3).factureId, B.id);
  for (const i of [4, 5, 6]) assert.equal(parPeriode(i).factureId, null, `période ${i} : annulée, avoir ou hors calendrier → reste à facturer`);
  assert.ok(l.length >= 9 + 12, 'toutes les périodes commencées, plus 12 d’avance');
  assert.ok(E.id);

  // aucune facture modifiée, créée ni supprimée par la reprise (l'avoir est une facture : comptée avec les autres)
  assert.deepEqual(await prisma.facture.findMany({ where: { numeroFacture: 'zz-test' }, orderBy: { id: 'asc' } }), avant);

  // « reste à facturer » identique à l'ancien calcul sur les factures
  const actives: FactureContrat[] = [A, B].map(f => ({ id: f.id, periodeDebut: versJour(f.periodeDebut), periodeFin: versJour(f.periodeFin), payee: f.statutPaiement === 'PAYEE' }));
  const anciennes = etatsPeriodes({ dateDebut: DEBUT, dateFin: null, periodicite: 'hebdomadaire' }, actives, jourParis()).filter(x => x.etat === 'a-facturer').map(x => x.debut);
  const plan = (await echeanciersDeContrats([c.id])).get(c.id)!;
  assert.deepEqual(plan.echeances.filter(x => x.statut === 'a-facturer').map(x => x.periodeDebut), anciennes);

  // rejouée : plus rien ne change
  const avantRejeu = await lignes(c.id);
  await reprendreContratsExistants();
  assert.deepEqual(await lignes(c.id), avantRejeu);
});

test('facturer : une facture par échéance due, jamais deux fois ; une facture annulée rouvre son échéance', async () => {
  const c = await nouveauContrat();
  await synchroniserEcheancierContrat(c);
  const echeancier = await prisma.echeancier.findUniqueOrThrow({ where: { contratId: c.id } });
  const crees = await facturerEcheances(echeancier.id, [], null);
  assert.equal(crees.length, 9, 'les 9 périodes commencées, pas les 12 à venir');
  await assert.rejects(facturerEcheances(echeancier.id, [], null), /Aucune échéance n’est due/);
  const dernier = await prisma.echeance.findFirstOrThrow({ where: { echeancierId: echeancier.id, factureId: crees[8] } });
  await assert.rejects(facturerEcheances(echeancier.id, [dernier.id], null), /déjà été facturée/);
  // annulée : l'échéance se rouvre et se refacture
  await prisma.facture.update({ where: { id: crees[8] }, data: { statutPaiement: 'ANNULEE', numeroFacture: 'zz-test' } });
  const rouvert = (await echeanciersDeContrats([c.id])).get(c.id)!;
  assert.equal(rouvert.aFacturer?.nombre, 1);
  const refaite = await facturerEcheances(echeancier.id, [], null);
  assert.equal(refaite.length, 1);
  assert.equal((await prisma.echeance.findUniqueOrThrow({ where: { id: dernier.id } })).factureId, refaite[0]);
  await prisma.facture.updateMany({ where: { contratId: c.id }, data: { numeroFacture: 'zz-test' } });
});

test('modifier le contrat régénère les échéances non facturées et garde les facturées ; la prolongation ne touche pas un montant ajusté', async () => {
  const c = await nouveauContrat();
  await synchroniserEcheancierContrat(c);
  const echeancier = await prisma.echeancier.findUniqueOrThrow({ where: { contratId: c.id } });
  const [premiere] = await facturerEcheances(echeancier.id, [(await prisma.echeance.findFirstOrThrow({ where: { echeancierId: echeancier.id }, orderBy: { periodeDebut: 'asc' } })).id], null);
  await prisma.facture.update({ where: { id: premiere }, data: { numeroFacture: 'zz-test' } });
  await prisma.echeance.updateMany({ where: { echeancierId: echeancier.id, factureId: null }, data: { montant: 1234 } });   // ajusté à la main
  await prolongerEcheanciers();
  assert.equal(await prisma.echeance.count({ where: { echeancierId: echeancier.id, montant: 1234 } }) > 0, true, 'la prolongation quotidienne ne régénère rien');
  await assert.rejects(modifierContrat(c.id, { partenaire: 'zz-test client', partie: 'client', montant: 1500, periodicite: 'mensuel', dateDebut: DEBUT }), /ne changent plus/);
  await modifierContrat(c.id, { partenaire: 'zz-test client', partie: 'client', montant: 1500, periodicite: 'hebdomadaire', dateDebut: DEBUT });
  const l = await lignes(c.id);
  assert.equal(l.find(x => x.factureId === premiere)?.montant, 1000, 'la facturée garde son montant');
  assert.ok(l.filter(x => !x.factureId).every(x => x.montant === 1500), 'les autres repartent du nouveau montant');
});

test('date de fin à plus de 10 ans refusée ; un contrat fournisseur n’a pas d’échéancier', async () => {
  const b = { partenaire: 'zz-test client', partie: 'client', montant: 100, periodicite: 'journalier', dateDebut: DEBUT, dateFin: '2060-01-01' };
  await assert.rejects(creerContrat(b, 1), /10 ans/);
  const f = await creerContrat({ ...b, partie: 'fournisseur', dateFin: null }, 1);
  contrats.push(f.id);
  assert.equal(await prisma.echeancier.count({ where: { contratId: f.id } }), 0);
});

test('paiement en plusieurs fois : la facture se solde au dernier règlement, la suppression est bloquée', async () => {
  const f = await prisma.facture.create({ data: { source: 'manuel', numeroFacture: 'zz-test', clientNom: 'zz-test client', total: 1000, statutPaiement: 'EN_ATTENTE' } });
  const e = await creerEcheancierPaiement(f.id, { premiere: jourParis(), nombre: 3, rythme: 'mensuel' }, 1);
  await assert.rejects(creerEcheancierPaiement(f.id, { premiere: jourParis(), nombre: 3, rythme: 'mensuel' }, 1), /existe déjà/);
  const echeances = await prisma.echeance.findMany({ where: { echeancierId: e.id }, orderBy: { datePrevue: 'asc' } });
  assert.deepEqual(echeances.map(x => x.montant), [333, 333, 334]);
  assert.ok(await planPaiementDeFacture(f.id));
  await assert.rejects(modifierEcheance(echeances[0].id, { datePrevue: jourParis(), montant: 1 }), /total/);
  for (const x of echeances.slice(0, 2)) await marquerEcheancePayee(x.id, 'Espèces');
  assert.equal((await prisma.facture.findUniqueOrThrow({ where: { id: f.id } })).statutPaiement, 'EN_ATTENTE');
  await assert.rejects(supprimerEcheancier(e.id), /Annulez les règlements/);
  await marquerEcheancePayee(echeances[2].id, 'Espèces');
  assert.equal((await prisma.facture.findUniqueOrThrow({ where: { id: f.id } })).statutPaiement, 'PAYEE');
});

test('facturation automatique : seulement un contrat client en cours qui l’a activée, avec un salon ; jamais deux fois', async () => {
  const base = { partenaire: 'zz-test client', partie: 'client', montant: 100, periodicite: 'hebdomadaire', dateDebut: DEBUT };
  await assert.rejects(creerContrat({ ...base, facturationAutomatique: true }, 1), /salon/);
  await assert.rejects(creerContrat({ ...base, partie: 'fournisseur', salonDiscordId: '123456789012345678', facturationAutomatique: true }, 1), /contrat client/);
  const auto = await creerContrat({ ...base, salonDiscordId: '999999999999999993', facturationAutomatique: true }, 1);
  const manuel = await creerContrat(base, 1);
  const fini = await creerContrat({ ...base, salonDiscordId: '999999999999999994', facturationAutomatique: true, dateFin: ajouter(-3) }, 1);
  contrats.push(auto.id, manuel.id, fini.id);
  const bilan = await facturerEtEnvoyerAutomatique();
  assert.ok(bilan.facturees >= 9, 'les 9 périodes commencées du contrat automatique');
  const facturesDe = (id: number) => prisma.facture.count({ where: { contratId: id } });
  assert.equal(await facturesDe(auto.id), 9);
  assert.equal(await facturesDe(manuel.id), 0, 'un contrat sans l’option n’est jamais facturé seul');
  assert.equal(await facturesDe(fini.id), 0, 'un contrat terminé non plus');
  assert.equal(bilan.envoyees, 0, 'le salon est inconnu du bot simulé : rien n’est parti, mais les factures existent');
  assert.ok((await prisma.contrat.findUniqueOrThrow({ where: { id: auto.id } })).salonIntrouvableLe, 'repère « salon introuvable » posé');
  await prisma.facture.updateMany({ where: { contratId: auto.id }, data: { numeroFacture: 'zz-test' } });
  const second = await facturerEtEnvoyerAutomatique();
  assert.equal(await facturesDe(auto.id), 9, 'rien n’est refacturé');
  assert.ok(second.facturees < 9);
  // la reprise des contrats n'active jamais l'option
  await reprendreContratsExistants();
  assert.equal((await prisma.contrat.findUniqueOrThrow({ where: { id: manuel.id } })).facturationAutomatique, false);
});
