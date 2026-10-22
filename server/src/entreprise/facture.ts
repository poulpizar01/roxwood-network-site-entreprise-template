// ENTREPRISE — factures reçues du bot Discord entreprise (table factures) : commande boutique (webhook
// order.updated, renvoyée à chaque changement — validation, régénération — rattachée par idBot, jamais recréée) et
// facture de monitoring FiveM (webhook monitoring.invoice, un paiement constaté en jeu, sans identifiant du bot :
// dédoublonnage des renvois déjà assuré par le socle, comme pour monitoring.sale, entreprise/run.ts).
// Formes exactes vérifiées côté bot (src/services/orderLogService.ts, src/services/monitoringService.ts +
// monitoringParsers.ts), docs/webhooks.md.
import type { EvenementBot } from '../socle/contrat.js';
import { prisma } from '../socle/db.js';
import { gradeDe, tousLesGrades } from '../socle/droits.js';
import { entierRegle } from './parametres.js';
import { nomComplet } from './rh.js';
import { debutSemaineParis, normaliserPseudo, versJour } from './texte.js';

const texte = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const entier = (v: unknown): number => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

// ---------- quota hebdomadaire de montant facturé, par grade (réglé dans la fiche du grade, page Grades) ----------
// Un grade sans ligne n'a pas de quota (0, jamais « en retard »). Consultation : page Quota, onglets Quota facture et
// Classements (classementFactures ci-dessous).
export async function quotasFacture() {
  const lignes = await prisma.facturesQuotaGrade.findMany();
  const parGrade = new Map(lignes.map(l => [l.gradeCle, l.quota]));
  return tousLesGrades().map(g => ({ cle: g.cle, libelle: g.libelle, quota: parGrade.get(g.cle) ?? 0 }));
}

export async function definirQuotaFacture(gradeCle: string, quota: number): Promise<void> {
  await prisma.facturesQuotaGrade.upsert({ where: { gradeCle }, create: { gradeCle, quota }, update: { quota } });
}

type Article = { name?: unknown; unitPrice?: unknown; quantity?: unknown; weightGrams?: unknown };

// Traitement de l'événement order.updated (entreprise.webhooks) : upsert sur l'identifiant de commande du bot — un
// renvoi (changement de statut, régénération de facture) remplace l'état précédent plutôt que d'en créer un second.
// Le bot n'envoie que l'ID Discord du client (pas de nom affiché) : clientNom le garde tel quel.
export async function recevoirFactureCommande(e: EvenementBot): Promise<void> {
  const p = e.payload as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') { console.warn('[facture] événement order.updated ignoré : contenu absent'); return; }
  const idBot = texte(p.orderId, 100);
  if (!idBot) { console.warn('[facture] événement order.updated ignoré : pas de orderId'); return; }
  const articles = (Array.isArray(p.items) ? p.items as Article[] : []).map(a => ({
    name: texte(a.name, 120),
    unitPrice: entier(a.unitPrice),
    quantity: entier(a.quantity),
    weightGrams: entier(a.weightGrams),
  }));
  const data = {
    source: 'order',
    numeroFacture: texte(p.invoiceNumber, 100),
    clientNom: texte(p.customerId, 200),
    sousTotal: entier(p.subtotal),
    livraison: entier(p.deliveryFee),
    reduction: entier(p.discountAmount),
    total: entier(p.total),
    statutPaiement: texte(p.paymentStatus, 20),
    details: {
      articles,
      ticketId: texte(p.ticketId, 100),
      channelId: texte(p.channelId, 100),
      confirmed: !!p.confirmed,
      status: texte(p.status, 20),
      discountPercent: entier(p.discountPercent),
    },
  };
  await prisma.facture.upsert({ where: { idBot }, create: { idBot, ...data }, update: data });
}

