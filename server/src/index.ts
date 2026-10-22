/* SOCLE — serveur du site : vitrine + gestion.
   Express + PostgreSQL (Prisma) + Discord OAuth2. Le socle (src/socle/) porte la sécurité, la connexion, les comptes,
   les grades, le stockage et les webhooks du bot ; l'entreprise (src/entreprise/) y branche ses routes et ses pages. */
import { join, posix } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import { config } from './socle/config.js';
import { pool, prisma } from './socle/db.js';
import { chargerGrades, CLES_PERMISSIONS, peut } from './socle/droits.js';
import { ImageRefusee } from './socle/images.js';
import { planifierPurge } from './socle/purge.js';
import { planifierSynchroDiscord } from './socle/synchro-discord.js';
import { chargerReglages } from './socle/reglages.js';
import { storage } from './socle/storage.js';
import { limits } from './socle/limites.js';
import { cspNonce, securityHeaders } from './socle/security.js';
import { site, pages, renderFile, withNonce } from './socle/site.js';
import { auth, PAGE_ACCUEIL, PAGE_ATTENTE, PAGE_CONNEXION } from './socle/routes/auth.js';
import { comptes } from './socle/routes/comptes.js';
import { grades } from './socle/routes/grades.js';
import { declarerParametres, parametres } from './socle/parametres.js';
import { webhooks } from './socle/routes/webhooks.js';
import type { NiveauPage } from './socle/contrat.js';
import { entreprise } from './entreprise/index.js';

await Promise.all([chargerGrades(), chargerReglages()]);
declarerParametres(entreprise.parametres);   // avant demarrage(), qui peut lire un paramètre
planifierPurge();
planifierSynchroDiscord();
await entreprise.demarrage?.();

const app = express();
app.set('trust proxy', 1);                     // derrière nginx (adresse IP réelle pour les limites de requêtes)
app.disable('x-powered-by');                   // ne pas signaler Express, même sur les hôtes annexes (hors helmet)

// Hôtes annexes de l'entreprise (contrat.ts) : servis avant tout le reste, sans session ni en-têtes du site. Le nom
// vient de X-Forwarded-Host (nginx) : un hôte non déclaré suit le chemin ordinaire du site.
const hotes = new Map(Object.entries(entreprise.hotes ?? {}).map(([h, f]) => [h.toLowerCase(), f]));
for (const h of hotes.keys()) {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || h === new URL(config.baseUrl).hostname) throw new Error(`entreprise.hotes : nom d'hôte invalide « ${h} »`);
}
if (hotes.size) app.use((req, res, next) => { const f = hotes.get(req.hostname); if (f) return f(req, res, next); next(); });

app.use(cspNonce, securityHeaders);

