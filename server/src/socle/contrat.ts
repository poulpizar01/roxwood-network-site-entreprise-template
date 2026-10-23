// SOCLE — contrat entre le socle et le code propre à l'entreprise (src/entreprise/).
// Le socle ne connaît l'entreprise que par deux fichiers : permissions.ts (ses permissions) et index.ts (l'objet
// Entreprise ci-dessous : niveau d'accès de ses pages, ses routes, ce qu'elle fait des événements du bot…).
// Tout le reste de src/entreprise/ est libre.
import type { RequestHandler, Router } from 'express';
import type { Prisma } from '../generated/prisma/client.js';

// Permission déclarée par l'entreprise (src/entreprise/permissions.ts), cochée par grade dans la gestion
// (ex. { cle: 'stocks', libelle: 'Gérer les stocks' }). Clé : minuscules, chiffres, tirets ; « comptes », « grades » et
// « parametres » sont réservées au socle. Fichier à part et sans import : le socle le lit avant de charger les routes.
// domaine : titre sous lequel la page Grades range la permission (« Ressources humaines »…) ; sans domaine : « Autres ».
// Dans un domaine, l'ordre de déclaration est l'ordre affiché : consulter, puis créer et modifier, puis retirer, puis
// régler (l'ordre dans lequel on accorde des droits). Le libellé se comprend seul, sans répéter le domaine.
export type Permission = { cle: string; libelle: string; description?: string; domaine?: string };

// Niveau d'accès d'une page de gestion/ : 'public' (sans connexion), 'connecte' (compte même en attente),
// 'valide' (compte validé), ou une clé de permission. Une page non déclarée exige un compte validé.
export type NiveauPage = 'public' | 'connecte' | 'valide' | string;

// Événement reçu du bot Discord entreprise (corps du webhook, signature déjà vérifiée, serveur Discord contrôlé)
export type EvenementBot = { guildId: string; eventType: string; payload: unknown; sentAt: string };

// Réglage de la page Paramètres (socle/parametres.ts), rangé dans un groupe affiché sous son titre.
//   lien : https, montré tel quel (public : servi à tous par GET /api/liens, pour data-lien des pages publiques) ;
//   origine : https, appelée PAR LE SERVEUR (service relayé…) : réduite à son origine, jamais le serveur lui-même ni
//     le réseau interne ; texte ; entier (min, max, defaut obligatoires) ; id-discord ; ids-discord (séparés par des
//     espaces).
// lire / afficher : saisie propre au site (ex. lien Google Sheets → identifiant) : lire renvoie la valeur à enregistrer
// ou { erreur }, afficher la valeur montrée dans le formulaire.
// discord (id-discord, ids-discord) : ce que désigne l'identifiant (rôle, salon, catégorie) ; avec le bot relié au site,
// la page Paramètres le fait choisir par son nom (GET /api/parametres/discord) au lieu de le faire recopier.
// onglet (groupe) : nom de l'onglet de la page Paramètres où ranger le groupe ; sans onglet : « Réglages ».
export type TypeParametre = 'lien' | 'origine' | 'texte' | 'entier' | 'id-discord' | 'ids-discord';
export type DefinitionParametre = {
  cle: string; type: TypeParametre; libelle: string; aide: string; public?: boolean;
  min?: number; max?: number; defaut?: number;
  lire?: (saisie: string) => string | { erreur: string };
  afficher?: (valeur: string) => string;
  discord?: 'role' | 'salon' | 'categorie';
};
export type GroupeParametres = { titre: string; intro?: string; onglet?: string; reglages: DefinitionParametre[] };

export type Entreprise = {
  // nom de la page de gestion/ (sans .html) → niveau
  pages: Record<string, NiveauPage>;
  // routes Express, sous /api/… (la session n'est ouverte que là) ; chacune protégée par une garde de socle/http.ts
  routes: Router[];
  // traitement d'un événement du bot, par type (`absence.updated`, `order.updated`, `monitoring.sale`, `custom`…).
  // Une erreur levée → réponse 500, le bot réessaie plus tard ; un type sans traitement est accepté et ignoré.
  webhooks?: Record<string, (e: EvenementBot) => Promise<void>>;
  // avant la suppression d'un compte (par lui-même ou par la gestion), dans la même transaction : effacer ou anonymiser
  // ce qui lui appartient dans les tables de l'entreprise
  avantSuppressionCompte?: (compteId: number, tx: Prisma.TransactionClient) => Promise<void>;
  // avant la suppression d'un grade, dans la même transaction : nettoyer les données liées à sa clé
  avantSuppressionGrade?: (gradeCle: string, tx: Prisma.TransactionClient) => Promise<void>;
  // grade que l'entreprise impose à des comptes, par ID Discord (ex. celui de leur fiche RH active) : il l'emporte sur
  // le rôle Discord et l'attribution à la main, et ne se change plus dans Comptes. raison : affichée à la place du
  // choix du grade (« Fiche RH »). Un ID absent de la réponse suit les règles du socle. Après un changement de son
  // côté, l'entreprise appelle actualiserGrades() (socle/grades-imposes.ts) pour l'appliquer sans attendre.
  gradesImposes?: (discordIds: string[]) => Promise<Map<string, { grade: string; raison: string }>>;
  // au démarrage, après le chargement du socle (tâches planifiées, caches…)
  demarrage?: () => Promise<void>;
  // origines https supplémentaires autorisées par la politique de sécurité : exception à justifier (voir CLAUDE.md),
  // à déclarer aussi dans confidentialite.html. frame : pages d'une autre origine affichées dans une iframe du site.
  csp?: { img?: string[]; connect?: string[]; frame?: string[] };
  // Hôtes annexes : un nom de domaine (ex. carte.monsite.fr) servi par ce même serveur, À PART du site — avant toute
  // session, tout cookie du site, toute limite et toute politique de sécurité du socle : le gestionnaire pose ses propres
  // en-têtes. Sert à relayer un service tiers sur un sous-domaine sans lui donner accès au site (le cookie de session,
  // lié au seul domaine de BASE_URL, n'y est jamais envoyé). Nom en minuscules, jamais celui de BASE_URL ; nginx doit y
  // renvoyer (docs/nginx.md).
  hotes?: Record<string, RequestHandler>;
  // réglages de la page Paramètres (socle/parametres.ts), par groupes ; clés lues avec parametre(), lienParametre()…
  parametres?: GroupeParametres[];
};