// Traitement de l'événement monitoring.invoice (entreprise.webhooks) : paiement d'une facture constaté en jeu, lu par
// le bot dans un salon de monitoring FiveM (docs/webhooks.md). Pas d'identifiant du bot propre à l'événement : le
// dédoublonnage des renvois est déjà assuré par le socle (empreinte du corps, socle/routes/webhooks.ts).
// playerDiscord/playerName (même champs que monitoring.sale, entreprise/run.ts) identifient l'employé qui a
// enregistré le paiement en jeu, jamais le client : parsed.payerName (texte libre du log, sans identifiant fiable)
// ne sert qu'à l'affichage (clientNom).
export async function recevoirFactureMonitoring(e: EvenementBot): Promise<void> {
  const p = e.payload as Record<string, unknown> | null;
  const parsed = p?.parsed as Record<string, unknown> | null | undefined;
  // forme inattendue (description du log FiveM non reconnue par le bot) : ignorée, mais consignée — seule trace si
  // le bot change de format
  if (!p || typeof p !== 'object' || !parsed || typeof parsed !== 'object') {
    console.warn('[facture] événement monitoring.invoice ignoré : forme inattendue', JSON.stringify(p).slice(0, 300));
    return;
  }
  const discordId = texte(p.playerDiscord, 22);
  const nom = texte(p.playerName, 120).replace(/[`*_<>@]/g, '');
  const employe = /^\d{15,22}$/.test(discordId) ? await prisma.employe.findUnique({ where: { discordId } })
    : nom ? await prisma.employe.findUnique({ where: { discordPseudoNormalise: normaliserPseudo(nom) } }) : null;
  await prisma.facture.create({
    data: {
      source: 'monitoring',
      clientNom: texte(parsed.payerName, 200),
      sousTotal: entier(parsed.amount),
      total: entier(parsed.amount),
      statutPaiement: 'PAID',
      employeId: employe?.id ?? null,
      details: {
        jobId: texte(p.jobId, 100),
        playerDiscord: discordId,
        playerName: nom,
        taxPercent: entier(parsed.taxPercent),
        description: texte(p.description, 500),
      },
    },
  });
}

// ---------- classement et quota de facturation (page Quota, onglet Quota facture / Classements) ----------
// Seul un paiement constaté en jeu (monitoring.invoice, employeId résolu à la réception ci-dessus) crédite un
// employé : une commande boutique (order.updated) n'identifie que le client, et une facture saisie à la main depuis
// la gestion (compteId, l'auteur de la saisie) n'est pas nécessairement celui qui a encaissé en jeu. Le montant total
// de la semaine (team-wide, en tête de page) compte tout de même toutes les sources, comme classementRuns
// (entreprise/run.ts) compte toute vente, rattachée ou non à une fiche.
export async function classementFactures(semaineDemandee?: string) {
  const semaineCourante = debutSemaineParis();
  const debut = semaineDemandee ? debutSemaineParis(semaineDemandee) : semaineCourante;
  if (debut > semaineCourante) debut.setTime(semaineCourante.getTime());
  const fin = new Date(debut); fin.setUTCDate(fin.getUTCDate() + 7);
  const [employes, factures, total, quotas] = await Promise.all([
    prisma.employe.findMany({ where: { statut: 'actif' } }),
    prisma.facture.groupBy({ by: ['employeId'], where: { dateFacture: { gte: debut, lt: fin }, employeId: { not: null } }, _sum: { total: true } }),
    prisma.facture.aggregate({ where: { dateFacture: { gte: debut, lt: fin } }, _sum: { total: true } }),
    quotasFacture(),
  ]);
  const montantParEmploye = new Map(factures.map(f => [f.employeId as number, f._sum.total ?? 0]));
  const quotaParGrade = new Map(quotas.map(q => [q.cle, q.quota]));
  const lignes = employes
    .map(e => {
      const montant = montantParEmploye.get(e.id) ?? 0;
      const quota = quotaParGrade.get(e.gradeCle) ?? 0;
      const g = gradeDe(e.gradeCle);
      return { id: e.id, nomComplet: nomComplet(e), grade: e.gradeCle, gradeLibelle: g?.libelle ?? e.gradeCle, position: g?.position ?? Number.MAX_SAFE_INTEGER, montant, quota };
    })
    .sort((a, b) => a.position - b.position || a.nomComplet.localeCompare(b.nomComplet, 'fr'));
  const classement = [...lignes].filter(l => l.montant > 0).sort((a, b) => b.montant - a.montant).slice(0, 5);
  return {
    debutSemaine: versJour(debut),
    semaineCourante: versJour(semaineCourante),
    montantSemaine: total._sum.total ?? 0,
    objectifEquipe: entierRegle('facture_objectif_hebdo'),
    employes: lignes.map(({ position, ...l }) => l),
    classement: classement.map(({ position, ...l }) => l),
  };
}
