// SOCLE — image donnée par son adresse (docs/stockage.md). Le serveur la télécharge, vérifie que c'est bien une image et
// la rend au navigateur, qui la place dans le champ fichier (socle/folkos.js) : elle repart ensuite par la route d'envoi
// habituelle, avec ses droits, ses limites et son réencodage. Rien n'est enregistré ici.
// Seulement avec l'ordinateur en jeu (FOLKOS_HOTE) et pour un compte validé : jamais de téléchargement à la demande
// d'un visiteur anonyme.
import { Router } from 'express';
import sharp from 'sharp';
import { config } from '../config.js';
import { body, text, valide } from '../http.js';
import { limits } from '../limites.js';
import { LienRefuse, telecharger } from '../telechargement.js';

export const imageLien = Router();

const OCTETS_MAX = 15 * 1024 * 1024;
const PIXELS_MAX = 25_000_000;   // comme à la réception d'un fichier (images.ts)
const FORMATS = ['jpeg', 'png', 'webp'];
// chaque image reste en mémoire le temps d'être renvoyée : peu à la fois
const EN_COURS_MAX = 2;
let enCours = 0;

if (config.folkos.hote) imageLien.post('/api/image-distante', ...valide, limits.upload, async (req, res) => {
  if (enCours >= EN_COURS_MAX) { res.status(503).set('Retry-After', '10').json({ error: 'Trop d’images en cours de récupération, réessaie dans quelques secondes.' }); return; }
  enCours++;
  try {
    const image = await telecharger(text(body(req).url, 2000), OCTETS_MAX);
    const format = await sharp(image, { limitInputPixels: PIXELS_MAX }).metadata().then(m => m.format, () => undefined);
    if (!format || !FORMATS.includes(format)) throw new LienRefuse('Cette adresse ne mène pas à une image jpg, png ou webp (25 mégapixels max).');
    res.type(`image/${format}`).send(image);
  } catch (e) {
    if (!(e instanceof LienRefuse)) throw e;
    res.status(400).json({ error: e.message });
  } finally { enCours--; }
});
