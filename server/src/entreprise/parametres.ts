// ENTREPRISE — réglages de la page Paramètres (socle/parametres.ts : validation, enregistrement, routes, permission
// « parametres »). Ici seulement ce que ce site règle, et la lecture typée dont le reste du site a besoin.
//   - privés : lus par le serveur ou servis aux comptes validés (Google Sheets, registre, services, agenda) ;
//   - publics : liens des pages publiques (GET /api/liens, data-lien) ; un lien vide masque son bouton.
import type { GroupeParametres } from '../socle/contrat.js';
import { entierParametre, idsParametre, lienParametre, parametre } from '../socle/parametres.js';
import { JOURS_SEMAINE } from './texte.js';

// Onglets de la page Paramètres : Discord (Apparence : propre à la page). Les aides parlent à la direction, pas à un
// administrateur : ni .env ni jargon ; un réglage Discord se choisit par son nom (discord).
export const PARAMETRES: GroupeParametres[] = [
  { onglet: 'Discord', titre: 'Site public', intro: 'Un lien vide masque son bouton.', reglages: [
    { cle: 'discord_entreprise', type: 'lien', public: true, libelle: 'Discord de l’entreprise', aide: 'Bouton « Rejoindre le Discord » de la page d’accueil et lien de la page Confidentialité.' },
  ] },
  // les prises et fins de service arrivent du bot (événement monitoring.duty, services.ts) ; rien à régler ici — l'état
  // de l'abonnement s'affiche plus bas (afficherEtats, gestion/parametres.html)
  // Agenda : qui voit, crée et modifie quoi se règle par grade (page Grades) ; ici, seulement où trouver les tickets
  { onglet: 'Discord', titre: 'Agenda : prévenir sur Discord', intro: 'Un événement créé pour quelqu’un d’autre lui est posté sur Discord : dans son ticket s’il en a un, sinon en message privé. Qui voit, crée et modifie les événements se règle dans la fiche de chaque grade.', reglages: [
    { cle: 'agenda_categories_tickets', type: 'ids-discord', discord: 'categorie', libelle: 'Catégories des tickets',
      aide: 'Les catégories où le bot de tickets les ouvre : le site y cherche le ticket de la personne (le bot doit pouvoir y voir les salons et écrire). Vide : message privé seulement.' },
  ] },
  // Quota : le quota de chacun (run et factures) se règle dans la fiche de son grade (page Grades) ; ici, seulement
  // l'objectif de toute l'équipe, comparé au total de la semaine (page Quota).
  { onglet: 'Quota', titre: 'Run', reglages: [
    { cle: 'run_objectif_hebdo', type: 'entier', min: 0, max: 1000000, defaut: 0, libelle: 'Objectif hebdomadaire (unités)',
      aide: 'Total d’unités que toute l’équipe vise à vendre chaque semaine. 0 = pas d’objectif affiché.' },
  ] },
  { onglet: 'Quota', titre: 'Factures', reglages: [
    { cle: 'facture_objectif_hebdo', type: 'entier', min: 0, max: 1000000, defaut: 0, libelle: 'Objectif hebdomadaire ($)',
      aide: 'Montant que toute l’équipe vise à facturer chaque semaine. 0 = pas d’objectif affiché.' },
  ] },
  // accès client aux contrats (lien à jeton, gestion/contrat-client.html) : jours où le client peut modifier sa
  // liste de bénéficiaires (entreprise/contrats.ts, joursAccesContrats)
  { onglet: 'Contrats', titre: 'Accès client', intro: 'Jours où un client peut modifier la liste des bénéficiaires de son contrat, depuis son lien d’accès.', reglages: [
    { cle: 'contrats_jours_acces', type: 'texte', libelle: 'Jours autorisés', aide: 'Aucun jour coché : la liste n’est jamais modifiable par le client.',
      lire: (v) => {
        const jours = v.split(/[,;]+/).map(j => j.trim().toLowerCase()).filter(Boolean);
        const invalide = jours.find(j => !(JOURS_SEMAINE as readonly string[]).includes(j));
        if (invalide) return { erreur: `« ${invalide} » n’est pas un jour de la semaine.` };
        return [...new Set(jours)].sort((a, b) => JOURS_SEMAINE.indexOf(a as typeof JOURS_SEMAINE[number]) - JOURS_SEMAINE.indexOf(b as typeof JOURS_SEMAINE[number])).join(',');
      },
      afficher: (v) => v.split(',').filter(Boolean).map(j => j[0].toUpperCase() + j.slice(1)).join(', '),
    },
  ] },
];

// jours (minuscules) où un client peut modifier sa liste de bénéficiaires ; vide = jamais
export const joursAccesContrats = (): string[] => parametre('contrats_jours_acces').split(',').filter(Boolean);

// ---- lecture typée, pour le reste du site ----
export { parametre };
export const lienRegle = lienParametre;
export const idsRegles = idsParametre;
export const entierRegle = entierParametre;