// santé du site (contrôle Docker) : le serveur répond et la base aussi ; hors limites de requêtes et sans session
app.get('/healthz', async (_req, res) => {
  try { await pool.query('select 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});

// webhooks du bot : avant le lecteur JSON (la signature porte sur le corps brut), sans session ni contrôle d'origine
app.use(webhooks);
app.use(express.json({ limit: '64kb' }));

// Session : seulement pour l'API, la connexion et les pages de gestion/ — jamais pour les fichiers du site (css, js,
// images), qui sans ça coûteraient chacun une lecture en base. disableTouch : pas d'écriture en base à chaque requête
// (la session expire à date fixe). 7 jours : la connexion Discord, qui revérifie l'appartenance au serveur, le grade
// et la propriété, a lieu au moins chaque semaine.
const sessions = session({
  store: new (connectPg(session))({ pool, tableName: 'session', disableTouch: true }),
  name: 'site.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, ...config.cookie, maxAge: 7 * 24 * 3600 * 1000 },
});
app.use(['/api', '/auth'], sessions);
// Réponses propres à un compte : jamais gardées par le navigateur, qui les laisserait lisibles sur un ordinateur
// partagé après la déconnexion
app.use(['/api', '/auth'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Requêtes qui modifient quelque chose : acceptées seulement depuis les pages du site. Le cookie SameSite=Lax arrête
// les autres sites, pas un voisin du même domaine (a.exemple.fr → b.exemple.fr), qui pourrait sinon agir au nom d'un
// compte ; avec FolkOS (cookie SameSite=None), ce contrôle est la seule barrière. Le navigateur joint toujours l'en-tête
// Origin à ces requêtes ; absent (curl, script), rien à craindre.
const origine = new URL(config.baseUrl).origin;
app.use(['/api', '/auth'], (req, res, next) => {
  const recue = req.get('origin');
  if (req.method === 'GET' || req.method === 'HEAD' || !recue || recue === origine) next();
  else res.status(403).json({ error: 'origine refusée' });
});

app.use('/auth', limits.auth);
app.use('/api', limits.api);
app.use(auth, comptes, grades, parametres, ...entreprise.routes);
// adresse d'API inconnue : 404 en JSON (pas la page 404 du site)
app.use('/api', (_req, res) => { res.status(404).json({ error: 'introuvable' }); });

// ---------- site statique : uniquement ce qui est public ----------
// gestion/, socle/ et assets/, plus les fichiers de la racine du site (pages, css, js, robots.txt, sitemap.xml) ;
// jamais le reste du dépôt (code du serveur, compose.yaml, site.json, README…), quelle que soit l'écriture de l'adresse.
// Les pages (.html, .css, .txt, .xml) passent par site.ts, qui y insère l'identité du site (site.json).
// redirect: false — un dossier du dépôt (/server, /docs) répond 404 comme le reste, sans révéler qu'il existe
const statics: Parameters<typeof express.static>[1] = { index: false, dotfiles: 'ignore', redirect: false };

// Pages de gestion/ : envoyées seulement à qui y a droit, selon les mêmes règles que l'API. Sinon la page n'est jamais
// envoyée : pas connecté → connexion ; compte pas encore validé → attente ; droits insuffisants → refuse.html (403).
// Niveaux : ceux du socle ci-dessous, puis ceux que déclare l'entreprise ; une page non déclarée exige un compte validé.
const NIVEAU_PAGE: Record<string, NiveauPage> = { parametres: 'parametres', ...entreprise.pages, index: 'public', refuse: 'public', attente: 'connecte' };
for (const [page, niveau] of Object.entries(NIVEAU_PAGE)) {
  if (!['public', 'connecte', 'valide'].includes(niveau) && !CLES_PERMISSIONS.has(niveau)) throw new Error(`entreprise.pages : niveau inconnu « ${niveau} » pour la page ${page}`);
}
// La page est déduite du chemin tel que le serveur de fichiers le lira : décodé, normalisé, sans casse (compt%65s.html,
// //comptes.html, Comptes.html sur un disque Windows désignent tous comptes.html).
const pageDemandee = (chemin: string): string | null => {
  try { chemin = decodeURIComponent(chemin); } catch { return null; }
  const norme = posix.normalize(chemin);
  if (norme === '/' || norme === '.') return 'index';
  const nom = posix.basename(norme).toLowerCase();
  return /^[\w-]+(\.html)?$/.test(nom) ? nom.replace(/\.html$/, '') : null;
};
app.use('/gestion', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const page = pageDemandee(req.path);
  // une page HTML (pas un .css ni un .js) : niveau déclaré, ou compte validé par défaut
  if (page === null) return next();
  const niveau = NIVEAU_PAGE[page] ?? 'valide';
  sessions(req, res, () => { accesPage(req, res, next, page, niveau).catch(next); });
});
async function accesPage(req: express.Request, res: express.Response, next: express.NextFunction, page: string, niveau: NiveauPage) {
  const c = req.session.compteId ? await prisma.compte.findUnique({ where: { id: req.session.compteId } }) : null;
  // session déjà ouverte : la page de connexion mène droit à l'accueil (ou à l'attente)
  if (page === 'index' && c) return res.redirect(c.statut === 'valide' ? PAGE_ACCUEIL : PAGE_ATTENTE);
  if (niveau === 'public') return next();
  if (!c) return res.redirect(PAGE_CONNEXION);
  if (niveau === 'connecte') return next();
  if (c.statut !== 'valide') return res.redirect(PAGE_ATTENTE);
  if (niveau === 'valide' || peut(c, niveau)) return next();
  res.status(403).type('html').send(withNonce(renderFile(join(config.root, 'gestion', 'refuse.html')), res));
}
app.use('/gestion', pages(join(config.root, 'gestion')), express.static(join(config.root, 'gestion'), statics));
app.use('/socle', express.static(join(config.root, 'socle'), statics));
// images et polices gardées 7 jours par les navigateurs en production ; en dev, toujours revalidées (un visuel changé
// s'affiche aussitôt). Scripts et feuilles (assets/js, assets/css) toujours revalidés : un ancien script resté en cache
// une semaine ne correspondrait plus aux pages ni à l'API mises à jour.
app.use('/assets', express.static(join(config.root, 'assets'), {
  dotfiles: 'ignore', maxAge: config.production ? '7d' : 0,
  setHeaders: (res, chemin) => { if (/\.(js|mjs|css)$/.test(chemin)) res.setHeader('Cache-Control', 'no-cache'); },
}));
// fichiers envoyés sur le disque (dev uniquement : en production, ils sont sur le stockage distant)
if (storage.kind === 'local') app.use('/uploads', express.static(storage.dir, { dotfiles: 'ignore', index: false, redirect: false }));
const rootPages = pages(config.root), rootFiles = express.static(config.root, statics);
app.use((req, res, next) => {
  if (!/^\/([\w-]+(\.(html|css|js|txt|xml))?)?$/.test(req.path)) return next();
  // un nom sans extension n'est qu'une page (/faq → faq.html) : jamais un fichier tel quel (LICENSE, Dockerfile…)
  rootPages(req, res, () => (/\.\w+$/.test(req.path) ? rootFiles(req, res, next) : next()));
});
app.use((_req, res) => {
  try { res.status(404).type('html').send(withNonce(renderFile(join(config.root, '404.html')), res)); } catch { res.status(404).send('404'); }
});

// erreur imprévue dans une route : journalisée, réponse générique
// Corps JSON illisible : 400, sans le journaliser (il peut contenir un jeton). Corps trop lourd : 413 (un 500 ferait
// réessayer le bot pour rien). Image refusée : 400 avec son message.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if ((err as { type?: string }).type === 'entity.parse.failed') { if (!res.headersSent) res.status(400).json({ error: 'requête illisible' }); return; }
  if ((err as { type?: string }).type === 'entity.too.large') { if (!res.headersSent) res.status(413).json({ error: 'Données trop volumineuses.' }); return; }
  if (err instanceof ImageRefusee) { if (!res.headersSent) res.status(400).json({ error: err.message }); return; }
  console.error((err as Error).stack || (err as Error).message || 'erreur inconnue');
  if (!res.headersSent) res.status(500).json({ error: 'erreur serveur' });
};
app.use(onError);

console.log(`Stockage des images : ${storage.kind === 'cdn' ? 'CDN' : storage.kind === 'local' ? `local, dev uniquement (${storage.dir})` : 'aucun (envoi désactivé)'}`);
console.log(`Webhooks du bot : ${config.webhookSecrets.length ? `${config.webhookSecrets.length} abonnement(s)` : 'désactivés (BOT_WEBHOOK_SECRETS vide)'}`);
const serveur = app.listen(config.port, '0.0.0.0', () => console.log(`${site.nom} en écoute sur le port ${config.port} (${config.baseUrl})`));

// Arrêt demandé par Docker (mise à jour, redémarrage) : plus de nouvelle requête, celles en cours se terminent, puis la
// base est rendue. Après 8 s, on sort quand même (Docker coupe à 10).
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  serveur.close(() => { pool.end().catch(() => {}).finally(() => process.exit(0)); });
  serveur.closeIdleConnections();
  setTimeout(() => process.exit(0), 8000).unref();
});
