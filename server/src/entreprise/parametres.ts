// ENTREPRISE — réglages de la page Paramètres (socle/parametres.ts : validation, enregistrement, routes, permission
// « parametres »). Ici seulement ce que ce site règle, et la lecture typée dont le reste du site a besoin.
//   - privés : lus par le serveur ou servis aux comptes validés (Google Sheets, registre, services, agenda) ;
//   - publics : liens des pages publiques (GET /api/liens, data-lien) ; un lien vide masque son bouton.
import type { GroupeParametres } from '../socle/contrat.js';
import { entierParametre, idsParametre, lienParametre, parametre } from '../socle/parametres.js';

// lien de partage Google Sheets (ou identifiant seul) → { id, gid }
export function lireLienSheet(valeur: string): { id: string; gid: string } | null {
  if (/^[A-Za-z0-9_-]{20,}$/.test(valeur)) return { id: valeur, gid: '0' };
  let u: URL;
  try { u = new URL(valeur); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
  const id = u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/)?.[1];
  if (!id) return null;
  return { id, gid: u.hash.match(/gid=(\d+)/)?.[1] ?? u.search.match(/[?&]gid=(\d+)/)?.[1] ?? '0' };
}
const lienSheet = (s: { id: string; gid: string }) => `https://docs.google.com/spreadsheets/d/${s.id}/edit#gid=${s.gid}`;

// Onglets de la page Paramètres : Liens, Annonces, Google Sheets, Discord (Apparence : propre à la page). Les aides parlent à la direction, pas à un
// administrateur : ni .env ni jargon ; un réglage Discord se choisit par son nom (discord).
export const PARAMETRES: GroupeParametres[] = [
  { onglet: 'Liens', titre: 'Espace de gestion', reglages: [
    { cle: 'registre_url', type: 'lien', libelle: 'Registre (intranet)', aide: 'Bouton « Registre » du menu. Vide : bouton masqué.' },
  ] },
  { onglet: 'Liens', titre: 'Site public', intro: 'Un lien vide masque son bouton.', reglages: [
    { cle: 'discord_entreprise', type: 'lien', public: true, libelle: 'Discord de l’entreprise', aide: 'Bouton « Rejoindre le Discord » de la page d’accueil et lien de la page Confidentialité.' },
    { cle: 'recrutement', type: 'lien', public: true, libelle: 'Formulaire de candidature', aide: 'Bouton « Postuler » de la page d’accueil.' },
  ] },
  { onglet: 'Annonces', titre: 'Annonces', reglages: [
    { cle: 'annonces_epinglees_max', type: 'entier', min: 1, max: 10, defaut: 3, libelle: 'Annonces épinglées au plus', aide: 'Nombre d’annonces gardées en tête de liste.' },
  ] },
  { onglet: 'Google Sheets', titre: 'Google Sheets de la direction', intro: 'Les ventes et locations de chaque employé, lues toutes les 5 minutes pour les primes.', reglages: [
    // enregistré sous la forme d'un lien complet vers l'onglet (identifiant du classeur + gid)
    { cle: 'sheet', type: 'texte', libelle: 'Lien de l’onglet du récapitulatif',
      aide: 'Ouvrez l’onglet dans Google Sheets et collez l’adresse de la barre du navigateur (elle finit par « gid=… »). Le classeur doit être partagé à « Tous les utilisateurs disposant du lien », en lecture.',
      lire: v => { const s = lireLienSheet(v); return s ? lienSheet(s) : { erreur: 'collez le lien du Google Sheets (https://docs.google.com/spreadsheets/d/…).' }; } },
  ] },
  // les prises et fins de service arrivent du bot (événement monitoring.duty, services.ts) : seule la clôture se règle
  { onglet: 'Discord', titre: 'Membres en service', intro: 'Le bot Discord de l’entreprise envoie au site chaque prise et fin de service lue en jeu : rien d’autre à régler que la clôture automatique.', reglages: [
    { cle: 'services_cloture_heures', type: 'entier', min: 1, max: 72, defaut: 12, libelle: 'Clôture automatique, en heures',
      aide: 'Un service resté ouvert (fin jamais annoncée) est fermé après ce délai ; une vraie fin annoncée plus tard la remplace.' },
  ] },
  // Agenda : qui voit, crée et modifie quoi se règle par grade (page Grades) ; ici, seulement où trouver les tickets
  { onglet: 'Discord', titre: 'Agenda : prévenir sur Discord', intro: 'Un événement créé pour quelqu’un d’autre lui est posté sur Discord : dans son ticket s’il en a un, sinon en message privé. Qui voit, crée et modifie les événements se règle dans la fiche de chaque grade.', reglages: [
    { cle: 'agenda_categories_tickets', type: 'ids-discord', discord: 'categorie', libelle: 'Catégories des tickets',
      aide: 'Les catégories où le bot de tickets les ouvre : le site y cherche le ticket de la personne (le bot doit pouvoir y voir les salons et écrire). Vide : message privé seulement.' },
  ] },
];

// ---- lecture typée, pour le reste du site ----
export { parametre };
export const lienRegle = lienParametre;
export const sheetRegle = (): { id: string; gid: string } | null => (parametre('sheet') ? lireLienSheet(parametre('sheet')) : null);
export const idsRegles = idsParametre;
export const entierRegle = entierParametre;
