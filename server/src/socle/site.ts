/* SOCLE — identité du site : lue dans site.json (racine du dépôt), insérée dans les pages au moment de les servir.
   Dans une page (.html, .css, robots.txt, sitemap.xml), {{cle}} est remplacé par la valeur de site.json ;
   {{Cle}} (majuscule) donne la même valeur avec une majuscule en tête. {{url}} vient de BASE_URL. Tirées de la couleur :
   {{couleur_rvb}} (« 62, 123, 250 », pour rgba()) et {{couleur_sombre}} (30 % plus sombre) : les feuilles s'en servent
   au lieu de color-mix(), que le navigateur de l'ordinateur en jeu ne connaît pas (la couleur y disparaîtrait).
   site.json accepte toute clé dont la valeur est un texte : chaque site y ajoute les siennes (adresse, horaires…). */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { RequestHandler, Response } from 'express';
import { config } from './config.js';

const REQUIRED = ['nom', 'description'] as const;

function load(): Record<string, string> {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(readFileSync(join(config.root, 'site.json'), 'utf8')); }
  catch (e) { console.error(`site.json illisible : ${(e as Error).message}`); process.exit(1); }
  const missing = REQUIRED.filter(k => typeof raw[k] !== 'string' || !raw[k]);
  if (missing.length) { console.error(`site.json : valeur manquante pour ${missing.join(', ')}`); process.exit(1); }
  const pasTexte = Object.keys(raw).filter(k => !/^\w+$/.test(k) || typeof raw[k] !== 'string');
  if (pasTexte.length) { console.error(`site.json : clés (lettres, chiffres, _) et valeurs doivent être du texte : ${pasTexte.join(', ')}`); process.exit(1); }
  const reservees = ['url', 'couleur_rvb', 'couleur_sombre'].filter(k => k in raw);
  if (reservees.length) { console.error(`site.json : ${reservees.join(', ')} : clé réservée (calculée par le site)`); process.exit(1); }
  // couleur d'accent : facultative, forcément une couleur hexadécimale (elle est insérée telle quelle dans les feuilles de style)
  const couleur = raw.couleur ?? '#3e7bfa';
  if (typeof couleur !== 'string' || !/^#[0-9a-f]{6}$/i.test(couleur)) { console.error('site.json : « couleur » doit être une couleur du type #3e7bfa'); process.exit(1); }
  // lien d'invitation : inséré dans des href, donc une adresse https et rien d'autre
  if (raw.discord !== undefined && !/^https:\/\/[^\s"'<>]+$/.test(raw.discord as string)) { console.error('site.json : « discord » doit être une adresse https:// (lien d’invitation)'); process.exit(1); }
  const rvb = [1, 3, 5].map(i => parseInt(couleur.slice(i, i + 2), 16));
  const sombre = '#' + rvb.map(v => Math.round(v * 0.7).toString(16).padStart(2, '0')).join('');
  return { ...(raw as Record<string, string>), couleur, couleur_rvb: rvb.join(', '), couleur_sombre: sombre, url: config.baseUrl };
}
export const site = load();

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// remplace les {{cle}} ; une clé inconnue est laissée telle quelle (et signalée une fois)
const warned = new Set<string>();
export function render(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (all, key: string) => {
    const lower = key.charAt(0).toLowerCase() + key.slice(1);
    const value = site[key] ?? (key !== lower && site[lower] !== undefined ? upper(site[lower]) : undefined);
    if (value === undefined) { if (!warned.has(key)) { warned.add(key); console.warn(`site.json : {{${key}}} inconnu`); } return all; }
    return esc(value);
  });
}

// pages servies avec l'identité du site ; mises en cache en production (en dev, relues à chaque requête)
const TYPES: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const cache = new Map<string, string>();
export function renderFile(file: string): string {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  let out = render(readFileSync(file, 'utf8'));
  if (extname(file) === '.html') out = versionner(out);
  if (config.production) cache.set(file, out);
  return out;
}

// feuilles et scripts du site appelés avec ?v=<empreinte du contenu> : gardés un an par le navigateur (index.ts),
// une nouvelle version change l'adresse. Empreinte d'une feuille : après insertion de site.json (sa couleur y entre).
const empreintes = new Map<string, string | null>();
function empreinte(url: string): string | null {
  if (empreintes.has(url)) return empreintes.get(url)!;
  let v: string | null = null;
  try {
    const fichier = join(config.root, url);
    v = createHash('sha256').update(extname(url) === '.css' ? renderFile(fichier) : readFileSync(fichier)).digest('hex').slice(0, 12);
  } catch { /* fichier absent : adresse laissée telle quelle */ }
  if (config.production) empreintes.set(url, v);
  return v;
}
const versionner = (html: string) => html.replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)=")(\/[\w\-/.]+\.(?:js|css))"/g,
  (tout, debut: string, url: string) => { const v = !url.includes('..') && empreinte(url); return v ? `${debut}${url}?v=${v}"` : tout; });
// FolkOS configuré : chaque page charge socle/folkos.js en tête (inerte hors de l'ordinateur en jeu)
const scriptFolkos = config.folkos.hote ? `<script src="/socle/folkos.js" data-hote="${esc(config.folkos.hote)}"></script>` : '';
// page HTML prête à envoyer : chaque <script> reçoit le jeton de la réponse (politique de contenu, security.ts)
export const withNonce = (html: string, res: Response): string =>
  (scriptFolkos ? html.replace(/<head>/i, m => m + scriptFolkos) : html).replace(/<script\b/g, `<script nonce="${res.locals.cspNonce}"`);

// sert les pages d'un dossier (index.html, extension .html facultative) ; le reste passe au middleware suivant
export function pages(dir: string): RequestHandler {
  const base = normalize(dir + sep);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let path: string;
    try { path = decodeURIComponent(req.path); } catch { return next(); }   // adresse mal encodée : simple 404
    if (path.endsWith('/')) path += 'index.html';
    else if (!extname(path)) path += '.html';
    const type = TYPES[extname(path)];
    const file = normalize(join(dir, path));
    if (!type || !file.startsWith(base) || /[\\/]\./.test(path)) return next();
    let body: string;
    try { body = renderFile(file); } catch { return next(); }
    res.type(type).send(type.startsWith('text/html') ? withNonce(body, res) : body);
  };
}
