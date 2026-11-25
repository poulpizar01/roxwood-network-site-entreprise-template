// ENTREPRISE — participation aux événements personnels de l'agenda (réunions, formations…) : seul le test « événement passé »
// est partagé (InvitationAgenda.present est corrigée après coup par l'auteur de l'événement, routes/agenda.ts).
import { parisVersDate } from './agenda-regles.js';

// fini quand sa fin est passée (heure de Paris) ; sans horaire, à la fin de son dernier jour. Un événement à venir ne
// compte ni comme présence ni comme absence : present vaut true par défaut, il gonflerait sinon le taux.
export const evenementPasse = (jourFin: string, heureFin: string | null, maintenant = new Date()): boolean =>
  parisVersDate(jourFin, heureFin ?? '23:59').getTime() <= maintenant.getTime();
