// SOCLE — appels à l'API Discord avec le jeton du bot (DISCORD_BOT_TOKEN) : un seul endroit pour le délai, le jeton et
// la lecture des erreurs. Le socle s'en sert pour les rôles (roles-discord.ts) ; l'entreprise pour ce qu'elle fait
// avec le bot (lire un salon, poster dans un ticket…), en documentant les droits que cela demande au bot.
import { config } from './config.js';
import { appelSimule } from './discord-simulation.js';

const API = 'https://discord.com/api/v10';
export const ID_DISCORD = /^\d{15,22}$/;

// échec d'un appel : statut HTTP (0 : Discord injoignable ou réponse illisible) et message lisible par qui règle le
// site ; l'appelant peut le remplacer par un message propre à son cas (salon introuvable, droit manquant…). code : code
// d'erreur de Discord quand il en donne un (10007 : membre inconnu, 10004 : serveur inconnu…), qui distingue deux 404 ;
// reessayerApres : secondes à attendre après un 429.
export class ErreurDiscord extends Error {
  constructor(public statut: number, message: string, public code: number | null = null, public reessayerApres = 0) { super(message); }
}
const message = (statut: number) =>
  statut === 0 ? 'Discord ne répond pas pour le moment.'
  : statut === 401 ? 'Discord refuse le jeton du bot (DISCORD_BOT_TOKEN) : à corriger dans la configuration du site.'
  : statut === 403 ? 'Le bot n’a pas les droits nécessaires sur Discord.'
  : statut === 404 ? 'Introuvable sur Discord (identifiant erroné, ou bot absent du serveur).'
  : statut === 429 ? 'Discord demande de ralentir : réessayer dans un instant.'
  : `Discord a refusé la demande (HTTP ${statut}).`;

export const botDiscordConfigure = (): boolean => !!config.discord.botToken;

// chemin : construit par l'appelant à partir d'identifiants vérifiés (ID_DISCORD), jamais d'un texte saisi tel quel
export async function appelBot(methode: 'GET' | 'POST' | 'PATCH' | 'DELETE', chemin: string, corps?: unknown): Promise<unknown> {
  if (!config.discord.botToken) throw new ErreurDiscord(401, 'Bot Discord non configuré (DISCORD_BOT_TOKEN absent).');
  if (!chemin.startsWith('/') || chemin.includes('..')) throw new Error(`chemin Discord invalide : ${chemin}`);
  if (config.discord.simulation) return appelSimule(methode, chemin, corps);
  let r: Response;
  try {
    r = await fetch(API + chemin, {
      method: methode, signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bot ${config.discord.botToken}`, ...(corps !== undefined && { 'Content-Type': 'application/json' }) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
  } catch { throw new ErreurDiscord(0, message(0)); }
  if (!r.ok) {
    const detail = await r.json().catch(() => null) as { code?: unknown; retry_after?: unknown } | null;
    const code = Number.isInteger(detail?.code) ? Number(detail!.code) : null;
    console.error(`[discord] ${methode} ${chemin.replace(/\d{15,22}/g, ':id')} : HTTP ${r.status}${code ? ` (code ${code})` : ''}`);
    const retryAfter = r.headers.get('Retry-After');
    const secondes = Number(detail?.retry_after ?? retryAfter) || (retryAfter ? (Date.parse(retryAfter) - Date.now()) / 1000 : 0);
    throw new ErreurDiscord(r.status, message(r.status), code, Math.max(0, Math.min(secondes || 0, 3600)));
  }
  if (r.status === 204) return null;
  try { return await r.json(); } catch { throw new ErreurDiscord(0, message(0)); }
}

// message posté par le bot : le texte vient souvent d'un utilisateur (titre, descriptif) et Discord interpréterait
// « @everyone » ou une mention de rôle qu'il contiendrait. Seules les personnes de `mentionner` sont notifiées.
export async function posterMessage(salonId: string, contenu: { content?: string; embeds?: unknown[] }, mentionner: string[] = []): Promise<string | null> {
  if (!ID_DISCORD.test(salonId) || mentionner.some(id => !ID_DISCORD.test(id))) throw new Error('identifiant Discord invalide');
  const m = await appelBot('POST', `/channels/${salonId}/messages`, { ...contenu, allowed_mentions: { parse: [], users: mentionner } }) as { id?: unknown } | null;
  return m && ID_DISCORD.test(String(m.id)) ? String(m.id) : null;
}
