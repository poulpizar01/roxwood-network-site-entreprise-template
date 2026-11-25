// ENTREPRISE — recrutement géré sur le site (module « recrutement », mode « site » : recrutement-mode.ts), distinct d'ArriveeBot (tickets du
// bot Discord, mode « bot ») : formulaire public paramétrable (identité Discord vérifiée ; questions, pièces jointes et champs de la fiche
// réglés par la direction), suivi en colonnes, votes des RH, entretien inscrit à l'agenda, acceptation → fiche RH pré-remplie.
// Permissions : rh-voir (consulter, voter), rh-creer (convoquer, accepter, refuser), rh-parametrer (réglages). Un salon Discord s'ouvre à
// l'envoi pour le suivi (salon-dossier.ts).
import crypto from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { Compte } from '../generated/prisma/client.js';
import { prisma } from '../socle/db.js';
import { auDessusDe, gradeDe } from '../socle/droits.js';
import { ID_DISCORD, posterMessage } from '../socle/discord.js';
import { enregistrerImage, retirerImage, type ImageEnregistree } from '../socle/images.js';
import { definirReglage, reglage } from '../socle/reglages.js';
import type { IdentiteVerifiee } from '../socle/routes/discord-leger.js';
import { Refus } from './refus.js';
import { CLE_GRADE_ARRIVEE, CLE_MODE, modeRecrutement, recrutementSiteActif } from './recrutement-mode.js';
import { creerSalonDossier } from './salon-dossier.js';
import { instantParis, jourParis, jourValide, versDate } from './texte.js';

export const STATUTS_CANDIDATURE = ['recue', 'entretien', 'acceptee', 'refusee'] as const;
export type StatutCandidature = typeof STATUTS_CANDIDATURE[number];
export const VALEURS_VOTE = ['pour', 'contre', 'abstention'] as const;
export type ValeurVote = typeof VALEURS_VOTE[number];
// pièces et candidature disparaissent ensemble, 90 jours après réception (confidentialite.html) : la fiche, si la personne est acceptée, garde la pièce marquée
export const CANDIDATURES_JOURS = 90;
export const TYPES_QUESTION = ['court', 'long'] as const;
// ce qu'une réponse peut pré-remplir sur la fiche (prénom et nom : toujours demandés) ; le libellé de la question est celui du champ
export const CHAMPS_FICHE = ['telephone', 'rib', 'idUnique'] as const;
export type ChampFiche = typeof CHAMPS_FICHE[number];
export const LIBELLES_FICHE: Record<ChampFiche, string> = { telephone: 'Téléphone', rib: 'RIB', idUnique: 'ID Unique' };
export type ModeChamp = 'aucun' | 'facultatif' | 'obligatoire';
export const QUESTIONS_MAX = 15, PIECES_MAX = 2, PIECE_MAX_MO = 10;   // 10 Mo pour l'ensemble des pièces d'un dépôt (contrôlé dans fichiersParPiece)

const texte = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

// ---- réglages du recrutement (Employés → Réglages du recrutement, rh-parametrer) ----
export const reglagesRecrutement = () => ({ mode: modeRecrutement(), gradeArrivee: reglage(CLE_GRADE_ARRIVEE) ?? '' });

export async function definirReglagesRecrutement(b: Record<string, unknown>, acteur: Compte): Promise<void> {
  if (b.gradeArrivee !== undefined) {
    const g = texte(b.gradeArrivee, 40);
    if (g && !gradeDe(g)) throw new Refus('Grade d’arrivée invalide.');
    // jamais un grade égal ou supérieur à celui de qui règle (comme pour le recrutement par le bot)
    if (g && !auDessusDe(acteur, g)) throw new Refus('Le grade d’arrivée doit être sous le vôtre.', 403);
    await definirReglage(CLE_GRADE_ARRIVEE, g || null);
  }
  if (b.champsFiche !== undefined) await definirChampsFiche(b.champsFiche);
  if (b.pieces !== undefined) await definirPieces(b.pieces);
  if (b.mode !== undefined) {
    if (b.mode !== 'bot' && b.mode !== 'site') throw new Refus('Choisissez « Bot Discord » ou « Site ».');
    await definirReglage(CLE_MODE, b.mode);
  }
}

