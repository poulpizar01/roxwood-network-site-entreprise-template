// SOCLE — consultation des webhooks reçus (permission « webhooks »), pour diagnostiquer un traitement en échec.
// À part de l'ingestion (routes/webhooks.ts, montée avant les sessions, body brut pour la signature) : cette route
// passe par les sessions et l'authentification comme le reste de l'API (montée avec comptes/grades/parametres).
// Le contenu d'un événement traité avec succès est effacé par l'ingestion (webhooks.ts) : seuls les événements en
// échec gardent leur payload, le temps du diagnostic.
import { Router } from 'express';
import { prisma } from '../db.js';
import { intParam, permission } from '../http.js';

export const webhooksJournal = Router();

webhooksJournal.get('/api/webhooks', ...permission('webhooks'), async (req, res) => {
  const type = typeof req.query.type === 'string' ? req.query.type.trim().slice(0, 64) : '';
  const traiteParam = req.query.traite;
  const traite = traiteParam === 'oui' ? true : traiteParam === 'non' ? false : undefined;
  const lignes = await prisma.webhookRecu.findMany({
    where: { ...(type && { type }), ...(traite !== undefined && { traite }) },
    orderBy: { recuLe: 'desc' },
    take: 500,
    omit: { contenu: true },   // jusqu'à 64 Ko par événement en échec : le contenu se lit à l'ouverture (GET /api/webhooks/:id)
  });
  res.json({ webhooks: lignes });
});

webhooksJournal.get('/api/webhooks/:id', ...permission('webhooks'), async (req, res) => {
  const w = await prisma.webhookRecu.findUnique({ where: { id: intParam(req, 'id') } });
  if (!w) { res.status(404).json({ error: 'Événement introuvable.' }); return; }
  res.json({ webhook: w });
});
