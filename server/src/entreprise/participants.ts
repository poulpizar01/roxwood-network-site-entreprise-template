// ENTREPRISE — participation aux événements personnels de l'agenda (réunions, formations…) : qui a été invité, qui
// était présent (InvitationAgenda.present, corrigée après coup par l'auteur de l'événement, routes/agenda.ts).
// Même recette que le quota de run (entreprise/run.ts) : semaine passée ou en cours, jamais future.
import { prisma } from '../socle/db.js';
import { gradeDe } from '../socle/droits.js';
import { nomComplet } from './rh.js';
import { jourParis, versDate, versJour } from './texte.js';

const lundiDe = (jour: string): string => {
  const d = versDate(jour);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return versJour(d);
};

// participation de chaque employé actif pour une semaine (la semaine en cours par défaut, ou une semaine passée
// choisie par son lundi — jamais future : on reste sur la semaine en cours)
export async function classementParticipants(semaineDemandee?: string) {
  const semaineCourante = lundiDe(jourParis());
  const semaine = semaineDemandee && lundiDe(semaineDemandee) < semaineCourante ? lundiDe(semaineDemandee) : semaineCourante;
  const debut = versDate(semaine), fin = versDate(semaine);
  fin.setUTCDate(fin.getUTCDate() + 6);

  const [employes, invitations] = await Promise.all([
    prisma.employe.findMany({ where: { statut: 'actif' } }),
    prisma.invitationAgenda.findMany({ where: { evenement: { jour: { gte: debut, lte: fin } } }, select: { discordId: true, present: true } }),
  ]);
  const parDiscord = new Map<string, { invitations: number; presences: number }>();
  for (const inv of invitations) {
    const c = parDiscord.get(inv.discordId) ?? { invitations: 0, presences: 0 };
    c.invitations++;
    if (inv.present) c.presences++;
    parDiscord.set(inv.discordId, c);
  }
  const lignes = employes
    .map(e => {
      const c = (e.discordId && parDiscord.get(e.discordId)) || { invitations: 0, presences: 0 };
      const g = gradeDe(e.gradeCle);
      return { id: e.id, nomComplet: nomComplet(e), grade: e.gradeCle, gradeLibelle: g?.libelle ?? e.gradeCle, position: g?.position ?? Number.MAX_SAFE_INTEGER, ...c };
    })
    .sort((a, b) => a.position - b.position || a.nomComplet.localeCompare(b.nomComplet, 'fr'));
  return {
    debutSemaine: semaine,
    semaineCourante,
    employes: lignes.map(({ position, ...l }) => l),
  };
}