// ---- questions du formulaire ----
export type Question = { id: number; libelle: string; type: typeof TYPES_QUESTION[number]; obligatoire: boolean; champFiche: ChampFiche | null; position: number };
const versQuestion = (q: { id: number; libelle: string; type: string; obligatoire: boolean; champFiche: string | null; position: number }): Question => ({
  id: q.id, libelle: q.libelle, type: q.type as Question['type'], obligatoire: q.obligatoire,
  champFiche: (CHAMPS_FICHE as readonly string[]).includes(q.champFiche ?? '') ? q.champFiche as ChampFiche : null, position: q.position,
});
export const listerQuestions = async (): Promise<Question[]> => (await prisma.questionCandidature.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] })).map(versQuestion);

// saisie d'une « autre question » (fonction pure, testée) : celles qui remplissent la fiche ne passent pas par là, elles se règlent avec la fiche
export function lireQuestion(b: Record<string, unknown>) {
  const libelle = texte(b.libelle, 120);
  if (!libelle) throw new Refus('Écrivez la question.');
  if (!(TYPES_QUESTION as readonly string[]).includes(String(b.type))) throw new Refus('Choisissez le type de réponse : courte ou longue.');
  const type = b.type as Question['type'];
  return { libelle, type, obligatoire: b.obligatoire !== false };
}
const REFUS_FICHE = 'Cette question remplit la fiche : elle se règle dans « La fiche créée à l’acceptation ».';
export async function creerQuestion(b: Record<string, unknown>): Promise<void> {
  const questions = await listerQuestions();
  if (questions.length >= QUESTIONS_MAX) throw new Refus(`${QUESTIONS_MAX} questions au plus : retirez-en une avant d’en ajouter.`);
  await prisma.questionCandidature.create({ data: { ...lireQuestion(b), position: (questions.at(-1)?.position ?? -1) + 1 } });
}
export async function modifierQuestion(id: number, b: Record<string, unknown>): Promise<void> {
  const q = (await listerQuestions()).find(x => x.id === id);
  if (!q) throw new Refus('Question introuvable.', 404);
  if (q.champFiche) throw new Refus(REFUS_FICHE, 409);
  await prisma.questionCandidature.update({ where: { id }, data: lireQuestion(b) });
}
// une candidature déjà reçue garde le libellé de sa question (figé dans ses réponses) : supprimer une question ne la touche pas
export async function supprimerQuestion(id: number): Promise<void> {
  const q = (await listerQuestions()).find(x => x.id === id);
  if (q?.champFiche) throw new Refus(REFUS_FICHE, 409);
  await prisma.questionCandidature.deleteMany({ where: { id } });
}
// l'ordre de TOUTES les questions (celles de la fiche comprises) : une seule liste, réordonnée au glisser-déposer
export async function ordonnerQuestions(ids: unknown): Promise<void> {
  const liste = Array.isArray(ids) ? ids.map(Number) : [];
  const actuelles = await prisma.questionCandidature.findMany({ select: { id: true } });
  if (liste.length !== actuelles.length || !actuelles.every(q => liste.includes(q.id))) throw new Refus('Ordre incomplet : actualisez la page puis réessayez.');
  await prisma.$transaction(liste.map((id, i) => prisma.questionCandidature.update({ where: { id }, data: { position: i } })));
}

// ---- champs de la fiche demandés au candidat : une question par champ, nommée d'après le champ (réglée avec la fiche) ----
export const etatChampsFiche = (questions: readonly Question[]): Record<ChampFiche, ModeChamp> =>
  Object.fromEntries(CHAMPS_FICHE.map(c => { const q = questions.find(x => x.champFiche === c); return [c, !q ? 'aucun' : q.obligatoire ? 'obligatoire' : 'facultatif']; })) as Record<ChampFiche, ModeChamp>;
