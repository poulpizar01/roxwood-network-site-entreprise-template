// SOCLE — salons et catégories du serveur Discord de l'entreprise, lus sur Discord pour que la page Paramètres les
// propose par leur nom (même principe que roles-discord.ts). Exige le jeton d'un bot présent sur le serveur
// (DISCORD_BOT_TOKEN) ; Discord ne renvoie que les salons que le bot peut voir. Sans jeton : listes vides.
import { config } from './config.js';
import { appelBot, ErreurDiscord } from './discord.js';
import { RolesIndisponibles } from './roles-discord.js';

export type SalonDiscord = { id: string; nom: string; categorie: string | null; position: number };
export type CategorieDiscord = { id: string; nom: string; position: number };

const DUREE_MS = 5 * 60_000;   // les salons changent rarement ; Discord limite les appels
let cache: { salons: SalonDiscord[]; categories: CategorieDiscord[]; le: number } | null = null;
// types Discord : 0 texte, 5 diffusion, 15 forum ; 4 catégorie
const TEXTE = new Set([0, 5, 15]), CATEGORIE = 4;

export async function salonsDiscord(): Promise<{ salons: SalonDiscord[]; categories: CategorieDiscord[] }> {
  if (!config.discord.botToken) return { salons: [], categories: [] };
  if (cache && Date.now() - cache.le < DUREE_MS) return cache;
  let brut: unknown;
  try { brut = await appelBot('GET', `/guilds/${config.discord.guildId}/channels`); }
  catch (e) {
    const statut = e instanceof ErreurDiscord ? e.statut : 0;
    throw new RolesIndisponibles(statut === 401 ? 'Discord refuse le jeton du bot.' : statut === 403 || statut === 404 ? 'Le bot n’est pas sur le serveur Discord de l’entreprise.' : 'Discord ne répond pas pour le moment.');
  }
  const liste = (Array.isArray(brut) ? brut : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && /^\d{5,32}$/.test(String(x.id)));
  const categories = liste.filter(x => x.type === CATEGORIE)
    .map(x => ({ id: String(x.id), nom: String(x.name ?? '').slice(0, 100), position: Number(x.position) || 0 }))
    .sort((a, b) => a.position - b.position);
  const nomCategorie = new Map(categories.map(c => [c.id, c.nom]));
  const salons = liste.filter(x => TEXTE.has(Number(x.type)))
    .map(x => ({ id: String(x.id), nom: String(x.name ?? '').slice(0, 100), categorie: nomCategorie.get(String(x.parent_id)) ?? null, position: Number(x.position) || 0 }))
    // rangés comme sur Discord : par catégorie, puis par position
    .sort((a, b) => (categories.findIndex(c => c.nom === a.categorie) - categories.findIndex(c => c.nom === b.categorie)) || a.position - b.position);
  cache = { salons, categories, le: Date.now() };
  return cache;
}
