// SOCLE — abonnements du bot Discord entreprise par type d'événement (permission « webhooks », déclarée au même
// titre que « comptes » ou « grades » : la page existe pour tous les sites, pas seulement celui-ci). Une clé par
// type (entreprise.webhooks), chiffrée en base (AES-256-GCM, socle/webhooks-cle.ts) : jamais revue en clair après
// son enregistrement. Remplacement sans coupure : l'ancienne clé, si demandé, reste acceptée 24 h (relue par
// socle/routes/webhooks.ts). Historique (qui, quand, quelle empreinte) gardé à part, jamais la clé elle-même.
import { Router, type Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../db.js';
import { body, permission, text } from '../http.js';
import { entreprise } from '../../entreprise/index.js';
import { chiffrer, dechiffrerCleActive } from '../webhooks-cle.js';

export const webhooksAbonnements = Router();

const CLE_FORME = /^[0-9a-f]{64}$/i;
// Enregistrer ou remplacer une clé exige une connexion Discord de moins de 5 min (socle/routes/auth.ts met à jour
// connecteLe à chaque connexion, dev local comprise) : une session restée ouverte longtemps ne suffit pas à elle
// seule à reprendre un abonnement.
const RECONFIRMATION_MS = 5 * 60_000;

const typeDeclare = (type: string): boolean => !!entreprise.webhooks && Object.hasOwn(entreprise.webhooks, type);

// Repartir de la clé réellement en place si deux modifications se croisent.
async function modifierAbonnement(res: Response, action: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  for (let tentative = 0; tentative < 3; tentative++) {
    try {
      await prisma.$transaction(action, { isolationLevel: 'Serializable' });
      res.json({ ok: true });
      return;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2034') throw err;
    }
  }
  res.status(409).json({ error: 'Cet abonnement vient d’être modifié. Actualise la page et réessaie.' });
}

webhooksAbonnements.get('/api/webhooks/abonnements', ...permission('webhooks'), async (_req, res) => {
  const types = Object.entries(entreprise.webhooks ?? {});
  const abonnements = await Promise.all(types.map(async ([type, info]) => {
    const [abonnement, dernier, echecs] = await Promise.all([
      prisma.abonnementWebhook.findUnique({ where: { type } }),
      prisma.webhookRecu.findFirst({ where: { type }, orderBy: { recuLe: 'desc' }, select: { recuLe: true, traite: true } }),
      prisma.webhookRecu.count({ where: { type, traite: false } }),
    ]);
    const etat = !abonnement ? 'non_configure'
      : !dechiffrerCleActive(abonnement) ? 'cle_illisible'
      : !dernier ? 'en_attente'
      : dernier.traite ? 'actif' : 'en_echec';
    return { type, libelle: info.libelle, description: info.description, etat, dernierRecuLe: dernier?.recuLe ?? null, echecs };
  }));
  res.json({ abonnements });
});

webhooksAbonnements.get('/api/webhooks/abonnements/:type/historique', ...permission('webhooks'), async (req, res) => {
  const type = text(req.params.type, 64);
  if (!typeDeclare(type)) { res.status(404).json({ error: 'type inconnu' }); return; }
  const historique = await prisma.historiqueAbonnementWebhook.findMany({ where: { type }, orderBy: { horodateLe: 'desc' }, take: 50 });
  res.json({ historique });
});

webhooksAbonnements.post('/api/webhooks/abonnements/:type/cle', ...permission('webhooks'), async (req, res) => {
  const type = text(req.params.type, 64);
  if (!typeDeclare(type)) { res.status(404).json({ error: 'type inconnu' }); return; }
  if (!req.compte.connecteLe || Date.now() - req.compte.connecteLe.getTime() > RECONFIRMATION_MS) { res.status(403).json({ error: 'discord-recent' }); return; }
  const c = body(req);
  const cle = text(c.cle, 128);
  if (!CLE_FORME.test(cle)) { res.status(400).json({ error: 'Clé invalide : 64 caractères hexadécimaux attendus (celle affichée par le bot).' }); return; }
  const immediate = c.expirationAncienne === 'immediate';
  const nouvelle = chiffrer(cle, type);
  await modifierAbonnement(res, async tx => {
    const existant = await tx.abonnementWebhook.findUnique({ where: { type } });
    const champsCle = { cleChiffree: nouvelle.chiffre, cleNonce: nouvelle.nonce, cleEmpreinte: nouvelle.empreinte };
    await tx.abonnementWebhook.upsert({
      where: { type },
      create: { type, ...champsCle },
      update: {
        ...champsCle,
        ...(existant && !immediate
          ? { ancienneCleChiffree: existant.cleChiffree, ancienneCleNonce: existant.cleNonce, ancienneCleEmpreinte: existant.cleEmpreinte, ancienneExpireLe: new Date(Date.now() + 24 * 3600_000) }
          : { ancienneCleChiffree: null, ancienneCleNonce: null, ancienneCleEmpreinte: null, ancienneExpireLe: null }),
      },
    });
    await tx.historiqueAbonnementWebhook.create({
      data: { type, action: existant ? 'remplacement' : 'creation', empreinte: nouvelle.empreinte, compteId: req.compte.id, acteurNom: req.compte.nom || req.compte.pseudo },
    });
  });
});

webhooksAbonnements.delete('/api/webhooks/abonnements/:type', ...permission('webhooks'), async (req, res) => {
  const type = text(req.params.type, 64);
  if (!typeDeclare(type)) { res.status(404).json({ error: 'type inconnu' }); return; }
  // comme l'enregistrement d'une clé : couper la réception d'un type d'événement exige une connexion Discord récente
  if (!req.compte.connecteLe || Date.now() - req.compte.connecteLe.getTime() > RECONFIRMATION_MS) { res.status(403).json({ error: 'discord-recent' }); return; }
  await modifierAbonnement(res, async tx => {
    const { count } = await tx.abonnementWebhook.deleteMany({ where: { type } });
    if (count) await tx.historiqueAbonnementWebhook.create({
      data: { type, action: 'retrait', compteId: req.compte.id, acteurNom: req.compte.nom || req.compte.pseudo },
    });
  });
});
