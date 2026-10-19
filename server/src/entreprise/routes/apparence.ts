// ENTREPRISE — Paramètres → Apparence : images de la marque (logo, icône d'onglet, image de partage).
// Les images d'origine restent dans assets/, livrées avec le code. La Direction (permission « parametres ») peut en
// remplacer une : le fichier passe par le traitement d'images du socle (contrôle, réencodage WebP, transparence
// gardée) puis part sur le stockage ; seule son adresse est enregistrée (table apparence_images). « Rétablir » efface
// la ligne : l'image livrée revient aussitôt.
// Les pages ne changent pas d'adresse (/assets/logo.png reste celle du logo partout) : une image réglée est
// relayée depuis le stockage sur cette même adresse — même origine que le site, donc ni souci de CORS ni redirection pour les robots qui lisent og:image. Une image réglée mais illisible (stockage
// injoignable) retombe sur le fichier livré : le site garde toujours un logo.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, type Request } from 'express';
import { config } from '../../socle/config.js';
import { prisma } from '../../socle/db.js';
import { permission } from '../../socle/http.js';
import { enregistrerImage, recevoirImage, retirerImage } from '../../socle/images.js';
import { storage } from '../../socle/storage.js';
import { Refus, traiter } from '../refus.js';

// largeur / hauteur : proportions de l'image livrée ; une image très différente serait déformée
export const IMAGES_MARQUE = [
  { cle: 'logo', fichier: '/assets/logo.png', largeur: 512, hauteur: 512, libelle: 'Logo', aide: 'Menu et pages de connexion de l’espace de gestion, en-tête des pages publiques.' },
  { cle: 'icone', fichier: '/assets/favicon.png', largeur: 64, hauteur: 64, libelle: 'Icône d’onglet', aide: 'Petite icône affichée dans l’onglet du navigateur.' },
  { cle: 'partage', fichier: '/assets/og-image.jpg', largeur: 1200, hauteur: 630, libelle: 'Image de partage', aide: 'Aperçu affiché quand un lien du site est partagé (Discord, réseaux…).' },
] as const;
const PAR_CLE = new Map<string, (typeof IMAGES_MARQUE)[number]>(IMAGES_MARQUE.map(d => [d.cle, d]));

// ---- relais des images réglées ----
// octets déjà relus, par adresse (un remplacement crée une nouvelle adresse) ; au plus une entrée par image
const octetsParUrl = new Map<string, Buffer>();
const OCTETS_MAX = 15 * 1024 * 1024;
// Stockage lent ou coupé : ces images sont demandées à chaque page, par chaque visiteur. Une lecture en cours est
// partagée (pas un appel par visiteur) et un échec est retenu 2 minutes : pendant ce temps l'image livrée est servie
// tout de suite, au lieu de faire attendre chaque page.
const lecturesEnCours = new Map<string, Promise<Buffer>>();
const echecs = new Map<string, number>();
const ECHEC_RETENU_MS = 2 * 60_000;

function lireImage(url: string): Promise<Buffer> {
  const enCache = octetsParUrl.get(url);
  if (enCache) return Promise.resolve(enCache);
  if ((echecs.get(url) ?? 0) > Date.now()) return Promise.reject(new Error('échec récent, nouvel essai dans un instant'));
  let lecture = lecturesEnCours.get(url);
  if (!lecture) {
    lecture = lireImageUneFois(url)
      .catch(e => { echecs.set(url, Date.now() + ECHEC_RETENU_MS); throw e; })
      .finally(() => lecturesEnCours.delete(url));
    lecturesEnCours.set(url, lecture);
  }
  return lecture;
}

// corps d'une réponse lu au plus jusqu'à max octets (jamais tout un fichier énorme en mémoire avant le contrôle)
async function lireBorne(r: Response, max: number): Promise<Buffer> {
  if (Number(r.headers.get('content-length') ?? 0) > max) throw new Error('image trop lourde');
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for await (const m of r.body as unknown as AsyncIterable<Uint8Array>) {
    total += m.length;
    if (total > max) throw new Error('image trop lourde');
    morceaux.push(m);
  }
  return Buffer.concat(morceaux);
}

async function lireImageUneFois(url: string): Promise<Buffer> {
  let octets: Buffer;
  if (url.startsWith('/uploads/') && storage.kind === 'local') {
    // dev : fichier sur le disque du poste (clé faite de segments simples, vérifiée par le stockage à l'écriture)
    octets = await readFile(join(storage.dir, url.slice('/uploads/'.length)));
  } else {
    // seules les adresses du stockage configuré sont relues, jamais une autre, même si la base en contenait une
    if (new URL(url).origin !== new URL(config.storage.url).origin) throw new Error('adresse hors du stockage');
    // délai court (une page attend ce logo) ; pas de redirection suivie : l'origine contrôlée ci-dessus reste la seule
    const r = await fetch(url, { signal: AbortSignal.timeout(4_000), redirect: 'error', headers: { Accept: 'image/webp' } });
    if (!r.ok) throw new Error(`stockage : HTTP ${r.status}`);
    octets = await lireBorne(r, OCTETS_MAX);
  }
  // jamais servi sans contrôle : seul un fichier WebP (ce que le socle enregistre) passe
  if (octets.length > OCTETS_MAX || octets.toString('ascii', 0, 4) !== 'RIFF' || octets.toString('ascii', 8, 12) !== 'WEBP') throw new Error('contenu qui n’est pas une image WebP');
  if (octetsParUrl.size >= IMAGES_MARQUE.length * 2) octetsParUrl.clear();
  octetsParUrl.set(url, octets);
  return octets;
}

