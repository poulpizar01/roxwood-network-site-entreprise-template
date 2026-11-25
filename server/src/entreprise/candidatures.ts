// ENTREPRISE — recrutement géré sur le site (module « recrutement », mode « site » : recrutement-mode.ts), distinct d'ArriveeBot (tickets du
// bot Discord, mode « bot ») : formulaire public paramétrable (identité Discord vérifiée, questions réglées par la direction, pièce
// d'identité obligatoire / facultative / retirée), suivi en colonnes, votes des RH, entretien inscrit à l'agenda, acceptation → fiche RH
// pré-remplie par les réponses liées à un champ de la fiche. Permissions : rh-voir (consulter, voter), rh-creer (convoquer, accepter,
// refuser), rh-parametrer (réglages du formulaire). Un salon Discord s'ouvre à l'envoi pour le suivi (salon-dossier.ts).
import crypto from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../socle/db.js';
import { auDessusDe, gradeDe } from '../socle/droits.js';
import type { Compte } from '../generated/prisma/client.js';
import { ID_DISCORD, posterMessage } from '../socle/discord.js';
import { enregistrerImage, retirerImage } from '../socle/images.js';
import { definirReglage, reglage } from '../socle/reglages.js';
import type { IdentiteVerifiee } from '../socle/routes/discord-leger.js';
import { Refus } from './refus.js';
import { CLE_GRADE_ARRIVEE, CLE_MODE, CLE_PIECE, modePiece, modeRecrutement, recrutementSiteActif, type ModePiece } from './recrutement-mode.js';
import { creerSalonDossier } from './salon-dossier.js';
import { instantParis, jourParis, jourValide, versDate } from './texte.js';

export const STATUTS_CANDIDATURE = ['recue', 'entretien', 'acceptee', 'refusee'] as const;
export type StatutCandidature = typeof STATUTS_CANDIDATURE[number];
export const VALEURS_VOTE = ['pour', 'contre', 'abstention'] as const;
export type ValeurVote = typeof VALEURS_VOTE[number];
// pièce et candidature disparaissent ensemble, 90 jours après réception (confidentialite.html) : la fiche, si la personne est acceptée, garde la pièce
export const CANDIDATURES_JOURS = 90;
export const TYPES_QUESTION = ['court', 'long', 'choix'] as const;
export const CHAMPS_FICHE = ['telephone', 'rib', 'idUnique'] as const;   // ce qu'une réponse peut pré-remplir sur la fiche (prénom et nom : toujours)
export type ChampFiche = typeof CHAMPS_FICHE[number];
const QUESTIONS_MAX = 15, CHOIX_MAX = 12;

const texte = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

// ---- réglages du recrutement (Employés → Recrutement → Réglages, rh-parametrer) ----
export const reglagesRecrutement = () => ({ mode: modeRecrutement(), piece: modePiece(), gradeArrivee: reglage(CLE_GRADE_ARRIVEE) ?? '' });
export async function definirReglagesRecrutement(b: Record<string, unknown>, acteur: Compte): Promise<void> {
  if (b.gradeArrivee !== undefined) {
    const g = texte(b.gradeArrivee, 40);
    if (g && !gradeDe(g)) throw new Refus('Grade d’arrivée invalide.');
    // jamais un grade égal ou supérieur à celui de qui règle (comme pour le recrutement par le bot)
    if (g && !auDessusDe(acteur, g)) throw new Refus('Le grade d’arrivée doit être sous le vôtre.', 403);
    await definirReglage(CLE_GRADE_ARRIVEE, g || null);
  }
  if (b.mode !== undefined) {
    if (b.mode !== 'bot' && b.mode !== 'site') throw new Refus('Choisissez « Bot Discord » ou « Site ».');
    await definirReglage(CLE_MODE, b.mode);
  }
  if (b.piece !== undefined) {
    if (!['obligatoire', 'facultative', 'aucune'].includes(String(b.piece))) throw new Refus('La pièce d’identité est « obligatoire », « facultative » ou « aucune ».');
    await definirReglage(CLE_PIECE, String(b.piece));
  }
}

