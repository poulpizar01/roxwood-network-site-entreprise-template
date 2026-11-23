// SOCLE — réception et traitement des images envoyées (photos d'articles, bannières, pièces jointes…).
// Une route d'envoi de l'entreprise s'écrit :
//   router.post('/api/articles/:id/photo', ...permission('catalogue'), ...recevoirImage, async (req, res) => {
//     const image = await enregistrerImage('articles', req.file);   // { cle, url, cleMini, urlMini, largeur, hauteur }
//     … enregistrer les quatre premiers champs en base ; à la suppression : retirerImage(image)
//   });
// Pas d'image donnée par lien : seul un fichier envoyé au site entre sur le stockage (ni téléchargement par le serveur,
// ni adresse d'une image hébergée ailleurs).
// Contrôles : 15 Mo par défaut, 25 mégapixels, contenu réellement jpg / png / webp (pas seulement l'extension), une image par
// envoi ; réencodage WebP (1 800 px + miniature 600 px), orientation appliquée, métadonnées (GPS…) retirées.
import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import multer from 'multer';
import sharp, { type Metadata } from 'sharp';
import { limits } from './limites.js';
import { storage } from './storage.js';

// à garder sous le plafond mémoire du conteneur (APP_MEMORY)
const MAX_PIXELS = 25_000_000;
// Mémoire de sharp : ni cache d'opérations (chaque image n'est traitée qu'une fois) ni plusieurs fils par image.
// Mesuré sur 25 Mpx, pic du processus : JPEG 125 Mo, PNG 16 bits avec transparence 156 à 191 Mo — contre 175 et 348 Mo
// avec les réglages par défaut de sharp, trop près du plafond du conteneur (512 Mo).
sharp.cache(false);
sharp.concurrency(1);
const FORMATS_ACCEPTES = ['jpeg', 'png', 'webp'];