export async function definirChampsFiche(brut: unknown): Promise<void> {
  const b = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  for (const c of CHAMPS_FICHE) {
    if (b[c] === undefined) continue;
    if (!['aucun', 'facultatif', 'obligatoire'].includes(String(b[c]))) throw new Refus(`« ${LIBELLES_FICHE[c]} » : choisissez pas demandé, facultatif ou obligatoire.`);
    const mode = b[c] as ModeChamp;
    const questions = await listerQuestions();
    const q = questions.find(x => x.champFiche === c);
    if (mode === 'aucun') { if (q) await prisma.questionCandidature.delete({ where: { id: q.id } }); continue; }
    if (q) await prisma.questionCandidature.update({ where: { id: q.id }, data: { obligatoire: mode === 'obligatoire', libelle: LIBELLES_FICHE[c] } });
    else if (questions.length >= QUESTIONS_MAX) throw new Refus(`${QUESTIONS_MAX} questions au plus : retirez-en une avant d’en ajouter.`);
    else await prisma.questionCandidature.create({ data: { libelle: LIBELLES_FICHE[c], type: 'court', obligatoire: mode === 'obligatoire', champFiche: c, position: (questions.at(-1)?.position ?? -1) + 1 } });
  }
}

// ---- pièces jointes demandées : 2 au plus, une seule peut aller sur la fiche (la pièce d'identité de l'employé) ----
export type PieceConfig = { id: number; libelle: string; obligatoire: boolean; versFiche: boolean };
export const listerPiecesDemandees = (): Promise<PieceConfig[]> =>
  prisma.pieceDemandee.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true, libelle: true, obligatoire: true, versFiche: true } });
// contrôle de la liste reçue (fonction pure, testée) ; les candidatures déjà reçues gardent le libellé figé de leurs pièces
export function lirePieces(brut: unknown): { libelle: string; obligatoire: boolean; versFiche: boolean }[] {
  if (!Array.isArray(brut)) throw new Refus('Liste de pièces invalide.');
  if (brut.length > PIECES_MAX) throw new Refus(`${PIECES_MAX} pièces jointes au plus.`);
  const pieces = brut.map((p: Record<string, unknown>) => ({ libelle: texte(p?.libelle, 80), obligatoire: p?.obligatoire !== false, versFiche: p?.versFiche === true }));
  if (pieces.some(p => !p.libelle)) throw new Refus('Donnez un nom à chaque pièce jointe.');
  if (new Set(pieces.map(p => p.libelle.toLowerCase())).size !== pieces.length) throw new Refus('Deux pièces ne peuvent pas porter le même nom.');
  if (pieces.filter(p => p.versFiche).length > 1) throw new Refus('Une seule pièce peut aller sur la fiche.');
  return pieces;
}
export async function definirPieces(brut: unknown): Promise<void> {
  const pieces = lirePieces(brut);
  await prisma.$transaction([prisma.pieceDemandee.deleteMany(), prisma.pieceDemandee.createMany({ data: pieces.map((p, position) => ({ ...p, position })) })]);
}

// ce que le formulaire public affiche : les questions dans l'ordre (les champs de la fiche en font partie, sans que leur lien soit dit) puis les pièces
export async function formulairePublic() {
  const pieces = await listerPiecesDemandees();
  return {
    ouvert: recrutementSiteActif(), pieces: pieces.map(({ versFiche: _v, ...p }) => p), piecesMaxMo: PIECE_MAX_MO,
    questions: (await listerQuestions()).map(({ champFiche: _c, position: _p, ...q }) => q),
  };
}

