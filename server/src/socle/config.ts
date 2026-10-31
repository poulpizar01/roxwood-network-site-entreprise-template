// SOCLE — configuration lue dans l'environnement (.env en prod, compose.override.yaml en dev).
// Une valeur vide (« NOM= », comme dans .env.example) compte comme absente : le serveur s'arrête ici avec un message
// clair, plutôt que de démarrer et d'échouer à la première requête. Les variables propres à l'entreprise se lisent
// dans src/entreprise/ avec les mêmes aides (adresse, fail), exportées ci-dessous.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const env = process.env;
// adresse http(s) valide, sans slash final (collé à un chemin, il donnerait « //… ») ; vide si absente
export function adresse(name: string): string {
  const v = (env[name] || '').trim();
  if (!v) return '';
  let u: URL;
  try { u = new URL(v); } catch { fail(`${name} dans .env n'est pas une adresse valide : ${v}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') fail(`${name} dans .env doit commencer par http:// ou https:// : ${v}`);
  return v.replace(/\/+$/, '');
}

const baseUrl = adresse('BASE_URL') || fail('Variable manquante dans .env : BASE_URL');

// connexion de dev sans Discord : uniquement en local (DEV_LOGIN=1 + BASE_URL sur localhost), jamais dans l'image de
// production (NODE_ENV=production, server/Dockerfile ; le dev passe en development, compose.override.yaml). Deux verrous
// indépendants : un .env de prod mal rempli ne suffit pas à l'ouvrir. Le troisième est dans la route (routes/auth.ts).
const devLogin = env.DEV_LOGIN === '1';
if (devLogin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) fail('DEV_LOGIN=1 refusé : BASE_URL doit être http://localhost');
if (devLogin && env.NODE_ENV === 'production') fail('DEV_LOGIN=1 refusé : connexion de dev impossible dans l’image de production (NODE_ENV=production)');

// faux bot Discord (discord-simulation.ts) : mêmes verrous que la connexion de dev, dont il dépend
const botSimule = (env.DISCORD_BOT_TOKEN || '').trim() === 'simulation';
if (botSimule && !devLogin) fail('DISCORD_BOT_TOKEN=simulation refusé : le faux bot Discord n’existe qu’en développement (DEV_LOGIN=1)');

const required = (name: string): string => env[name] || (devLogin ? '' : fail(`Variable manquante dans .env : ${name}`));

// le secret signe les cookies de session : un secret court se devine (en dev, la valeur fixe de compose.override.yaml suffit)
const sessionSecret = env.SESSION_SECRET || fail('Variable manquante dans .env : SESSION_SECRET');
if (!devLogin && sessionSecret.length < 32) fail('SESSION_SECRET trop court dans .env (32 caractères au moins) : openssl rand -hex 32');

// dossier du site sur le stockage partagé : sans « / » final, les fichiers iraient dans « monsiteimages/… » ;
// vide, à la racine commune à tous les sites
const storageUrl = adresse('STORAGE_URL');
const storagePrefix = env.STORAGE_PREFIX ?? 'site/';
if (!!storageUrl !== !!env.STORAGE_TOKEN) fail('STORAGE_URL et STORAGE_TOKEN vont ensemble dans .env : remplir les deux, ou aucun');
if (storageUrl && !/^[\w.-]+(\/[\w.-]+)*\/$/.test(storagePrefix)) fail(`STORAGE_PREFIX dans .env doit être un dossier terminé par « / » (ex. monsite/) : « ${storagePrefix} »`);

// Secrets des abonnements webhook du bot Discord entreprise (un par abonnement, affiché une seule fois par le bot),
// séparés par des virgules. Un secret court se devine : refusé.
const webhookSecrets = (env.BOT_WEBHOOK_SECRETS || '').split(',').map(s => s.trim()).filter(Boolean);
if (webhookSecrets.some(s => s.length < 16)) fail('BOT_WEBHOOK_SECRETS dans .env : chaque secret doit faire 16 caractères au moins (copier celui donné par le bot)');

// Super-admins : IDs Discord qui se connectent directement, avec tous les droits (compte.proprietaire), sans devoir
// appartenir au serveur Discord de l'entreprise — remplace l'ancienne notion de « propriétaire du serveur Discord ».
// Séparés par des virgules.
const superAdmins = (env.SUPER_ADMIN_DISCORD_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
for (const id of superAdmins) if (!/^\d{15,22}$/.test(id)) fail(`SUPER_ADMIN_DISCORD_IDS dans .env : « ${id} » n'est pas un ID Discord valide`);

// Ordinateur en jeu (FolkOS, navigateur FiveM) : facultatif, désactivé sans FOLKOS_HOTE. Le site s'affiche alors dans
// l'iframe de FolkOS (origine FOLKOS_HOTE, plus les cadres FiveM et ceux de FOLKOS_CADRES), et charge le SDK de
// l'opérateur depuis cette origine. FOLKOS_ID_BASE + identifiants : connexion « IG » par le SSO FolkOS (routes/auth.ts).
const folkosHote = adresse('FOLKOS_HOTE');
if (folkosHote && (!folkosHote.startsWith('https://') || new URL(folkosHote).origin !== folkosHote)) fail(`FOLKOS_HOTE dans .env : une origine https:// sans chemin est attendue (ex. https://computer.exemple.fr) : ${folkosHote}`);
// cadres supplémentaires : origine https (joker de sous-domaine admis) ou schéma seul (nui:) ; jamais « * » ni guillemets
const folkosCadres = (env.FOLKOS_CADRES || '').split(/[\s,]+/).filter(Boolean);
for (const c of folkosCadres) if (!/^(https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d+)?|[a-z][a-z0-9+.-]*:(\/\/[a-z0-9.-]+)?)$/.test(c)) fail(`FOLKOS_CADRES dans .env : « ${c} » n'est ni une origine https:// ni un schéma (nui:)`);
if (folkosCadres.length && !folkosHote) fail('FOLKOS_CADRES dans .env exige FOLKOS_HOTE');
const folkosSso = [env.FOLKOS_ID_BASE, env.FOLKOS_CLIENT_ID, env.FOLKOS_CLIENT_SECRET];
if (folkosSso.some(Boolean) && !folkosSso.every(Boolean)) fail('FOLKOS_ID_BASE, FOLKOS_CLIENT_ID et FOLKOS_CLIENT_SECRET vont ensemble dans .env : remplir les trois, ou aucun');
// sans iframe autorisée, la connexion IG mènerait à une page que FolkOS ne peut pas afficher
if (folkosSso.every(Boolean) && !folkosHote) fail('FOLKOS_ID_BASE dans .env exige FOLKOS_HOTE (le site doit pouvoir s’afficher dans l’ordinateur en jeu)');

// racine du dépôt (index.html, gestion/, assets/…) : dist/socle/ ou src/socle/ → server/ → racine
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const config = {
  port: Number(env.PORT) || 3000,
  baseUrl,
  production: env.NODE_ENV === 'production',
  devLogin,
  // compte de dev : ID Discord réel (DEV_DISCORD_ID) si besoin, sinon un identifiant fictif
  devDiscordId: env.DEV_DISCORD_ID || 'dev-local',
  sessionSecret,
  // cookie de session : SameSite=None quand le site s'affiche dans l'iframe FolkOS (autre site : un cookie Lax n'y serait
  // jamais envoyé), ce qui exige Secure ; en http (dev), Lax — l'iframe ne s'y essaie pas
  cookie: { sameSite: folkosHote && baseUrl.startsWith('https') ? 'none' as const : 'lax' as const, secure: baseUrl.startsWith('https') },
  discord: {
    clientId: required('DISCORD_CLIENT_ID'),
    clientSecret: required('DISCORD_CLIENT_SECRET'),
    guildId: required('DISCORD_GUILD_ID'),
    // facultatif : jeton du bot qui lit la liste des rôles du serveur (page Grades, roles-discord.ts)
    botToken: (env.DISCORD_BOT_TOKEN || '').trim(),
    // « simulation » : aucun appel à Discord, réponses fictives (discord-simulation.ts), développement seulement
    simulation: botSimule,
  },
  root,
  storage: {
    url: storageUrl,
    token: env.STORAGE_TOKEN || '',
    prefix: storagePrefix,
    dir: env.UPLOAD_DIR || join(root, 'uploads'),
  },
  webhookSecrets,
  superAdmins,
  folkos: {
    hote: folkosHote,           // vide : FolkOS désactivé
    cadres: folkosCadres,
    sso: folkosSso.every(Boolean) ? { base: adresse('FOLKOS_ID_BASE'), clientId: env.FOLKOS_CLIENT_ID!, clientSecret: env.FOLKOS_CLIENT_SECRET! } : null,
  },
};
