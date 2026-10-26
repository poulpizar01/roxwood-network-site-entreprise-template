// ENTREPRISE — permissions propres à ce site, cochées par grade dans la gestion (page Grades).
// Clé : minuscules, chiffres, tirets, stable dans le temps (elle est enregistrée dans les grades) ; « comptes »,
// « grades » et « parametres » appartiennent au socle. Fichier sans import (le socle le lit avant de charger les routes).
// Libellé : lu sous le titre de son domaine dans la page Grades (« Ressources humaines », « Comptabilité »…) : il ne
// répète pas le domaine, mais se comprend seul (« Ajouter un employé », pas « Ajouter »).
// requiert : la page Grades coche automatiquement la permission exigée, et le serveur la rajoute d'office si elle
// manque (socle/contrat.ts, socle/droits.ts) — inutile de la revérifier dans les routes.
import type { Permission } from '../socle/contrat.js';

const RH = 'Ressources humaines';
const COMPTA = 'Comptabilité';
const AGENDA = 'Agenda';

export const permissions: Permission[] = [
  // Ressources humaines : chaque permission qui touche une fiche exige rh-voir
  { cle: 'rh-voir', domaine: RH, libelle: 'Consulter les fiches', description: 'Voir les fiches employés, l’effectif et les candidatures reçues' },
  { cle: 'rh-sanctions-voir', domaine: RH, libelle: 'Consulter les sanctions', description: 'Voir les sanctions de tous les employés (page Sanctions)' },
  { cle: 'quota', domaine: RH, libelle: 'Consulter les quotas', description: 'Voir les quotas de run et de facturation, les classements et le suivi par semaine' },
  { cle: 'services', domaine: RH, libelle: 'Consulter les prises de service', description: 'Voir qui est en service et l’historique des prises de service' },
  { cle: 'services-corriger', domaine: RH, libelle: 'Corriger un service', description: 'Modifier un service ou ignorer une anomalie signalée', requiert: ['services'] },
  { cle: 'rh-sensible', domaine: RH, libelle: 'Consulter le téléphone et le RIB', description: 'Voir et modifier le téléphone et le RIB des employés', requiert: ['rh-voir'], sensible: true },
  { cle: 'rh-modifier', domaine: RH, libelle: 'Modifier une fiche', description: 'Changer l’identité, le grade ou les dates d’un employé', requiert: ['rh-voir'] },
  { cle: 'rh-sanctionner', domaine: RH, libelle: 'Gérer les sanctions', description: 'Ajouter ou retirer une sanction sur une fiche employé', requiert: ['rh-voir', 'rh-sanctions-voir'] },
  { cle: 'rh-creer', domaine: RH, libelle: 'Ajouter un employé', description: 'Créer une fiche ; retraiter ou écarter une candidature reçue', requiert: ['rh-voir'] },
  { cle: 'rh-reactiver', domaine: RH, libelle: 'Réintégrer un ancien employé', description: 'Remettre un ancien employé dans l’effectif actif', requiert: ['rh-voir'] },
  { cle: 'rh-desactiver', domaine: RH, libelle: 'Enregistrer un départ', description: 'Passer un employé en « ancien employé »', requiert: ['rh-voir'] },
  { cle: 'rh-parametrer', domaine: RH, libelle: 'Paramétrer le recrutement', description: 'Choisir comment les candidatures acceptées sur Discord remplissent les fiches', requiert: ['rh-voir'] },
  { cle: 'factures-voir', domaine: COMPTA, libelle: 'Consulter les factures', description: 'Voir les factures, quelle que soit leur provenance, et le détail des échéanciers' },
  { cle: 'factures', domaine: COMPTA, libelle: 'Gérer les factures', description: 'Saisir, modifier, supprimer et facturer, quelle que soit la provenance', requiert: ['factures-voir'] },
  { cle: 'paie', domaine: COMPTA, libelle: 'Gérer la paie', description: 'Salaire de base et primes par palier de quota (run, facture) par grade, et le simulateur' },
  { cle: 'compta', domaine: COMPTA, libelle: 'Gérer la DOT', description: 'Relevé Tablettes et résumé de la déclaration DOT' },
  { cle: 'contrats', domaine: COMPTA, libelle: 'Gérer les contrats', description: 'Créer, modifier, facturer et terminer les contrats passés avec d’autres entreprises' },
  // indépendante de « contrats » : la Direction coche les deux pour voir aussi la page Bénéficiaires
  { cle: 'contrats-beneficiaires', domaine: COMPTA, libelle: 'Consulter les bénéficiaires', description: 'Vérifier qui est couvert par un contrat client en cours, sans voir les montants ni gérer les contrats' },
  { cle: 'agenda-types', domaine: AGENDA, libelle: 'Gérer les types d’événements', description: 'Créer, renommer, colorer et supprimer les types qui classent les événements de l’agenda' },
  { cle: 'agenda-absences', domaine: AGENDA, libelle: 'Valider les absences', description: 'Approuver ou refuser une demande d’absence (jamais la sienne)' },
];
