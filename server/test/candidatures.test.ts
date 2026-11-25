// ENTREPRISE — recrutement sur le site (candidatures.ts) : heure de Paris, questions du formulaire et leur lien avec la fiche, réponses
// contrôlées, mode bot / site (jamais les deux), dépôt qui exige Discord, votes, entretien dans l'agenda, refus, purge à 90 jours,
// suppression. Base réelle, lignes « zz-test » retirées à la fin. L'acceptation (fiche RH) se vérifie dans le navigateur.
import test, { after, before } from 'node:test';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { definirReglage } from '../src/socle/reglages.js';
import {
  champsDepuisReponses, convoquerEntretien, creerCandidature, creerQuestion, definirChampsFiche, definirPieces, fichiersParPiece, formulairePublic, lireIdentiteCandidat, lirePieces, lireQuestion,
  lireReponses, listerCandidatures, listerPiecesDemandees, listerQuestions, monVote, ordonnerQuestions, purgerCandidatures, refuserCandidature, supprimerCandidature, supprimerQuestion, voter, type Question,
} from '../src/entreprise/candidatures.js';
import { CLE_MODE, modeRecrutement } from '../src/entreprise/recrutement-mode.js';
import { retirerImage } from '../src/socle/images.js';
import { instantParis } from '../src/entreprise/texte.js';

const DISCORD = '900000000000000903';
let png: Buffer;   // une vraie image : le dépôt contrôle le contenu
const fichier = (champ: string) => ({ fieldname: champ, buffer: png, mimetype: 'image/png', size: png.length }) as unknown as Express.Multer.File;
let piecesAvant: { libelle: string; obligatoire: boolean; versFiche: boolean }[] = [];
before(async () => {
  png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c00' } }).png().toBuffer();
  await definirReglage(CLE_MODE, 'site');
  piecesAvant = (await listerPiecesDemandees()).map(({ libelle, obligatoire, versFiche }) => ({ libelle, obligatoire, versFiche }));
});
after(async () => {
  await definirReglage(CLE_MODE, null); await definirPieces(piecesAvant);
  await prisma.questionCandidature.deleteMany({ where: { libelle: { startsWith: 'zz-test' } } });
  await prisma.evenementAgenda.deleteMany({ where: { titre: { startsWith: 'Entretien — zz-test' } } });
  await prisma.candidature.deleteMany({ where: { nom: { startsWith: 'zz-test' } } });
  await prisma.imageRetiree.deleteMany({ where: { cle: { startsWith: 'zz-test' } } });
  await prisma.$disconnect();
});
const nouvelle = (extra: Record<string, unknown> = {}) => prisma.candidature.create({ data: { prenom: 'zz-test', nom: 'zz-test', discordId: DISCORD, pseudoDiscord: 'zz', ...extra } });
const q = (extra: Partial<Question> = {}): Question => ({ id: 1, libelle: 'Question', type: 'court', obligatoire: true, champFiche: null, position: 0, ...extra });

test('instantParis : l’heure de Paris, été comme hiver', () => {
  assert.equal(instantParis('2026-07-15', '14:30').toISOString(), '2026-07-15T12:30:00.000Z');   // UTC+2
  assert.equal(instantParis('2026-01-15', '14:30').toISOString(), '2026-01-15T13:30:00.000Z');   // UTC+1
  assert.equal(instantParis('2026-03-29', '12:00').toISOString(), '2026-03-29T10:00:00.000Z');   // jour du passage à l'heure d'été
});

test('identité du candidat : prénom et nom obligatoires', () => {
  assert.throws(() => lireIdentiteCandidat({ prenom: 'A', nom: ' ' }), /prénom et le nom/);
  assert.deepEqual(lireIdentiteCandidat({ prenom: ' A ', nom: 'B', poste: 'Vendeur' }), { poste: 'Vendeur', prenom: 'A', nom: 'B' });
});

test('lireQuestion : libellé, type (court ou long) ; obligatoire par défaut', () => {
  assert.throws(() => lireQuestion({ libelle: ' ', type: 'court' }), /question/);
  assert.throws(() => lireQuestion({ libelle: 'x', type: 'autre' }), /type/);
  assert.throws(() => lireQuestion({ libelle: 'x', type: 'choix' }), /type/);   // plus de question à choix
  assert.equal(lireQuestion({ libelle: 'x', type: 'court' }).obligatoire, true);
});