// ---- dépôt public ----
type Reponse = { libelle: string; valeur: string; champFiche: ChampFiche | null };
// réponses reçues { "<id de la question>": "valeur" } contrôlées contre les questions actuelles ; le libellé est figé avec la réponse
export function lireReponses(brut: unknown, questions: readonly Question[]): Reponse[] {
  let recu: Record<string, unknown> = {};
  if (typeof brut === 'string' && brut) { try { recu = JSON.parse(brut); } catch { throw new Refus('Les réponses ne sont pas lisibles : rechargez la page.'); } }
  else if (brut && typeof brut === 'object') recu = brut as Record<string, unknown>;
  return questions.flatMap(q => {
    const valeur = texte(recu[q.id], q.type === 'long' ? 2000 : 300);
    if (!valeur) { if (q.obligatoire) throw new Refus(`Répondez à « ${q.libelle} ».`); return []; }
    // les règles de la fiche s'appliquent dès le dépôt : le candidat voit l'erreur, pas l'équipe à l'acceptation (rh.ts lireChamps)
    if (q.champFiche === 'idUnique' && !/^\d{1,12}$/.test(valeur)) throw new Refus(`« ${q.libelle} » ne contient que des chiffres (par exemple 42).`);
    if (q.champFiche === 'telephone' && valeur.length > 30) throw new Refus(`« ${q.libelle} » : 30 caractères au plus.`);
    if (q.champFiche === 'rib' && valeur.length > 60) throw new Refus(`« ${q.libelle} » : 60 caractères au plus.`);
    return [{ libelle: q.libelle, valeur, champFiche: q.champFiche }];
  });
}
export function lireIdentiteCandidat(b: Record<string, unknown>) {
  const prenom = texte(b.prenom, 60), nom = texte(b.nom, 60);
  if (!prenom || !nom) throw new Refus('Le prénom et le nom sont obligatoires.');
  return { poste: texte(b.poste, 120), prenom, nom };
}

// associe les fichiers reçus (champ « piece-<id> ») aux pièces demandées : une obligatoire manquante est refusée, un champ inconnu ignoré
export function fichiersParPiece(demandees: readonly PieceConfig[], fichiers: readonly Express.Multer.File[]): { piece: PieceConfig; fichier: Express.Multer.File }[] {
  const retenus = demandees.flatMap(piece => { const f = fichiers.find(x => x.fieldname === `piece-${piece.id}`); return f ? [{ piece, fichier: f }] : []; });
  const manquante = demandees.find(p => p.obligatoire && !retenus.some(r => r.piece.id === p.id));
  if (manquante) throw new Refus(`Joignez « ${manquante.libelle} » (une image).`);
  if (retenus.reduce((t, r) => t + r.fichier.size, 0) > PIECE_MAX_MO * 1048576) throw new Refus(`Les pièces jointes pèsent ${PIECE_MAX_MO} Mo au plus en tout.`);
  return retenus;
}

// discordId : jamais une saisie libre, seulement l'identité vérifiée (routes/candidatures.ts) : sans elle, une candidature acceptée
// créerait une fiche sans compte Discord, inutilisable pour se connecter. Les pièces partent avec la candidature ; si l'enregistrement
// échoue, les fichiers tout juste déposés sont retirés (jamais un fichier sans trace en base).
export async function creerCandidature(b: Record<string, unknown>, identite: IdentiteVerifiee | null, fichiers: readonly Express.Multer.File[]) {
  if (!recrutementSiteActif()) throw new Refus('Le recrutement par le site n’est pas ouvert.', 403);
  if (!identite) throw new Refus('Connectez-vous avec Discord pour envoyer votre candidature.', 401);
  const champs = lireIdentiteCandidat(b);
  const reponses = lireReponses(b.reponses, await listerQuestions());
  const retenus = fichiersParPiece(await listerPiecesDemandees(), fichiers);
  // une candidature en cours à la fois par personne (et donc un seul salon à la chaîne)
  if (await prisma.candidature.count({ where: { discordId: identite.id, statut: { in: ['recue', 'entretien'] } } })) {
    throw new Refus('Vous avez déjà une candidature en cours d’examen : l’équipe y répond avant que vous puissiez en envoyer une autre.', 409);
  }
  const enregistrees: { piece: PieceConfig; image: ImageEnregistree }[] = [];
  let candidature;
  try {
    for (const { piece, fichier } of retenus) enregistrees.push({ piece, image: await enregistrerImage('candidatures', fichier) });
    candidature = await prisma.candidature.create({ data: {
      ...champs, reponses: reponses as unknown as Prisma.InputJsonValue, discordId: identite.id, pseudoDiscord: identite.pseudo.slice(0, 100),
      pieces: { create: enregistrees.map(({ piece, image }, position) => ({ libelle: piece.libelle, versFiche: piece.versFiche, cle: image.cle, url: image.url, cleMini: image.cleMini, urlMini: image.urlMini, position })) },
    } });
  } catch (e) { for (const { image } of enregistrees) await retirerImage(image).catch(() => {}); throw e; }
  try {
    const precedente = await prisma.candidature.findFirst({ where: { discordId: identite.id, salonDiscordId: { not: null }, id: { not: candidature.id } }, orderBy: { creeLe: 'desc' }, select: { salonDiscordId: true } });
    const salonId = await creerSalonDossier('candidatures_categorie_discord', `candidature-${candidature.id}-${champs.prenom}-${champs.nom}`, identite.id, precedente?.salonDiscordId ?? null);
    if (salonId) await prisma.candidature.update({ where: { id: candidature.id }, data: { salonDiscordId: salonId } });
  } catch (e) { console.error('[candidatures] salon Discord', e); }
  return candidature;
}

