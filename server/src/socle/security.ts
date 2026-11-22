// SOCLE — en-têtes de sécurité (helmet). Les limites de requêtes sont dans limites.ts.
import crypto from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import helmet from 'helmet';
import { config, fail } from './config.js';
import { entreprise } from '../entreprise/index.js';

const https = config.baseUrl.startsWith('https');

// Ordinateur en jeu (FolkOS) : le navigateur FiveM vérifie chaque ancêtre de l'iframe — s'il en manque un, la page
// reste blanche sans message. Cadres FiveM fixes, plus l'origine FolkOS et ceux de FOLKOS_CADRES. Le SDK de l'opérateur
// (clavier, touche Échap) vient de FOLKOS_HOTE : origine de confiance pour les scripts, donc aussi pour le reste.
const { hote: folkos, cadres } = config.folkos;
const CADRES_FIVEM = ['https://cfx-nui-external-iframe', 'nui://game', 'nui:'];
const viaFolkos = folkos ? [folkos] : [];

// Jeton à usage unique (nonce) par réponse : seuls les <script> des pages du site, marqués par site.ts, s'exécutent.
// Un script injecté (contenu d'un utilisateur mal échappé, par exemple) n'a pas le jeton et reste inerte.
export const cspNonce: RequestHandler = (_req, res, next) => { res.locals.cspNonce = crypto.randomBytes(16).toString('base64'); next(); };

// origines supplémentaires déclarées par l'entreprise : https uniquement, origine seule (ni joker ni chemin). Seule
// exception, en développement (DEV_LOGIN, donc BASE_URL sur localhost) : un sous-domaine de localhost en http, pour
// voir en local ce qui s'affiche en cadre en production (ex. une carte servie sur son sous-domaine, entreprise.hotes)
const localDev = (u: URL) => config.devLogin && u.protocol === 'http:' && /(^|\.)localhost$/.test(u.hostname);
const origines = (liste: string[] | undefined): string[] => (liste ?? []).map(o => {
  let u: URL | null = null;
  try { u = new URL(o); } catch { /* signalé ci-dessous */ }
  if (!u || (u.protocol !== 'https:' && !localDev(u)) || u.origin !== o.replace(/\/$/, '')) fail(`entreprise.csp : une origine https:// sans chemin est attendue, pas « ${o} »`);
  return u.origin;
});

// Politique de contenu : uniquement ce que les pages chargent réellement. Scripts, feuilles de style et polices
// viennent du site lui-même (aucun hébergeur tiers : un hôte de scripts autorisé en entier servirait de contournement
// au jeton) ; images : le site, les avatars Discord, le stockage d'images en prod. Scripts en ligne : seulement avec
// le jeton de la réponse ; styles en ligne autorisés (attributs style des pages, sans risque d'exécution de code).
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`, ...viaFolkos],
      'style-src': ["'self'", "'unsafe-inline'", ...viaFolkos],
      'font-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:', 'https://cdn.discordapp.com', ...(config.storage.url ? [new URL(config.storage.url).origin] : []), ...origines(entreprise.csp?.img), ...viaFolkos],
      // https://external-iframe : l'API du jeu (/typing, /leave…), appelée par fbfa-game.js et par socle/folkos.js ; n'existe que dans FiveM
      'connect-src': ["'self'", ...origines(entreprise.csp?.connect), ...viaFolkos, ...(folkos ? ['https://external-iframe'] : [])],
      ...(entreprise.csp?.frame?.length && { 'frame-src': ["'self'", ...origines(entreprise.csp.frame)] }),
      'form-action': ["'self'"],
      'frame-ancestors': folkos ? ["'self'", folkos, ...CADRES_FIVEM, ...cadres] : ["'none'"],
      'upgrade-insecure-requests': https ? [] : null,   // en dev (http://localhost), pas de passage forcé en https
    },
  },
  strictTransportSecurity: https ? { maxAge: 31536000 } : false,
  // X-Frame-Options ne connaît pas de liste d'ancêtres : avec FolkOS, il contredirait frame-ancestors (page blanche)
  ...(folkos && { xFrameOptions: false }),
  // « same-origin » et non le « no-referrer » de helmet : avec no-referrer, un formulaire part avec « Origin: null » dans le
  // navigateur du jeu (docs/guide-dev-fbfa.md, B7), et le contrôle d'origine du serveur le refuserait
  referrerPolicy: { policy: 'same-origin' },
  crossOriginEmbedderPolicy: false,
});

// limites de requêtes : dans limites.ts (importable par les routes de l'entreprise) ; réexportées pour les sites qui
// les importaient d'ici
export { limiter, limits, parCompte } from './limites.js';
