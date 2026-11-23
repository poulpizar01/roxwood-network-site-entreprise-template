// ENTREPRISE — permissions propres à ce site, cochées par grade dans la gestion (page Grades).
// Clé : minuscules, chiffres, tirets, stable dans le temps (elle est enregistrée dans les grades) ; « comptes »,
// « grades » et « parametres » appartiennent au socle. Fichier sans import (le socle le lit avant de charger les routes).
// Libellé : lu sous le titre de son domaine dans la page Grades (« Ressources humaines », « Comptabilité »…) : il ne
// répète pas le domaine, mais se comprend seul (« Ajouter un employé », pas « Ajouter »).
import type { Permission } from '../socle/contrat.js';

const RH = 'Ressources humaines';

export const permissions: Permission[] = [
  // Ressources humaines : chaque permission rh-* suppose rh-voir (vérifié par les routes)
  { cle: 'rh-voir', domaine: RH, libelle: 'Consulter les fiches', description: 'Voir les fiches employés, l’effectif et les candidatures reçues' },
  { cle: 'rh-sensible-voir', domaine: RH, libelle: 'Consulter le téléphone et le RIB', description: 'Voir le téléphone et le RIB des employés, sans pouvoir les modifier' },
  { cle: 'rh-sensible', domaine: RH, libelle: 'Modifier le téléphone et le RIB', description: 'Changer le téléphone et le RIB d’un employé', requiert: ['rh-sensible-voir'] },
  { cle: 'rh-modifier', domaine: RH, libelle: 'Modifier une fiche', description: 'Changer l’identité, le grade ou les dates d’un employé' },
  // la page Sanctions se consulte sans pouvoir sanctionner (et sans consulter les fiches : rh-voir à part)
  { cle: 'rh-sanctions-voir', domaine: RH, libelle: 'Consulter les sanctions', description: 'Voir les sanctions de tous les employés (page Sanctions)' },
  { cle: 'rh-sanctionner', domaine: RH, libelle: 'Gérer les sanctions', description: 'Ajouter ou retirer une sanction sur une fiche employé', requiert: ['rh-sanctions-voir'] },
  { cle: 'rh-creer', domaine: RH, libelle: 'Ajouter un employé', description: 'Créer une fiche ; retraiter ou écarter une candidature reçue' },
  { cle: 'rh-reactiver', domaine: RH, libelle: 'Réintégrer un ancien employé', description: 'Remettre un ancien employé dans l’effectif actif' },
  { cle: 'rh-desactiver', domaine: RH, libelle: 'Enregistrer un départ', description: 'Passer un employé en « ancien employé »' },
  { cle: 'rh-parametrer', domaine: RH, libelle: 'Paramétrer le recrutement', description: 'Choisir comment les candidatures acceptées sur Discord remplissent les fiches' },
  { cle: 'factures', domaine: 'Comptabilité', libelle: 'Gérer les factures', description: 'Consulter et saisir les factures, quelle que soit leur provenance' },
  { cle: 'paie', domaine: 'Comptabilité', libelle: 'Gérer la paie', description: 'Salaire de base et primes par palier de quota (run, facture) par grade, et le simulateur' },
  { cle: 'compta', domaine: 'Comptabilité', libelle: 'Gérer la DOT', description: 'Relevé Tablettes et résumé de la déclaration DOT' },
  { cle: 'contrats', domaine: 'Comptabilité', libelle: 'Gérer les contrats', description: 'Créer, modifier, facturer et terminer les contrats passés avec d’autres entreprises' },
  // indépendante de « contrats » : la Direction coche les deux pour voir aussi la page Bénéficiaires
  { cle: 'contrats-beneficiaires', domaine: 'Comptabilité', libelle: 'Consulter les bénéficiaires', description: 'Vérifier qui est couvert par un contrat client en cours, sans voir les montants ni gérer les contrats' },
  { cle: 'agenda-types', domaine: 'Agenda', libelle: 'Gérer les types d’événements', description: 'Créer, renommer, colorer et supprimer les types qui classent les événements de l’agenda' },
];