// message au candidat dans son salon : un échec (bot absent, salon supprimé) ne fait jamais échouer la décision
async function ecrireAuCandidat(c: { salonDiscordId: string | null }, contenu: string): Promise<void> {
  if (!c.salonDiscordId) return;
  try { await posterMessage(c.salonDiscordId, { content: contenu }); }
  catch (e) { console.error('[candidatures] message Discord', e); }
}

// ---- consultation (colonnes, votes) ----
const avatarVotant = (c: { discordId: string; avatar: string | null }) => (c.avatar ? `https://cdn.discordapp.com/avatars/${c.discordId}/${c.avatar}.webp?size=64` : null);

// les pièces jointes ne sont montrées qu'à qui peut voir une pièce d'identité (rh-piece-voir) ; l'identifiant Discord et les clés de stockage, jamais
// téléphone et RIB demandés par le formulaire : comme sur la fiche, seulement avec rh-sensible-voir (voitSensible) ; les pièces avec rh-piece-voir
export async function listerCandidatures(voitPieces: boolean, voitSensible: boolean) {
  const [candidatures, votes] = await Promise.all([
    prisma.candidature.findMany({ orderBy: { creeLe: 'desc' }, take: 1000, include: { pieces: { orderBy: { position: 'asc' } } } }),
    prisma.candidatureVote.findMany(),
  ]);
  const comptes = votes.length ? await prisma.compte.findMany({ where: { id: { in: [...new Set(votes.map(v => v.compteId))] } }, select: { id: true, nom: true, pseudo: true, discordId: true, avatar: true } }) : [];
  const compteParId = new Map(comptes.map(c => [c.id, c]));
  const votant = (v: { compteId: number }) => { const c = compteParId.get(v.compteId); return c ? { nom: c.nom || c.pseudo, avatar: avatarVotant(c) } : { nom: 'Compte supprimé', avatar: null }; };
  const parCandidature = new Map<number, typeof votes>();
  for (const v of votes) parCandidature.set(v.candidatureId, [...(parCandidature.get(v.candidatureId) ?? []), v]);
  return candidatures.map(({ discordId: _id, reponses, pieces, ...c }) => {
    const v = parCandidature.get(c.id) ?? [];
    const de = (valeur: string) => v.filter(x => x.valeur === valeur);
    return {
      ...c,
      reponses: (Array.isArray(reponses) ? reponses as unknown as Reponse[] : []).filter(r => voitSensible || (r.champFiche !== 'telephone' && r.champFiche !== 'rib')).map(({ libelle, valeur }) => ({ libelle, valeur })),
      pieces: voitPieces ? pieces.map(p => ({ id: p.id, libelle: p.libelle, url: p.url, urlMini: p.urlMini })) : [],
      nombrePieces: pieces.length,
      votes: { pour: de('pour').length, contre: de('contre').length, abstention: de('abstention').length },
      votants: { pour: de('pour').map(votant), contre: de('contre').map(votant), abstention: de('abstention').map(votant) },
    };
  });
}

async function candidatureOu404(id: number) {
  const c = await prisma.candidature.findUnique({ where: { id }, include: { pieces: { orderBy: { position: 'asc' } } } });
  if (!c) throw new Refus('Candidature introuvable.', 404);
  return c;
}

