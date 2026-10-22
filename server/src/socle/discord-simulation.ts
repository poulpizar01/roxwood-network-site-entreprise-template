// SOCLE — faux bot Discord pour le développement (DISCORD_BOT_TOKEN=simulation, refusé sans DEV_LOGIN : config.ts).
// appelBot (discord.ts) lui passe chaque appel au lieu de Discord : rôles, catégories et salons fictifs, un salon de
// ticket par personne connue, membres qui gardent les rôles déjà enregistrés (la synchro ne retire rien), messages
// de salons et privés gardés en mémoire et relus par GET …/messages. De quoi voir fonctionner sans vrai bot ce qui en dépend
// (page Paramètres, Grades, tâches de l'entreprise). Rien n'est envoyé à Discord ; tout est perdu au redémarrage.
// L'entreprise y ajoute ce que son propre bot ferait : personnes ayant un ticket (ajouterPersonnesSimulees), messages
// publiés dans un salon (publierMessageSimule, ex. notifications d'un bot tiers).
import { config } from './config.js';
import { prisma } from './db.js';
import { ErreurDiscord, ID_DISCORD } from './discord.js';

// identifiants au format Discord (snowflake : date dans les bits de poids fort), croissants comme les vrais
let compteur = 0n;
export const idSimule = (date = Date.now()) => String(((BigInt(date) - 1420070400000n) << 22n) + (compteur++ % 4096n));

// noms génériques (le modèle ne porte aucun contenu propre à une entreprise) ; identifiants fixes d'un démarrage à l'autre
const ROLES = [
  { id: '900000000000000001', name: 'Direction', color: 0xc9a227, position: 5 },
  { id: '900000000000000002', name: 'Responsable', color: 0x3b82f6, position: 4 },
  { id: '900000000000000003', name: 'Employé', color: 0x22c55e, position: 3 },
  { id: '900000000000000004', name: 'Recrue', color: 0x94a3b8, position: 2 },
  { id: '900000000000000005', name: 'Partenaire', color: 0, position: 1 },
];
const CATEGORIES = [
  { id: '900000000000000101', name: 'Accueil', position: 0 },
  { id: '900000000000000102', name: 'Équipe', position: 1 },
  { id: '900000000000000103', name: 'Tickets', position: 2 },
  { id: '900000000000000104', name: 'Tickets archivés', position: 3 },
];
const SALONS = [
  { id: '900000000000000201', name: 'informations', type: 5, parent_id: '900000000000000101', position: 0 },
  { id: '900000000000000202', name: 'général', type: 0, parent_id: '900000000000000101', position: 1 },
  { id: '900000000000000203', name: 'prise-de-service', type: 0, parent_id: '900000000000000102', position: 0 },
  { id: '900000000000000204', name: 'planning', type: 0, parent_id: '900000000000000102', position: 1 },
  { id: '900000000000000205', name: 'journal-du-bot', type: 0, parent_id: '900000000000000102', position: 2 },
];

type Personne = { discordId: string; nom: string };
const sourcesPersonnes: (() => Promise<Personne[]>)[] = [];
// l'entreprise ajoute des personnes qui ont un ticket (ex. fiches d'employés reliées à Discord)
export const ajouterPersonnesSimulees = (source: () => Promise<Personne[]>) => { sourcesPersonnes.push(source); };

// un ticket (salon privé dans « Tickets ») par compte ou personne connue ayant un vrai identifiant Discord
async function tickets() {
  const comptes = await prisma.compte.findMany({ select: { discordId: true, nom: true, pseudo: true } });
  const personnes = new Map<string, string>();
  for (const c of comptes) if (ID_DISCORD.test(c.discordId)) personnes.set(c.discordId, c.nom ?? c.pseudo);
  for (const source of sourcesPersonnes) for (const p of await source()) if (ID_DISCORD.test(p.discordId) && !personnes.has(p.discordId)) personnes.set(p.discordId, p.nom);
  return [...personnes].map(([discordId, nom], i) => ({
    // identifiant stable dérivé de la personne : le même ticket d'une lecture à l'autre
    id: String(910000000000000000n + BigInt(discordId) % 89999999999999999n), type: 0, parent_id: '900000000000000103', position: i,
    name: `ticket-${nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sans-nom'}`,
    permission_overwrites: [{ id: config.discord.guildId || '0', type: 0 }, { id: discordId, type: 1 }],
  }));
}

