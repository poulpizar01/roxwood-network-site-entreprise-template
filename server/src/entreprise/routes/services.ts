// ENTREPRISE — routes des membres en service (/api/services/…) : indicateur du menu et Accueil, état de la réception
// dans Paramètres (logique : entreprise/services.ts ; les services arrivent du bot, événement monitoring.duty).
import { Router } from 'express';
import { config } from '../../socle/config.js';
import { prisma } from '../../socle/db.js';
import { body, intParam, permission, valide } from '../../socle/http.js';
import { entierRegle } from '../parametres.js';
import { traiter } from '../refus.js';
import { nomComplet } from '../rh.js';
import { anomaliesATraiter, corrigerService, ignorerAnomalie } from '../services.js';

export const services = Router();

// qui est en service, depuis quand (indicateur du menu, Accueil) : tout compte validé ; moi : la ligne du compte connecté
services.get('/api/services/en-cours', ...valide, async (req, res) => {
  const [ouverts, etat] = await Promise.all([prisma.service.findMany({ where: { fin: null }, orderBy: { debut: 'asc' }, take: 100 }), prisma.serviceEtat.findUnique({ where: { id: 1 } })]);
  const fiches = new Map((await prisma.employe.findMany({ where: { id: { in: ouverts.map(o => o.employeId).filter((x): x is number => x !== null) } } })).map(e => [e.id, e]));
  res.json({
    // affiché dès qu'au moins une prise ou fin de service a été reçue du bot (sinon l'abonnement n'est pas fait)
    regle: !!etat?.derniereLecture,
    enService: ouverts.map(o => { const f = o.employeId ? fiches.get(o.employeId) : undefined; return { nom: f ? nomComplet(f) : o.employeNom, depuis: o.debut, moi: !!o.discordId && o.discordId === req.compte.discordId }; }),
  });
});

// état de la réception (Paramètres) : dernier événement reçu du bot, anomalies récentes
services.get('/api/services/etat', ...permission('parametres'), async (_req, res) => {
  const [etat, anomalies, enService] = await Promise.all([
    prisma.serviceEtat.findUnique({ where: { id: 1 } }),
    prisma.service.findMany({ where: { anomalie: { not: '' } }, orderBy: [{ majLe: 'desc' }, { id: 'desc' }], take: 10, select: { employeNom: true, debut: true, fin: true, causeFin: true, anomalie: true } }),
    prisma.service.count({ where: { fin: null } }),
  ]);
  res.json({
    abonnementPossible: config.webhookSecrets.length > 0, clotureHeures: entierRegle('services_cloture_heures'),
    dernierRecu: etat?.derniereLecture ?? null, recus: etat?.nbReconnus ?? 0, enService, anomalies,
  });
});

// anomalies à traiter (RH, onglet Services) : tant qu'une ligne n'est pas corrigée ou ignorée, ses heures ne comptent
// pas dans la paie à l'heure de la DOT (services.ts, heuresServiceSemaine).
services.get('/api/services/anomalies', ...permission('rh-voir'), async (_req, res) => {
  res.json({ anomalies: await anomaliesATraiter() });
});

services.put('/api/services/:id', ...permission('rh-modifier'), traiter(async (req, res) => {
  const b = body(req);
  await corrigerService(intParam(req, 'id'), String(b.jour ?? ''), String(b.heure_debut ?? ''), String(b.heure_fin ?? ''));
  res.json({ ok: true });
}));

services.post('/api/services/:id/ignorer', ...permission('rh-modifier'), traiter(async (req, res) => {
  await ignorerAnomalie(intParam(req, 'id'));
  res.json({ ok: true });
}));