export async function monVote(candidatureId: number, compteId: number): Promise<ValeurVote | null> {
  const v = await prisma.candidatureVote.findUnique({ where: { candidatureId_compteId: { candidatureId, compteId } } });
  return (v?.valeur as ValeurVote) ?? null;
}
export async function voter(candidatureId: number, compteId: number, valeur: unknown): Promise<void> {
  await candidatureOu404(candidatureId);
  if (!VALEURS_VOTE.includes(valeur as ValeurVote)) throw new Refus('Vote invalide.');
  await prisma.candidatureVote.upsert({
    where: { candidatureId_compteId: { candidatureId, compteId } },
    create: { candidatureId, compteId, valeur: valeur as ValeurVote }, update: { valeur: valeur as ValeurVote },
  });
}

export async function modifierNotesCandidature(id: number, notes: unknown): Promise<void> {
  await candidatureOu404(id);
  await prisma.candidature.update({ where: { id }, data: { notes: texte(notes, 2000) } });
}
export async function modifierSalonCandidature(id: number, salonDiscordId: unknown): Promise<void> {
  await candidatureOu404(id);
  const v = salonDiscordId === null || salonDiscordId === undefined || salonDiscordId === '' ? null : String(salonDiscordId);
  if (v !== null && !ID_DISCORD.test(v)) throw new Refus('Salon Discord invalide.');
  await prisma.candidature.update({ where: { id }, data: { salonDiscordId: v } });
}
// « Créer le salon » : secours quand l'ouverture automatique a échoué
export async function creerSalonPourCandidature(id: number): Promise<string> {
  const c = await candidatureOu404(id);
  if (c.salonDiscordId) throw new Refus('Cette candidature a déjà un salon.', 409);
  const salon = await creerSalonDossier('candidatures_categorie_discord', `candidature-${c.id}-${c.prenom}-${c.nom}`, c.discordId);
  if (!salon) throw new Refus('Le salon n’a pas pu être créé : le bot Discord doit être relié et la catégorie des salons de candidature réglée dans Paramètres → Discord.', 409);
  await prisma.candidature.update({ where: { id }, data: { salonDiscordId: salon } });
  return salon;
}

// ---- entretien : statut, créneau posé dans l'agenda de l'équipe, message type dans le salon du candidat ----
// fin = début + 1 h (ou le début, passé minuit : l'agenda d'un jour n'a pas d'horaire qui déborde sur le suivant)
const heureFin = (heure: string) => { const h = Number(heure.slice(0, 2)) + 1; return h > 23 ? heure : `${String(h).padStart(2, '0')}${heure.slice(2)}`; };
export async function convoquerEntretien(id: number, jour: unknown, heure: unknown, auteur: { id: number; nom: string }): Promise<void> {
  const c = await candidatureOu404(id);
  if (c.statut === 'acceptee') throw new Refus('Cette candidature a déjà été acceptée.', 409);
  if (!jourValide(jour)) throw new Refus('La date est invalide (jj/mm/aaaa).');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(heure))) throw new Refus('L’heure est invalide (HH:MM).');
  const h = String(heure);
  await prisma.$transaction([
    prisma.candidature.update({ where: { id }, data: { statut: 'entretien', entretienLe: instantParis(jour, h) } }),
    prisma.evenementAgenda.create({ data: {
      titre: `Entretien — ${c.prenom} ${c.nom}`.slice(0, 80), jour: versDate(jour), jourFin: versDate(jour), heureDebut: h, heureFin: heureFin(h),
      destination: 'tous', compteId: auteur.id, auteurNom: auteur.nom.slice(0, 64),
    } }),
  ]);
  await ecrireAuCandidat(c, `Bonjour ${c.prenom}, votre candidature a retenu notre attention : nous vous invitons à un entretien le ${jour.split('-').reverse().join('/')} à ${h} (heure de Paris).`);
}

// l'événement d'agenda « Entretien — Prénom Nom » n'est pas rattaché à la candidature : quand elle disparaît (suppression, purge de
// 90 jours, suppression de la fiche), le nom de la personne n'y reste pas jusqu'à la purge d'un an de l'agenda
export async function anonymiserEntretien(tx: Prisma.TransactionClient, c: { prenom: string; nom: string; entretienLe: Date | null }): Promise<void> {
  if (!c.entretienLe) return;
  await tx.evenementAgenda.updateMany({
    where: { titre: `Entretien — ${c.prenom} ${c.nom}`.slice(0, 80), destination: 'tous', jour: versDate(jourParis(c.entretienLe)) },
    data: { titre: 'Entretien — candidat' },
  });
}

