// ENTREPRISE — Agenda de l'espace de gestion (gestion/agenda.html). Règles dans agenda-regles.ts : un événement est destiné
// à soi et à ses invités, à toute l'équipe, ou à un grade précis ; les droits par grade sont réglés dans sa fiche
// (page Grades). Types d'événements : simple classement (nom, couleur), gérés avec la
// permission « agenda-types ». L'identité vient toujours de la session ; un événement qu'on ne voit pas répond 404,
// comme un événement inexistant.
// « Perso » pour quelqu'un d'autre : son ID Discord est lu dans sa fiche RH ; le bot poste l'événement dans son ticket
// (catégories réglées dans Paramètres), sinon en message privé. Texte seul (un embed disparaît sans « Intégrer des
// liens ») et seule la personne est mentionnée. Si rien n'a pu partir, l'événement est créé quand même et l'auteur le sait.
import { Router, type Request } from 'express';
import type { EvenementAgenda, InvitationAgenda } from '../../generated/prisma/client.js';
import { config } from '../../socle/config.js';
import { prisma } from '../../socle/db.js';
import { appelBot, ErreurDiscord, posterMessage } from '../../socle/discord.js';
import { auDessusDe, gradeDe, peut, tousLesGrades } from '../../socle/droits.js';
import { body, couleur, entier, intParam, permission, text, valide } from '../../socle/http.js';
import { site } from '../../socle/site.js';
import { ajoutsNonDetenus, choisirTicket, droitsAgenda, droitsInclusDansConsultation, estDestination, gradeAccordable, modifiable, parisVersDate, peutCreer, peutInviter, voit, type Destination, type DroitsAgenda } from '../agenda-regles.js';
import { idsRegles } from '../parametres.js';
import { classementParticipants } from '../participants.js';
import { Refus, traiter } from '../refus.js';
import { nomComplet } from '../rh.js';

export const agenda = Router();

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/, RE_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
// jour sans heure : stocké en DATE, échangé en AAAA-MM-JJ (jamais d'heure ni de fuseau qui le décalerait)
const versDate = (jour: string) => new Date(`${jour}T00:00:00Z`);
const dateValide = (jour: unknown): jour is string => typeof jour === 'string' && RE_DATE.test(jour) && !Number.isNaN(versDate(jour).getTime()) && versDate(jour).toISOString().startsWith(jour);

const clesGrades = () => tousLesGrades().map(g => g.cle);   // du sommet à la base
async function droitsDe(req: Request): Promise<DroitsAgenda> {
  const c = req.compte;
  const enregistres = c.gradeCle ? await prisma.agendaDroitsGrade.findUnique({ where: { gradeCle: c.gradeCle } }) : null;
  return droitsAgenda(clesGrades(), c.gradeCle, c.proprietaire, enregistres);
}
const lecteur = (req: Request) => ({ id: req.compte.id, discordId: req.compte.discordId });

// libellé d'un destinataire, tel que la page l'affiche
const libelleDestination = (e: Pick<EvenementAgenda, 'destination' | 'destinationGrade'>, invitations: Pick<InvitationAgenda, 'nom'>[]): string =>
  e.destination === 'tous' ? 'Toute l’équipe'
    : e.destination === 'grade' ? gradeDe(e.destinationGrade)?.libelle ?? 'Grade supprimé'
      : invitations.length === 1 ? `Personnel — ${invitations[0].nom}`
        : invitations.length ? `Personnel — ${invitations.length} invités` : 'Personnel — moi uniquement';

type EvenementAvecInvitations = EvenementAgenda & { invitations: InvitationAgenda[] };
const versClient = (e: EvenementAvecInvitations, req: Request, droits: DroitsAgenda, peutValiderAbsence: boolean) => ({
  id: e.id, titre: e.titre, jour: e.jour.toISOString().slice(0, 10), jour_fin: e.jourFin.toISOString().slice(0, 10),
  heure_debut: e.heureDebut, heure_fin: e.heureFin, notes: e.notes,
  type_id: e.typeId, destination: e.destination, destination_grade: e.destinationGrade, destinataire: libelleDestination(e, e.invitations),
  auteur: e.auteurNom, mien: e.compteId === req.compte.id,
  invites: e.invitations.map(({ id, nom, prevenu, present }) => ({
    ...(e.compteId === req.compte.id ? { invitation_id: id } : {}),
    nom, prevenu, present,
  })),
  modifiable: modifiable(e, lecteur(req), droits, clesGrades()),
  absence: !!e.statutAbsence, statut_absence: e.statutAbsence, absence_motif_refus: e.absenceMotifRefus,
  peut_valider: e.statutAbsence === 'en_attente' && e.compteId !== req.compte.id && peutValiderAbsence,
});

// type (facultatif) : classement visuel, partagé avec les événements (permission « agenda-types ») ; l'entreprise s'en
// sert aussi pour distinguer ses motifs d'absence (congé, maladie…), sans liste imposée par le socle
async function lireTypeId(b: Record<string, unknown>): Promise<{ typeId: number | null; typeNom: string }> {
  if (b.type_id === undefined || b.type_id === null || b.type_id === '') return { typeId: null, typeNom: '' };
  const typeId = entier(b.type_id);
  const type = typeId !== null ? await prisma.typeAgenda.findUnique({ where: { id: typeId } }) : null;
  if (!type) throw new Refus('Ce type d’événement n’existe plus : choisissez-en un autre.');
  return { typeId, typeNom: type.nom };
}

