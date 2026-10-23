// SOCLE — connexion Discord (OAuth2), connexion de dev locale et déconnexion.
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { tousLesGrades } from '../droits.js';
import { gradeALaConnexion } from '../grade-connexion.js';
import { gradesImposes } from '../grades-imposes.js';

const DISCORD_API = 'https://discord.com/api/v10';
const REDIRECT_URI = `${config.baseUrl}/auth/discord/callback`;
const SCOPES = 'identify guilds guilds.members.read';   // guilds : savoir si l'utilisateur est propriétaire du serveur
// pages où mènent la connexion (noms imposés aux sites : voir CLAUDE.md)
export const PAGE_ACCUEIL = '/gestion/accueil.html', PAGE_ATTENTE = '/gestion/attente.html', PAGE_CONNEXION = '/gestion/';

type DiscordUser = { id: string; username: string; global_name: string | null; avatar: string | null };
type GuildMember = { nick: string | null; roles: string[] };
type UserGuild = { id: string; owner: boolean };

export const auth = Router();

// nouvelle session à chaque connexion (évite la fixation de session), puis rattachement du compte
const ouvrirSession = (req: Request, compteId: number) => new Promise<void>((ok, ko) =>
  req.session.regenerate(err => { if (err) ko(err); else { req.session.compteId = compteId; ok(); } }));

// Connexion de dev : seulement pour une requête arrivée directement sur la machine (adresse localhost, sans passer par
// un proxy). Derrière nginx, le Host est le domaine et nginx ajoute X-Forwarded-For : refusée même si DEV_LOGIN était
// activé par erreur en production.
const requeteLocale = (req: Request) =>
  /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '') && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host'];