// stockage prêt (sinon 503 explicite), limite d'envois, puis lecture du champ « image » du formulaire
const stockagePret: RequestHandler = (_req, res, next) => {
  if (storage.accepte) next();
  else res.status(503).json({ error: 'L’envoi d’images n’est pas encore configuré sur ce site.' });
};
// Chaque envoi reçu garde son fichier en mémoire (15 Mo au plus) jusqu'à la fin de son traitement : au-delà de quelques
// envois en même temps, tous comptes confondus, le plafond mémoire du conteneur serait dépassé. Les suivants repassent.
// La place n'est rendue qu'à la fin du traitement, pas quand le navigateur abandonne : sinon un envoi abandonné
// libérerait sa place tout en gardant son fichier en mémoire, et le plafond ne protégerait plus rien.
const ENVOIS_MAX = 3;
let envois = 0;
type Creneau = { traitement: boolean; liberer: () => void; abandonne: () => boolean };
const CRENEAU = Symbol('creneau');
type FichierRecu = Express.Multer.File & { [CRENEAU]?: Creneau };
const envoisBornes: RequestHandler = (req, res, next) => {
  if (envois >= ENVOIS_MAX) { res.status(503).set('Retry-After', '10').json({ error: 'Trop d’images en cours d’envoi, réessaie dans quelques secondes.' }); return; }
  envois++;
  let libre = false;
  // connexion coupée (pas req.destroyed : vrai dès que le corps de la requête est lu, donc pour tout envoi)
  const creneau: Creneau = { traitement: false, liberer: () => { if (!libre) { libre = true; envois--; } }, abandonne: () => req.socket.destroyed };
  res.locals.creneauImage = creneau;
  // refusé ou abandonné avant le traitement : la place est rendue avec la réponse ; sinon enregistrerImage la rend
  res.once('close', () => { if (!creneau.traitement) creneau.liberer(); });
  next();
};
export function recevoirImageLimitee(maxMo: number): RequestHandler[] {
  const maxOctets = maxMo * 1024 * 1024;
  const multerUn = multer({
    // Garde un octet pour vérifier la borne exacte, même si le parseur lève une erreur en l’atteignant.
    storage: multer.memoryStorage(), limits: { fileSize: maxOctets + 1, files: 1 },
    fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
  }).single('image');
  const lire: RequestHandler = (req, res, next) => multerUn(req, res, err => {
    const tailleDepassee = (req.file?.size ?? 0) > maxOctets;
    if (!err && !tailleDepassee) {
      if (req.file) (req.file as FichierRecu)[CRENEAU] = res.locals.creneauImage;
      return next();
    }
    const tropLourde = tailleDepassee || (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE');
    res.status(400).json({ error: tropLourde ? `Image trop lourde (${maxMo} Mo max).` : 'Envoi illisible.' });
  });
  return [stockagePret, limits.upload, envoisBornes, lire];
}
export const recevoirImage = recevoirImageLimitee(15);

// un seul traitement à la fois : deux images de 25 Mpx en parallèle dépasseraient la mémoire du conteneur
let file: Promise<unknown> = Promise.resolve();
const aTonTour = <T>(travail: () => Promise<T>): Promise<T> => {
  const tour = file.then(travail, travail);
  file = tour.catch(() => {});
  return tour;
};

export class ImageRefusee extends Error {}

export type ImageEnregistree = { cle: string; url: string; cleMini: string; urlMini: string; largeur: number; hauteur: number };

// contrôle, réencode et enregistre ; lève ImageRefusee (message à montrer tel quel, 400) ou une erreur de stockage (502)
export async function enregistrerImage(dossier: string, fichier: Express.Multer.File | undefined): Promise<ImageEnregistree> {
  if (!/^[a-z0-9-]+$/.test(dossier)) throw new Error(`enregistrerImage : dossier invalide « ${dossier} »`);
  if (!fichier) throw new ImageRefusee('Aucune image (jpg, png ou webp).');
  const creneau = (fichier as FichierRecu)[CRENEAU];
  if (creneau) creneau.traitement = true;
  try { return await traiter(dossier, fichier, creneau); } finally { creneau?.liberer(); }
}

async function traiter(dossier: string, fichier: Express.Multer.File, creneau: Creneau | undefined): Promise<ImageEnregistree> {
  const { grande, mini } = await aTonTour(async () => {
    // envoi abandonné pendant l'attente : on ne traite pas une image que personne ne recevra
    if (creneau?.abandonne()) throw new ImageRefusee('Envoi abandonné.');
    let meta: Metadata;
    try { meta = await sharp(fichier.buffer, { limitInputPixels: MAX_PIXELS }).metadata(); } catch { throw new ImageRefusee('Image illisible.'); }
    if (!meta.format || !FORMATS_ACCEPTES.includes(meta.format)) throw new ImageRefusee('Format refusé : jpg, png ou webp uniquement (pas de gif ni de heic).');
    if ((meta.pages ?? 1) > 1) throw new ImageRefusee('Les images animées ne sont pas acceptées.');
    const img = sharp(fichier.buffer, { animated: false, limitInputPixels: MAX_PIXELS }).rotate();
    return {
      grande: await img.clone().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true }),
      mini: await img.clone().resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
    };
  });
  // clé non dérivée du nom du fichier envoyé
  const base = `${dossier}/${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const cle = `${base}.webp`, cleMini = `${base}-m.webp`;
  const url = await storage.put(cle, grande.data);
  let urlMini: string;
  try { urlMini = await storage.put(cleMini, mini); }
  catch (e) { await storage.remove(cle, url).catch(() => {}); throw e; }
  return { cle, url, cleMini, urlMini, largeur: grande.info.width, hauteur: grande.info.height };
}

// retire les deux fichiers ; lève une erreur si le stockage ne répond pas (garder alors la ligne en base et réessayer)
export async function retirerImage(i: Pick<ImageEnregistree, 'cle' | 'url' | 'cleMini' | 'urlMini'>): Promise<void> {
  await storage.remove(i.cle, i.url);
  await storage.remove(i.cleMini, i.urlMini);
}
