// ENTREPRISE — durées de conservation de ce site (annoncées dans confidentialite.html), appliquées chaque jour.
// Les ventes ne sont jamais purgées : elles font l'historique des primes et de la paie. Les événements du bot et les
// sessions relèvent du socle (socle/purge.ts).
import { prisma } from '../socle/db.js';
import { purgerReponses } from './rh.js';

const JOUR = 24 * 3600e3;
const AGENDA_JOURS = 365, CANDIDATURES_JOURS = 365, SERVICES_JOURS = 365, RELEVES_GARDES = 20, ABSENCES_REFUSEES_JOURS = 30;

async function purger(): Promise<void> {
  await purgerReponses();
  const avant = (jours: number) => new Date(Date.now() - jours * JOUR);
  const [agenda, absencesRefusees, candidatures, services] = await Promise.all([
    prisma.evenementAgenda.deleteMany({ where: { jour: { lt: avant(AGENDA_JOURS) } } }),
    // une absence refusée reste un mois, pour que son auteur la voie, puis disparaît (agenda-regles.ts, routes/agenda.ts)
    prisma.evenementAgenda.deleteMany({ where: { statutAbsence: 'refuse', absenceDecideLe: { lt: avant(ABSENCES_REFUSEES_JOURS) } } }),
    // confidentialite.html promet un an pour toute candidature, y compris celle restée en suspens sans être retraitée
    prisma.arriveeBot.deleteMany({ where: { recuLe: { lt: avant(CANDIDATURES_JOURS) } } }),
    // services terminés (un service en cours reste)
    prisma.service.deleteMany({ where: { fin: { lt: avant(SERVICES_JOURS) } } }),
  ]);
  // relevés Tablettes : chaque retrait d'une ligne en enregistre une nouvelle copie ; seuls les plus récents servent
  const gardes = await prisma.importCompta.findMany({ where: { type: 'tablettes' }, orderBy: [{ importeLe: 'desc' }, { id: 'desc' }], take: RELEVES_GARDES, select: { id: true } });
  const releves = gardes.length < RELEVES_GARDES ? { count: 0 } : await prisma.importCompta.deleteMany({ where: { type: 'tablettes', id: { notIn: gardes.map(g => g.id) } } });
  const effaces = { agenda: agenda.count, absencesRefusees: absencesRefusees.count, candidatures: candidatures.count, services: services.count, releves: releves.count };
  if (Object.values(effaces).some(Boolean)) console.log('[purge] effacés :', JSON.stringify(effaces));
}

// au démarrage puis une fois par jour ; unref : ce minuteur ne retient pas l'arrêt du serveur
export function planifierPurge(): void {
  const run = () => purger().catch(e => console.error('[purge]', e));
  run();
  setInterval(run, JOUR).unref();
}