// ---- questions du formulaire ----
export type Question = { id: number; libelle: string; type: typeof TYPES_QUESTION[number]; choix: string[]; obligatoire: boolean; champFiche: ChampFiche | null; position: number };
const versQuestion = (q: { id: number; libelle: string; type: string; choix: unknown; obligatoire: boolean; champFiche: string | null; position: number }): Question => ({
  id: q.id, libelle: q.libelle, type: q.type as Question['type'], choix: Array.isArray(q.choix) ? q.choix.map(String) : [], obligatoire: q.obligatoire,
  champFiche: (CHAMPS_FICHE as readonly string[]).includes(q.champFiche ?? '') ? q.champFiche as ChampFiche : null, position: q.position,
});
export const listerQuestions = async (): Promise<Question[]> => (await prisma.questionCandidature.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] })).map(versQuestion);

// saisie d'une question (fonction pure, testée) : un champ de la fiche ne se remplit que par une réponse courte, et par une seule question
export function lireQuestion(b: Record<string, unknown>, autres: readonly Question[], idCourant = 0) {
  const libelle = texte(b.libelle, 120);
  if (!libelle) throw new Refus('Écrivez la question.');
  if (!(TYPES_QUESTION as readonly string[]).includes(String(b.type))) throw new Refus('Choisissez le type de réponse : courte, longue ou à choix.');
  const type = b.type as Question['type'];
  let choix: string[] = [];
  if (type === 'choix') {
    const brut = Array.isArray(b.choix) ? b.choix : String(b.choix ?? '').split('\n');
    choix = [...new Set(brut.map(c => texte(c, 60)).filter(Boolean))];
    if (choix.length < 2) throw new Refus('Une question à choix propose au moins deux réponses.');
    if (choix.length > CHOIX_MAX) throw new Refus(`${CHOIX_MAX} réponses au plus.`);
  }
  const champFiche = b.champFiche ? String(b.champFiche) : null;
  if (champFiche !== null) {
    if (!(CHAMPS_FICHE as readonly string[]).includes(champFiche)) throw new Refus('Ce champ de la fiche n’existe pas.');
    if (type === 'long') throw new Refus('Une réponse longue ne peut pas remplir un champ de la fiche : choisissez une réponse courte.');
    if (autres.some(q => q.id !== idCourant && q.champFiche === champFiche)) throw new Refus('Une autre question remplit déjà ce champ de la fiche.');
  }
  return { libelle, type, choix, obligatoire: b.obligatoire !== false, champFiche };
}
export async function creerQuestion(b: Record<string, unknown>): Promise<void> {
  const questions = await listerQuestions();
  if (questions.length >= QUESTIONS_MAX) throw new Refus(`${QUESTIONS_MAX} questions au plus : retirez-en une avant d’en ajouter.`);
  const q = lireQuestion(b, questions);
  await prisma.questionCandidature.create({ data: { ...q, choix: q.choix, position: (questions.at(-1)?.position ?? -1) + 1 } });
}
export async function modifierQuestion(id: number, b: Record<string, unknown>): Promise<void> {
  const questions = await listerQuestions();
  if (!questions.some(q => q.id === id)) throw new Refus('Question introuvable.', 404);
  await prisma.questionCandidature.update({ where: { id }, data: lireQuestion(b, questions, id) });
}
// une candidature déjà reçue garde le libellé de sa question (figé dans ses réponses) : supprimer une question ne la touche pas
export async function supprimerQuestion(id: number): Promise<void> { await prisma.questionCandidature.deleteMany({ where: { id } }); }
export async function ordonnerQuestions(ids: unknown): Promise<void> {
  const liste = Array.isArray(ids) ? ids.map(Number) : [];
  const actuelles = await prisma.questionCandidature.findMany({ select: { id: true } });
  if (liste.length !== actuelles.length || !actuelles.every(q => liste.includes(q.id))) throw new Refus('Ordre incomplet : actualisez la page puis réessayez.');
  await prisma.$transaction(liste.map((id, i) => prisma.questionCandidature.update({ where: { id }, data: { position: i } })));
}

