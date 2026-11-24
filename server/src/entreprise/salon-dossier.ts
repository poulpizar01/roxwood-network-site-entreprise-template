// ENTREPRISE — salon Discord d'un dossier (demande, candidature…) : un salon s'ouvre dans la catégorie réglée dans Paramètres,
// avec exactement les droits de cette catégorie, plus la personne du dossier (son Discord est vérifié). Le dossier existe
// toujours, avec ou sans salon : un bot absent, une catégorie non réglée ou supprimée ne fait jamais échouer l'envoi.
import { config } from '../socle/config.js';
import { appelBot, botDiscordConfigure, ErreurDiscord, ID_DISCORD } from '../socle/discord.js';
import { parametre } from './parametres.js';

type Overwrite = { id: string; type: number; allow: string; deny: string };
type SalonBrut = { id?: unknown; permission_overwrites?: { id?: unknown; type?: unknown; allow?: unknown; deny?: unknown }[] };

// droits de la catégorie recopiés tels quels ; la personne du dossier voit le salon même si la catégorie le lui refusait
export function construireOverwritesSalon(categorie: { id?: unknown; type?: unknown; allow?: unknown; deny?: unknown }[], discordId: string | null): Overwrite[] {
  const overwrites = categorie.filter(o => ID_DISCORD.test(String(o.id)))
    .map(o => ({ id: String(o.id), type: Number(o.type) === 1 ? 1 : 0, allow: String(o.allow ?? '0'), deny: String(o.deny ?? '0') }));
  if (!discordId) return overwrites;
  const vue = 1024n;   // VIEW_CHANNEL (1 << 10)
  const deja = overwrites.find(o => o.type === 1 && o.id === discordId);
  if (deja) { deja.allow = String(BigInt(deja.allow) | vue); deja.deny = String(BigInt(deja.deny) & ~vue); }
  else overwrites.push({ id: discordId, type: 1, allow: String(vue), deny: '0' });
  return overwrites;
}

// null si le bot ou la catégorie (réglage `cleCategorie`) manque. salonExistant : salon d'un dossier précédent de la même
// personne, repris tel quel s'il existe encore sur Discord (une personne qui enchaîne les dossiers n'a qu'un salon).
export async function creerSalonDossier(cleCategorie: string, nom: string, discordId: string | null, salonExistant: string | null = null): Promise<string | null> {
  if (!botDiscordConfigure()) return null;
  if (salonExistant && ID_DISCORD.test(salonExistant)) {
    try { await appelBot('GET', `/channels/${salonExistant}`); return salonExistant; }
    catch (e) { if (!(e instanceof ErreurDiscord) || e.statut !== 404) throw e; }
  }
  const categorie = parametre(cleCategorie);
  if (!ID_DISCORD.test(categorie)) return null;
  const salons = await appelBot('GET', `/guilds/${config.discord.guildId}/channels`) as SalonBrut[] | null;
  const cat = (salons ?? []).find(c => String(c.id) === categorie);
  if (!cat) return null;   // catégorie supprimée sur Discord depuis le réglage
  const nomSalon = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'dossier';
  const salon = await appelBot('POST', `/guilds/${config.discord.guildId}/channels`, {
    name: nomSalon, type: 0, parent_id: categorie,
    permission_overwrites: construireOverwritesSalon(Array.isArray(cat.permission_overwrites) ? cat.permission_overwrites : [], discordId),
  }) as { id?: unknown } | null;
  return salon && ID_DISCORD.test(String(salon.id)) ? String(salon.id) : null;
}
