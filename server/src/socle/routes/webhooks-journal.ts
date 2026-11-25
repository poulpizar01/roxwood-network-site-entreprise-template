// SOCLE — consultation des webhooks reçus (permission « webhooks »), pour diagnostiquer un traitement en échec.
// À part de l'ingestion (routes/webhooks.ts, montée avant les sessions, body brut pour la signature) : cette route
// passe par les sessions et l'authentification comme le reste de l'API (montée avec comptes/grades/parametres).
// Pour un échec, seules les métadonnées utiles au diagnostic sont renvoyées.
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
    omit: { contenu: true },
  });
  res.json({ webhooks: lignes });
});

webhooksJournal.get('/api/webhooks/:id', ...permission('webhooks'), async (req, res) => {
  const w = await prisma.webhookRecu.findUnique({ where: { id: intParam(req, 'id') } });
  if (!w) { res.status(404).json({ error: 'Événement introuvable.' }); return; }
  const contenu = w.contenu as { sentAt?: unknown };
  res.json({ webhook: { ...w, contenu: typeof contenu?.sentAt === 'string' ? { sentAt: contenu.sentAt } : {} } });
});
