// ENTREPRISE — ce que ce site branche sur le socle (contrat : src/socle/contrat.ts).
// Tout src/entreprise/ est libre : ajouter des routes (routes/), des modules métier, des tâches planifiées.
import type { Entreprise } from '../socle/contrat.js';
import { prisma } from '../socle/db.js';
import { actualiserGrades } from '../socle/grades-imposes.js';
import { simulerBotsDiscord } from './discord-simulation.js';
import { planifierNettoyageImages } from './images-retirees.js';
import { PARAMETRES } from './parametres.js';
import { planifierPurge } from './purge.js';
import { recevoirFactureCommande, recevoirFactureMonitoring } from './facture.js';
import { recevoirCandidature } from './rh.js';
import { recevoirRun } from './run.js';
import { planifierServices, recevoirDuty } from './services.js';
import { planifierVerrouillageDot } from './verrouillage-dot.js';
import { accueil } from './routes/accueil.js';
import { agenda } from './routes/agenda.js';
import { apparence } from './routes/apparence.js';
import { compte } from './routes/compte.js';
import { compta } from './routes/compta.js';
import { paie } from './routes/paie.js';
import { rh } from './routes/rh.js';
import { run } from './routes/run.js';
import { services } from './routes/services.js';

export const entreprise: Entreprise = {
  // niveau d'accès de chaque page de gestion/ (sans .html) : 'public', 'connecte', 'valide' ou une permission.
  // Non déclarée = compte validé. index, attente et refuse sont réglées par le socle.
  pages: {
    accueil: 'valide',
    compte: 'valide',
    agenda: 'valide',
    comptes: 'comptes',
    grades: 'grades',
    rh: 'rh-voir',
    quota: 'rh-voir',
    dot: 'compta',
    facturation: 'factures',
    paie: 'paie',
    parametres: 'parametres',
  },

  // apparence en premier : elle répond sur les adresses des images de la marque, avant le fichier livré
  routes: [apparence, agenda, rh, run, compta, paie, services, accueil, compte],

  // page Paramètres (socle) : liens et réglages de ce site, déclarés dans parametres.ts
  parametres: PARAMETRES,

  // événements du bot Discord entreprise (docs/webhooks.md) : un traitement par type d'événement reçu
  webhooks: {
    // candidatures acceptées → fiches RH
    'recruitment.updated': recevoirCandidature,
    // prises et fins de service (journaux FiveM lus par le bot) : indicateur « En service » et Accueil
    'monitoring.duty': recevoirDuty,
    // vente d'objet en jeu annoncée dans le salon de monitoring (table runs, entreprise/run.ts)
    'monitoring.sale': recevoirRun,
    // factures (table factures, entreprise/facture.ts) : commande boutique validée/régénérée, et paiement constaté
    // en jeu par le monitoring FiveM
    'order.updated': recevoirFactureCommande,
    'monitoring.invoice': recevoirFactureMonitoring,
  },

  // Factures et comptabilité restent (historique de la paie), détachées du compte. Son agenda personnel et ses
  // invitations disparaissent ; ses événements partagés restent pour l'équipe, sans son nom.
  avantSuppressionCompte: async (compteId, tx) => {
    const compte = await tx.compte.findUnique({ where: { id: compteId }, select: { discordId: true } });
    await tx.facture.updateMany({ where: { compteId }, data: { compteId: null } });
    await tx.importCompta.updateMany({ where: { compteId }, data: { compteId: null } });
    await tx.ecritureDot.updateMany({ where: { compteId }, data: { compteId: null } });
    await tx.apparenceImage.updateMany({ where: { compteId }, data: { compteId: null } });
    if (compte) await tx.invitationAgenda.deleteMany({ where: { discordId: compte.discordId } });
    await tx.evenementAgenda.deleteMany({ where: { compteId, destination: 'perso' } });
    await tx.evenementAgenda.updateMany({ where: { compteId }, data: { compteId: null, auteurNom: '' } });
  },

  avantSuppressionGrade: async (gradeCle, tx) => {
    // une fiche RH active avec ce grade continuerait d'exister sans qu'aucun grade ne corresponde plus : les
    // calculs de paie/quota qui relisent gradeDe(e.gradeCle) retomberaient silencieusement à zéro (annule la suppression)
    const porteurs = await tx.employe.count({ where: { gradeCle, statut: 'actif' } });
    if (porteurs) throw new Error(`Ce grade est encore porté par ${porteurs} fiche(s) RH active(s) : change-leur de grade d’abord.`);
    await tx.remunerationGrade.deleteMany({ where: { gradeCle } });
    await tx.primePalierGrade.deleteMany({ where: { gradeCle } });
    await tx.runsQuotaGrade.deleteMany({ where: { gradeCle } });
    await tx.facturesQuotaGrade.deleteMany({ where: { gradeCle } });
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

  // une seule vérité pour le grade : celui de la fiche RH active donne les droits sur le site (socle/grades-imposes.ts)
  gradesImposes: async discordIds => {
    const fiches = await prisma.employe.findMany({ where: { statut: 'actif', discordId: { in: discordIds } }, select: { discordId: true, gradeCle: true } });
    return new Map(fiches.map(f => [f.discordId as string, { grade: f.gradeCle, raison: 'Fiche RH' }]));
  },

  demarrage: async () => {
    // fiches actives : grade du compte aligné dès le démarrage (fiches créées avant cette règle, base restaurée)
    const fiches = await prisma.employe.findMany({ where: { statut: 'actif', discordId: { not: null } }, select: { discordId: true } });
    await actualiserGrades(fiches.map(f => f.discordId));
    planifierNettoyageImages();
    planifierPurge();
    planifierServices();
    planifierVerrouillageDot();
    simulerBotsDiscord();   // développement seulement (DISCORD_BOT_TOKEN=simulation)
  },
};