export async function refuserCandidature(id: number): Promise<void> {
  const c = await candidatureOu404(id);
  if (c.statut === 'acceptee') throw new Refus('Cette candidature a déjà été acceptée.', 409);
  await prisma.candidature.update({ where: { id }, data: { statut: 'refusee' } });
  await ecrireAuCandidat(c, `Bonjour ${c.prenom}, après étude, nous ne donnons pas suite à votre candidature. Merci pour votre intérêt.`);
}

// ---- accepter : la fiche se crée comme pour une candidature du bot (lireChamps, verifierUnicite, grade d'arrivée réglé) ; les réponses
// liées à un champ de la fiche (téléphone, RIB, ID Unique) la pré-remplissent ; la pièce marquée « va sur la fiche » devient sa pièce
// d'identité (même fichier, jamais copié : la candidature n'y pointe plus), les autres restent consultables jusqu'à l'effacement ----
export function champsDepuisReponses(reponses: readonly Reponse[]): Partial<Record<ChampFiche, string>> {
  const champs: Partial<Record<ChampFiche, string>> = {};
  for (const r of reponses) if (r.champFiche && (CHAMPS_FICHE as readonly string[]).includes(r.champFiche)) champs[r.champFiche] = r.valeur;
  return champs;
}
export async function accepterCandidature(id: number, acteur: Compte): Promise<{ employeId: number }> {
  const auteur = acteur.nom || acteur.pseudo;
  // imports tardifs : rh.ts et grades-imposes.ts remontent jusqu'à index.ts, que les routes de ce module (importées par un await
  // au chargement de index.ts) ne peuvent pas attendre — le serveur ne démarrerait pas
  const { consignerHistorique, lireChamps, nomComplet, pasSaPropreFiche, REGLAGES_BOT, verifierDroitsDuCompte, verifierHierarchie, verifierUnicite } = await import('./rh.js');
  const { actualiserGrades } = await import('../socle/grades-imposes.js');
  const c = await candidatureOu404(id);
  if (c.statut === 'acceptee') throw new Refus('Cette candidature a déjà été acceptée.', 409);
  const gradeArrivee = reglage(REGLAGES_BOT.gradeArrivee) ?? '';
  if (!gradeDe(gradeArrivee)) throw new Refus('Réglez d’abord le grade donné aux arrivées (Employés → Réglages du recrutement).');
  if ((await prisma.employe.findUnique({ where: { discordId: c.discordId }, select: { id: true } }))) throw new Refus('Ce compte Discord a déjà une fiche.', 409);
  // mêmes contrôles qu'une création à la main : grade sous celui de l'acteur, pas sa propre fiche, droits sur un compte déjà validé
  verifierHierarchie(acteur, null, gradeArrivee);
  pasSaPropreFiche(acteur, c.discordId);
  await verifierDroitsDuCompte(acteur, c.discordId, gradeArrivee);
  const liees = champsDepuisReponses(Array.isArray(c.reponses) ? c.reponses as unknown as Reponse[] : []);
  const champs = lireChamps({
    prenom: c.prenom, nom: c.nom, grade: gradeArrivee, discordId: c.discordId, dateArrivee: jourParis(),
    telephone: liees.telephone ?? '', rib: liees.rib ?? '',
    // sans ID Unique dans les réponses : provisoire, remplacé ci-dessous par PROV-C + numéro de la fiche
    idUnique: liees.idUnique || `PROV-tmp-${crypto.randomUUID().slice(0, 8)}`,
  }, null);
  await verifierUnicite(champs);
  const pieceFiche = c.pieces.find(p => p.versFiche);
  const fiche = await prisma.$transaction(async tx => {
    // on prend la candidature d'abord : un second clic simultané ne passe pas ce garde et ne crée pas une deuxième fiche
    const prise = await tx.candidature.updateMany({ where: { id, statut: { not: 'acceptee' } }, data: { statut: 'acceptee' } });
    if (prise.count === 0) throw new Refus('Cette candidature a déjà été acceptée.', 409);
    const f = await tx.employe.create({ data: {
      ...champs, statut: 'actif', idProvisoire: !liees.idUnique,
      ...(pieceFiche ? { pieceIdentiteCle: pieceFiche.cle, pieceIdentiteUrl: pieceFiche.url, pieceIdentiteCleMini: pieceFiche.cleMini, pieceIdentiteUrlMini: pieceFiche.urlMini } : {}),
    } as Prisma.EmployeUncheckedCreateInput });
    let avecId = f;
    if (!liees.idUnique) {
      const prov = `PROV-C${String(f.id).padStart(4, '0')}`;
      avecId = await tx.employe.update({ where: { id: f.id }, data: { idUnique: prov, idUniqueNormalise: prov.toLowerCase() } });
    }
    await tx.candidature.update({ where: { id }, data: { employeId: f.id } });
    if (pieceFiche) await tx.pieceCandidature.delete({ where: { id: pieceFiche.id } });   // le fichier est à la fiche désormais : jamais mis au nettoyage
    await consignerHistorique(tx, f.id, auteur, [{ type: 'creation', texte: 'Fiche créée à l’acceptation de la candidature du site' }]);
    return avecId;
  });
  await actualiserGrades([fiche.discordId]);   // le compte du site (s'il existe) prend le grade d'arrivée
  await ecrireAuCandidat(c, `Bonjour ${c.prenom}, bienvenue ! Votre candidature est acceptée, votre fiche (${nomComplet(fiche)}) vient d’être créée.`);
  return { employeId: fiche.id };
}