// images réglées, gardées en mémoire (ces fichiers sont demandés à chaque page) : rechargées à chaque changement
let reglees: Map<string, { url: string; majLe: Date }> | null = null;
async function imagesReglees() {
  reglees ??= new Map((await prisma.apparenceImage.findMany({ select: { cle: true, url: true, majLe: true } })).map(r => [r.cle, r]));
  return reglees;
}

export const apparence = Router();

// chaque fichier de la marque : l'image réglée si elle existe et se lit, sinon le fichier livré. Les deux avec un cache
// court : les autres fichiers de assets/ sont gardés 7 jours par les navigateurs, un logo remplacé ne s'afficherait pas
// avant une semaine chez qui a déjà l'ancien.
const CACHE_COURT = 'public, max-age=300';
for (const d of IMAGES_MARQUE) {
  apparence.get(d.fichier, async (_req, res) => {
    const livre = () => res.sendFile(join(config.root, d.fichier), { headers: { 'Cache-Control': CACHE_COURT } });
    const reglee = (await imagesReglees().catch(() => null))?.get(d.cle);
    if (!reglee) { livre(); return; }
    try {
      const octets = await lireImage(reglee.url);
      res.set({ 'Content-Type': 'image/webp', 'Cache-Control': CACHE_COURT, ETag: `"apparence-${d.cle}-${reglee.majLe.getTime()}"` }).send(octets);
    } catch (e) {
      console.error(`[apparence] « ${d.libelle} » illisible sur le stockage (${(e as Error).message}) : image d’origine servie`);
      livre();
    }
  });
}

// ---- Paramètres → Apparence ----
const gerer = permission('parametres');

apparence.get('/api/apparence', ...gerer, async (_req, res) => {
  const reglees = new Map((await prisma.apparenceImage.findMany()).map(r => [r.cle, r]));
  res.json({
    stockage: storage.accepte,
    images: IMAGES_MARQUE.map(d => ({ cle: d.cle, libelle: d.libelle, aide: d.aide, largeur: d.largeur, hauteur: d.hauteur, apercu: d.fichier, personnalisee: reglees.has(d.cle), majLe: reglees.get(d.cle)?.majLe ?? null })),
  });
});

const definition = (req: Request) => {
  const d = PAR_CLE.get(String(req.params.cle));
  if (!d) throw new Refus('Image inconnue.', 404);
  return d;
};

// L'image remplacée (ou rétablie) n'est pas retirée du stockage ici : elle part dans la file de nettoyage
// (entreprise/images-retirees.ts), dans la même transaction que le changement. Un stockage injoignable n'y laisse donc jamais un
// fichier en ligne sans trace : la suppression est réessayée au passage suivant. Un verrou par image fait se suivre deux
// remplacements simultanés : chacun envoie bien au nettoyage l'image du précédent.
type Ligne = { cleImage: string; url: string; cleMini: string; urlMini: string };
async function changerImage(cle: string, nouvelle: (Ligne & { compteId: number }) | null): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'apparence:' + cle}))`;
    const avant = await tx.apparenceImage.findUnique({ where: { cle } });
    if (nouvelle) await tx.apparenceImage.upsert({ where: { cle }, create: { cle, ...nouvelle }, update: nouvelle });
    else if (avant) await tx.apparenceImage.delete({ where: { cle } });
    if (avant) await tx.imageRetiree.create({ data: { cle: avant.cleImage, url: avant.url, cleMini: avant.cleMini, urlMini: avant.urlMini } });
  });
  reglees = null;
}

// remplacer
apparence.post('/api/apparence/:cle', ...gerer, ...recevoirImage, traiter(async (req, res) => {
  const d = definition(req);
  const image = await enregistrerImage('apparence', req.file);
  // échec de l'enregistrement : le fichier tout juste déposé est retiré (jamais un fichier sans trace en base)
  try { await changerImage(d.cle, { cleImage: image.cle, url: image.url, cleMini: image.cleMini, urlMini: image.urlMini, compteId: req.compte.id }); }
  catch (e) { await retirerImage(image).catch(() => {}); throw e; }
  // proportions très différentes de l'image livrée : signalées, pas refusées
  const ratio = image.largeur / image.hauteur, attendu = d.largeur / d.hauteur;
  res.json({ ok: true, avertissement: Math.abs(ratio - attendu) / attendu > 0.08 ? `Proportions différentes de l’image d’origine (${d.largeur} × ${d.hauteur}) : elle peut apparaître déformée ou rognée.` : null });
}));

// rétablir l'image d'origine
apparence.delete('/api/apparence/:cle', ...gerer, traiter(async (req, res) => {
  await changerImage(definition(req).cle, null);
  res.json({ ok: true });
}));
