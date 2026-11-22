// SOCLE — connexion « IG » (FolkOS) : fonctions pures de la route /auth/folkos, testées dans test/socle-folkos-sso.test.ts
// (docs/guide-dev-fbfa.md, B8). Aucun accès réseau ni base ici.
import { randomBytes } from 'node:crypto';

// Préfixe des cookies secrets posés avec le ticket : « fbfa_sso_<client_id>_ », client_id en minuscules, tout caractère
// hors a-z, 0-9 et - remplacé par - (B8.5).
export const prefixeNonces = (clientId: string): string =>
  `fbfa_sso_${clientId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}_`;

// Valeurs des cookies fbfa_sso_<client_id>_* de l'en-tête Cookie, à envoyer dans « nonces » : 16 à 128 caractères chacune,
// les 16 plus récentes (les dernières de l'en-tête). Ce sont des secrets : jamais journalisés, jamais renvoyés au navigateur.
export function noncesFolkos(enteteCookie: string | undefined, clientId: string): string[] {
  const prefixe = prefixeNonces(clientId);
  return String(enteteCookie ?? '').split(';').map(p => p.trim()).filter(p => p.startsWith(prefixe))
    .map(p => p.slice(p.indexOf('=') + 1)).filter(v => v.length >= 16 && v.length <= 128).slice(-16);
}

// Routes de passage où l'on n'arrive jamais après une connexion (API, connexion elle-même).
const TRANSITOIRES = /^\/(api|auth)(\/|\?|$)/;

// « next » (B8.7) : un chemin relatif du site seulement — jamais une URL absolue (redirection ouverte), ni « //hote »,
// ni espace ou « \ », court, hors routes de passage. Sinon `defaut`.
export function cheminSur(brut: unknown, defaut: string): string {
  const v = typeof brut === 'string' ? brut : '';
  const ok = v.startsWith('/') && !v.startsWith('//') && v.length <= 512 && !/[\\\s]/.test(v) && !TRANSITOIRES.test(v);
  return ok ? v : defaut;
}

// Adresse d'arrivée avec un paramètre jetable : le jeu sert volontiers une vieille version de la page d'arrivée (B8.7).
export function arrivee(chemin: string): string {
  return `${chemin}${chemin.includes('?') ? '&' : '?'}_sso=${randomBytes(4).toString('hex')}`;
}
