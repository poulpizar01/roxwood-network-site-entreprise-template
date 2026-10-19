// ENTREPRISE — permissions propres à ce site, cochées par grade dans la gestion (page Grades).
// Clé : minuscules, chiffres, tirets, stable dans le temps (elle est enregistrée dans les grades) ; « comptes »,
// « grades » et « parametres » appartiennent au socle. Fichier sans import (le socle le lit avant de charger les routes).
// Libellé : lu sous le titre de son domaine dans la page Grades (« Ressources humaines », « Comptabilité »…) : il ne
// répète pas le domaine, mais se comprend seul (« Ajouter un employé », pas « Ajouter »).
import type { Permission } from '../socle/contrat.js';

const RH = 'Ressources humaines', VENTES = 'Ventes et statistiques';

export const permissions: Permission[] = [
  // Ressources humaines : chaque permission rh-* suppose rh-voir (vérifié par les routes)
  { cle: 'rh-voir', domaine: RH, libelle: 'Consulter les fiches', description: 'Voir les fiches employés, l’effectif et les candidatures reçues' },
  { cle: 'rh-creer', domaine: RH, libelle: 'Ajouter un employé', description: 'Créer une fiche ; retraiter ou écarter une candidature reçue' },
  { cle: 'rh-modifier', domaine: RH, libelle: 'Modifier une fiche', description: 'Changer l’identité, le grade ou les dates d’un employé' },
  { cle: 'rh-desactiver', domaine: RH, libelle: 'Enregistrer un départ', description: 'Passer un employé en « ancien employé »' },
  { cle: 'rh-reactiver', domaine: RH, libelle: 'Réintégrer un ancien employé', description: 'Remettre un ancien employé dans l’effectif actif' },
  { cle: 'rh-sensible', domaine: RH, libelle: 'Consulter le téléphone et le RIB', description: 'Voir et modifier le téléphone et le RIB des employés' },
  { cle: 'rh-parametrer', domaine: RH, libelle: 'Régler le recrutement', description: 'Choisir comment les candidatures acceptées sur Discord remplissent les fiches' },
  { cle: 'ventes', domaine: VENTES, libelle: 'Consulter les ventes et statistiques', description: 'Ventes reçues, totaux, anomalies et chiffres du Google Sheets de la direction' },
  { cle: 'ventes-gerer', domaine: VENTES, libelle: 'Synchroniser le Google Sheets', description: 'Relire à la main le Google Sheets de la direction (sinon automatique toutes les 5 minutes)' },
  { cle: 'compta', domaine: 'Comptabilité', libelle: 'Gérer la comptabilité', description: 'Relevé Tablettes, rémunération (salaires, paliers de primes) et déclaration DOT' },
  { cle: 'agenda-types', domaine: 'Agenda', libelle: 'Gérer les types d’événements', description: 'Créer, renommer, colorer et supprimer les types qui classent les événements de l’agenda' },
  // exemple (annonces internes) : à remplacer par celles de l'entreprise (stocks, factures…)
  { cle: 'annonces', domaine: 'Annonces', libelle: 'Publier des annonces', description: 'Publier, épingler et retirer les annonces internes' },
];
