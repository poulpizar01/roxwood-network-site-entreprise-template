// ENTREPRISE — routes des contrats (/api/contrats/…), page gestion/contrats.html. Permission « contrats ».
import { Router } from 'express';
import { body, intParam, permission } from '../../socle/http.js';
import { changerStatutContrat, creerContrat, listerContrats, modifierContrat, supprimerContrat } from '../contrats.js';
import { traiter } from '../refus.js';

export const contrats = Router();
const gerer = permission('contrats');

contrats.get('/api/contrats', ...gerer, async (_req, res) => {
  res.json({ contrats: await listerContrats() });
});

contrats.post('/api/contrats', ...gerer, traiter(async (req, res) => {
  const c = await creerContrat(body(req), req.compte.id);
  res.status(201).json({ id: c.id });
}));

contrats.put('/api/contrats/:id', ...gerer, traiter(async (req, res) => {
  await modifierContrat(intParam(req, 'id'), body(req));
  res.json({ ok: true });
}));

contrats.post('/api/contrats/:id/statut', ...gerer, traiter(async (req, res) => {
  await changerStatutContrat(intParam(req, 'id'), String(body(req).statut ?? ''), req.compte.id);
  res.json({ ok: true });
}));

contrats.delete('/api/contrats/:id', ...gerer, traiter(async (req, res) => {
  await supprimerContrat(intParam(req, 'id'));
  res.json({ ok: true });
}));