type Message = { id: string; timestamp: string; author: { id: string; username: string; bot: true }; content?: string; embeds?: unknown[] };
const messages = new Map<string, Message[]>();   // par salon, du plus ancien au plus récent
const conversationsPrivees = new Map<string, string>();   // identifiant Discord de la personne → salon privé simulé
const AUTEUR = { id: '900000000000000999', username: 'Bot simulé', bot: true as const };

// message déposé dans un salon comme s'il venait d'un bot (relu par GET /channels/:id/messages)
export function publierMessageSimule(salonId: string, contenu: { content?: string; embeds?: unknown[] }, date = new Date()): string {
  const m: Message = { id: idSimule(date.getTime()), timestamp: date.toISOString(), author: AUTEUR, ...contenu };
  const liste = messages.get(salonId) ?? [];
  liste.push(m);
  liste.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  messages.set(salonId, liste.slice(-500));
  return m.id;
}

const introuvable = (code: number) => new ErreurDiscord(404, 'Introuvable sur Discord (simulation).', code);

export async function appelSimule(methode: string, chemin: string, corps?: unknown): Promise<unknown> {
  const [route, requete = ''] = chemin.split('?');
  const p = new URLSearchParams(requete);
  let m: RegExpMatchArray | null;
  if (methode === 'POST' && route === '/users/@me/channels') {
    const destinataire = (corps as { recipient_id?: unknown } | null)?.recipient_id;
    if (typeof destinataire !== 'string' || !ID_DISCORD.test(destinataire)) throw new ErreurDiscord(400, 'Identifiant Discord invalide (simulation).');
    let id = conversationsPrivees.get(destinataire);
    if (!id) { id = idSimule(); conversationsPrivees.set(destinataire, id); }
    return { id };
  }
  if (methode === 'GET' && /^\/guilds\/[^/]*\/roles$/.test(route)) return ROLES.map(r => ({ ...r, managed: false }));
  if (methode === 'GET' && /^\/guilds\/[^/]*\/channels$/.test(route)) return [...CATEGORIES.map(c => ({ ...c, type: 4 })), ...SALONS, ...await tickets()];
  if (methode === 'GET' && (m = route.match(/^\/guilds\/[^/]*\/members\/(\d+)$/))) {
    // membre toujours présent, avec les rôles déjà enregistrés : la synchro ne change rien
    const c = await prisma.compte.findUnique({ where: { discordId: m[1] }, select: { rolesDiscord: true } });
    if (!c) throw introuvable(10007);
    return { roles: c.rolesDiscord, user: { id: m[1] } };
  }
  if ((m = route.match(/^\/channels\/(\d+)\/messages$/))) {
    const salon = m[1];
    const connu = SALONS.some(s => s.id === salon) || [...conversationsPrivees.values()].includes(salon)
      || messages.has(salon) || (await tickets()).some(t => t.id === salon);
    if (!connu) throw introuvable(10003);
    if (methode === 'POST') {
      const { content, embeds } = (corps ?? {}) as { content?: string; embeds?: unknown[] };
      const id = publierMessageSimule(salon, { content, embeds });
      console.log(`[discord simulé] message dans le salon ${salon} : ${String(content ?? '').slice(0, 200) || '(embed)'}`);
      return { id };
    }
    if (methode === 'GET') {
      const apres = p.get('after'), limite = Math.min(Number(p.get('limit')) || 50, 100);
      const liste = (messages.get(salon) ?? []).filter(x => !apres || BigInt(x.id) > BigInt(apres));
      // comme Discord : avec after, les plus anciens d'abord après le curseur ; sans, les plus récents
      return (apres ? liste.slice(0, limite) : liste.slice(-limite)).reverse();
    }
  }
  console.log(`[discord simulé] appel non simulé : ${methode} ${route.replace(/\d{15,22}/g, ':id')}`);
  throw introuvable(0);
}
