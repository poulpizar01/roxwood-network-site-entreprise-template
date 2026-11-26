// SOCLE — réception des webhooks du bot Discord entreprise (roxwood-network-entreprise, panneau « Monitoring »).
// Le bot signe chaque envoi : en-tête X-Signature-256 = HMAC-SHA256 du corps brut (hex), avec la clé de l'abonnement
// propre au type reçu (une clé par type, chiffrée en base — gestion/webhooks.html, routes/webhooks-abonnements.ts).
// Ici : type lu, fraîcheur vérifiée, signature vérifiée en temps constant contre la (ou les, pendant un remplacement)
// clé(s) de ce type, serveur Discord contrôlé, événement enregistré une seule fois (empreinte du corps : une
// nouvelle tentative du bot n'est pas traitée deux fois), puis confié au traitement que déclare l'entreprise.
// Route d'ingestion uniquement : elle ne renvoie jamais de donnée.
import crypto from 'node:crypto';
import express, { Router } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { Prisma } from '../../generated/prisma/client.js';
import { limits } from '../limites.js';
import type { EvenementBot } from '../contrat.js';
import { entreprise } from '../../entreprise/index.js';
import { dechiffrer, dechiffrerCleActive } from '../webhooks-cle.js';

export const webhooks = Router();

// une même empreinte en cours de traitement (deux livraisons simultanées) ne doit démarrer le traitement de
// l'entreprise qu'une seule fois : verrou en mémoire (une seule instance par VPS, cf. CLAUDE.md « Déploiement »)
// tenu de la création de la ligne jusqu'à son marquage traité, pas seulement sur l'insertion
const empreintesEnCours = new Set<string>();

// Fenêtre de fraîcheur : un envoi trop ancien (rejoué, horloge du bot désynchronisée) n'est pas traité. Une petite
// tolérance dans le futur couvre un léger décalage d'horloge entre les deux machines.
const FRAICHEUR_MS = 4 * 3600_000, TOLERANCE_AVENIR_MS = 5 * 60_000;
export const sentAtFrais = (sentAt: string): boolean => {
  const t = Date.parse(sentAt);
  return Number.isFinite(t) && Date.now() - t <= FRAICHEUR_MS && t - Date.now() <= TOLERANCE_AVENIR_MS;
};

// clés en clair utilisables pour ce type : la clé active, et l'ancienne si son délai de grâce (remplacement sans
// coupure) n'est pas passé. Déchiffrées à la demande, jamais gardées au-delà de la requête.
async function clesDuType(type: string): Promise<string[]> {
  const a = await prisma.abonnementWebhook.findUnique({ where: { type } });
  if (!a) return [];
  const cles: string[] = [];
  const active = dechiffrerCleActive(a);
  if (active) cles.push(active);
  if (a.ancienneCleChiffree && a.ancienneCleNonce && a.ancienneCleEmpreinte && a.ancienneExpireLe && a.ancienneExpireLe > new Date()) {
    const ancienne = dechiffrer({ chiffre: a.ancienneCleChiffree, nonce: a.ancienneCleNonce, empreinte: a.ancienneCleEmpreinte }, type);
    if (ancienne) cles.push(ancienne);
  }
  return cles;
}

const signatureValide = (corps: Buffer, recue: string, cles: string[]): boolean => {
  if (!/^[0-9a-f]{64}$/i.test(recue) || !cles.length) return false;
  const attendue = Buffer.from(recue.toLowerCase(), 'hex');
  // chaque clé utilisable est essayée, sans s'arrêter à la première : le temps de réponse ne dit pas laquelle a servi
  return cles.reduce((ok, secret) =>
    crypto.timingSafeEqual(crypto.createHmac('sha256', secret).update(corps).digest(), attendue) || ok, false);
};

const estEvenement = (v: unknown): v is EvenementBot =>
  !!v && typeof v === 'object' && typeof (v as EvenementBot).guildId === 'string' && typeof (v as EvenementBot).eventType === 'string'
  && /^[\w.-]{1,64}$/.test((v as EvenementBot).eventType) && typeof (v as EvenementBot).sentAt === 'string'
  && Object.hasOwn(v, 'payload') && (v as EvenementBot).payload !== null
  && typeof (v as EvenementBot).payload === 'object' && !Array.isArray((v as EvenementBot).payload);

// corps brut (la signature porte sur les octets reçus, pas sur un JSON relu) ; 1 Mo : le bot n'envoie jamais d'image
webhooks.post('/webhooks/bot', limits.webhooks, express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
  const corps = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  let e: unknown;
  try { e = JSON.parse(corps.toString('utf8')); } catch { res.status(400).json({ error: 'corps illisible' }); return; }
  if (!estEvenement(e)) { res.status(400).json({ error: 'événement mal formé' }); return; }
  if (!sentAtFrais(e.sentAt)) { res.status(400).json({ error: 'événement trop ancien' }); return; }
  // un abonnement d'un autre serveur Discord (configuration croisée) n'a rien à faire ici
  if (config.discord.guildId && e.guildId !== config.discord.guildId) { res.status(403).json({ error: 'serveur Discord inattendu' }); return; }

  // signature vérifiée après avoir lu le type (une clé par type) : le corps n'est pas davantage « cru » qu'avant,
  // seulement lu un instant plus tôt — de toute façon rejeté si la signature ne correspond pas à ce type précis.
  const cles = await clesDuType(e.eventType);
  if (!signatureValide(corps, String(req.get('x-signature-256') ?? ''), cles)) { res.status(401).json({ error: 'signature refusée' }); return; }

  const empreinte = crypto.createHash('sha256').update(corps).digest('hex');
  let recu = await prisma.webhookRecu.findUnique({ where: { empreinte } });
  if (recu?.traite) { res.json({ ok: true, deja: true }); return; }
  if (!recu) {
    try { recu = await prisma.webhookRecu.create({ data: { empreinte, type: e.eventType, contenu: { sentAt: e.sentAt } } }); }
    catch (err) {
      // la même livraison arrive deux fois au même instant : l'autre requête la traite
      // 503 et non 200 : si l'autre requête échoue, le bot doit réessayer (un 200 lui ferait croire l'événement traité)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { res.set('Retry-After', '5').status(503).json({ error: 'traitement en cours' }); return; }
      throw err;
    }
  }
  // la ligne existe déjà mais n'est pas encore marquée traitée (l'autre requête en est au traitement, pas qu'à
  // la création) : sans ce verrou, les deux requêtes lanceraient entreprise.webhooks[type] en parallèle
  if (empreintesEnCours.has(empreinte)) { res.set('Retry-After', '5').status(503).json({ error: 'traitement en cours' }); return; }
  empreintesEnCours.add(empreinte);

  const abonnement = entreprise.webhooks?.[e.eventType];
  try {
    if (abonnement) await abonnement.traiter(e);
    // Le diagnostic se limite à des métadonnées. Le corps n'est traité qu'en mémoire.
    await prisma.webhookRecu.update({ where: { id: recu.id }, data: { traite: true, contenu: {} } });
  }
  catch (err) {
    // 500 : le bot réessaiera (erreur transitoire de son point de vue) ; l'événement reste enregistré, non traité
    console.error(`Webhook ${e.eventType} : échec du traitement`, err instanceof Prisma.PrismaClientKnownRequestError ? err.code : err instanceof Error ? err.name : 'erreur');
    res.status(500).json({ error: 'traitement en échec' });
    return;
  }
  finally { empreintesEnCours.delete(empreinte); }
  res.json({ ok: true });
});
