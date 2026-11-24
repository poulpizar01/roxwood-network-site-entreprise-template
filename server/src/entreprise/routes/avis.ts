// ENTREPRISE — routes du module « avis » (montées seulement s'il est allumé dans site.json) : /api/avis/…, page gestion/avis.html.
// Lecture de la file de modération : « avis-voir » ; décider (publier, refuser, épingler, supprimer) : « avis » (requiert
// avis-voir). Lecture publique (accueil, page Avis) sans garde ; dépôt : identité Discord vérifiée exigée.
import { Router } from 'express';
import { body, entier, intParam, permission } from '../../socle/http.js';
import { limiter } from '../../socle/limites.js';
import { identiteVerifiee } from '../../socle/routes/discord-leger.js';
import {
  creerAvis, desepinglerAvis, epinglerAvis, listerAvisGestion, listerAvisPublics, publierAvis,
  refuserAvis, remettreEnAttenteAvis, supprimerAvis,
} from '../avis.js';
import { traiter } from '../refus.js';

export const avis = Router();
const voir = permission('avis-voir');
const gerer = permission('avis');

// ---- formulaire public ----
const limiteAvis = limiter(60, 10, 'Trop d’avis envoyés, réessayez plus tard.');
avis.post('/api/avis', limiteAvis, traiter(async (req, res) => {
  const a = await creerAvis(body(req), identiteVerifiee(req));
  res.status(201).json({ id: a.id });
}));

// ---- lecture publique ----
avis.get('/api/avis', traiter(async (req, res) => { res.json(await listerAvisPublics(entier(req.query.page) ?? 1)); }));

// ---- modération (gestion) ----
avis.get('/api/avis/gestion', ...voir, traiter(async (_req, res) => { res.json({ avis: await listerAvisGestion() }); }));
avis.post('/api/avis/:id/publier', ...gerer, traiter(async (req, res) => { res.json(await publierAvis(intParam(req, 'id'))); }));
avis.post('/api/avis/:id/refuser', ...gerer, traiter(async (req, res) => { res.json(await refuserAvis(intParam(req, 'id'))); }));
avis.post('/api/avis/:id/attente', ...gerer, traiter(async (req, res) => { res.json(await remettreEnAttenteAvis(intParam(req, 'id'))); }));
avis.post('/api/avis/:id/epingler', ...gerer, traiter(async (req, res) => { await epinglerAvis(intParam(req, 'id')); res.json({ ok: true }); }));
avis.post('/api/avis/:id/desepingler', ...gerer, traiter(async (req, res) => { await desepinglerAvis(intParam(req, 'id')); res.json({ ok: true }); }));
avis.delete('/api/avis/:id', ...gerer, traiter(async (req, res) => { await supprimerAvis(intParam(req, 'id')); res.json({ ok: true }); }));
