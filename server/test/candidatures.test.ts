// ENTREPRISE — recrutement sur le site (candidatures.ts) : heure de Paris, questions du formulaire et leur lien avec la fiche, réponses
// contrôlées, mode bot / site (jamais les deux), dépôt qui exige Discord, votes, entretien dans l'agenda, refus, purge à 90 jours,
// suppression. Base réelle, lignes « zz-test » retirées à la fin. L'acceptation (fiche RH) se vérifie dans le navigateur.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import '../src/entreprise/index.js';   // d'abord : charge les routes dans l'ordre voulu (sinon dépendance circulaire)
import { prisma } from '../src/socle/db.js';
import { definirReglage } from '../src/socle/reglages.js';
import {
  champsDepuisReponses, convoquerEntretien, creerCandidature, creerQuestion, formulairePublic, lireIdentiteCandidat, lireQuestion, lireReponses, listerCandidatures,
  listerQuestions, monVote, ordonnerQuestions, purgerCandidatures, refuserCandidature, supprimerCandidature, supprimerQuestion, voter, type Question,
} from '../src/entreprise/candidatures.js';
import { CLE_MODE, CLE_PIECE, modeRecrutement } from '../src/entreprise/recrutement-mode.js';
import { instantParis } from '../src/entreprise/texte.js';

const DISCORD = '900000000000000903';
const fausseImage = { buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 } as unknown as Express.Multer.File;
before(async () => { await definirReglage(CLE_MODE, 'site'); });
after(async () => {
  await definirReglage(CLE_MODE, null); await definirReglage(CLE_PIECE, null);
  await prisma.questionCandidature.deleteMany({ where: { libelle: { startsWith: 'zz-test' } } });
  await prisma.evenementAgenda.deleteMany({ where: { titre: { startsWith: 'Entretien — zz-test' } } });
  await prisma.candidature.deleteMany({ where: { nom: { startsWith: 'zz-test' } } });
  await prisma.imageRetiree.deleteMany({ where: { cle: { startsWith: 'zz-test' } } });
  await prisma.$disconnect();
});
const nouvelle = (extra: Record<string, unknown> = {}) => prisma.candidature.create({ data: { prenom: 'zz-test', nom: 'zz-test', discordId: DISCORD, pseudoDiscord: 'zz', ...extra } });
const q = (extra: Partial<Question> = {}): Question => ({ id: 1, libelle: 'Question', type: 'court', choix: [], obligatoire: true, champFiche: null, position: 0, ...extra });

test('instantParis : l’heure de Paris, été comme hiver', () => {
  assert.equal(instantParis('2026-07-15', '14:30').toISOString(), '2026-07-15T12:30:00.000Z');   // UTC+2
  assert.equal(instantParis('2026-01-15', '14:30').toISOString(), '2026-01-15T13:30:00.000Z');   // UTC+1
  assert.equal(instantParis('2026-03-29', '12:00').toISOString(), '2026-03-29T10:00:00.000Z');   // jour du passage à l'heure d'été
});

test('identité du candidat : prénom et nom obligatoires', () => {
  assert.throws(() => lireIdentiteCandidat({ prenom: 'A', nom: ' ' }), /prénom et le nom/);
  assert.deepEqual(lireIdentiteCandidat({ prenom: ' A ', nom: 'B', poste: 'Vendeur' }), { poste: 'Vendeur', prenom: 'A', nom: 'B' });
});

test('lireQuestion : libellé, type, choix (2 à 12), champ de la fiche réservé aux réponses courtes et à une seule question', () => {
  assert.throws(() => lireQuestion({ libelle: ' ', type: 'court' }, []), /question/);
  assert.throws(() => lireQuestion({ libelle: 'x', type: 'autre' }, []), /type/);
  assert.throws(() => lireQuestion({ libelle: 'x', type: 'choix', choix: ['un'] }, []), /deux réponses/);
  assert.deepEqual(lireQuestion({ libelle: 'x', type: 'choix', choix: 'a\nb\na\n' }, []).choix, ['a', 'b']);   // doublons et lignes vides retirés
  assert.throws(() => lireQuestion({ libelle: 'x', type: 'long', champFiche: 'rib' }, []), /courte/);
  assert.throws(() => lireQuestion({ libelle: 'x', type: 'court', champFiche: 'adresse' }, []), /n’existe pas/);
  assert.throws(() => lireQuestion({ libelle: 'x', type: 'court', champFiche: 'rib' }, [q({ id: 5, champFiche: 'rib' })]), /déjà ce champ/);
  assert.equal(lireQuestion({ libelle: 'x', type: 'court', champFiche: 'rib' }, [q({ id: 5, champFiche: 'rib' })], 5).champFiche, 'rib');   // la question elle-même
  assert.equal(lireQuestion({ libelle: 'x', type: 'court' }, []).obligatoire, true);
});