test('pièces demandées : 2 au plus, noms uniques, une seule va sur la fiche ; les fichiers se rangent par pièce', async () => {
  const ok = { libelle: 'Pièce d’identité', obligatoire: true, versFiche: true };
  assert.throws(() => lirePieces('x'), /invalide/);
  assert.throws(() => lirePieces([{ libelle: ' ' }]), /nom/);
  assert.throws(() => lirePieces([ok, { ...ok, libelle: 'PIÈCE d’identité', versFiche: false }]), /même nom/);
  assert.throws(() => lirePieces([ok, { libelle: 'B', versFiche: true }]), /Une seule/);
  assert.throws(() => lirePieces(Array.from({ length: 3 }, (_, i) => ({ libelle: `p${i}` }))), /2 pièces/);
  await definirPieces([ok, { libelle: 'Casier', obligatoire: false, versFiche: false }]);
  const [id, casier] = await listerPiecesDemandees();
  assert.throws(() => fichiersParPiece([id, casier], []), /Pièce d’identité/);   // l'obligatoire manque
  assert.equal(fichiersParPiece([id, casier], [fichier(`piece-${id.id}`), fichier('piece-999')]).length, 1);   // champ inconnu ignoré, facultative absente
  assert.equal(fichiersParPiece([id, casier], [fichier(`piece-${id.id}`), fichier(`piece-${casier.id}`)]).length, 2);
});

test('lireReponses : obligatoires exigées, libellé figé, lien avec la fiche', () => {
  const questions = [q({ id: 1, libelle: 'Téléphone', champFiche: 'telephone' }), q({ id: 2, libelle: 'Permis', obligatoire: false })];
  assert.throws(() => lireReponses('{}', questions), /Téléphone/);
  assert.throws(() => lireReponses('pas du json', questions), /pas lisibles/);
  // les règles de la fiche valent dès le dépôt
  assert.throws(() => lireReponses('{"3":"ZZ-42"}', [q({ id: 3, libelle: 'ID', champFiche: 'idUnique' })]), /chiffres/);
  assert.deepEqual(lireReponses('{"3":"4242"}', [q({ id: 3, libelle: 'ID', champFiche: 'idUnique' })])[0].valeur, '4242');
  assert.throws(() => lireReponses(JSON.stringify({ 4: 'x'.repeat(31) }), [q({ id: 4, libelle: 'Tel', champFiche: 'telephone' })]), /30 caractères/);
  const r = lireReponses('{"1":"0612","2":""}', questions);
  assert.deepEqual(r, [{ libelle: 'Téléphone', valeur: '0612', champFiche: 'telephone' }]);   // la facultative vide n'est pas gardée
  assert.deepEqual(champsDepuisReponses(r), { telephone: '0612' });
  // une réponse qui ne vise aucun champ ne remplit rien
  assert.deepEqual(champsDepuisReponses([{ libelle: 'x', valeur: 'y', champFiche: null }]), {});
});

test('questions : création, ordre, suppression (la question par défaut existe)', async () => {
  assert.ok((await listerQuestions()).some(x => x.libelle === 'Votre motivation'));
  await creerQuestion({ libelle: 'zz-test A', type: 'court' });
  await creerQuestion({ libelle: 'zz-test B', type: 'long' });
  await definirChampsFiche({ rib: 'facultatif' });   // une question de la fiche, nommée d'après le champ, dans la même liste ordonnée
  const toutes = await listerQuestions();
  const [a, b] = ['zz-test A', 'zz-test B'].map(l => toutes.find(x => x.libelle === l)!);
  await assert.rejects(ordonnerQuestions([a.id]), /incomplet/);
  await ordonnerQuestions([b.id, a.id, ...toutes.filter(x => x.id !== a.id && x.id !== b.id).map(x => x.id)]);
  const ordre = (await listerQuestions()).map(x => x.id);
  assert.ok(ordre.indexOf(b.id) < ordre.indexOf(a.id));
  // le formulaire public ne montre jamais le champ de la fiche visé
  const pub = await formulairePublic();
  assert.ok(pub.ouvert && pub.questions.every(x => !('champFiche' in x)) && pub.questions.some(x => x.libelle === 'RIB'));
  await supprimerQuestion(a.id); await supprimerQuestion(b.id);
  await definirChampsFiche({ rib: 'aucun' });
});

test('modes : « site » ouvre le formulaire, « bot » (par défaut) le ferme', async () => {
  assert.equal(modeRecrutement(), 'site');
  await definirReglage(CLE_MODE, null);
  assert.equal(modeRecrutement(), 'bot');
  assert.equal((await formulairePublic()).ouvert, false);
  await assert.rejects(creerCandidature({ prenom: 'a', nom: 'b' }, { id: DISCORD, pseudo: 'zz' }, []), (e: { status?: number }) => e.status === 403);
  await definirReglage(CLE_MODE, 'site');
});