// toutes les pièces d'une candidature partent au nettoyage du stockage (jamais effacées à la main) ; à appeler dans la transaction qui la supprime
const mettreAuNettoyage = (tx: Prisma.TransactionClient, pieces: readonly { cle: string; url: string; cleMini: string; urlMini: string }[]) =>
  tx.imageRetiree.createMany({ data: pieces.map(p => ({ cle: p.cle, url: p.url, cleMini: p.cleMini, urlMini: p.urlMini })) });

// suppression définitive d'une candidature (demande de l'intéressé, erreur) : ses pièces partent au nettoyage ; une candidature acceptée
// n'a plus la pièce de la fiche (elle est sur la fiche), seulement les autres
export async function supprimerCandidature(id: number): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM candidatures WHERE id = ${id} FOR UPDATE`;
    const c = await tx.candidature.findUnique({ where: { id }, include: { pieces: true } });
    if (!c) throw new Refus('Candidature introuvable.', 404);
    await mettreAuNettoyage(tx, c.pieces);
    await anonymiserEntretien(tx, c);
    await tx.candidature.delete({ where: { id } });
  });
}

// tâche quotidienne (purge.ts) : 90 jours après réception, la candidature disparaît avec ses pièces jointes (quel que soit son statut :
// une réponse tardive se traite avant). Une personne acceptée garde sa fiche, et la pièce qui y est passée suit les règles de la fiche.
export async function purgerCandidatures(): Promise<{ pieces: number; candidatures: number }> {
  const limite = new Date(Date.now() - CANDIDATURES_JOURS * 86_400_000);
  const aEffacer = await prisma.candidature.findMany({ where: { creeLe: { lt: limite } }, select: { id: true } });
  let pieces = 0, candidatures = 0;
  for (const { id } of aEffacer) {
    // une candidature en échec ne bloque ni les autres, ni le reste de la purge du jour
    try {
      await prisma.$transaction(async tx => {
        // verrou de ligne : une acceptation en cours (qui déplace la pièce d'identité vers la fiche) se termine avant qu'on lise les pièces
        await tx.$queryRaw`SELECT id FROM candidatures WHERE id = ${id} FOR UPDATE`;
        const c = await tx.candidature.findUnique({ where: { id }, include: { pieces: true } });
        if (!c) return;
        await mettreAuNettoyage(tx, c.pieces); pieces += c.pieces.length;
        await anonymiserEntretien(tx, c);
        await tx.candidature.delete({ where: { id } });
        candidatures++;
      });
    } catch (e) { console.error('[purge] candidature', id, e); }
  }
  return { pieces, candidatures };
}

export const nombreCandidaturesRecues = () => prisma.candidature.count({ where: { statut: 'recue' } });
