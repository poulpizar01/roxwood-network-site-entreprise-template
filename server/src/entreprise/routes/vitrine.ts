// ENTREPRISE — routes du module « vitrine » (montées seulement s'il est allumé dans site.json) : services de la page
// d'accueil, étiquettes, postes ouverts. Public : les services et les postes à pourvoir, et la photo d'un service
// non masqué ; tout le reste exige vitrine-voir / vitrine (services, étiquettes) ou postes-voir / postes (postes).
import { Router, type Request } from 'express';
import { prisma } from '../../socle/db.js';
import { body, intParam, permission } from '../../socle/http.js';
import { enregistrerImage, recevoirImage, retirerImage } from '../../socle/images.js';
import { storage } from '../../socle/storage.js';
import { Refus, traiter } from '../refus.js';
import {
  creerEtiquette, creerPoste, creerService, listerEtiquettes, listerPostes, listerServices, modifierEtiquette, modifierPoste, modifierService,
  ordonnerServices, postesPublics, urlPhoto, serviceDe, servicesPublics, supprimerEtiquette, supprimerPoste, supprimerService,
} from '../vitrine.js';
import { CACHE_COURT, changerImage, lireImage } from './apparence.js';

export const vitrine = Router();

const voirServices = permission('vitrine-voir'), gererServices = permission('vitrine');
const voirPostes = permission('postes-voir'), gererPostes = permission('postes');

// ---- photo d'un service : image d'apparence « service-<id> » (même traitement que le logo) ----
type Photo = { url: string; urlMini: string; majLe: Date };
const photoDe = async (id: number): Promise<Photo | null> => prisma.apparenceImage.findUnique({ where: { cle: `service-${id}` }, select: { url: true, urlMini: true, majLe: true } });
async function servirPhoto(res: import('express').Response, id: number, mini: boolean): Promise<void> {
  const photo = await photoDe(id);
  if (!photo) { res.status(404).end(); return; }
  try { res.set({ 'Content-Type': 'image/webp', 'Cache-Control': CACHE_COURT }).send(await lireImage(mini ? photo.urlMini : photo.url)); }
  catch (e) { console.error(`[vitrine] photo du service ${id} illisible sur le stockage (${(e as Error).message})`); res.status(404).end(); }
}
const serviceOu404 = async (req: Request) => {
  const s = await serviceDe(intParam(req, 'id'));
  if (!s) throw new Refus('Service introuvable.', 404);
  return s;
};
// un service masqué n'est pas public : sa photo, servie ici sans session, y répond 404 (la gestion la lit par /api/vitrine/…)
// la variante « -mini » d'abord : sinon « :id » prendrait « 7-mini » pour un identifiant
for (const mini of [true, false]) {
  vitrine.get(`/assets/img/service-:id${mini ? '-mini' : ''}.webp`, traiter(async (req, res) => {
    const s = await serviceDe(Number(req.params.id));
    if (!s || s.masque) { res.status(404).end(); return; }
    await servirPhoto(res, s.id, mini);
  }));
}

// ---- public : lecture JSON (la page d'accueil elle-même est rendue par routes/accueil-public.ts) ----
vitrine.get('/api/services/public', traiter(async (_req, res) => {
  const photos = new Map((await prisma.apparenceImage.findMany({ where: { cle: { startsWith: 'service-' } }, select: { cle: true, majLe: true } })).map(p => [p.cle, p]));
  res.json({ services: await servicesPublics(s => urlPhoto(s, photos.get(`service-${s.id}`))) });
}));
vitrine.get('/api/postes/public', traiter(async (_req, res) => { res.json({ postes: await postesPublics() }); }));