auth.get('/auth/discord', async (req, res) => {
  if (config.devLogin) {
    if (!requeteLocale(req)) { res.status(403).send('Connexion de dev réservée à la machine locale.'); return; }
    // dev : ?compte=<ID Discord> ouvre la session d'un compte existant, pour essayer chaque niveau d'accès
    const autre = typeof req.query.compte === 'string' ? await prisma.compte.findUnique({ where: { discordId: req.query.compte } }) : null;
    if (autre) {
      await ouvrirSession(req, autre.id);
      res.redirect(autre.statut === 'valide' ? PAGE_ACCUEIL : PAGE_ATTENTE);
      return;
    }
    const c = await prisma.compte.upsert({
      where: { discordId: config.devDiscordId },
      create: { discordId: config.devDiscordId, pseudo: 'dev', nom: 'Dev local', proprietaire: true, statut: 'valide', valideLe: new Date(), connecteLe: new Date() },
      update: { proprietaire: true, connecteLe: new Date() },
    });
    await ouvrirSession(req, c.id);
    res.redirect(PAGE_ACCUEIL);
    return;
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const url = new URL(`${DISCORD_API}/oauth2/authorize`);
  url.search = new URLSearchParams({ client_id: config.discord.clientId, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES, state, prompt: 'none' }).toString();
  res.redirect(url.toString());
});

// Comptes encore marqués propriétaires alors qu'un autre l'est devenu (serveur transféré) : plus de permissions
// d'office, et un grade sans rôle Discord (qu'il a pu s'attribuer lui-même) est retiré. Un grade lié à un rôle est
// gardé, revérifié à leur prochaine connexion.
async function retirerProprietaires(saufDiscordId: string) {
  const anciens = await prisma.compte.findMany({ where: { proprietaire: true, discordId: { not: saufDiscordId } }, select: { id: true, gradeCle: true } });
  for (const a of anciens) {
    const lie = !!tousLesGrades().find(g => g.cle === a.gradeCle)?.roleDiscordId;
    await prisma.compte.update({ where: { id: a.id }, data: { proprietaire: false, ...(!lie && { gradeCle: null }) } });
  }
}

auth.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    // state obligatoire : sans connexion lancée depuis ce navigateur (rien en session), un retour forgé est refusé
    if (error || typeof code !== 'string' || typeof state !== 'string' || !state || state !== req.session.oauthState) { res.redirect(`${PAGE_CONNEXION}?erreur=oauth`); return; }
    delete req.session.oauthState;

    // 1. code → jeton (10 s au plus par appel : un Discord qui ne répond pas ne laisse pas la connexion pendue)
    const delai = () => AbortSignal.timeout(10000);
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.discord.clientId, client_secret: config.discord.clientSecret, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
      signal: delai(),
    });
    if (!tokenRes.ok) { res.redirect(`${PAGE_CONNEXION}?erreur=jeton`); return; }
    const { access_token } = await tokenRes.json() as { access_token: string };
    const discord = (path: string) => fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bearer ${access_token}` }, signal: delai() });

    // 2. identité, appartenance au serveur (+ rôles), propriété du serveur. Une réponse en erreur de Discord (limite,
    // panne) interrompt la connexion sans toucher au compte : la lire comme « pas propriétaire » ou « pas membre »
    // retirerait ses droits à quelqu'un qui les a.
    const [userRes, memberRes, guildsRes] = [await discord('/users/@me'), await discord(`/users/@me/guilds/${config.discord.guildId}/member`), await discord('/users/@me/guilds')];
    if (memberRes.status === 404) { res.redirect(`${PAGE_CONNEXION}?erreur=pas-membre`); return; }
    if (!userRes.ok || !memberRes.ok || !guildsRes.ok) { res.redirect(`${PAGE_CONNEXION}?erreur=discord`); return; }
    const user = await userRes.json() as DiscordUser, guildMember = await memberRes.json() as GuildMember, guilds = await guildsRes.json() as UserGuild[];
    // formes attendues : ces valeurs servent à construire l'adresse de l'avatar, insérée dans les pages
    if (!/^\d{5,32}$/.test(String(user.id)) || !Array.isArray(guildMember.roles) || !Array.isArray(guilds)) { res.redirect(`${PAGE_CONNEXION}?erreur=discord`); return; }
    if (user.avatar && !/^(a_)?[0-9a-f]{32}$/.test(user.avatar)) user.avatar = null;
    const proprietaire = guilds.some(g => g.id === config.discord.guildId && g.owner === true);
    // rôles gardés sur le compte (req.compte.rolesDiscord) : l'entreprise peut s'en servir (visibilité selon le rôle…).
    // Photo de la dernière connexion Discord, pas de l'instant : un rôle retiré sur Discord compte jusqu'à la suivante.
    const rolesDiscord = [...new Set(guildMember.roles.map(String).filter(r => /^\d{15,21}$/.test(r)))].slice(0, 250);

    // 3. grade : règles dans grade-connexion.ts (rôle Discord porté, grade attribué à la main, ancien propriétaire)
    const existant = await prisma.compte.findUnique({ where: { discordId: user.id } });
    const { grade: gradeDiscord, parRole: gradeParRole } = gradeALaConnexion(tousLesGrades(), guildMember.roles, existant?.gradeCle, !!existant?.proprietaire && !proprietaire);
    // grade imposé par l'entreprise (fiche RH…) : il l'emporte ; il ne valide pas le compte à lui seul
    const grade = (await gradesImposes([user.id])).get(user.id)?.grade ?? gradeDiscord;
    // nouveau propriétaire : l'ancien perd aussitôt ce que la propriété lui donnait, sans attendre sa reconnexion
    if (proprietaire) await retirerProprietaires(user.id);

    // 4. statut : nouveau compte en attente de validation ; validé d'office pour le propriétaire, et pour qui reçoit un
    // grade par son rôle Discord (l'entreprise l'a déjà reconnu sur Discord). Un compte refusé le reste.
    const valideOffice = proprietaire || (!!gradeParRole && existant?.statut !== 'refuse');
    const c = await prisma.compte.upsert({
      where: { discordId: user.id },
      create: {
        discordId: user.id, pseudo: user.username, avatar: user.avatar,
        nom: guildMember.nick || user.global_name || user.username,
        gradeCle: grade, proprietaire, rolesDiscord, quitteLe: null, connecteLe: new Date(),
        statut: valideOffice ? 'valide' : 'attente', valideLe: valideOffice ? new Date() : null,
      },
      update: {
        pseudo: user.username, avatar: user.avatar, proprietaire, rolesDiscord, quitteLe: null, gradeCle: grade, connecteLe: new Date(),
        ...(valideOffice && existant?.statut !== 'valide' && { statut: 'valide' as const, valideLe: new Date() }),
      },
    });

    await ouvrirSession(req, c.id);
    res.redirect(c.statut === 'valide' ? PAGE_ACCUEIL : PAGE_ATTENTE);
  } catch (e) {
    console.error(e);
    res.redirect(`${PAGE_CONNEXION}?erreur=serveur`);
  }
});

// « Se connecter IG » : SSO FolkOS (ordinateur en jeu), si configuré. Le broker de l'opérateur ouvre cette adresse avec
// ?folkos_ticket=… (usage unique) ; seule la réponse du validateur (/sso/verify) fait foi, jamais le ticket lui-même.
// Le compte est retrouvé par son ID Discord : il doit exister et être validé. La connexion IG ne revérifie ni
// l'appartenance au serveur Discord ni les rôles (FolkOS ne les connaît pas) : elle n'est acceptée qu'après une
// connexion Discord de moins de 30 jours, pour qu'un départ du serveur Discord finisse par couper aussi l'accès en jeu.
const DISCORD_RECENT_MS = 30 * 24 * 3600 * 1000;
auth.get('/auth/folkos', async (req, res) => {
  const sso = config.folkos.sso;
  const echec = (code: string) => res.redirect(`${PAGE_CONNEXION}?erreur=folkos-${code}`);
  if (!sso) { echec('config'); return; }
  const ticket = req.query.folkos_ticket;
  if (typeof ticket !== 'string' || !ticket || ticket.length > 2048) { echec('ticket'); return; }
  let identite: { discord_id?: unknown } | undefined;
  try {
    const r = await fetch(`${sso.base}/sso/verify`, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: sso.clientId, client_secret: sso.clientSecret, token: ticket }),
    });
    const data = await r.json().catch(() => null) as { valid?: unknown; identity?: { discord_id?: unknown } } | null;
    if (!r.ok || data?.valid !== true || !data.identity) { echec('ticket'); return; }
    identite = data.identity;
  } catch { echec('reseau'); return; }
  // jamais `sub` (sa forme change selon le chemin d'entrée) : l'ID Discord, en texte
  const discordId = identite.discord_id == null ? '' : String(identite.discord_id);
  if (!/^\d{5,32}$/.test(discordId)) { echec('inconnu'); return; }
  try {
    const c = await prisma.compte.findUnique({ where: { discordId } });
    if (!c) { echec('inconnu'); return; }
    // parti du serveur Discord depuis (vu par le bot, synchro-discord.ts) : refusé aussi, sans attendre les 30 jours
    if (!c.connecteLe || c.quitteLe || Date.now() - c.connecteLe.getTime() > DISCORD_RECENT_MS) { echec('discord'); return; }
    await ouvrirSession(req, c.id);
    if (c.statut !== 'valide') { res.redirect(PAGE_ATTENTE); return; }
    // ?next= : un chemin du site seulement (ni //autre.site, ni /\autre.site)
    const next = typeof req.query.next === 'string' ? req.query.next : '';
    res.redirect(/^\/(?![/\\])[^\s\\]*$/.test(next) ? next : PAGE_ACCUEIL);
  } catch (e) {
    console.error(e);
    echec('serveur');
  }
});

auth.post('/auth/logout', (req, res) => {
  // mêmes attributs qu'à la pose : dans l'iframe FolkOS, un effacement en SameSite=Lax serait ignoré
  req.session.destroy(() => res.clearCookie('site.sid', { httpOnly: true, ...config.cookie }).json({ ok: true }));
});
