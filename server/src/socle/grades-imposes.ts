// SOCLE — grade imposé par l'entreprise (contrat : gradesImposes, ex. celui de la fiche RH). Lu à chaque connexion
// Discord (routes/auth.ts), à chaque passe du bot (synchro-discord.ts) et par la page Comptes (qui ne le laisse plus
// changer). Le site n'a alors qu'une vérité pour le grade d'une personne : celle de l'entreprise.
// entreprise n'est lu qu'à l'appel (jamais au chargement du module) : pas d'import circulaire au démarrage.
import { prisma } from './db.js';
import { gradeDe, tousLesGrades } from './droits.js';
import { gradeALaConnexion } from './grade-connexion.js';
import { entreprise } from '../entreprise/index.js';

export type GradeImpose = { grade: string; raison: string };

// une clé inconnue (grade supprimé entre-temps) est ignorée : le compte suit alors les règles du socle
export async function gradesImposes(discordIds: string[]): Promise<Map<string, GradeImpose>> {
  if (!entreprise.gradesImposes || !discordIds.length) return new Map();
  const m = await entreprise.gradesImposes([...new Set(discordIds)]);
  return new Map([...m].filter(([, v]) => !!gradeDe(v.grade)));
}

// À appeler par l'entreprise pour les seuls comptes dont le grade imposé vient de changer (fiche créée, grade changé,
// fiche reliée à un autre compte ou désactivée). Imposé : appliqué tout de suite. Plus imposé : le compte retombe sur
// son rôle Discord seul — le grade qu'il portait venait de l'entreprise, le garder comme « attribué à la main »
// laisserait les droits d'une fiche désactivée.
export async function actualiserGrades(discordIds: (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(discordIds.filter((d): d is string => !!d))];
  if (!ids.length) return;
  const [imposes, comptes] = await Promise.all([
    gradesImposes(ids),
    prisma.compte.findMany({ where: { discordId: { in: ids } }, select: { id: true, discordId: true, gradeCle: true, rolesDiscord: true } }),
  ]);
  for (const c of comptes) {
    const grade = imposes.get(c.discordId)?.grade ?? gradeALaConnexion(tousLesGrades(), c.rolesDiscord, null, false).grade;
    if (grade !== c.gradeCle) await prisma.compte.update({ where: { id: c.id }, data: { gradeCle: grade } });
  }
}
