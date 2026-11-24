// ENTREPRISE — permissions propres à ce site, cochées par grade dans la gestion (page Grades).
// Clé : minuscules, chiffres, tirets, stable dans le temps (elle est enregistrée dans les grades) ; « comptes »,
// « grades » et « parametres » appartiennent au socle. Fichier sans import (le socle le lit avant de charger les routes).
// Libellé : lu sous le titre de son domaine dans la page Grades (« Ressources humaines », « Comptabilité »…) : il ne
// répète pas le domaine, mais se comprend seul (« Ajouter un employé », pas « Ajouter »).
import type { Permission } from '../socle/contrat.js';
import { permissionsInactives } from './modules.js';

const RH = 'Ressources humaines';

const declarees: Permission[] = [
  // Ressources humaines : chaque permission rh-* suppose rh-voir (vérifié par les routes)
  { cle: 'rh-voir', domaine: RH, libelle: 'Consulter les fiches', description: 'Voir les fiches employés, l’effectif et les candidatures reçues' },
  { cle: 'rh-sensible-voir', domaine: RH, libelle: 'Consulter le téléphone et le RIB', description: 'Voir le téléphone et le RIB des employés, sans pouvoir les modifier' },
  { cle: 'rh-sensible', domaine: RH, libelle: 'Modifier le téléphone et le RIB', description: 'Changer le téléphone et le RIB d’un employé', requiert: ['rh-sensible-voir'] },
  { cle: 'rh-piece-voir', domaine: RH, libelle: 'Consulter la pièce d’identité', description: 'Voir la pièce d’identité d’un employé (effacée 90 jours après son départ)', requiert: ['rh-voir'] },
  { cle: 'rh-piece', domaine: RH, libelle: 'Gérer la pièce d’identité', description: 'Ajouter, remplacer ou retirer la pièce d’identité d’un employé', requiert: ['rh-piece-voir'] },
  { cle: 'rh-modifier', domaine: RH, libelle: 'Modifier une fiche', description: 'Changer l’identité, le grade ou les dates d’un employé' },
  // la page Sanctions se consulte sans pouvoir sanctionner ; elle liste aussi les employés, d'où rh-voir
  { cle: 'rh-sanctions-voir', domaine: RH, libelle: 'Consulter les sanctions', description: 'Voir les sanctions de tous les employés (page Sanctions)', requiert: ['rh-voir'] },
  { cle: 'rh-sanctionner', domaine: RH, libelle: 'Gérer les sanctions', description: 'Ajouter ou retirer une sanction sur une fiche employé', requiert: ['rh-sanctions-voir'] },
  { cle: 'rh-creer', domaine: RH, libelle: 'Ajouter un employé', description: 'Créer une fiche ; retraiter ou écarter une candidature reçue' },
  { cle: 'rh-supprimer', domaine: RH, libelle: 'Supprimer une fiche', description: 'Effacer définitivement la fiche d’un employé (préférer le départ, qui garde l’historique)', requiert: ['rh-voir'] },
  { cle: 'rh-reactiver', domaine: RH, libelle: 'Réintégrer un ancien employé', description: 'Remettre un ancien employé dans l’effectif actif' },
  { cle: 'rh-desactiver', domaine: RH, libelle: 'Enregistrer un départ', description: 'Passer un employé en « ancien employé »' },
  { cle: 'rh-parametrer', domaine: RH, libelle: 'Paramétrer le recrutement', description: 'Choisir comment les candidatures acceptées sur Discord remplissent les fiches' },
  // Comptabilité : chaque domaine a une lecture (« voir ») et une écriture qui l'entraîne
  { cle: 'factures-voir', domaine: 'Comptabilité', libelle: 'Consulter les factures', description: 'Voir les factures, quelle que soit leur provenance, et leur aperçu imprimable' },
  { cle: 'factures', domaine: 'Comptabilité', libelle: 'Gérer les factures', description: 'Saisir, modifier, annuler et supprimer des factures, créer un avoir', requiert: ['factures-voir'] },
  { cle: 'paie-voir', domaine: 'Comptabilité', libelle: 'Consulter la paie', description: 'Voir le salaire de base et les primes par palier de chaque grade, et utiliser le simulateur' },
  { cle: 'paie', domaine: 'Comptabilité', libelle: 'Gérer la paie', description: 'Modifier le salaire de base et les primes par palier de quota (run, facture) par grade', requiert: ['paie-voir'] },
  { cle: 'compta-voir', domaine: 'Comptabilité', libelle: 'Consulter la DOT', description: 'Voir le relevé Tablettes, la déclaration de chaque semaine et le graphique' },
  { cle: 'compta', domaine: 'Comptabilité', libelle: 'Gérer la DOT', description: 'Importer le relevé, saisir mouvements, primes et solde bancaire, valider une déclaration, publier les fiches de paie', requiert: ['compta-voir'] },
  { cle: 'contrats-voir', domaine: 'Comptabilité', libelle: 'Consulter les contrats', description: 'Voir les contrats passés avec d’autres entreprises, leurs échéances et leurs bénéficiaires' },
  { cle: 'contrats', domaine: 'Comptabilité', libelle: 'Gérer les contrats', description: 'Créer, modifier, facturer et terminer les contrats, donner l’accès au client', requiert: ['contrats-voir'] },
  // indépendante de « contrats » : la Direction coche les deux pour voir aussi la page Bénéficiaires
  { cle: 'contrats-beneficiaires', domaine: 'Comptabilité', libelle: 'Consulter les bénéficiaires', description: 'Vérifier qui est couvert par un contrat client en cours, sans voir les montants ni gérer les contrats' },
  { cle: 'agenda-types', domaine: 'Agenda', libelle: 'Gérer les types d’événements', description: 'Créer, renommer, colorer et supprimer les types qui classent les événements de l’agenda' },
  // Site : module « vitrine » (site.json) — services, étiquettes et postes ouverts de la page d'accueil, chacun sa paire consulter / gérer
  { cle: 'vitrine-voir', domaine: 'Site', libelle: 'Consulter la vitrine', description: 'Voir le catalogue de services affiché sur l’accueil et ses étiquettes' },
  { cle: 'vitrine', domaine: 'Site', libelle: 'Gérer la vitrine', description: 'Créer, modifier, ordonner ou supprimer un service ou une étiquette', requiert: ['vitrine-voir'] },
  { cle: 'postes-voir', domaine: 'Site', libelle: 'Consulter les postes ouverts', description: 'Voir les postes affichés dans la section Recrutement de l’accueil' },
  { cle: 'postes', domaine: 'Site', libelle: 'Gérer les postes ouverts', description: 'Créer, modifier ou supprimer un poste ouvert', requiert: ['postes-voir'] },
  // Site : module « avis » (site.json) — file de modération des avis déposés sur la vitrine
  { cle: 'avis-voir', domaine: 'Site', libelle: 'Consulter les avis', description: 'Voir la file de modération des avis déposés sur la vitrine' },
  { cle: 'avis', domaine: 'Site', libelle: 'Modérer les avis', description: 'Publier, refuser, épingler ou supprimer un avis', requiert: ['avis-voir'] },
  // Site : module « demandes » (site.json) — boîte des demandes de contact et de devis reçues du site
  { cle: 'demandes-voir', domaine: 'Site', libelle: 'Consulter les demandes', description: 'Voir la boîte des demandes de contact et de devis reçues du site' },
  { cle: 'demandes-gerer', domaine: 'Site', libelle: 'Traiter les demandes', description: 'Prendre en charge, refuser, annoter une demande ; la convertir en contrat exige aussi la gestion des contrats', requiert: ['demandes-voir'] },
];

// celles d'un module éteint (site.json) ne sont pas déclarées : absentes de la page Grades, refusées par les routes
export const permissions: Permission[] = declarees.filter(p => !permissionsInactives.has(p.cle));
