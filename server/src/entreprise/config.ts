// ENTREPRISE — réglages de ce site lus dans l'environnement (.env, dernière section de .env.example). Contrôlés au
// démarrage avec les aides du socle : un réglage présent mais mal formé arrête le serveur avec un message clair ; un
// réglage absent désactive seulement la fonction concernée.
import { fail } from '../socle/config.js';

const env = process.env;

// clé du bot de ventes (en-tête Authorization: Bearer …) ; vide : réception des ventes désactivée
const statsBotSecret = (env.STATS_BOT_SECRET || '').trim();
if (statsBotSecret && statsBotSecret.length < 16) fail('STATS_BOT_SECRET dans .env : 16 caractères au moins (openssl rand -hex 32)');

// Les liens (Google Sheets…) ne viennent pas du .env : ils se règlent dans l'onglet Paramètres (parametres.ts).
export const configEntreprise = { statsBotSecret };
