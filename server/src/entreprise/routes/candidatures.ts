// ENTREPRISE — routes du module « recrutement » (montées seulement s'il est allumé dans site.json) : /api/candidatures/…, page
// onglet Candidatures de gestion/rh.html. « rh-voir » : consulter et voter ; « rh-creer » (en plus) : convoquer, accepter, refuser, annoter,
// supprimer. Dépôt public : identité Discord vérifiée exigée AVANT de recevoir le fichier (un visiteur anonyme n'envoie rien).
import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, intParam, permission } from '../../socle/http.js';
import { limiter } from '../../socle/limites.js';
import { recevoirImagesLimitees } from '../../socle/images.js';
import { identiteVerifiee } from '../../socle/routes/discord-leger.js';
import {
  accepterCandidature, convoquerEntretien, creerCandidature, creerQuestion, creerSalonPourCandidature, definirReglagesRecrutement, etatChampsFiche, formulairePublic,
  listerCandidatures, listerPiecesDemandees, listerQuestions, PIECE_MAX_MO, PIECES_MAX, modifierNotesCandidature, modifierQuestion, modifierSalonCandidature, monVote, ordonnerQuestions, refuserCandidature, reglagesRecrutement,
  supprimerCandidature, supprimerQuestion, voter,
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
// une image par pièce demandée (champ « piece-<id> »), 10 Mo pour l'ensemble, 2 au plus : le créneau mémoire du socle est partagé par tout l'envoi
const recevoirPieces = recevoirImagesLimitees(PIECE_MAX_MO, PIECES_MAX);
candidatures.post('/api/candidatures', limiteCandidatures, exigerIdentite, ...recevoirPieces, traiter(async (req, res) => {
  const c = await creerCandidature(body(req), identiteVerifiee(req), (req.files as Express.Multer.File[] | undefined) ?? []);
  res.status(201).json({ id: c.id });
}));

// formulaire tel que le site le présente (questions, pièce) : public, sans rien de la fiche visée par une réponse
candidatures.get('/api/candidatures/formulaire', traiter(async (_req, res) => { res.json(await formulairePublic()); }));

// ---- gestion ----
// réglages du recrutement (mode bot / site, pièce, grade d'arrivée) et questions du formulaire : lecture rh-voir, écriture rh-parametrer
const parametrer = async (req: Request, res: Response, next: NextFunction) => {
  if ((await droits(req)).has('parametrer')) next();
  else res.status(403).json({ error: 'Vous n’avez pas le droit de régler le recrutement.' });
};
candidatures.get('/api/candidatures/reglages', ...voir, traiter(async (_req, res) => {
  const questions = await listerQuestions();
  res.json({ ...reglagesRecrutement(), champsFiche: etatChampsFiche(questions), pieces: await listerPiecesDemandees(), piecesMax: PIECES_MAX, questions });
}));
candidatures.put('/api/candidatures/reglages', ...voir, parametrer, traiter(async (req, res) => { await definirReglagesRecrutement(body(req), req.compte); res.json({ ok: true }); }));
candidatures.post('/api/candidatures/questions', ...voir, parametrer, traiter(async (req, res) => { await creerQuestion(body(req)); res.status(201).json({ questions: await listerQuestions() }); }));
// déclarée avant /:id, qui la prendrait sinon pour l'id « ordre »
candidatures.put('/api/candidatures/questions/ordre', ...voir, parametrer, traiter(async (req, res) => { await ordonnerQuestions(body(req).ids); res.json({ questions: await listerQuestions() }); }));
candidatures.put('/api/candidatures/questions/:id', ...voir, parametrer, traiter(async (req, res) => { await modifierQuestion(intParam(req, 'id'), body(req)); res.json({ questions: await listerQuestions() }); }));
candidatures.delete('/api/candidatures/questions/:id', ...voir, parametrer, traiter(async (req, res) => { await supprimerQuestion(intParam(req, 'id')); res.json({ questions: await listerQuestions() }); }));

candidatures.get('/api/candidatures', ...voir, traiter(async (req, res) => { const d = await droits(req); res.json({ candidatures: await listerCandidatures(d.has('piece-voir'), d.has('sensible-voir')) }); }));
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
  const r = await accepterCandidature(intParam(req, 'id'), req.compte);
  res.json({ ok: true, employeId: r.employeId });
}));
candidatures.post('/api/candidatures/:id/refuser', ...voir, gerer, traiter(async (req, res) => { await refuserCandidature(intParam(req, 'id')); res.json({ ok: true }); }));
candidatures.delete('/api/candidatures/:id', ...voir, gerer, traiter(async (req, res) => { await supprimerCandidature(intParam(req, 'id')); res.json({ ok: true }); }));

