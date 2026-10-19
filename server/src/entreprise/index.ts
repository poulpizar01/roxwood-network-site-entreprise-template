// ENTREPRISE — ce que ce site branche sur le socle (contrat : src/socle/contrat.ts).
// Tout src/entreprise/ est libre : ajouter des routes (routes/), des modules métier, des tâches planifiées.
import type { Entreprise } from '../socle/contrat.js';
import { prisma } from '../socle/db.js';
import { simulerBotsDiscord } from './discord-simulation.js';
import { planifierNettoyageImages } from './images-retirees.js';
import { PARAMETRES } from './parametres.js';
import { planifierPurge } from './purge.js';
import { recevoirCandidature } from './rh.js';
import { planifierServices, recevoirDuty } from './services.js';
import { accueil } from './routes/accueil.js';
import { agenda } from './routes/agenda.js';
import { apparence } from './routes/apparence.js';
import { annonces } from './routes/annonces.js';
import { compta } from './routes/compta.js';
import { rh } from './routes/rh.js';
import { services } from './routes/services.js';
import { stats } from './routes/stats.js';
import { planifierTableur } from './stats/tableur.js';

export const entreprise: Entreprise = {
  // niveau d'accès de chaque page de gestion/ (sans .html) : 'public', 'connecte', 'valide' ou une permission.
  // Non déclarée = compte validé. index, attente et refuse sont réglées par le socle.
  pages: {
    accueil: 'valide',
    compte: 'valide',
    annonces: 'valide',
    agenda: 'valide',
    comptes: 'comptes',
    grades: 'grades',
    rh: 'rh-voir',
    comptabilite: 'compta',
    parametres: 'parametres',
  },

  // apparence en premier : elle répond sur les adresses des images de la marque, avant le fichier livré
  routes: [apparence, annonces, agenda, rh, stats, compta, services, accueil],

  // page Paramètres (socle) : liens et réglages de ce site, déclarés dans parametres.ts
  parametres: PARAMETRES,

  // événements du bot Discord entreprise (docs/webhooks.md) : un traitement par type d'événement reçu
  webhooks: {
    // candidatures acceptées → fiches RH
    'recruitment.updated': recevoirCandidature,
    // prises et fins de service (journaux FiveM lus par le bot) : indicateur « En service » et Accueil
    'monitoring.duty': recevoirDuty,
    // exemple : une absence acceptée devient une annonce. payload : { requestId, requesterId (ID Discord), startDate,
    // endDate (ISO), reason, status: PENDING|ACCEPTED|REFUSED, … }
    'absence.updated': async e => {
      const p = e.payload as { requesterId?: string; startDate?: string; endDate?: string; status?: string };
      if (p.status !== 'ACCEPTED' || !p.startDate || !p.endDate) return;
      const c = p.requesterId ? await prisma.compte.findUnique({ where: { discordId: String(p.requesterId) } }) : null;
      const jour = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
      await prisma.annonce.create({ data: { titre: `Absence : ${c?.nom ?? c?.pseudo ?? 'un employé'}`, texte: `Du ${jour(p.startDate)} au ${jour(p.endDate)}.` } });
    },
  },

  // Ventes, lignes du tableur et comptabilité restent (historique de la paie), détachées du compte. Son agenda
  // personnel et ses invitations disparaissent ; ses événements partagés restent pour l'équipe, sans son nom.
  avantSuppressionCompte: async (compteId, tx) => {
    const compte = await tx.compte.findUnique({ where: { id: compteId }, select: { discordId: true } });
    await tx.annonce.updateMany({ where: { compteId }, data: { compteId: null } });
    await tx.vente.updateMany({ where: { compteId }, data: { compteId: null } });
    await tx.ligneTableur.updateMany({ where: { compteId }, data: { compteId: null } });
    await tx.importCompta.updateMany({ where: { compteId }, data: { compteId: null } });
    await tx.ecritureDot.updateMany({ where: { compteId }, data: { compteId: null } });
    await tx.apparenceImage.updateMany({ where: { compteId }, data: { compteId: null } });
    if (compte) await tx.invitationAgenda.deleteMany({ where: { discordId: compte.discordId } });
    await tx.evenementAgenda.deleteMany({ where: { compteId, destination: 'perso' } });
    await tx.evenementAgenda.updateMany({ where: { compteId }, data: { compteId: null, auteurNom: '' } });
  },

  avantSuppressionGrade: async (gradeCle, tx) => {
    await tx.agendaDroitsGrade.deleteMany({ where: { gradeCle } });
    const droits = await tx.agendaDroitsGrade.findMany();
    for (const ligne of droits) {
      await tx.agendaDroitsGrade.update({
        where: { gradeCle: ligne.gradeCle },
        data: {
          consulter: ligne.consulter.filter(cle => cle !== gradeCle),
          creer: ligne.creer.filter(cle => cle !== gradeCle),
          modifier: ligne.modifier.filter(cle => cle !== gradeCle),
        },
      });
    }
    await tx.evenementAgenda.updateMany({
      where: { destination: 'grade', destinationGrade: gradeCle },
      data: { destination: 'perso', destinationGrade: null },
    });
  },

  demarrage: async () => {
    planifierNettoyageImages();
    planifierTableur();
    planifierPurge();
    planifierServices();
    simulerBotsDiscord();   // développement seulement (DISCORD_BOT_TOKEN=simulation)
  },
};
