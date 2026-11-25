// ENTREPRISE — recrutement géré sur le site (module « recrutement »), distinct d'ArriveeBot (tickets du bot Discord) : formulaire
// public (identité Discord vérifiée, pièce d'identité RP obligatoire), suivi en colonnes par statut, votes des RH, entretien
// inscrit à l'agenda, acceptation → fiche RH. Permissions : rh-voir (consulter, voter), rh-creer (convoquer, accepter, refuser).
// Un salon Discord s'ouvre à l'envoi pour le suivi (salon-dossier.ts, même recette que les demandes).
import crypto from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../socle/db.js';
import { gradeDe } from '../socle/droits.js';
import { ID_DISCORD, posterMessage } from '../socle/discord.js';
import { enregistrerImage, retirerImage } from '../socle/images.js';
import { reglage } from '../socle/reglages.js';
import type { IdentiteVerifiee } from '../socle/routes/discord-leger.js';
import { Refus } from './refus.js';
import { creerSalonDossier } from './salon-dossier.js';
import { instantParis, jourParis, jourValide, versDate } from './texte.js';

export const STATUTS_CANDIDATURE = ['recue', 'entretien', 'acceptee', 'refusee'] as const;
export type StatutCandidature = typeof STATUTS_CANDIDATURE[number];
export const VALEURS_VOTE = ['pour', 'contre', 'abstention'] as const;
export type ValeurVote = typeof VALEURS_VOTE[number];
export const PIECE_JOURS = 90, CANDIDATURES_JOURS = 365;

const texte = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

// ---- formulaire public ----
export function lireChampsCandidature(b: Record<string, unknown>) {
  const prenom = texte(b.prenom, 60), nom = texte(b.nom, 60);
  if (!prenom || !nom) throw new Refus('Le prénom et le nom sont obligatoires.');
  const motivation = texte(b.motivation, 2000);
  if (!motivation) throw new Refus('La motivation est obligatoire.');
  return { poste: texte(b.poste, 120), prenom, nom, motivation };
}