// absence : seules les dates, le type et les notes se saisissent (pas d'horaire, de titre libre, de partage ni
// d'invités) ; le titre se déduit du type choisi (ou reste « Absence » sans type)
async function lireAbsence(b: Record<string, unknown>): Promise<{ titre: string; jour: Date; jourFin: Date; typeId: number | null; notes: string }> {
  if (!dateValide(b.jour)) throw new Refus('Date de début invalide : attendue au format jj/mm/aaaa.');
  if (!dateValide(b.jour_fin)) throw new Refus('Date de fin invalide : attendue au format jj/mm/aaaa.');
  if (String(b.jour_fin) < String(b.jour)) throw new Refus('La date de fin doit être après la date de début.');
  if (String(b.notes ?? '').length > 500) throw new Refus('Les notes sont trop longues (500 caractères maximum).');
  const { typeId, typeNom } = await lireTypeId(b);
  return { titre: (typeNom ? `Absence — ${typeNom}` : 'Absence').slice(0, 80), jour: versDate(b.jour), jourFin: versDate(b.jour_fin), typeId, notes: text(b.notes, 500) };
}

type Champs = { titre: string; jour: Date; jourFin: Date; heureDebut: string | null; heureFin: string | null; notes: string; typeId: number | null };
// un seul jour : horaires obligatoires ; plusieurs jours : pas d'horaire (l'événement occupe la journée entière, chaque jour)
async function lire(b: Record<string, unknown>): Promise<Champs> {
  const titre = text(b.titre, 80);
  if (!titre) throw new Refus('Le titre de l’événement est obligatoire.');
  if (!dateValide(b.jour)) throw new Refus('Date de début invalide : attendue au format jj/mm/aaaa.');
  if (!dateValide(b.jour_fin)) throw new Refus('Date de fin invalide : attendue au format jj/mm/aaaa.');
  if (String(b.jour_fin) < String(b.jour)) throw new Refus('La date de fin doit être après la date de début.');
  const plusieursJours = String(b.jour_fin) !== String(b.jour);
  let heureDebut: string | null = null, heureFin: string | null = null;
  if (!plusieursJours) {
    heureDebut = String(b.heure_debut ?? ''); heureFin = String(b.heure_fin ?? '');
    if (!RE_HEURE.test(heureDebut)) throw new Refus('Heure de début invalide : attendue au format 14:30.');
    if (!RE_HEURE.test(heureFin)) throw new Refus('Heure de fin invalide : attendue au format 14:30.');
    if (heureFin <= heureDebut) throw new Refus('L’heure de fin doit être après l’heure de début.');
  }
  if (String(b.notes ?? '').length > 500) throw new Refus('Les notes sont trop longues (500 caractères maximum).');
  const { typeId } = await lireTypeId(b);
  return { titre, jour: versDate(b.jour), jourFin: versDate(b.jour_fin), heureDebut, heureFin, notes: text(b.notes, 500), typeId };
}

// destinataire demandé : « perso », « tous » ou « grade » + destination_grade (un grade existant)
function lireDestination(b: Record<string, unknown>): { destination: Destination; destinationGrade: string | null } {
  const destination = estDestination(b.destination) ? b.destination : 'perso';
  if (destination !== 'grade') return { destination, destinationGrade: null };
  const g = gradeDe(String(b.destination_grade ?? ''));
  if (!g) throw new Refus('Ce grade n’existe plus : choisissez à qui l’événement est destiné.');
  return { destination, destinationGrade: g.cle };
}
const refusDestination = (d: { destination: Destination; destinationGrade: string | null }) => new Refus(d.destination === 'tous'
  ? 'Votre grade ne permet pas de créer un événement pour tout le monde.'
  : `Votre grade ne permet pas de créer un événement destiné à « ${gradeDe(d.destinationGrade)?.libelle ?? 'ce grade'} ».`, 403);

