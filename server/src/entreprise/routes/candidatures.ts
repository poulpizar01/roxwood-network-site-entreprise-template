// ENTREPRISE — routes du module « recrutement » (montées seulement s'il est allumé dans site.json) : /api/candidatures/…, page
// gestion/recrutement.html. « rh-voir » : consulter et voter ; « rh-creer » (en plus) : convoquer, accepter, refuser, annoter,
// supprimer. Dépôt public : identité Discord vérifiée exigée AVANT de recevoir le fichier (un visiteur anonyme n'envoie rien).
import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, intParam, permission } from '../../socle/http.js';
import { limiter } from '../../socle/limites.js';
import { recevoirImage } from '../../socle/images.js';
import { identiteVerifiee } from '../../socle/routes/discord-leger.js';
import {
  accepterCandidature, convoquerEntretien, creerCandidature, creerSalonPourCandidature, listerCandidatures, modifierNotesCandidature,
  modifierSalonCandidature, monVote, refuserCandidature, supprimerCandidature, voter,
} from '../candidatures.js';
import { traiter } from '../refus.js';

export const candidatures = Router();
const voir = permission('rh-voir');
// rh-creer, en plus de rh-voir (même recette que routes/rh.ts) : une permission RH coche sa propre case dans Grades
// (rh.ts s'importe à l'appel : il remonte jusqu'à index.ts, qui attend ce fichier au chargement)
const droits = async (req: Request) => (await import('../rh.js')).droitsRh(req.compte);
const gerer = async (req: Request, res: Response, next: NextFunction) => {
  if ((await droits(req)).has('creer')) next();
  else res.status(403).json({ error: 'Vous n’avez pas le droit de gérer les candidatures.' });
};

// ---- formulaire public (fenêtre de la vitrine, assets/js/candidature-depot.js) ----
const limiteCandidatures = limiter(60, 10, 'Trop de candidatures envoyées, réessayez plus tard.');
const exigerIdentite = (req: Request, res: Response, next: NextFunction) => {
  if (identiteVerifiee(req)) next();
  else res.status(401).json({ error: 'Connectez-vous avec Discord pour envoyer votre candidature.' });
};
candidatures.post('/api/candidatures', limiteCandidatures, exigerIdentite, ...recevoirImage, traiter(async (req, res) => {
  const c = await creerCandidature(body(req), identiteVerifiee(req), req.file);
  res.status(201).json({ id: c.id });
}));

// ---- gestion ----
candidatures.get('/api/candidatures', ...voir, traiter(async (req, res) => { res.json({ candidatures: await listerCandidatures((await droits(req)).has('piece-voir')) }); }));
candidatures.get('/api/candidatures/:id/mon-vote', ...voir, traiter(async (req, res) => { res.json({ vote: await monVote(intParam(req, 'id'), req.compte.id) }); }));
candidatures.put('/api/candidatures/:id/vote', ...voir, traiter(async (req, res) => { await voter(intParam(req, 'id'), req.compte.id, body(req).valeur); res.json({ ok: true }); }));

candidatures.patch('/api/candidatures/:id', ...voir, gerer, traiter(async (req, res) => {
  const b = body(req);
  // le salon d'abord : un identifiant invalide refuse l'enregistrement avant que les notes ne soient écrites
  if ('salonDiscordId' in b) await modifierSalonCandidature(intParam(req, 'id'), b.salonDiscordId);
  if ('notes' in b) await modifierNotesCandidature(intParam(req, 'id'), b.notes);
  res.json({ ok: true });
}));
candidatures.post('/api/candidatures/:id/salon', ...voir, gerer, traiter(async (req, res) => { res.status(201).json({ salonDiscordId: await creerSalonPourCandidature(intParam(req, 'id')) }); }));
candidatures.post('/api/candidatures/:id/entretien', ...voir, gerer, traiter(async (req, res) => {
  const b = body(req);
  await convoquerEntretien(intParam(req, 'id'), b.jour, b.heure, { id: req.compte.id, nom: req.compte.nom || req.compte.pseudo });
  res.json({ ok: true });
}));
candidatures.post('/api/candidatures/:id/accepter', ...voir, gerer, traiter(async (req, res) => {
  const r = await accepterCandidature(intParam(req, 'id'), req.compte.nom || req.compte.pseudo);
  res.json({ ok: true, employeId: r.employeId });
}));
candidatures.post('/api/candidatures/:id/refuser', ...voir, gerer, traiter(async (req, res) => { await refuserCandidature(intParam(req, 'id')); res.json({ ok: true }); }));
candidatures.delete('/api/candidatures/:id', ...voir, gerer, traiter(async (req, res) => { await supprimerCandidature(intParam(req, 'id')); res.json({ ok: true }); }));

