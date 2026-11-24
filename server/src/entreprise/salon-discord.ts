// ENTREPRISE — suivi du salon associé à un dossier (ici le contrat) : un envoi qui échoue parce que Discord ne connaît
// plus ce salon (statut 404 : supprimé, ou jamais valide) pose un repère affiché sur la fiche (salonIntrouvableLe) ; un
// envoi réussi, ou un nouveau salon enregistré à la main, l'efface. Les autres échecs (bot hors ligne, droit manquant,
// 429) sont transitoires : on ne les mémorise pas, pour ne pas alarmer sur un incident qui se résout seul.
import { prisma } from '../socle/db.js';
import { ErreurDiscord } from '../socle/discord.js';

export const salonIntrouvable = (e: unknown): boolean => e instanceof ErreurDiscord && e.statut === 404;

// bloc « À traiter » de l'Accueil (routes/accueil.ts) : les contrats dont le salon est introuvable
export async function nombreSalonsIntrouvables(): Promise<{ contrats: number }> {
  return { contrats: await prisma.contrat.count({ where: { salonIntrouvableLe: { not: null } } }) };
}
