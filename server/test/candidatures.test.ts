// ENTREPRISE — recrutement sur le site (candidatures.ts) : heure de Paris, champs, dépôt qui exige Discord et une pièce, votes,
// entretien posé dans l'agenda, refus, purge des pièces (90 jours) et des candidatures closes (un an), suppression. Base réelle,
// lignes « zz-test » retirées à la fin. L'acceptation (fiche RH) se vérifie dans le navigateur : elle exige un grade d'arrivée réglé.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import {
  convoquerEntretien, creerCandidature, lireChampsCandidature, listerCandidatures, monVote, purgerCandidatures, refuserCandidature, supprimerCandidature, voter,
} from '../src/entreprise/candidatures.js';
import { instantParis } from '../src/entreprise/texte.js';

const DISCORD = '900000000000000903';
const fausseImage = { buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 } as unknown as Express.Multer.File;
after(async () => {
  await prisma.evenementAgenda.deleteMany({ where: { titre: { startsWith: 'Entretien — zz-test' } } });
  await prisma.candidature.deleteMany({ where: { nom: { startsWith: 'zz-test' } } });
  await prisma.imageRetiree.deleteMany({ where: { cle: { startsWith: 'zz-test' } } });
  await prisma.$disconnect();
});
const nouvelle = (extra: Record<string, unknown> = {}) => prisma.candidature.create({ data: { prenom: 'Alice', nom: 'zz-test', discordId: DISCORD, pseudoDiscord: 'zz', motivation: 'm', ...extra } });

test('instantParis : l’heure de Paris, été comme hiver', () => {
  assert.equal(instantParis('2026-07-15', '14:30').toISOString(), '2026-07-15T12:30:00.000Z');   // UTC+2
  assert.equal(instantParis('2026-01-15', '14:30').toISOString(), '2026-01-15T13:30:00.000Z');   // UTC+1
  assert.equal(instantParis('2026-03-29', '12:00').toISOString(), '2026-03-29T10:00:00.000Z');   // jour du passage à l'heure d'été
});

test('lireChampsCandidature : prénom, nom et motivation obligatoires', () => {
  assert.throws(() => lireChampsCandidature({ prenom: 'A', nom: ' ', motivation: 'm' }), /prénom et le nom/);
  assert.throws(() => lireChampsCandidature({ prenom: 'A', nom: 'B', motivation: '' }), /motivation/);
  assert.deepEqual(lireChampsCandidature({ prenom: ' A ', nom: 'B', motivation: 'm', poste: 'Vendeur' }), { poste: 'Vendeur', prenom: 'A', nom: 'B', motivation: 'm' });
});

test('dépôt : sans Discord (401), sans pièce, une candidature en cours à la fois', async () => {
  const champs = { prenom: 'Alice', nom: 'zz-test', motivation: 'm' };
  await assert.rejects(creerCandidature(champs, null, fausseImage), (e: { status?: number }) => e.status === 401);
  await assert.rejects(creerCandidature(champs, { id: DISCORD, pseudo: 'zz' }, undefined), /pièce d’identité/);
  await nouvelle();
  await assert.rejects(creerCandidature(champs, { id: DISCORD, pseudo: 'zz' }, fausseImage), (e: { status?: number }) => e.status === 409);
});

test('votes : un vote par personne, remplaçable ; l’identifiant Discord ne sort jamais de la liste', async () => {
  const c = await nouvelle({ prenom: 'Bob' });
  await assert.rejects(voter(c.id, 1, 'peut-être'), /invalide/);
  await voter(c.id, 1, 'pour');
  await voter(c.id, 1, 'contre');   // remplace
  assert.equal(await monVote(c.id, 1), 'contre');
  const ligne = (await listerCandidatures(true)).find(x => x.id === c.id)!;
  assert.deepEqual([ligne.votes.pour, ligne.votes.contre], [0, 1]);
  assert.ok(!('discordId' in ligne));
  // sans le droit de voir les pièces, aucune adresse d'image
  const sansPiece = (await listerCandidatures(false)).find(x => x.id === c.id)!;
  assert.equal(sansPiece.pieceIdentiteUrl, null);
});

test('entretien : statut, heure exacte, événement d’agenda ; refus', async () => {
  const c = await nouvelle({ prenom: 'Chloé' });
  await assert.rejects(convoquerEntretien(c.id, '2026-02-31', '10:00', { id: 1, nom: 'RH' }), /date/);
  await assert.rejects(convoquerEntretien(c.id, '2026-12-12', '25:00', { id: 1, nom: 'RH' }), /heure/);
  await convoquerEntretien(c.id, '2026-12-12', '10:00', { id: 1, nom: 'RH' });
  const apres = await prisma.candidature.findUnique({ where: { id: c.id } });
  assert.deepEqual([apres!.statut, apres!.entretienLe!.toISOString()], ['entretien', '2026-12-12T09:00:00.000Z']);
  const evt = await prisma.evenementAgenda.findFirst({ where: { titre: 'Entretien — Chloé zz-test' } });
  assert.deepEqual([evt!.heureDebut, evt!.heureFin, evt!.destination], ['10:00', '11:00', 'tous']);
  await refuserCandidature(c.id);
  assert.equal((await prisma.candidature.findUnique({ where: { id: c.id } }))!.statut, 'refusee');
});

test('purge : la pièce d’une candidature part au bout de 90 jours, une candidature close au bout d’un an', async () => {
  const vieille = (jours: number) => new Date(Date.now() - jours * 86_400_000);
  const piece = { pieceIdentiteCle: 'zz-test-cle', pieceIdentiteUrl: 'u', pieceIdentiteCleMini: 'zz-test-mini', pieceIdentiteUrlMini: 'um' };
  const recente = await nouvelle({ prenom: 'R', ...piece, pieceIdentiteCle: 'zz-test-recente', creeLe: vieille(10) });
  const ancienne = await nouvelle({ prenom: 'A', ...piece, pieceIdentiteCle: 'zz-test-ancienne', creeLe: vieille(100) });
  const close = await nouvelle({ prenom: 'C', statut: 'refusee', creeLe: vieille(400) });
  await purgerCandidatures();
  assert.ok((await prisma.candidature.findUnique({ where: { id: recente.id } }))!.pieceIdentiteCle);
  assert.equal((await prisma.candidature.findUnique({ where: { id: ancienne.id } }))!.pieceIdentiteCle, null);
  assert.ok(await prisma.imageRetiree.findFirst({ where: { cle: 'zz-test-ancienne' } }));   // part au nettoyage du stockage
  assert.equal(await prisma.candidature.findUnique({ where: { id: close.id } }), null);
});

test('suppression : la pièce passe par la file de nettoyage ; introuvable ensuite', async () => {
  const c = await nouvelle({ prenom: 'S', pieceIdentiteCle: 'zz-test-suppr', pieceIdentiteUrl: 'u', pieceIdentiteCleMini: 'zz-test-suppr-m', pieceIdentiteUrlMini: 'um' });
  await supprimerCandidature(c.id);
  assert.ok(await prisma.imageRetiree.findFirst({ where: { cle: 'zz-test-suppr' } }));
  await assert.rejects(supprimerCandidature(c.id), (e: { status?: number }) => e.status === 404);
});
