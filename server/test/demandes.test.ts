// ENTREPRISE — demandes (demandes.ts) : champs contrôlés, dépôt qui exige une identité Discord et une seule demande ouverte par
// personne, transitions de statut exactes (deux prises en charge simultanées), conversion en contrat qui reprend le salon,
// droits copiés de la catégorie pour le salon. Base réelle, lignes « zz-test » retirées à la fin.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import {
  changerStatutDemande, convertirEnContrat, creerDemande, lireChampsDemande, listerDemandes, modifierSalonDemande, statutDemandeValide,
} from '../src/entreprise/demandes.js';
import { construireOverwritesSalon } from '../src/entreprise/salon-dossier.js';

const DISCORD = '900000000000000902';
const identite = { id: DISCORD, pseudo: 'zz-test-demandeur' };
const ids: number[] = [];
after(async () => {
  const contrats = await prisma.contrat.findMany({ where: { partenaire: { startsWith: 'zz-test' } }, select: { id: true } });
  await prisma.echeancier.deleteMany({ where: { contratId: { in: contrats.map(c => c.id) } } });
  await prisma.contrat.deleteMany({ where: { id: { in: contrats.map(c => c.id) } } });
  await prisma.demande.deleteMany({ where: { discordId: DISCORD } });
  await prisma.$disconnect();
});

const base = { type: 'devis', nom: 'zz-test Alice', message: 'Bonjour', entrepriseNom: 'zz-test SARL' };

test('lireChampsDemande : type, nom et message obligatoires ; champs de devis ignorés pour un contact', () => {
  assert.throws(() => lireChampsDemande({ ...base, type: 'autre' }), /type/);
  assert.throws(() => lireChampsDemande({ ...base, nom: ' ' }), /nom/);
  assert.throws(() => lireChampsDemande({ ...base, message: '' }), /message/);
  const contact = lireChampsDemande({ ...base, type: 'contact', prestation: 'x', budget: 'y', dateSouhaitee: 'z' });
  assert.deepEqual([contact.prestation, contact.budget, contact.dateSouhaitee], [null, null, null]);
  const devis = lireChampsDemande({ ...base, prestation: 'Conseil', budget: '500 $', dateSouhaitee: '2026-12-12' });
  assert.deepEqual([devis.prestation, devis.budget, devis.dateSouhaitee], ['Conseil', '500 $', '2026-12-12']);
  // une date impossible ou mal écrite est refusée ; vide, elle reste facultative
  for (const date of ['2026-02-31', '12/12/2026', 'dès que possible']) assert.throws(() => lireChampsDemande({ ...base, dateSouhaitee: date }), /date souhaitée/);
  assert.equal(lireChampsDemande({ ...base, dateSouhaitee: '' }).dateSouhaitee, null);
});

test('dépôt : sans identité Discord, refusé (401) ; une seule demande ouverte par personne', async () => {
  await assert.rejects(creerDemande(base, null), (e: { status?: number }) => e.status === 401);
  const a = await creerDemande(base, identite);
  ids.push(a.id);
  await assert.rejects(creerDemande(base, identite), (e: { status?: number }) => e.status === 409);
  // l'identifiant Discord ne sort pas de la liste de gestion
  const ligne = (await listerDemandes()).find(d => d.id === a.id)!;
  assert.ok(!('discordId' in ligne));
  assert.equal(ligne.pseudoDiscord, 'zz-test-demandeur');
});

test('statuts : transitions exactes, une seule prise en charge', async () => {
  assert.equal(statutDemandeValide('nouvelle', 'en_cours'), true);
  assert.equal(statutDemandeValide('nouvelle', 'traitee'), false);
  assert.equal(statutDemandeValide('traitee', 'en_cours'), false);
  assert.equal(statutDemandeValide('refusee', 'en_cours'), true);
  const id = ids[0];
  await changerStatutDemande(id, 'en_cours', 1);
  await assert.rejects(changerStatutDemande(id, 'en_cours', 2), (e: { status?: number }) => e.status === 409);
  await assert.rejects(changerStatutDemande(id, 'nimporte', 1), /invalide/);
});

test('conversion en contrat : exige « en cours », reprend le salon, marque la demande traitée', async () => {
  const nouvelle = await prisma.demande.create({ data: { type: 'devis', nom: 'zz-test Bob', discordId: DISCORD, pseudoDiscord: 'p', message: 'm', salonDiscordId: '999999999999999902' } });
  ids.push(nouvelle.id);
  const contrat = { montant: 100, periodicite: 'hebdomadaire', dateDebut: '2026-01-05' };
  await assert.rejects(convertirEnContrat(nouvelle.id, contrat, 1), (e: { status?: number }) => e.status === 409);   // encore « nouvelle »
  await prisma.demande.update({ where: { id: nouvelle.id }, data: { statut: 'en_cours' } });
  const c = await convertirEnContrat(nouvelle.id, { ...contrat, partenaire: 'zz-test Bob SARL' }, 1);
  assert.equal(c.salonDiscordId, '999999999999999902');
  assert.equal(c.partie, 'client');
  const apres = await prisma.demande.findUnique({ where: { id: nouvelle.id } });
  assert.deepEqual([apres!.statut, apres!.contratId], ['traitee', c.id]);
  await assert.rejects(convertirEnContrat(nouvelle.id, { ...contrat, partenaire: 'zz-test Bis' }, 1), (e: { status?: number }) => e.status === 409);   // déjà traitée
});

test('salon : identifiant contrôlé ; droits de la catégorie copiés, la personne du dossier ajoutée', async () => {
  await assert.rejects(modifierSalonDemande(ids[0], 'pas-un-id'), /invalide/);
  await modifierSalonDemande(ids[0], '999999999999999903');
  assert.equal((await prisma.demande.findUnique({ where: { id: ids[0] } }))!.salonDiscordId, '999999999999999903');
  const categorie = [{ id: '100000000000000001', type: 0, allow: '0', deny: '1024' }];
  const droits = construireOverwritesSalon(categorie, DISCORD);
  assert.deepEqual(droits[0], { id: '100000000000000001', type: 0, allow: '0', deny: '1024' });   // copie exacte
  assert.deepEqual(droits[1], { id: DISCORD, type: 1, allow: '1024', deny: '0' });                 // la personne voit le salon
  // une personne que la catégorie masquait le voit quand même
  const masquee = construireOverwritesSalon([{ id: DISCORD, type: 1, allow: '0', deny: '1024' }], DISCORD);
  assert.deepEqual(masquee, [{ id: DISCORD, type: 1, allow: '1024', deny: '0' }]);
});