// ce que le formulaire public affiche : jamais le champ de la fiche visé
export async function formulairePublic() {
  return { ouvert: recrutementSiteActif(), piece: modePiece(), questions: (await listerQuestions()).map(({ champFiche: _c, position: _p, ...q }) => q) };
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
    if (q.type === 'choix' && !q.choix.includes(valeur)) throw new Refus(`Choisissez une des réponses proposées pour « ${q.libelle} ».`);
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

// discordId : jamais une saisie libre, seulement l'identité vérifiée (routes/candidatures.ts) : sans elle, une candidature acceptée
// créerait une fiche sans compte Discord, inutilisable pour se connecter. La pièce part avec la candidature ; si l'enregistrement
// échoue, le fichier tout juste déposé est retiré (jamais un fichier sans trace en base).
export async function creerCandidature(b: Record<string, unknown>, identite: IdentiteVerifiee | null, fichier: Express.Multer.File | undefined) {
  if (!recrutementSiteActif()) throw new Refus('Le recrutement par le site n’est pas ouvert.', 403);
  if (!identite) throw new Refus('Connectez-vous avec Discord pour envoyer votre candidature.', 401);
  const champs = lireIdentiteCandidat(b);
  const reponses = lireReponses(b.reponses, await listerQuestions());
  const piece: ModePiece = modePiece();
  if (piece === 'obligatoire' && !fichier) throw new Refus('Joignez votre pièce d’identité (une image).');
  // une candidature en cours à la fois par personne (et donc un seul salon à la chaîne)
  if (await prisma.candidature.count({ where: { discordId: identite.id, statut: { in: ['recue', 'entretien'] } } })) {
    throw new Refus('Vous avez déjà une candidature en cours d’examen : l’équipe y répond avant que vous puissiez en envoyer une autre.', 409);
  }
  const image = piece === 'aucune' || !fichier ? null : await enregistrerImage('candidatures', fichier);
  let candidature;
  try {
    candidature = await prisma.candidature.create({ data: {
      ...champs, reponses: reponses as unknown as Prisma.InputJsonValue, discordId: identite.id, pseudoDiscord: identite.pseudo.slice(0, 100),
      ...(image ? { pieceIdentiteCle: image.cle, pieceIdentiteUrl: image.url, pieceIdentiteCleMini: image.cleMini, pieceIdentiteUrlMini: image.urlMini } : {}),
    } });
  } catch (e) { if (image) await retirerImage(image).catch(() => {}); throw e; }
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

// la pièce d'identité n'est montrée qu'à qui peut la voir sur une fiche (rh-piece-voir) ; l'identifiant Discord, jamais
export async function listerCandidatures(voitPiece: boolean) {
  const [candidatures, votes] = await Promise.all([prisma.candidature.findMany({ orderBy: { creeLe: 'desc' }, take: 1000 }), prisma.candidatureVote.findMany()]);
  const comptes = votes.length ? await prisma.compte.findMany({ where: { id: { in: [...new Set(votes.map(v => v.compteId))] } }, select: { id: true, nom: true, pseudo: true, discordId: true, avatar: true } }) : [];
  const compteParId = new Map(comptes.map(c => [c.id, c]));
  const votant = (v: { compteId: number }) => { const c = compteParId.get(v.compteId); return c ? { nom: c.nom || c.pseudo, avatar: avatarVotant(c) } : { nom: 'Compte supprimé', avatar: null }; };
  const parCandidature = new Map<number, typeof votes>();
  for (const v of votes) parCandidature.set(v.candidatureId, [...(parCandidature.get(v.candidatureId) ?? []), v]);
  return candidatures.map(({ pieceIdentiteCle: _cle, pieceIdentiteCleMini: _cleMini, discordId: _id, reponses, ...c }) => {   // clés de stockage et identifiant : jamais envoyés
    const v = parCandidature.get(c.id) ?? [];
    const de = (valeur: string) => v.filter(x => x.valeur === valeur);
    return {
      ...c, ...(voitPiece ? {} : { pieceIdentiteUrl: null, pieceIdentiteUrlMini: null }),
      reponses: (Array.isArray(reponses) ? reponses as Reponse[] : []).map(({ libelle, valeur }) => ({ libelle, valeur })),
      votes: { pour: de('pour').length, contre: de('contre').length, abstention: de('abstention').length },
      votants: { pour: de('pour').map(votant), contre: de('contre').map(votant), abstention: de('abstention').map(votant) },
    };
  });
}

async function candidatureOu404(id: number) {
  const c = await prisma.candidature.findUnique({ where: { id } });
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

export async function refuserCandidature(id: number): Promise<void> {
  const c = await candidatureOu404(id);
  if (c.statut === 'acceptee') throw new Refus('Cette candidature a déjà été acceptée.', 409);
  await prisma.candidature.update({ where: { id }, data: { statut: 'refusee' } });
  await ecrireAuCandidat(c, `Bonjour ${c.prenom}, après étude, nous ne donnons pas suite à votre candidature. Merci pour votre intérêt.`);
}

// ---- accepter : la fiche se crée comme pour une candidature du bot (lireChamps, verifierUnicite, grade d'arrivée réglé) ; les réponses
// liées à un champ de la fiche (téléphone, RIB, ID Unique) la pré-remplissent ; la pièce d'identité passe de la candidature à la fiche
// (même fichier, jamais copié : la candidature n'y pointe plus) ----
export function champsDepuisReponses(reponses: readonly Reponse[]): Partial<Record<ChampFiche, string>> {
  const champs: Partial<Record<ChampFiche, string>> = {};
  for (const r of reponses) if (r.champFiche && (CHAMPS_FICHE as readonly string[]).includes(r.champFiche)) champs[r.champFiche] = r.valeur;
  return champs;
}
export async function accepterCandidature(id: number, auteur: string): Promise<{ employeId: number }> {
  // imports tardifs : rh.ts et grades-imposes.ts remontent jusqu'à index.ts, que les routes de ce module (importées par un await
  // au chargement de index.ts) ne peuvent pas attendre — le serveur ne démarrerait pas
  const { consignerHistorique, lireChamps, nomComplet, REGLAGES_BOT, verifierUnicite } = await import('./rh.js');
  const { actualiserGrades } = await import('../socle/grades-imposes.js');
  const c = await candidatureOu404(id);
  if (c.statut === 'acceptee') throw new Refus('Cette candidature a déjà été acceptée.', 409);
  const gradeArrivee = reglage(REGLAGES_BOT.gradeArrivee) ?? '';
  if (!gradeDe(gradeArrivee)) throw new Refus('Réglez d’abord le grade donné aux arrivées (Employés → Recrutement → Réglages).');
  if ((await prisma.employe.findUnique({ where: { discordId: c.discordId }, select: { id: true } }))) throw new Refus('Ce compte Discord a déjà une fiche.', 409);
  const liees = champsDepuisReponses(Array.isArray(c.reponses) ? c.reponses as unknown as Reponse[] : []);
  const champs = lireChamps({
    prenom: c.prenom, nom: c.nom, grade: gradeArrivee, discordId: c.discordId, dateArrivee: jourParis(),
    telephone: liees.telephone ?? '', rib: liees.rib ?? '',
    // sans ID Unique dans les réponses : provisoire, remplacé ci-dessous par PROV-C + numéro de la fiche
    idUnique: liees.idUnique || `PROV-tmp-${crypto.randomUUID().slice(0, 8)}`,
  }, null);
  await verifierUnicite(champs);
  const fiche = await prisma.$transaction(async tx => {
    // on prend la candidature d'abord : un second clic simultané ne passe pas ce garde et ne crée pas une deuxième fiche
    const prise = await tx.candidature.updateMany({ where: { id, statut: { not: 'acceptee' } }, data: { statut: 'acceptee' } });
    if (prise.count === 0) throw new Refus('Cette candidature a déjà été acceptée.', 409);
    const f = await tx.employe.create({ data: {
      ...champs, statut: 'actif', idProvisoire: !liees.idUnique,
      pieceIdentiteCle: c.pieceIdentiteCle, pieceIdentiteUrl: c.pieceIdentiteUrl, pieceIdentiteCleMini: c.pieceIdentiteCleMini, pieceIdentiteUrlMini: c.pieceIdentiteUrlMini,
    } as Prisma.EmployeUncheckedCreateInput });
    let avecId = f;
    if (!liees.idUnique) {
      const prov = `PROV-C${String(f.id).padStart(4, '0')}`;
      avecId = await tx.employe.update({ where: { id: f.id }, data: { idUnique: prov, idUniqueNormalise: prov.toLowerCase() } });
    }
    await tx.candidature.update({ where: { id }, data: { employeId: f.id, pieceIdentiteCle: null, pieceIdentiteUrl: null, pieceIdentiteCleMini: null, pieceIdentiteUrlMini: null } });
    await consignerHistorique(tx, f.id, auteur, [{ type: 'creation', texte: 'Fiche créée à l’acceptation de la candidature du site' }]);
    return avecId;
  });
  await actualiserGrades([fiche.discordId]);   // le compte du site (s'il existe) prend le grade d'arrivée
  await ecrireAuCandidat(c, `Bonjour ${c.prenom}, bienvenue ! Votre candidature est acceptée, votre fiche (${nomComplet(fiche)}) vient d’être créée.`);
  return { employeId: fiche.id };
}

// suppression définitive d'une candidature (demande de l'intéressé, erreur) : sa pièce part au nettoyage du stockage ; une candidature
// acceptée n'a plus de pièce (elle est sur la fiche)
export async function supprimerCandidature(id: number): Promise<void> {
  await prisma.$transaction(async tx => {
    const c = await tx.candidature.findUnique({ where: { id } });
    if (!c) throw new Refus('Candidature introuvable.', 404);
    if (c.pieceIdentiteCle) await tx.imageRetiree.create({ data: { cle: c.pieceIdentiteCle, url: c.pieceIdentiteUrl ?? '', cleMini: c.pieceIdentiteCleMini ?? '', urlMini: c.pieceIdentiteUrlMini ?? '' } });
    await tx.candidature.delete({ where: { id } });
  });
}

// tâche quotidienne (purge.ts) : 90 jours après réception, la candidature disparaît avec sa pièce d'identité (quel que soit son statut :
// une réponse tardive se traite avant). Une personne acceptée garde sa fiche, et la pièce qui y est passée suit les règles de la fiche.
export async function purgerCandidatures(): Promise<{ pieces: number; candidatures: number }> {
  const limite = new Date(Date.now() - CANDIDATURES_JOURS * 86_400_000);
  const aEffacer = await prisma.candidature.findMany({ where: { creeLe: { lt: limite } }, select: { id: true } });
  let pieces = 0, candidatures = 0;
  for (const { id } of aEffacer) {
    // une candidature en échec ne bloque ni les autres, ni le reste de la purge du jour
    try {
      await prisma.$transaction(async tx => {
        const c = await tx.candidature.findUnique({ where: { id } });
        if (!c) return;
        if (c.pieceIdentiteCle) { await tx.imageRetiree.create({ data: { cle: c.pieceIdentiteCle, url: c.pieceIdentiteUrl ?? '', cleMini: c.pieceIdentiteCleMini ?? '', urlMini: c.pieceIdentiteUrlMini ?? '' } }); pieces++; }
        await tx.candidature.delete({ where: { id } });
        candidatures++;
      });
    } catch (e) { console.error('[purge] candidature', id, e); }
  }
  return { pieces, candidatures };
}

export const nombreCandidaturesRecues = () => prisma.candidature.count({ where: { statut: 'recue' } });