test('dépôt : sans Discord (401), pièces exigées, une candidature en cours à la fois, pièces rangées par nom', async () => {
  await definirPieces([{ libelle: 'Pièce d’identité', obligatoire: true, versFiche: true }, { libelle: 'Casier', obligatoire: false, versFiche: false }]);
  const [id, casier] = await listerPiecesDemandees();
  const champs = { prenom: 'Alice', nom: 'zz-test', reponses: '{}' };
  const moi = { id: DISCORD, pseudo: 'zz' };
  await assert.rejects(creerCandidature(champs, null, []), (e: { status?: number }) => e.status === 401);
  await assert.rejects(creerCandidature(champs, moi, []), /Répondez/);   // la question par défaut est obligatoire
  const motivation = (await listerQuestions()).find(x => x.libelle === 'Votre motivation')!;
  const avecReponse = { ...champs, reponses: JSON.stringify({ [motivation.id]: 'ok' }) };
  await assert.rejects(creerCandidature(avecReponse, moi, []), /Pièce d’identité/);
  const c = await creerCandidature(avecReponse, moi, [fichier(`piece-${id.id}`), fichier(`piece-${casier.id}`)]);
  const pieces = await prisma.pieceCandidature.findMany({ where: { candidatureId: c.id }, orderBy: { position: 'asc' } });
  assert.deepEqual(pieces.map(p => [p.libelle, p.versFiche]), [['Pièce d’identité', true], ['Casier', false]]);
  await assert.rejects(creerCandidature(avecReponse, moi, [fichier(`piece-${id.id}`)]), (e: { status?: number }) => e.status === 409);
  for (const p of pieces) await retirerImage(p);   // les fichiers de l'essai ne restent pas sur le disque
});

test('votes : un vote par personne, remplaçable ; l’identifiant Discord ne sort jamais de la liste', async () => {
  const c = await nouvelle({ prenom: 'Bob' });
  await voter(c.id, 1, 'pour');
  await voter(c.id, 1, 'contre');   // remplace
  assert.equal(await monVote(c.id, 1), 'contre');
  const ligne = (await listerCandidatures(true, true)).find(x => x.id === c.id)!;
  assert.deepEqual([ligne.votes.pour, ligne.votes.contre], [0, 1]);
  assert.ok(!('discordId' in ligne));
  assert.equal((await listerCandidatures(false, false)).find(x => x.id === c.id)!.pieces.length, 0);   // sans le droit de voir les pièces, aucune adresse d'image
});

test('réponses liées au téléphone ou au RIB : visibles seulement avec le droit sensible', async () => {
  const c = await nouvelle({ prenom: 'Sensible', reponses: [{ libelle: 'RIB', valeur: 'FR76', champFiche: 'rib' }, { libelle: 'Motivation', valeur: 'ok', champFiche: null }] });
  const libelles = async (sensible: boolean) => (await listerCandidatures(false, sensible)).find(x => x.id === c.id)!.reponses.map(r => r.libelle);
  assert.deepEqual(await libelles(true), ['RIB', 'Motivation']);
  assert.deepEqual(await libelles(false), ['Motivation']);
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

const avecPieces = (cle: string) => ({ pieces: { create: [{ libelle: 'A', cle, url: 'u', cleMini: `${cle}-m`, urlMini: 'um' }, { libelle: 'B', cle: `${cle}-2`, url: 'u', cleMini: `${cle}-2m`, urlMini: 'um' }] } });

test('purge : à 90 jours la candidature disparaît avec toutes ses pièces, quel que soit son statut ; avant, rien ne bouge', async () => {
  const vieille = (jours: number) => new Date(Date.now() - jours * 86_400_000);
  const recente = await nouvelle({ prenom: 'R', ...avecPieces('zz-test-recente'), creeLe: vieille(60) });
  const ancienne = await nouvelle({ prenom: 'A', statut: 'entretien', ...avecPieces('zz-test-ancienne'), creeLe: vieille(100) });
  const close = await nouvelle({ prenom: 'C', statut: 'refusee', creeLe: vieille(95) });
  await purgerCandidatures();
  assert.ok(await prisma.candidature.findUnique({ where: { id: recente.id } }));
  assert.equal(await prisma.candidature.findUnique({ where: { id: ancienne.id } }), null);
  assert.equal(await prisma.candidature.findUnique({ where: { id: close.id } }), null);
  for (const cle of ['zz-test-ancienne', 'zz-test-ancienne-2']) assert.ok(await prisma.imageRetiree.findFirst({ where: { cle } }), cle);   // chaque pièce part au nettoyage du stockage
});

test('suppression : toutes les pièces passent par la file de nettoyage ; introuvable ensuite', async () => {
  const c = await nouvelle({ prenom: 'S', ...avecPieces('zz-test-suppr') });
  await supprimerCandidature(c.id);
  assert.ok(await prisma.imageRetiree.findFirst({ where: { cle: 'zz-test-suppr' } }));
  assert.ok(await prisma.imageRetiree.findFirst({ where: { cle: 'zz-test-suppr-2' } }));
  await assert.rejects(supprimerCandidature(c.id), (e: { status?: number }) => e.status === 404);
});
