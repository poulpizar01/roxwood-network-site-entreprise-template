// ENTREPRISE — participation aux événements personnels de l'agenda (réunions, formations…) : qui a été invité, qui
// était présent (InvitationAgenda.present, corrigée après coup par l'auteur de l'événement, routes/agenda.ts).
// La période (jour, semaine ou mois) vient du sélecteur partagé de la page Agenda (gestion/agenda.js).
import { prisma } from '../socle/db.js';
import { gradeDe } from '../socle/droits.js';
import { parisVersDate } from './agenda-regles.js';
import { nomComplet } from './rh.js';
import { versDate, versJour } from './texte.js';

// fini quand sa fin est passée (heure de Paris) ; sans horaire, à la fin de son dernier jour. Un événement à venir ne
// compte ni comme présence ni comme absence : present vaut true par défaut, il gonflerait sinon le taux.
export const evenementPasse = (jourFin: string, heureFin: string | null, maintenant = new Date()): boolean =>
  parisVersDate(jourFin, heureFin ?? '23:59').getTime() <= maintenant.getTime();

// participation de chaque employé actif sur une période (bornes incluses, données par le sélecteur de l'agenda)
export async function classementParticipants(debutJour: string, finJour: string) {
  const debut = versDate(debutJour), fin = versDate(finJour);

  const [employes, invitations, absencesApprouvees] = await Promise.all([
    prisma.employe.findMany({ where: { statut: 'actif' } }),
    prisma.invitationAgenda.findMany({
      where: { evenement: { jour: { gte: debut, lte: fin } } },
      select: { discordId: true, present: true, evenement: { select: { id: true, titre: true, jour: true, jourFin: true, heureDebut: true, heureFin: true, type: { select: { nom: true, couleur: true } } } } },
      orderBy: [{ evenement: { jour: 'asc' } }, { evenement: { heureDebut: 'asc' } }],
    }),
    // absences (congés) approuvées, pour justifier une absence à une réunion qui tombe pendant l'une d'elles
    prisma.evenementAgenda.findMany({
      where: { statutAbsence: 'approuve', compteId: { not: null }, jour: { lte: fin }, jourFin: { gte: debut } },
      select: { compteId: true, jour: true, jourFin: true },
    }),
  ]);
  const auteursAbsences = absencesApprouvees.length
    ? new Map((await prisma.compte.findMany({ where: { id: { in: absencesApprouvees.map(a => a.compteId!) } }, select: { id: true, discordId: true } })).map(c => [c.id, c.discordId]))
    : new Map<number, string>();
  const absencesParDiscord = new Map<string, { jour: Date; jourFin: Date }[]>();
  for (const a of absencesApprouvees) {
    const discordId = auteursAbsences.get(a.compteId!);
    if (!discordId) continue;
    const liste = absencesParDiscord.get(discordId) ?? [];
    liste.push({ jour: a.jour, jourFin: a.jourFin });
    absencesParDiscord.set(discordId, liste);
  }
  // un congé approuvé couvrant le jour de l'événement justifie l'absence : elle compte comme présence pour le taux
  // (comme un « excused » dans les outils de présence), mais reste distinguée dans le détail de chaque personne
  const absenceJustifiee = (discordId: string, jour: Date): boolean =>
    !!absencesParDiscord.get(discordId)?.some(a => a.jour.getTime() <= jour.getTime() && jour.getTime() <= a.jourFin.getTime());

  type Detail = { id: number; titre: string; jour: string; heureDebut: string | null; heureFin: string | null; type: { nom: string; couleur: string } | null; etat: 'present' | 'absent' | 'absence-justifiee' | 'a-venir' };
  type Compte = { invitations: number; presences: number; absencesJustifiees: number; aVenir: number; evenements: Detail[] };
  const parDiscord = new Map<string, Compte>();
  const evenementsPasses = new Set<number>(), evenementsAVenir = new Set<number>();
  for (const inv of invitations) {
    const ev = inv.evenement;
    const c = parDiscord.get(inv.discordId) ?? { invitations: 0, presences: 0, absencesJustifiees: 0, aVenir: 0, evenements: [] };
    const passe = evenementPasse(versJour(ev.jourFin), ev.heureFin);
    (passe ? evenementsPasses : evenementsAVenir).add(ev.id);
    const justifiee = passe && !inv.present && absenceJustifiee(inv.discordId, ev.jour);
    if (passe) { c.invitations++; if (inv.present || justifiee) c.presences++; if (justifiee) c.absencesJustifiees++; } else c.aVenir++;
    c.evenements.push({ id: ev.id, titre: ev.titre, jour: versJour(ev.jour), heureDebut: ev.heureDebut, heureFin: ev.heureFin, type: ev.type, etat: !passe ? 'a-venir' : inv.present ? 'present' : justifiee ? 'absence-justifiee' : 'absent' });
    parDiscord.set(inv.discordId, c);
  }
  const vide: Compte = { invitations: 0, presences: 0, absencesJustifiees: 0, aVenir: 0, evenements: [] };
  const lignes = employes
    .map(e => {
      const c = (e.discordId && parDiscord.get(e.discordId)) || vide;
      const g = gradeDe(e.gradeCle);
      return { id: e.id, nomComplet: nomComplet(e), grade: e.gradeCle, gradeLibelle: g?.libelle ?? e.gradeCle, position: g?.position ?? Number.MAX_SAFE_INTEGER, ...c };
    })
    .sort((a, b) => a.position - b.position || a.nomComplet.localeCompare(b.nomComplet, 'fr'));
  // synthèse de l'équipe : seulement les employés actifs (un invité parti n'est plus dans le tableau)
  const invites = lignes.reduce((s, l) => s + l.invitations, 0), presents = lignes.reduce((s, l) => s + l.presences, 0);
  const justifiees = lignes.reduce((s, l) => s + l.absencesJustifiees, 0);
  return {
    employes: lignes.map(({ position, ...l }) => l),
    // absences : non justifiées seulement (une absence justifiée compte comme présence dans `presences`)
    synthese: { evenementsPasses: evenementsPasses.size, evenementsAVenir: evenementsAVenir.size, invitations: invites, presences: presents, absences: invites - presents, absencesJustifiees: justifiees },
  };
}