// ---- prévenir chaque personne invitée : son ticket, sinon un message privé ----
type Envoi = { prevenu: '' | 'ticket' | 'prive'; discordSalonId: string | null; discordMessageId: string | null; avertissement: string };
const echapperMarkdown = (t: string) => t.replace(/[\\*_~`|>#[\]()-]/g, c => `\\${c}`);
const pourquoi = (e: unknown) => e instanceof ErreurDiscord
  ? e.statut === 0 ? 'Discord ne répond pas' : e.statut === 401 ? 'le jeton du bot Discord est refusé' : e.statut === 403 ? 'le bot n’a pas le droit d’y écrire' : e.statut === 429 ? 'Discord demande de ralentir' : `Discord a refusé (HTTP ${e.statut})`
  : 'erreur inattendue';

function texteMessage(discordId: string, ev: { titre: string; jour: string; jourFin: string; heureDebut: string | null; heureFin: string | null; notes: string }, auteur: string): string {
  const quand = ev.heureDebut && ev.heureFin
    ? (() => {
      const debut = Math.floor(parisVersDate(ev.jour, ev.heureDebut!).getTime() / 1000), fin = Math.floor(parisVersDate(ev.jour, ev.heureFin!).getTime() / 1000);
      return `<t:${debut}:F> → <t:${fin}:t>`;
    })()
    : (() => {
      const debut = Math.floor(parisVersDate(ev.jour, '00:00').getTime() / 1000), fin = Math.floor(parisVersDate(ev.jourFin, '00:00').getTime() / 1000);
      return `<t:${debut}:D> → <t:${fin}:D>`;
    })();
  return [`<@${discordId}>`, '', `📅 **${echapperMarkdown(ev.titre)}**`, quand,
    ...(ev.notes ? [echapperMarkdown(ev.notes)] : []), '', `*Ajouté à ton agenda par ${echapperMarkdown(auteur)} · ${echapperMarkdown(site.nom)}*`].join('\n').slice(0, 2000);
}

// salons du serveur, lus une seule fois pour tous les invités d'une même requête (pas un appel par personne)
const lireSalons = (): Promise<unknown> | null => {
  if (!config.discord.botToken || !idsRegles('agenda_categories_tickets').length) return null;
  return appelBot('GET', `/guilds/${config.discord.guildId}/channels`).catch(e => { console.error('[agenda] salons du serveur :', pourquoi(e)); return null; });
};

async function prevenir(discordId: string, nom: string, ev: Parameters<typeof texteMessage>[1], auteur: string, salons: Promise<unknown> | null): Promise<Envoi> {
  const rien = (avertissement: string): Envoi => ({ prevenu: '', discordSalonId: null, discordMessageId: null, avertissement });
  if (!config.discord.botToken) return rien(`${nom} n’a pas été prévenu sur Discord : le bot n’est pas relié au site.`);
  const contenu = { content: texteMessage(discordId, ev, auteur) };
  // 1. son ticket : salon d'une des catégories réglées où il a une permission à son nom
  const categories = idsRegles('agenda_categories_tickets');
  const ticket = salons ? choisirTicket(await salons, discordId, categories) : null;
  if (ticket) {
    // ticket trouvé mais refusé : on le dit plutôt que d'écrire ailleurs en silence (droits du bot à corriger)
    try { return { prevenu: 'ticket', discordSalonId: ticket, discordMessageId: await posterMessage(ticket, contenu, [discordId]), avertissement: '' }; }
    catch (e) { return rien(`Le message n’a pas pu être posté dans le ticket de ${nom} (${pourquoi(e)}) : prévenez-le vous-même.`); }
  }
  // 2. sans ticket : message privé
  try {
    const prive = await appelBot('POST', '/users/@me/channels', { recipient_id: discordId }) as { id?: unknown } | null;
    const salon = String(prive?.id ?? '');
    return { prevenu: 'prive', discordSalonId: salon, discordMessageId: await posterMessage(salon, contenu, [discordId]), avertissement: '' };
  } catch (e) {
    const cause = e instanceof ErreurDiscord && e.statut === 403 ? 'ses messages privés sont fermés' : pourquoi(e);
    return rien(`${nom} n’a pas de ticket ouvert et n’a pas pu être prévenu en message privé (${cause}) : prévenez-le vous-même.`);
  }
}

// Prévenir les invités sans faire attendre la page indéfiniment : quatre à la fois, et au bout de DELAI_REPONSE_MS la
// réponse part avec ceux déjà prévenus ; les autres continuent en arrière-plan (leur état s'enregistre quand même).
// Sinon, avec beaucoup d'invités ou un Discord lent, la page dépassait le délai du serveur web : erreur affichée alors
// que l'événement était créé, et l'agent le recréait en double.
const EN_PARALLELE = 4, DELAI_REPONSE_MS = 20_000;
async function prevenirInvitations(invitations: InvitationAgenda[], ev: Parameters<typeof texteMessage>[1], auteur: string) {
  const envois: { nom: string; prevenu: Envoi['prevenu']; avertissement: string }[] = [];
  if (!invitations.length) return { envois, enCours: 0 };
  const salons = lireSalons(), file = [...invitations];
  const travailleur = async () => {
    for (let inv = file.shift(); inv; inv = file.shift()) {
      const invitation = inv;
      try {
        const envoi = await prevenir(invitation.discordId, invitation.nom, ev, auteur, salons);
        await prisma.invitationAgenda.updateMany({
          where: { id: invitation.id },   // updateMany : l'invitation a pu être retirée entre-temps
          data: { prevenu: envoi.prevenu, discordSalonId: envoi.discordSalonId, discordMessageId: envoi.discordMessageId },
        });
        envois.push({ nom: invitation.nom, prevenu: envoi.prevenu, avertissement: envoi.avertissement });
      } catch (e) { console.error('[agenda] invitation non prévenue :', e); envois.push({ nom: invitation.nom, prevenu: '', avertissement: `${invitation.nom} n’a pas pu être prévenu sur Discord : prévenez-le vous-même.` }); }
    }
  };
  const tous = Promise.all(Array.from({ length: Math.min(EN_PARALLELE, invitations.length) }, travailleur));
  let minuteur: NodeJS.Timeout | undefined;
  await Promise.race([tous, new Promise(r => { minuteur = setTimeout(r, DELAI_REPONSE_MS); })]);
  clearTimeout(minuteur);
  // copie : la liste continue de se remplir en arrière-plan
  return { envois: [...envois], enCours: invitations.length - envois.length };
}

// prévenir l'auteur d'une absence de la décision (approbation ou refus), dans son ticket sinon en message privé
function texteDecisionAbsence(discordId: string, e: { jour: Date; jourFin: Date }, approuve: boolean, motifRefus: string | null, valideur: string): string {
  const debut = Math.floor(parisVersDate(e.jour.toISOString().slice(0, 10), '00:00').getTime() / 1000);
  const fin = Math.floor(parisVersDate(e.jourFin.toISOString().slice(0, 10), '00:00').getTime() / 1000);
  const quand = e.jour.getTime() === e.jourFin.getTime() ? `<t:${debut}:D>` : `<t:${debut}:D> → <t:${fin}:D>`;
  return [`<@${discordId}>`, '',
    approuve ? `✅ Ton absence du ${quand} a été **approuvée**.` : `❌ Ton absence du ${quand} a été **refusée**${motifRefus ? ` : ${echapperMarkdown(motifRefus)}` : '.'}`,
    '', `*Décidé par ${echapperMarkdown(valideur)} · ${echapperMarkdown(site.nom)}*`].join('\n').slice(0, 2000);
}
async function prevenirDecisionAbsence(e: EvenementAgenda, approuve: boolean, motifRefus: string | null, valideur: string): Promise<string> {
  if (!e.compteId) return '';
  const compte = await prisma.compte.findUnique({ where: { id: e.compteId }, select: { discordId: true } });
  if (!compte) return '';
  if (!config.discord.botToken) return 'L’auteur n’a pas été prévenu sur Discord : le bot n’est pas relié au site.';
  const contenu = { content: texteDecisionAbsence(compte.discordId, e, approuve, motifRefus, valideur) };
  try {
    const salons = await lireSalons();
    const ticket = salons ? choisirTicket(salons, compte.discordId, idsRegles('agenda_categories_tickets')) : null;
    if (ticket) { await posterMessage(ticket, contenu, [compte.discordId]); return ''; }
    const prive = await appelBot('POST', '/users/@me/channels', { recipient_id: compte.discordId }) as { id?: unknown } | null;
    await posterMessage(String(prive?.id ?? ''), contenu, [compte.discordId]);
    return '';
  } catch (err) {
    const cause = err instanceof ErreurDiscord && err.statut === 403 ? 'ses messages privés sont fermés' : pourquoi(err);
    return `L’auteur n’a pas pu être prévenu sur Discord (${cause}) : prévenez-le vous-même.`;
  }
}

async function prevenirRetrait(invitation: InvitationAgenda, titre: string): Promise<string> {
  if (!invitation.prevenu || !invitation.discordSalonId) return '';
  if (!config.discord.botToken) return `${invitation.nom} a été retiré de l’événement, mais le bot Discord n’est plus relié : l’ancienne invitation n’a pas pu être signalée.`;
  try {
    await posterMessage(invitation.discordSalonId, {
      content: `<@${invitation.discordId}> — l’événement **${echapperMarkdown(titre)}** a été retiré de votre agenda par son organisateur.`,
    }, [invitation.discordId]);
    return '';
  } catch (e) {
    return `${invitation.nom} a été retiré de l’événement, mais l’annulation n’a pas pu être signalée sur Discord (${pourquoi(e)}).`;
  }
}

// ---- types d'événements ----
const versType = (t: { id: number; nom: string; couleur: string }) => ({ id: t.id, nom: t.nom, couleur: t.couleur });
const listeTypes = async () => (await prisma.typeAgenda.findMany({ orderBy: [{ position: 'asc' }, { nom: 'asc' }] })).map(versType);

function lireType(b: Record<string, unknown>) {
  const nom = text(b.nom, 40), c = couleur(b.couleur);
  if (!nom) throw new Refus('Donnez un nom au type.');
  if (!c) throw new Refus('Couleur invalide.');
  return { nom, couleur: c };
}
const nomPris = (e: unknown) => (e as { code?: string }).code === 'P2002';

agenda.get('/api/agenda/types', ...valide, async (_req, res) => { res.json({ types: await listeTypes() }); });

agenda.post('/api/agenda/types', ...permission('agenda-types'), traiter(async (req, res) => {
  const t = lireType(body(req));
  if (await prisma.typeAgenda.count() >= 30) throw new Refus('30 types au plus : regroupez-en avant d’en créer un autre.');
  const position = (await prisma.typeAgenda.aggregate({ _max: { position: true } }))._max.position ?? -1;
  try { await prisma.typeAgenda.create({ data: { ...t, position: position + 1 } }); }
  catch (e) { if (nomPris(e)) throw new Refus(`Le type « ${t.nom} » existe déjà.`, 409); throw e; }
  res.status(201).json({ types: await listeTypes() });
}));

agenda.put('/api/agenda/types/:id', ...permission('agenda-types'), traiter(async (req, res) => {
  const t = lireType(body(req));
  try { await prisma.typeAgenda.update({ where: { id: intParam(req, 'id') }, data: t }); }
  catch (e) {
    if (nomPris(e)) throw new Refus(`Le type « ${t.nom} » existe déjà.`, 409);
    if ((e as { code?: string }).code === 'P2025') throw new Refus('Type introuvable.', 404);
    throw e;
  }
  res.json({ types: await listeTypes() });
}));

// ses événements restent, « sans type » (onDelete: SetNull)
agenda.delete('/api/agenda/types/:id', ...permission('agenda-types'), traiter(async (req, res) => {
  await prisma.typeAgenda.deleteMany({ where: { id: intParam(req, 'id') } });
  res.json({ types: await listeTypes() });
}));

// ---- droits par grade (fiche du grade, page Grades) ----
// Les événements partagés dans toute l'équipe ont des droits séparés des événements adressés à un grade.
agenda.get('/api/agenda/droits-grades', ...permission('grades'), async (_req, res) => {
  const lignes = new Map((await prisma.agendaDroitsGrade.findMany()).map(l => [l.gradeCle, l]));
  const grades = clesGrades();
  res.json({ droits: grades.map(cle => {
    const l = lignes.get(cle);
    const d = droitsAgenda(grades, cle, false, l ?? null);
    return {
      grade: cle,
      consulter: d.consulter, creer: d.creer, modifier: d.modifier,
      consulter_tous: d.consulterTous, gerer_tous: d.gererTous,
    };
  }) });
});

// mêmes règles que les permissions : on ne règle que les grades sous le sien et on ne leur donne pas accès au-dessus.
agenda.put('/api/agenda/droits-grades/:cle', ...permission('grades'), traiter(async (req, res) => {
  const cle = String(req.params.cle), b = body(req), grades = clesGrades();
  if (!gradeDe(cle)) throw new Refus('Grade introuvable.', 404);
  if (!auDessusDe(req.compte, cle)) throw new Refus('Vous ne gérez que les grades sous le vôtre.', 403);
  const lireListe = (valeur: unknown, champ: string): string[] => {
    if (!Array.isArray(valeur) || valeur.some(cle => typeof cle !== 'string') || new Set(valeur).size !== valeur.length) {
      throw new Refus(`La sélection « ${champ} » est invalide.`);
    }
    const liste = valeur as string[];
    if (liste.some(cle => !gradeAccordable(cle, grades, req.compte.gradeCle, req.compte.proprietaire))) {
      throw new Refus('Vous ne pouvez pas ouvrir l’agenda au-dessus de votre propre grade.', 403);
    }
    return liste;
  };
  const valeurs = {
    consulter: lireListe(b.consulter, 'Consulter'),
    creer: lireListe(b.creer, 'Créer'),
    modifier: lireListe(b.modifier, 'Modifier'),
  };
  if (typeof b.consulter_tous !== 'boolean' || typeof b.gerer_tous !== 'boolean') {
    throw new Refus('Choisissez les droits de consultation et de gestion pour toute l’équipe.');
  }
  const consulterTous = b.consulter_tous, gererTous = b.gerer_tous;
  if (gererTous && !consulterTous) throw new Refus('Pour gérer les événements de toute l’équipe, il faut aussi pouvoir les consulter.');
  if (!droitsInclusDansConsultation(valeurs.consulter, valeurs.modifier)) {
    throw new Refus('Le grade ne peut pas modifier des événements qu’il ne peut pas consulter.');
  }
  if (!droitsInclusDansConsultation(valeurs.consulter, valeurs.creer)) {
    throw new Refus('Le grade ne peut pas créer des événements pour des grades qu’il ne peut pas consulter.');
  }
  const [droitsActeur, existant] = await Promise.all([
    droitsDe(req),
    prisma.agendaDroitsGrade.findUnique({ where: { gradeCle: cle } }),
  ]);
  const droitsExistants = droitsAgenda(grades, cle, false, existant);
  for (const [champ, libelle] of [['consulter', 'consulter'], ['creer', 'créer'], ['modifier', 'modifier']] as const) {
    const refuses = ajoutsNonDetenus(droitsActeur, droitsActeur[champ], droitsExistants[champ], valeurs[champ]);
    if (refuses.length) {
      const noms = refuses.map(k => gradeDe(k)?.libelle ?? k).join(', ');
      throw new Refus(`Vous ne pouvez accorder que des droits que vous avez vous-même : vous ne pouvez pas ${libelle} les événements destinés à ${noms}. Demandez à un supérieur.`, 403);
    }
  }
  if (!droitsActeur.tout && consulterTous && !droitsActeur.consulterTous && !droitsExistants.consulterTous) {
    throw new Refus('Vous ne pouvez pas accorder un accès de consultation que vous n’avez pas.', 403);
  }
  if (!droitsActeur.tout && gererTous && !droitsActeur.gererTous && !droitsExistants.gererTous) {
    throw new Refus('Vous ne pouvez pas accorder un droit de gestion que vous n’avez pas.', 403);
  }
  const tous = { consulterTous, gererTous };
  await prisma.agendaDroitsGrade.upsert({ where: { gradeCle: cle }, create: { gradeCle: cle, ...valeurs, ...tous }, update: { ...valeurs, ...tous } });
  res.json({ ok: true });
}));

// ---- événements ----
agenda.get('/api/agenda', ...valide, async (req, res) => {
  const { debut, fin } = req.query;
  if (!dateValide(debut) || !dateValide(fin)) { res.status(400).json({ error: 'Plage de dates invalide.' }); return; }
  const droits = await droitsDe(req), grades = clesGrades(), moi = lecteur(req);
  const peutValiderAbsence = peut(req.compte, 'agenda-absences');
  const candidats = await prisma.evenementAgenda.findMany({
    where: {
      jour: { lte: versDate(fin) },
      jourFin: { gte: versDate(debut) },
      OR: [
        { compteId: req.compte.id }, { invitations: { some: { discordId: req.compte.discordId ?? '' } } }, { destination: { in: ['tous', 'grade'] } },
        // les absences (même « perso ») se voient par qui peut les valider, sans quoi rien ne les lui montrerait
        ...(peutValiderAbsence ? [{ statutAbsence: { not: null } }] : []),
      ],
    },
    orderBy: [{ jour: 'asc' }, { heureDebut: 'asc' }],
    take: 2000,
    include: { invitations: true },
  });
  // destinations proposées à la création : personnel, toute l'équipe, puis chaque grade autorisé
  const destinations = [{ valeur: 'perso', libelle: 'Personnel' }];
  if (peutCreer(droits, 'tous', null, grades)) destinations.push({ valeur: 'tous', libelle: 'Toute l’équipe' });
  for (const g of tousLesGrades()) if (peutCreer(droits, 'grade', g.cle, grades)) destinations.push({ valeur: `grade:${g.cle}`, libelle: g.libelle });
  res.json({
    evenements: candidats.filter(e => voit({ ...e, invitesDiscordIds: e.invitations.map(i => i.discordId) }, moi, droits, grades, peutValiderAbsence)).slice(0, 1000).map(e => versClient(e, req, droits, peutValiderAbsence)),
    types: await listeTypes(),
    droits: { destinations, peut_inviter: droits.tout || droits.creer.length > 0 },
  });
});

// fiches RH des personnes qu'on peut inviter : elles doivent être actives et dans la limite du droit de création
agenda.get('/api/agenda/personnes', ...valide, traiter(async (req, res) => {
  const droits = await droitsDe(req), grades = clesGrades();
  if (!droits.tout && droits.creer.length === 0) throw new Refus('Votre grade ne permet pas d’inviter des personnes.', 403);
  const fiches = await prisma.employe.findMany({ where: { statut: 'actif' }, orderBy: [{ prenom: 'asc' }, { nom: 'asc' }], select: { id: true, prenom: true, nom: true, discordPseudo: true, idUnique: true, discordId: true, gradeCle: true } });
  res.json({ personnes: fiches.filter(f => f.discordId !== req.compte.discordId && peutInviter(droits, f.gradeCle, grades)).map(f => ({ id: f.id, nom: nomComplet(f), discord: !!f.discordId })) });
}));

agenda.post('/api/agenda', ...valide, traiter(async (req, res) => {
  const b = body(req);
  if (b.absence) {
    const a = await lireAbsence(b);
    const auteur = req.compte.nom || req.compte.pseudo;
    const e = await prisma.evenementAgenda.create({
      data: { titre: a.titre, jour: a.jour, jourFin: a.jourFin, notes: a.notes, typeId: a.typeId, destination: 'perso', compteId: req.compte.id, auteurNom: auteur.slice(0, 64), statutAbsence: 'en_attente' },
    });
    res.status(201).json({ id: e.id, notifications: [], en_cours: 0, avertissements: [] });
    return;
  }
  const d = await lire(b), dest = lireDestination(b);
  const droits = await droitsDe(req), grades = clesGrades();
  if (!peutCreer(droits, dest.destination, dest.destinationGrade, grades)) throw refusDestination(dest);
  const auteur = req.compte.nom || req.compte.pseudo;

  const valeurs = b.invites_employe_ids;
  if (valeurs !== undefined && (!Array.isArray(valeurs) || valeurs.length > 100 || valeurs.some(id => entier(id) === null))) {
    throw new Refus('La liste des personnes à inviter est invalide.');
  }
  const ids: number[] = [];
  for (const valeur of Array.isArray(valeurs) ? valeurs : []) {
    const id = entier(valeur);
    if (id === null || ids.includes(id)) throw new Refus('La liste des personnes à inviter est invalide.');
    ids.push(id);
  }
  if (ids.length && dest.destination !== 'perso') {
    throw new Refus('Les personnes ne peuvent être invitées que pour un événement personnel.');
  }
  const fiches = ids.length ? await prisma.employe.findMany({ where: { id: { in: ids }, statut: 'actif' } }) : [];
  if (fiches.length !== ids.length) throw new Refus('Une personne sélectionnée est introuvable ou n’est plus active.', 404);
  const parId = new Map(fiches.map(f => [f.id, f]));
  const personnes = ids.map(id => {
    const fiche = parId.get(id);
    if (!fiche) throw new Refus('Une personne sélectionnée est introuvable ou n’est plus active.', 404);
    const nom = nomComplet(fiche);
    if (!peutInviter(droits, fiche.gradeCle, grades)) throw new Refus(`Votre grade ne permet pas d’inviter ${nom}.`, 403);
    if (fiche.discordId === req.compte.discordId) throw new Refus('Vous ne pouvez pas vous inviter vous-même.');
    if (!fiche.discordId) throw new Refus(`La fiche RH de ${nom} n’a pas d’ID Discord : complétez-la avant de l’inviter.`, 409);
    return { discordId: fiche.discordId, nom };
  });

  const e = await prisma.evenementAgenda.create({
    data: {
      ...d, ...dest, compteId: req.compte.id, auteurNom: auteur.slice(0, 64),
      invitations: { create: personnes.map(p => ({ ...p })) },
    },
    include: { invitations: true },
  });
  const { envois, enCours } = await prevenirInvitations(e.invitations, { ...d, jour: String(b.jour), jourFin: String(b.jour_fin) }, auteur);
  res.status(201).json({
    id: e.id,
    notifications: envois.map(({ nom, prevenu }) => ({ nom, prevenu })),
    en_cours: enCours,
    avertissements: envois.map(x => x.avertissement).filter(Boolean),
  });
}));

// un événement qu'on ne peut pas modifier répond 404 s'il est invisible, 403 s'il est seulement visible
async function modifiableOuRefus(req: Request) {
  const e = await prisma.evenementAgenda.findUnique({ where: { id: intParam(req, 'id') }, include: { invitations: true } });
  const droits = await droitsDe(req), grades = clesGrades();
  if (!e || !voit({ ...e, invitesDiscordIds: e.invitations.map(i => i.discordId) }, lecteur(req), droits, grades, peut(req.compte, 'agenda-absences'))) throw new Refus('Événement introuvable.', 404);
  if (!modifiable(e, lecteur(req), droits, grades)) throw new Refus('Votre grade ne permet pas de modifier cet événement.', 403);
  return { e, droits, grades };
}

agenda.put('/api/agenda/:id', ...valide, traiter(async (req, res) => {
  const { e, droits, grades } = await modifiableOuRefus(req);
  const b = body(req);
  // absence : seules les dates, le type et les notes se corrigent ; une absence déjà approuvée repasse « en attente »
  if (e.statutAbsence) {
    const a = await lireAbsence(b);
    const remiseEnAttente = e.statutAbsence === 'approuve';
    await prisma.evenementAgenda.update({
      where: { id: e.id },
      data: { jour: a.jour, jourFin: a.jourFin, typeId: a.typeId, notes: a.notes, titre: a.titre, ...(remiseEnAttente ? { statutAbsence: 'en_attente', absenceDecideLe: null, absenceMotifRefus: null } : {}) },
    });
    res.json({ ok: true, notifications: [], en_cours: 0, annulations: 0, avertissements: remiseEnAttente ? ['Absence remise en attente de validation après modification.'] : [] });
    return;
  }
  const d = await lire(b);
  const invitationIds: number[] = [];
  if (b.invitation_ids === undefined) invitationIds.push(...e.invitations.map(i => i.id));
  else {
    if (!Array.isArray(b.invitation_ids) || b.invitation_ids.length > 100) throw new Refus('La liste des invitations est invalide.');
    for (const valeur of b.invitation_ids) {
      const id = entier(valeur);
      if (id === null || invitationIds.includes(id) || !e.invitations.some(i => i.id === id)) throw new Refus('La liste des invitations est invalide.');
      invitationIds.push(id);
    }
  }
  const valeursEmployes = b.invites_employe_ids;
  if (valeursEmployes !== undefined && (!Array.isArray(valeursEmployes) || valeursEmployes.length > 100)) {
    throw new Refus('La liste des personnes à inviter est invalide.');
  }
  const employeIds: number[] = [];
  for (const valeur of Array.isArray(valeursEmployes) ? valeursEmployes : []) {
    const id = entier(valeur);
    if (id === null || employeIds.includes(id)) throw new Refus('La liste des personnes à inviter est invalide.');
    employeIds.push(id);
  }
  const fiches = employeIds.length ? await prisma.employe.findMany({ where: { id: { in: employeIds }, statut: 'actif' } }) : [];
  if (fiches.length !== employeIds.length) throw new Refus('Une personne sélectionnée est introuvable ou n’est plus active.', 404);
  const parId = new Map(fiches.map(f => [f.id, f]));
  const invitesExistants = e.invitations.filter(i => invitationIds.includes(i.id));
  const discordDejaInvite = new Set(invitesExistants.map(i => i.discordId));
  const nouvellesPersonnes = employeIds.map(id => {
    const fiche = parId.get(id);
    if (!fiche) throw new Refus('Une personne sélectionnée est introuvable ou n’est plus active.', 404);
    const nom = nomComplet(fiche);
    if (!peutInviter(droits, fiche.gradeCle, grades)) throw new Refus(`Votre grade ne permet pas d’inviter ${nom}.`, 403);
    if (fiche.discordId === req.compte.discordId) throw new Refus('Vous ne pouvez pas vous inviter vous-même.');
    if (!fiche.discordId) throw new Refus(`La fiche RH de ${nom} n’a pas d’ID Discord : complétez-la avant de l’inviter.`, 409);
    if (discordDejaInvite.has(fiche.discordId)) return null;
    discordDejaInvite.add(fiche.discordId);
    return { discordId: fiche.discordId, nom };
  }).filter((personne): personne is { discordId: string; nom: string } => personne !== null);

  // Une destination partagée n'accepte pas d'invitations nominatives ; les invitations existantes doivent être retirées d'abord.
  let dest = { destination: e.destination as Destination, destinationGrade: e.destinationGrade };
  if (b.destination !== undefined && invitationIds.length === 0 && nouvellesPersonnes.length === 0) {
    const demande = lireDestination(b);
    if (demande.destination !== dest.destination || demande.destinationGrade !== dest.destinationGrade) {
      if (!peutCreer(droits, demande.destination, demande.destinationGrade, grades)) throw refusDestination(demande);
      // l'événement d'un autre ne devient pas privé à soi : il disparaîtrait de l'agenda de son auteur
      if (demande.destination === 'perso' && e.compteId !== req.compte.id) throw new Refus('Seul son auteur peut rendre cet événement personnel.', 403);
      dest = demande;
    }
  }
  if ((invitationIds.length || nouvellesPersonnes.length) && dest.destination !== 'perso') {
    throw new Refus('Les personnes ne peuvent être invitées que pour un événement personnel.');
  }
  // présence des invités déjà là (corrigée après coup) : liste de ceux marqués absents, parmi ceux conservés ;
  // absente du corps = rien à changer (une modification qui ne touche pas aux invités ne doit pas tout remettre « présent »)
  const absentsBrut = b.absents_invitation_ids;
  let absents: Set<number> | null = null;
  if (absentsBrut !== undefined) {
    if (!Array.isArray(absentsBrut) || absentsBrut.length > 100) throw new Refus('La liste des absences est invalide.');
    absents = new Set<number>();
    for (const valeur of absentsBrut) {
      const id = entier(valeur);
      if (id === null || !invitationIds.includes(id)) throw new Refus('La liste des absences est invalide.');
      absents.add(id);
    }
  }

  const retires = e.invitations.filter(i => !invitationIds.includes(i.id));
  const ajoutes = await prisma.$transaction(async tx => {
    await tx.evenementAgenda.update({ where: { id: e.id }, data: { ...d, ...dest } });
    if (retires.length) await tx.invitationAgenda.deleteMany({ where: { id: { in: retires.map(i => i.id) } } });
    if (absents) await Promise.all(invitationIds.map(id => tx.invitationAgenda.update({ where: { id }, data: { present: !absents!.has(id) } } )));
    return nouvellesPersonnes.length
      ? Promise.all(nouvellesPersonnes.map(p => tx.invitationAgenda.create({ data: { evenementId: e.id, ...p } })))
      : [];
  });
  const auteur = req.compte.nom || req.compte.pseudo;
  const { envois, enCours } = await prevenirInvitations(ajoutes, { ...d, jour: String(b.jour), jourFin: String(b.jour_fin) }, auteur);
  const avertissements = envois.map(x => x.avertissement).filter(Boolean);
  let annulations = 0;
  for (const invitation of retires) {
    const avertissement = await prevenirRetrait(invitation, e.titre);
    if (!avertissement && invitation.prevenu) annulations++;
    if (avertissement) avertissements.push(avertissement);
  }
  res.json({ ok: true, notifications: envois.map(({ nom, prevenu }) => ({ nom, prevenu })), en_cours: enCours, annulations, avertissements });
}));

agenda.delete('/api/agenda/:id', ...valide, traiter(async (req, res) => {
  const { e } = await modifiableOuRefus(req);
  await prisma.evenementAgenda.delete({ where: { id: e.id } });
  res.json({ ok: true });
}));

// Valider une absence : permission dédiée « agenda-absences » (page Grades), jamais son auteur. Un refus garde
// l'événement (motif facultatif), purgé 30 jours après la décision (purge.ts) ; l'auteur en est prévenu sur Discord
// s'il est joignable (prevenirDecisionAbsence).
agenda.post('/api/agenda/:id/absence', ...permission('agenda-absences'), traiter(async (req, res) => {
  const e = await prisma.evenementAgenda.findUnique({ where: { id: intParam(req, 'id') } });
  if (!e || e.statutAbsence !== 'en_attente') throw new Refus('Absence introuvable ou déjà traitée.', 404);
  if (e.compteId === req.compte.id) throw new Refus('Vous ne pouvez pas valider votre propre absence.', 403);
  const b = body(req), approuve = !!b.approuve;
  if (String(b.motif ?? '').length > 200) throw new Refus('Le motif est trop long (200 caractères maximum).');
  const motifRefus = approuve ? null : (text(b.motif, 200) || null);
  await prisma.evenementAgenda.update({ where: { id: e.id }, data: { statutAbsence: approuve ? 'approuve' : 'refuse', absenceDecideLe: new Date(), absenceMotifRefus: motifRefus } });
  const valideur = req.compte.nom || req.compte.pseudo;
  const avertissement = await prevenirDecisionAbsence(e, approuve, motifRefus, valideur);
  res.json({ ok: true, approuve, avertissement });
}));

// Participation aux événements personnels (réunions, formations…) : qui a été invité, qui était présent, sur la
// période affichée par le sélecteur partagé de l'agenda (jour, semaine ou mois). Page Agenda, onglet Participants ;
// même permission que Quota.
agenda.get('/api/agenda/participants', ...permission('quota'), traiter(async (req, res) => {
  const { debut, fin } = req.query;
  if (typeof debut !== 'string' || typeof fin !== 'string' || !dateValide(debut) || !dateValide(fin)) throw new Refus('Période invalide.', 400);
  res.json(await classementParticipants(debut, fin));
}));
