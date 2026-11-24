// SOCLE — vérification Discord légère, pour les pages publiques qui doivent savoir QUI agit (signer une facture, déposer
// une candidature) sans créer de compte ni de session : l'identité vient de Discord (OAuth, scope « identify » seul), jamais
// d'une saisie libre. Un seul cookie signé de 15 minutes (`discord_leger`, sous /api) : connecté sur une page, on l'est
// sur les autres. Une adresse de retour de plus à déclarer dans le portail Discord : <BASE_URL>/api/discord/callback.
// En dev (DEV_LOGIN=1), « Connecter mon Discord » pose directement une identité fictive, avec les mêmes verrous que la
// connexion de dev (requête arrivée directement sur la machine, jamais en production). Utilisation côté site :
// `identiteVerifiee(req)` (routes) et `/api/discord/connecter?next=/chemin` (lien de connexion).
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { ID_DISCORD } from '../discord.js';

const DISCORD_API = 'https://discord.com/api/v10';
const PREFIXE = '/api/discord';
const REDIRECT_URI = `${config.baseUrl}${PREFIXE}/callback`;
const DUREE_MS = 900_000;   // 15 minutes : le temps de relire et de valider
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax' as const, secure: config.baseUrl.startsWith('https'), path: '/api' };
const COOKIE_NOM = 'discord_leger', COOKIE_STATE = 'discord_leger_state', COOKIE_RETOUR = 'discord_leger_next';
const DEV_ID = '900000000000000801', DEV_PSEUDO = 'dev-discord';

export type IdentiteVerifiee = { id: string; pseudo: string };

function lireCookie(cookieHeader: string | undefined, nom: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === nom) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// même critère que la connexion de dev de routes/auth.ts : arrivée directement sur la machine, sans proxy
const requeteLocale = (req: Request) =>
  /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '') && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host'];

// chemin du site seulement, jamais une autre origine (« //hote » et la barre oblique inverse en seraient une)
const RE_RETOUR = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]{0,300}$/;
export const lireRetour = (v: unknown): string => (typeof v === 'string' && RE_RETOUR.test(v) ? v : '/');

const signer = (valeur: string) => crypto.createHmac('sha256', config.sessionSecret).update(valeur).digest('hex');

// valeur du cookie : « id.expiration.pseudo.signature » (le pseudo, qui peut contenir des points, vient en dernier)
export function valeurCookieIdentite(id: string, pseudo: string, expire = Date.now() + DUREE_MS): string {
  const valeur = `${id}.${expire}.${pseudo}`;
  return `${valeur}.${signer(valeur)}`;
}
function poserIdentiteVerifiee(res: Response, id: string, pseudo: string) {
  res.cookie(COOKIE_NOM, valeurCookieIdentite(id, pseudo), { ...COOKIE_OPTS, maxAge: DUREE_MS });
}

export function lireIdentiteVerifiee(cookieHeader: string | undefined): IdentiteVerifiee | null {
  const brut = lireCookie(cookieHeader, COOKIE_NOM);
  if (!brut) return null;
  const i = brut.lastIndexOf('.');
  const valeur = brut.slice(0, i), signature = brut.slice(i + 1);
  const attendue = Buffer.from(signer(valeur)), recue = Buffer.from(signature);
  if (attendue.length !== recue.length || !crypto.timingSafeEqual(attendue, recue)) return null;
  const [id, expireStr, ...reste] = valeur.split('.');
  const expire = Number(expireStr);
  if (!ID_DISCORD.test(id) || !Number.isFinite(expire) || Date.now() > expire) return null;
  return { id, pseudo: reste.join('.') };
}
export const identiteVerifiee = (req: Request): IdentiteVerifiee | null => lireIdentiteVerifiee(req.headers.cookie);

const versRetour = (retour: string, etat: 'ok' | 'erreur') => `${config.baseUrl}${retour}${retour.includes('?') ? '&' : '?'}discord=${etat}`;

export const discordLeger = Router();

discordLeger.get(`${PREFIXE}/connecter`, (req, res) => {
  const retour = lireRetour(req.query.next);
  if (config.devLogin) {
    if (!requeteLocale(req)) { res.status(403).send('Connexion de dev réservée à la machine locale.'); return; }
    poserIdentiteVerifiee(res, DEV_ID, DEV_PSEUDO);
    res.redirect(versRetour(retour, 'ok'));
    return;
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(COOKIE_STATE, state, { ...COOKIE_OPTS, maxAge: 600_000 });
  res.cookie(COOKIE_RETOUR, retour, { ...COOKIE_OPTS, maxAge: 600_000 });
  const url = new URL(`${DISCORD_API}/oauth2/authorize`);
  url.search = new URLSearchParams({ client_id: config.discord.clientId, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'identify', state, prompt: 'none' }).toString();
  res.redirect(url.toString());
});

discordLeger.get(`${PREFIXE}/callback`, async (req, res) => {
  const retour = lireRetour(lireCookie(req.headers.cookie, COOKIE_RETOUR));
  res.clearCookie(COOKIE_RETOUR, COOKIE_OPTS);
  try {
    const { code, state } = req.query;
    const stateCookie = lireCookie(req.headers.cookie, COOKIE_STATE);
    res.clearCookie(COOKIE_STATE, COOKIE_OPTS);
    if (typeof code !== 'string' || typeof state !== 'string' || !state || state !== stateCookie) { res.redirect(versRetour(retour, 'erreur')); return; }
    const delai = () => AbortSignal.timeout(10000);
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: delai(),
      body: new URLSearchParams({ client_id: config.discord.clientId, client_secret: config.discord.clientSecret, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    });
    if (!tokenRes.ok) { res.redirect(versRetour(retour, 'erreur')); return; }
    const { access_token } = await tokenRes.json() as { access_token: string };
    const userRes = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${access_token}` }, signal: delai() });
    if (!userRes.ok) { res.redirect(versRetour(retour, 'erreur')); return; }
    const user = await userRes.json() as { id: string; username: string };
    if (!ID_DISCORD.test(user.id)) { res.redirect(versRetour(retour, 'erreur')); return; }
    poserIdentiteVerifiee(res, user.id, user.username);
    res.redirect(versRetour(retour, 'ok'));
  } catch (e) { console.error('[discord léger] vérification', e); res.redirect(versRetour(retour, 'erreur')); }
});

// qui est connecté (pour afficher « Connecté en tant que … ») ; jamais l'identité d'un autre
discordLeger.get(`${PREFIXE}/moi`, (req, res) => { res.json({ discord: identiteVerifiee(req) }); });
discordLeger.post(`${PREFIXE}/oublier`, (_req, res) => { res.clearCookie(COOKIE_NOM, COOKIE_OPTS); res.json({ ok: true }); });
