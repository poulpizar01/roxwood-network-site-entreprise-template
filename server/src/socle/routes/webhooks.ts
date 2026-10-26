// SOCLE — réception des webhooks du bot Discord entreprise (roxwood-network-entreprise, panneau « Monitoring »).
// Le bot signe chaque envoi : en-tête X-Signature-256 = HMAC-SHA256 du corps brut (hex), avec le secret propre à
// l'abonnement. Ici : signature vérifiée en temps constant contre chaque secret de BOT_WEBHOOK_SECRETS, serveur Discord
// contrôlé, événement enregistré une seule fois (empreinte du corps : une nouvelle tentative du bot n'est pas traitée deux
// fois), puis confié au traitement que déclare l'entreprise (entreprise/index.ts → webhooks).
// Route d'ingestion uniquement : elle ne renvoie jamais de donnée.
import crypto from 'node:crypto';
import express, { Router } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { Prisma } from '../../generated/prisma/client.js';
import { limits } from '../limites.js';
import type { EvenementBot } from '../contrat.js';
import { entreprise } from '../../entreprise/index.js';

export const webhooks = Router();

// une même empreinte en cours de traitement (deux livraisons simultanées) ne doit démarrer le traitement de
// l'entreprise qu'une seule fois : verrou en mémoire (une seule instance par VPS, cf. CLAUDE.md « Déploiement »)
// tenu de la création de la ligne jusqu'à son marquage traité, pas seulement sur l'insertion
const empreintesEnCours = new Set<string>();

const signatureValide = (corps: Buffer, recue: string): boolean => {
  if (!/^[0-9a-f]{64}$/i.test(recue)) return false;
  const attendue = Buffer.from(recue.toLowerCase(), 'hex');
  // chaque secret est essayé, sans s'arrêter au premier : le temps de réponse ne dit pas lequel a servi
  return config.webhookSecrets.reduce((ok, secret) =>
    crypto.timingSafeEqual(crypto.createHmac('sha256', secret).update(corps).digest(), attendue) || ok, false);
};

const estEvenement = (v: unknown): v is EvenementBot =>
  !!v && typeof v === 'object' && typeof (v as EvenementBot).guildId === 'string' && typeof (v as EvenementBot).eventType === 'string'
  && /^[\w.-]{1,64}$/.test((v as EvenementBot).eventType) && typeof (v as EvenementBot).sentAt === 'string';

// corps brut (la signature porte sur les octets reçus, pas sur un JSON relu) ; 1 Mo : le bot n'envoie jamais d'image
webhooks.post('/webhooks/bot', limits.webhooks, express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
  if (!config.webhookSecrets.length) { res.status(503).json({ error: 'webhooks non configurés' }); return; }
  const corps = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!signatureValide(corps, String(req.get('x-signature-256') ?? ''))) { res.status(401).json({ error: 'signature refusée' }); return; }

  let e: unknown;
  try { e = JSON.parse(corps.toString('utf8')); } catch { res.status(400).json({ error: 'corps illisible' }); return; }
  if (!estEvenement(e)) { res.status(400).json({ error: 'événement mal formé' }); return; }
  // un abonnement d'un autre serveur Discord (secret réutilisé, configuration croisée) n'a rien à faire ici
  if (config.discord.guildId && e.guildId !== config.discord.guildId) { res.status(403).json({ error: 'serveur Discord inattendu' }); return; }

  const empreinte = crypto.createHash('sha256').update(corps).digest('hex');
  let recu = await prisma.webhookRecu.findUnique({ where: { empreinte } });
  if (recu?.traite) { res.json({ ok: true, deja: true }); return; }
  if (!recu) {
    try { recu = await prisma.webhookRecu.create({ data: { empreinte, type: e.eventType, contenu: e as unknown as Prisma.InputJsonValue } }); }
    catch (err) {
      // la même livraison arrive deux fois au même instant : l'autre requête la traite
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { res.json({ ok: true, deja: true }); return; }
      throw err;
    }
  }
  // la ligne existe déjà mais n'est pas encore marquée traitée (l'autre requête en est au traitement, pas qu'à
  // la création) : sans ce verrou, les deux requêtes lanceraient entreprise.webhooks[type] en parallèle
  if (empreintesEnCours.has(empreinte)) { res.json({ ok: true, deja: true }); return; }
  empreintesEnCours.add(empreinte);

  const traitement = entreprise.webhooks?.[e.eventType];
  try {
    if (traitement) await traitement(e);
    // traité : seule l'empreinte reste utile (dédoublonnage). Le corps, qui peut porter des données personnelles
    // (réponses d'un candidat), n'est gardé que tant que le traitement échoue, pour le diagnostiquer. Le verrou
    // mémoire (finally) n'est levé qu'une fois cette écriture faite : sinon une livraison en double arrivant entre
    // la fin du traitement et ce marquage le relancerait une seconde fois.
    await prisma.webhookRecu.update({ where: { id: recu.id }, data: { traite: true, contenu: {} } });
  }
  catch (err) {
    // 500 : le bot réessaiera (erreur transitoire de son point de vue) ; l'événement reste enregistré, non traité
    console.error(`Webhook ${e.eventType} : échec du traitement`, err);
    res.status(500).json({ error: 'traitement en échec' });
    return;
  }
  finally { empreintesEnCours.delete(empreinte); }
  res.json({ ok: true });
});