// discordId : jamais une saisie libre, seulement l'identité vérifiée (routes/candidatures.ts) : sans elle, une candidature acceptée
// créerait une fiche sans compte Discord, inutilisable pour se connecter. La pièce d'identité part avec la candidature ; si
// l'enregistrement échoue, le fichier tout juste déposé est retiré (jamais un fichier sans trace en base).
export async function creerCandidature(b: Record<string, unknown>, identite: IdentiteVerifiee | null, fichier: Express.Multer.File | undefined) {
  if (!identite) throw new Refus('Connectez-vous avec Discord pour envoyer votre candidature.', 401);
  const champs = lireChampsCandidature(b);
  if (!fichier) throw new Refus('Joignez votre pièce d’identité (une image).');
  // une candidature en cours à la fois par personne (et donc un seul salon à la chaîne)
  if (await prisma.candidature.count({ where: { discordId: identite.id, statut: { in: ['recue', 'entretien'] } } })) {
    throw new Refus('Vous avez déjà une candidature en cours d’examen : l’équipe y répond avant que vous puissiez en envoyer une autre.', 409);
  }
  const image = await enregistrerImage('candidatures', fichier);
  let candidature;
  try {
    candidature = await prisma.candidature.create({ data: {
      ...champs, discordId: identite.id, pseudoDiscord: identite.pseudo.slice(0, 100),
      pieceIdentiteCle: image.cle, pieceIdentiteUrl: image.url, pieceIdentiteCleMini: image.cleMini, pieceIdentiteUrlMini: image.urlMini,
    } });
  } catch (e) { await retirerImage(image).catch(() => {}); throw e; }
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

// la pièce d'identité n'est montrée qu'à qui peut la voir sur une fiche (rh-piece-voir) ; l'identifiant Discord jamais
export async function listerCandidatures(voitPiece: boolean) {
  const depuis = new Date(Date.now() - CANDIDATURES_JOURS * 86_400_000);
  const filtre = { OR: [{ statut: { notIn: ['acceptee', 'refusee'] } }, { creeLe: { gte: depuis } }] };
  const [candidatures, votes] = await Promise.all([
    prisma.candidature.findMany({ where: filtre, orderBy: { creeLe: 'desc' }, take: 1000 }),
    prisma.candidatureVote.findMany({ where: { candidature: filtre } }),
  ]);
  const comptes = votes.length ? await prisma.compte.findMany({ where: { id: { in: [...new Set(votes.map(v => v.compteId))] } }, select: { id: true, nom: true, pseudo: true, discordId: true, avatar: true } }) : [];
  const compteParId = new Map(comptes.map(c => [c.id, c]));
  const votant = (v: { compteId: number }) => { const c = compteParId.get(v.compteId); return c ? { nom: c.nom || c.pseudo, avatar: avatarVotant(c) } : { nom: 'Compte supprimé', avatar: null }; };
  const parCandidature = new Map<number, typeof votes>();
  for (const v of votes) parCandidature.set(v.candidatureId, [...(parCandidature.get(v.candidatureId) ?? []), v]);
  return candidatures.map(({ pieceIdentiteCle: _cle, pieceIdentiteCleMini: _cleMini, discordId: _id, ...c }) => {   // clés de stockage et identifiant : jamais envoyés
    const v = parCandidature.get(c.id) ?? [];
    const de = (valeur: string) => v.filter(x => x.valeur === valeur);
    return {
      ...c, ...(voitPiece ? {} : { pieceIdentiteUrl: null, pieceIdentiteUrlMini: null }),
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

// ---- accepter : la fiche se crée comme pour une candidature du bot (lireChamps, verifierUnicite, grade d'arrivée réglé) ; la
// pièce d'identité passe de la candidature à la fiche (même fichier, jamais copié : la candidature n'y pointe plus) ----
export async function accepterCandidature(id: number, auteur: string): Promise<{ employeId: number }> {
  // imports tardifs : rh.ts et grades-imposes.ts remontent jusqu'à index.ts, que les routes de ce module (importées par un await
  // au chargement de index.ts) ne peuvent pas attendre — le serveur ne démarrerait pas
  const { consignerHistorique, lireChamps, nomComplet, REGLAGES_BOT, verifierUnicite } = await import('./rh.js');
  const { actualiserGrades } = await import('../socle/grades-imposes.js');
  const c = await candidatureOu404(id);
  if (c.statut === 'acceptee') throw new Refus('Cette candidature a déjà été acceptée.', 409);
  const gradeArrivee = reglage(REGLAGES_BOT.gradeArrivee) ?? '';
  if (!gradeDe(gradeArrivee)) throw new Refus('Réglez d’abord le grade donné aux arrivées (Employés → Recrutement par le bot).');
  if ((await prisma.employe.findUnique({ where: { discordId: c.discordId }, select: { id: true } }))) throw new Refus('Ce compte Discord a déjà une fiche.', 409);
  const champs = lireChamps({ prenom: c.prenom, nom: c.nom, grade: gradeArrivee, discordId: c.discordId, dateArrivee: jourParis(), idUnique: `PROV-tmp-${crypto.randomUUID().slice(0, 8)}` }, null);
  await verifierUnicite(champs);
  const fiche = await prisma.$transaction(async tx => {
    // on prend la candidature d'abord : un second clic simultané ne passe pas ce garde et ne crée pas une deuxième fiche
    const prise = await tx.candidature.updateMany({ where: { id, statut: { not: 'acceptee' } }, data: { statut: 'acceptee' } });
    if (prise.count === 0) throw new Refus('Cette candidature a déjà été acceptée.', 409);
    const f = await tx.employe.create({ data: {
      ...champs, statut: 'actif', idProvisoire: true,
      pieceIdentiteCle: c.pieceIdentiteCle, pieceIdentiteUrl: c.pieceIdentiteUrl, pieceIdentiteCleMini: c.pieceIdentiteCleMini, pieceIdentiteUrlMini: c.pieceIdentiteUrlMini,
    } as Prisma.EmployeUncheckedCreateInput });
    const prov = `PROV-C${String(f.id).padStart(4, '0')}`;
    const avecId = await tx.employe.update({ where: { id: f.id }, data: { idUnique: prov, idUniqueNormalise: prov.toLowerCase() } });
    await tx.candidature.update({ where: { id }, data: { employeId: f.id, pieceIdentiteCle: null, pieceIdentiteUrl: null, pieceIdentiteCleMini: null, pieceIdentiteUrlMini: null } });
    await consignerHistorique(tx, f.id, auteur, [{ type: 'creation', texte: 'Fiche créée à l’acceptation de la candidature du site' }]);
    return avecId;
  });
  await actualiserGrades([fiche.discordId]);   // le compte du site (s'il existe) prend le grade d'arrivée
  await ecrireAuCandidat(c, `Bonjour ${c.prenom}, bienvenue ! Votre candidature est acceptée, votre fiche (${nomComplet(fiche)}) vient d’être créée.`);
  return { employeId: fiche.id };
}

// suppression définitive d'une candidature (demande de l'intéressé, erreur) : sa pièce part au nettoyage du stockage ; une
// candidature acceptée n'a plus de pièce (elle est sur la fiche)
export async function supprimerCandidature(id: number): Promise<void> {
  await prisma.$transaction(async tx => {
    const c = await tx.candidature.findUnique({ where: { id } });
    if (!c) throw new Refus('Candidature introuvable.', 404);
    if (c.pieceIdentiteCle) await tx.imageRetiree.create({ data: { cle: c.pieceIdentiteCle, url: c.pieceIdentiteUrl ?? '', cleMini: c.pieceIdentiteCleMini ?? '', urlMini: c.pieceIdentiteUrlMini ?? '' } });
    await tx.candidature.delete({ where: { id } });
  });
}

// tâche quotidienne (purge.ts) : la pièce d'une candidature non acceptée est effacée 90 jours après réception ; la candidature
// elle-même un an après (confidentialite.html). Une acceptée garde sa ligne (sans pièce) jusqu'à l'année.
export async function purgerCandidatures(): Promise<{ pieces: number; candidatures: number }> {
  const avant = (jours: number) => new Date(Date.now() - jours * 86_400_000);
  const aEffacer = await prisma.candidature.findMany({ where: { creeLe: { lt: avant(PIECE_JOURS) }, pieceIdentiteCle: { not: null } }, select: { id: true } });
  let pieces = 0;
  for (const { id } of aEffacer) {
    // une candidature en échec ne bloque ni les autres, ni le reste de la purge du jour
    try {
      await prisma.$transaction(async tx => {
        const c = await tx.candidature.findUnique({ where: { id } });
        if (!c?.pieceIdentiteCle) return;
        await tx.imageRetiree.create({ data: { cle: c.pieceIdentiteCle, url: c.pieceIdentiteUrl ?? '', cleMini: c.pieceIdentiteCleMini ?? '', urlMini: c.pieceIdentiteUrlMini ?? '' } });
        await tx.candidature.update({ where: { id }, data: { pieceIdentiteCle: null, pieceIdentiteUrl: null, pieceIdentiteCleMini: null, pieceIdentiteUrlMini: null } });
        pieces++;
      });
    } catch (e) { console.error('[purge] pièce de candidature', id, e); }
  }
  const vieilles = await prisma.candidature.deleteMany({ where: { creeLe: { lt: avant(CANDIDATURES_JOURS) }, statut: { in: ['acceptee', 'refusee'] } } });
  return { pieces, candidatures: vieilles.count };
}

export const nombreCandidaturesRecues = () => prisma.candidature.count({ where: { statut: 'recue' } });