// ---- gestion : services ----
vitrine.get('/api/vitrine/services', ...voirServices, traiter(async (_req, res) => {
  const [services, etiquettes, photos] = await Promise.all([
    listerServices(), listerEtiquettes(),
    prisma.apparenceImage.findMany({ where: { cle: { startsWith: 'service-' } }, select: { cle: true, majLe: true } }),
  ]);
  const parCle = new Map(photos.map(p => [p.cle, p]));
  res.json({
    stockage: storage.accepte, etiquettes,
    services: services.map(s => {
      const photo = parCle.get(`service-${s.id}`);
      return { ...s, photo: { apercu: urlPhoto(s, photo), apercuMini: urlPhoto(s, photo, true), personnalisee: !!photo, majLe: photo?.majLe ?? null } };
    }),
  });
}));
vitrine.get('/api/vitrine/services/:id/apercu', ...voirServices, traiter(async (req, res) => { await servirPhoto(res, (await serviceOu404(req)).id, false); }));
vitrine.get('/api/vitrine/services/:id/apercu-mini', ...voirServices, traiter(async (req, res) => { await servirPhoto(res, (await serviceOu404(req)).id, true); }));
vitrine.post('/api/vitrine/services', ...gererServices, traiter(async (req, res) => { res.status(201).json({ id: await creerService(body(req)) }); }));
// déclarée avant /:id, qui la prendrait sinon pour l'id « ordre »
vitrine.put('/api/vitrine/services/ordre', ...gererServices, traiter(async (req, res) => { await ordonnerServices(body(req).ids); res.json({ ok: true }); }));
vitrine.put('/api/vitrine/services/:id', ...gererServices, traiter(async (req, res) => { await modifierService(intParam(req, 'id'), body(req)); res.json({ ok: true }); }));
vitrine.delete('/api/vitrine/services/:id', ...gererServices, traiter(async (req, res) => { await supprimerService((await serviceOu404(req)).id); res.json({ ok: true }); }));
vitrine.post('/api/vitrine/services/:id/photo', ...gererServices, ...recevoirImage, traiter(async (req, res) => {
  const s = await serviceOu404(req);
  const image = await enregistrerImage('apparence', req.file);
  try { await changerImage(`service-${s.id}`, { cleImage: image.cle, url: image.url, cleMini: image.cleMini, urlMini: image.urlMini, compteId: req.compte.id }); }
  catch (e) { await retirerImage(image).catch(() => {}); throw e; }
  res.json({ ok: true });
}));
vitrine.delete('/api/vitrine/services/:id/photo', ...gererServices, traiter(async (req, res) => { await changerImage(`service-${(await serviceOu404(req)).id}`, null); res.json({ ok: true }); }));

// ---- gestion : étiquettes ----
vitrine.post('/api/vitrine/etiquettes', ...gererServices, traiter(async (req, res) => { await creerEtiquette(body(req)); res.status(201).json({ etiquettes: await listerEtiquettes() }); }));
vitrine.put('/api/vitrine/etiquettes/:id', ...gererServices, traiter(async (req, res) => { await modifierEtiquette(intParam(req, 'id'), body(req)); res.json({ etiquettes: await listerEtiquettes() }); }));
// retirée des services qui la portaient : leur fiche redonne la liste à jour
vitrine.delete('/api/vitrine/etiquettes/:id', ...gererServices, traiter(async (req, res) => {
  await supprimerEtiquette(intParam(req, 'id'));
  res.json({ etiquettes: await listerEtiquettes(), services: await listerServices() });
}));

// ---- gestion : postes ouverts ----
vitrine.get('/api/vitrine/postes', ...voirPostes, traiter(async (_req, res) => { res.json({ postes: await listerPostes() }); }));
vitrine.post('/api/vitrine/postes', ...gererPostes, traiter(async (req, res) => { await creerPoste(body(req)); res.status(201).json({ postes: await listerPostes() }); }));
vitrine.put('/api/vitrine/postes/:id', ...gererPostes, traiter(async (req, res) => { await modifierPoste(intParam(req, 'id'), body(req)); res.json({ postes: await listerPostes() }); }));
vitrine.delete('/api/vitrine/postes/:id', ...gererPostes, traiter(async (req, res) => { await supprimerPoste(intParam(req, 'id')); res.json({ postes: await listerPostes() }); }));