test('lireReponses : obligatoires exigées, choix parmi ceux proposés, libellé figé, lien avec la fiche', () => {
  const questions = [q({ id: 1, libelle: 'Téléphone', champFiche: 'telephone' }), q({ id: 2, libelle: 'Permis', type: 'choix', choix: ['oui', 'non'], obligatoire: false })];
  assert.throws(() => lireReponses('{}', questions), /Téléphone/);
  assert.throws(() => lireReponses('{"1":"0612","2":"peut-être"}', questions), /proposées/);
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
  await creerQuestion({ libelle: 'zz-test A', type: 'court', champFiche: 'idUnique' });
  await creerQuestion({ libelle: 'zz-test B', type: 'long' });
  const toutes = await listerQuestions();
  const [a, b] = ['zz-test A', 'zz-test B'].map(l => toutes.find(x => x.libelle === l)!);
  await assert.rejects(ordonnerQuestions([a.id]), /incomplet/);
  await ordonnerQuestions([b.id, a.id, ...toutes.filter(x => x.id !== a.id && x.id !== b.id).map(x => x.id)]);
  const ordre = (await listerQuestions()).map(x => x.id);
  assert.ok(ordre.indexOf(b.id) < ordre.indexOf(a.id));
  // le formulaire public ne montre jamais le champ de la fiche visé
  const pub = await formulairePublic();
  assert.ok(pub.ouvert && pub.questions.every(x => !('champFiche' in x)));
  await supprimerQuestion(a.id); await supprimerQuestion(b.id);
});

test('modes : « site » ouvre le formulaire, « bot » (par défaut) le ferme', async () => {
  assert.equal(modeRecrutement(), 'site');
  await definirReglage(CLE_MODE, null);
  assert.equal(modeRecrutement(), 'bot');
  assert.equal((await formulairePublic()).ouvert, false);
  await assert.rejects(creerCandidature({ prenom: 'a', nom: 'b' }, { id: DISCORD, pseudo: 'zz' }, fausseImage), (e: { status?: number }) => e.status === 403);
  await definirReglage(CLE_MODE, 'site');
});

test('dépôt : sans Discord (401), pièce exigée selon le réglage, une candidature en cours à la fois', async () => {
  const champs = { prenom: 'Alice', nom: 'zz-test', reponses: '{}' };
  // la question par défaut est obligatoire : les champs ci-dessus n'y répondent pas
  await assert.rejects(creerCandidature(champs, null, fausseImage), (e: { status?: number }) => e.status === 401);
  await assert.rejects(creerCandidature(champs, { id: DISCORD, pseudo: 'zz' }, fausseImage), /Répondez/);
  const motivation = (await listerQuestions()).find(x => x.libelle === 'Votre motivation')!;
  const avecReponse = { ...champs, reponses: JSON.stringify({ [motivation.id]: 'ok' }) };
  await assert.rejects(creerCandidature(avecReponse, { id: DISCORD, pseudo: 'zz' }, undefined), /pièce d’identité/);
  await nouvelle();
  await assert.rejects(creerCandidature(avecReponse, { id: DISCORD, pseudo: 'zz' }, fausseImage), (e: { status?: number }) => e.status === 409);
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
  assert.equal((await listerCandidatures(false)).find(x => x.id === c.id)!.pieceIdentiteUrl, null);   // sans le droit de voir les pièces, aucune adresse d'image
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

test('purge : à 90 jours la candidature disparaît avec sa pièce, quel que soit son statut ; avant, rien ne bouge', async () => {
  const vieille = (jours: number) => new Date(Date.now() - jours * 86_400_000);
  const piece = { pieceIdentiteUrl: 'u', pieceIdentiteUrlMini: 'um' };
  const recente = await nouvelle({ prenom: 'R', ...piece, pieceIdentiteCle: 'zz-test-recente', pieceIdentiteCleMini: 'zz-test-recente-m', creeLe: vieille(60) });
  const encoursAncienne = await nouvelle({ prenom: 'A', statut: 'entretien', ...piece, pieceIdentiteCle: 'zz-test-ancienne', pieceIdentiteCleMini: 'zz-test-ancienne-m', creeLe: vieille(100) });
  const close = await nouvelle({ prenom: 'C', statut: 'refusee', creeLe: vieille(95) });
  await purgerCandidatures();
  assert.ok(await prisma.candidature.findUnique({ where: { id: recente.id } }));
  assert.equal(await prisma.candidature.findUnique({ where: { id: encoursAncienne.id } }), null);
  assert.equal(await prisma.candidature.findUnique({ where: { id: close.id } }), null);
  assert.ok(await prisma.imageRetiree.findFirst({ where: { cle: 'zz-test-ancienne' } }));   // la pièce part au nettoyage du stockage
});

test('suppression : la pièce passe par la file de nettoyage ; introuvable ensuite', async () => {
  const c = await nouvelle({ prenom: 'S', pieceIdentiteCle: 'zz-test-suppr', pieceIdentiteUrl: 'u', pieceIdentiteCleMini: 'zz-test-suppr-m', pieceIdentiteUrlMini: 'um' });
  await supprimerCandidature(c.id);
  assert.ok(await prisma.imageRetiree.findFirst({ where: { cle: 'zz-test-suppr' } }));
  await assert.rejects(supprimerCandidature(c.id), (e: { status?: number }) => e.status === 404);
});
