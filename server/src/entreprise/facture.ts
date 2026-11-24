// ENTREPRISE — factures reçues du bot Discord entreprise (table factures) : commande boutique (webhook
// order.updated, renvoyée à chaque changement — validation, régénération — rattachée par idBot, jamais recréée) et
// facture de monitoring FiveM (webhook monitoring.invoice, un paiement constaté en jeu, sans identifiant du bot :
// dédoublonnage des renvois déjà assuré par le socle, comme pour monitoring.sale, entreprise/run.ts).
// Formes exactes vérifiées côté bot (src/services/orderLogService.ts, src/services/monitoringService.ts +
// monitoringParsers.ts), docs/webhooks.md.
import crypto from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { EvenementBot } from '../socle/contrat.js';
import { prisma } from '../socle/db.js';
import { gradeDe, tousLesGrades } from '../socle/droits.js';
import { ID_DISCORD, posterMessage } from '../socle/discord.js';
import type { IdentiteVerifiee } from '../socle/routes/discord-leger.js';
import { config } from '../socle/config.js';
import { entierRegle } from './parametres.js';
import { Refus } from './refus.js';
import { nomComplet } from './rh.js';
import { salonIntrouvable } from './salon-discord.js';
import { debutSemaineParis, jourDeSemaineParis } from './texte.js';

const texte = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const entier = (v: unknown): number => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

// ---------- envoi d'une facture sur Discord : dans le salon du contrat seulement ----------
// Une facture liée à un contrat (créée depuis son échéancier) utilise le salon posé sur le contrat ; une facture sans
// contrat (paiement en jeu, saisie libre) n'en a pas : la personne qui envoie donne alors le salon, jamais mémorisé.
async function salonDuContrat(contratId: number | null): Promise<string | null> {
  if (!contratId) return null;
  return (await prisma.contrat.findUnique({ where: { id: contratId }, select: { salonDiscordId: true } }))?.salonDiscordId ?? null;
}
// marque ou efface le repère « salon introuvable » sur le contrat propriétaire du salon utilisé
async function marquerSalon(contratId: number, introuvable: boolean): Promise<void> {
  await prisma.contrat.update({ where: { id: contratId }, data: { salonIntrouvableLe: introuvable ? new Date() : null } }).catch(() => {});
}

export function contenuMessageFacture(f: { id: number; numeroFacture: string; clientNom: string; total: number; statutPaiement: string }): string {
  return `**Facture ${f.numeroFacture || `n° ${f.id}`}**\nClient : ${f.clientNom || 'Client inconnu'}\nTotal : ${f.total.toLocaleString('fr-FR')} $\nStatut : ${f.statutPaiement}`;
}

// envoi automatique (echeanciers.ts) : pas de salon sur le contrat = ignoré en silence (la facturation automatique a
// exigé un salon à l'activation, mais il a pu être retiré depuis)
export async function envoyerFactureSurDiscord(factureId: number): Promise<boolean> {
  const f = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!f?.contratId) return false;
  const salon = await salonDuContrat(f.contratId);
  if (!salon) return false;
  try {
    await posterMessage(salon, { content: contenuMessageFacture(f) });
    await marquerSalon(f.contratId, false);
    return true;
  } catch (e) {
    if (salonIntrouvable(e)) await marquerSalon(f.contratId, true);
    throw e;
  }
}

// envoi manuel (bouton de la fiche de facture) : salon du contrat par défaut ; à défaut, le salon donné à la main
export async function envoyerFactureManuel(factureId: number, salonManuel: string): Promise<void> {
  const f = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!f) throw new Refus('Facture introuvable.', 404);
  const duContrat = await salonDuContrat(f.contratId);
  const salon = duContrat ?? salonManuel.trim();
  if (!duContrat && !ID_DISCORD.test(salon)) throw new Refus('Indiquez l’identifiant du salon Discord où envoyer la facture.');
  try {
    await posterMessage(salon, { content: contenuMessageFacture(f) });
    if (duContrat && f.contratId) await marquerSalon(f.contratId, false);
  } catch (e) {
    if (duContrat && f.contratId && salonIntrouvable(e)) await marquerSalon(f.contratId, true);
    throw e;
  }
}

// contrats (parmi ceux donnés) qui ont un salon : pour afficher « Envoyer sur Discord » sans demander de salon, sans un
// appel par ligne
export async function contratsAvecSalon(contratIds: readonly number[]): Promise<Set<number>> {
  if (!contratIds.length) return new Set();
  return new Set((await prisma.contrat.findMany({ where: { id: { in: [...contratIds] }, salonDiscordId: { not: null } }, select: { id: true } })).map(c => c.id));
}

// ---------- signature par le client : accusé de lecture, prouvé par sa connexion Discord ----------
// Lien à usage unique, valable 7 jours, envoyé dans le salon du contrat. Le client relit la facture, se connecte avec
// Discord (identité vérifiée, jamais saisie) et confirme : le site garde une copie figée du document et qui l'a signé.
// Réservée aux factures qui ont un client identifié (contrat, ou saisie manuelle avec un nom) : un paiement constaté en
// jeu n'a personne à qui envoyer un lien. Ce n'est pas une signature au sens juridique, seulement une trace de lecture.
const VALIDITE_LIEN_MS = 7 * 24 * 3600e3;
export const factureSignable = (f: { contratId: number | null; source: string; clientNom: string; avoirDeId?: number | null }): boolean =>
  f.avoirDeId == null && (f.contratId !== null || (f.source === 'manuel' && f.clientNom.trim() !== ''));

// champs figés au moment de la signature : ceux de l'aperçu de la facture (facturation.js, rendreDocumentFacture) ; une
// correction après coup (date, statut) ne change pas rétroactivement ce que le client a lu
export const champsDocument = (f: { numeroFacture: string; clientNom: string; sousTotal: number; livraison: number; reduction: number; total: number; statutPaiement: string; dateFacture: Date; dateEcheance: Date | null; details: Prisma.JsonValue | null; source: string }) => ({
  numeroFacture: f.numeroFacture, clientNom: f.clientNom, sousTotal: f.sousTotal, livraison: f.livraison,
  reduction: f.reduction, total: f.total, statutPaiement: f.statutPaiement, dateFacture: f.dateFacture,
  dateEcheance: f.dateEcheance, details: (f.details ?? Prisma.JsonNull) as Prisma.InputJsonValue, source: f.source,
});

// lien envoyé dans le salon du contrat : un nouveau jeton à chaque envoi (un renvoi invalide le précédent non signé)
export async function envoyerLienSignature(factureId: number): Promise<void> {
  const f = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!f) throw new Refus('Facture introuvable.', 404);
  if (!factureSignable(f)) throw new Refus('Cette facture n’a pas de client identifié à qui envoyer un lien de signature.', 403);
  if (f.statutPaiement === 'ANNULEE') throw new Refus('Une facture annulée ne se signe pas.', 409);
  if (f.signatureSigneeLe) throw new Refus('Cette facture est déjà signée.', 409);
  const salon = await salonDuContrat(f.contratId);
  if (!salon || !f.contratId) throw new Refus('Aucun salon Discord n’est renseigné sur le contrat de cette facture : le lien y est envoyé.', 404);
  const jeton = crypto.randomBytes(24).toString('hex');
  await prisma.facture.update({ where: { id: factureId }, data: { signatureJeton: jeton, signatureExpireLe: new Date(Date.now() + VALIDITE_LIEN_MS) } });
  const lien = `${config.baseUrl}/gestion/facture-signature.html?jeton=${jeton}`;
  try {
    await posterMessage(salon, { content: `Facture ${f.numeroFacture || `n° ${f.id}`} — merci de la relire et de confirmer votre lecture en ligne (connexion Discord, lien valable 7 jours) : ${lien}` });
    await marquerSalon(f.contratId, false);
  } catch (e) {
    if (salonIntrouvable(e)) await marquerSalon(f.contratId, true);
    throw e;
  }
}

// facture désignée par un lien : inconnu, déjà servi ou périmé répondent pareil (rien n'indique qu'un jeton a existé)
async function factureDuJeton(jeton: string) {
  const f = /^[0-9a-f]{48}$/.test(jeton) ? await prisma.facture.findUnique({ where: { signatureJeton: jeton } }) : null;
  if (!f || !f.signatureExpireLe || f.signatureExpireLe.getTime() < Date.now()) throw new Refus('Ce lien n’existe pas, a déjà servi ou a expiré. Demandez-en un nouveau.', 404);
  return f;
}
export async function infoLienSignature(jeton: string) { return champsDocument(await factureDuJeton(jeton)); }

// signature : copie figée du document + identité Discord du signataire, jeton effacé (usage unique), puis confirmation
// dans le salon du contrat. Conditionnée au jeton encore posé : deux signatures simultanées n'en valident qu'une.
export async function signerFacture(jeton: string, identite: IdentiteVerifiee): Promise<void> {
  const f = await factureDuJeton(jeton);
  const { count } = await prisma.facture.updateMany({
    where: { id: f.id, signatureJeton: jeton },
    data: { signatureSigneeLe: new Date(), signatureDocumentFige: champsDocument(f), signatureJeton: null, signatureExpireLe: null, signatureDiscordId: identite.id, signatureDiscordPseudo: identite.pseudo.slice(0, 100) },
  });
  if (!count) throw new Refus('Ce lien a déjà servi. Demandez-en un nouveau.', 404);
  const salon = await salonDuContrat(f.contratId);
  if (salon && f.contratId) {
    try { await posterMessage(salon, { content: `✅ Facture ${f.numeroFacture || `n° ${f.id}`} lue et confirmée par ${identite.pseudo.replace(/[\\*_~`|>@#[\]()-]/g, c => `\\${c}`)} (Discord).` }); await marquerSalon(f.contratId, false); }
    catch (e) {
      if (salonIntrouvable(e)) await marquerSalon(f.contratId, true);
      // la signature est déjà enregistrée : une panne Discord ne doit pas la faire échouer
      else console.error('[facture] confirmation de signature (salon)', e);
    }
  }
}

// ce que la liste montre d'une signature, sans jamais renvoyer le jeton (secret d'accès) ni la copie figée
export function resumeSignature(f: { signatureJeton: string | null; signatureExpireLe: Date | null; signatureSigneeLe: Date | null; signatureDiscordPseudo: string | null }) {
  return {
    signeeLe: f.signatureSigneeLe, signeePar: f.signatureSigneeLe ? f.signatureDiscordPseudo : null,
    lienEnvoye: !!f.signatureJeton && !!f.signatureExpireLe && f.signatureExpireLe.getTime() > Date.now(),
  };
}

// ---------- catalogue de prestations : raccourci de saisie d'un article de facture, jamais obligatoire ----------
export const listerCatalogue = () => prisma.catalogueFacture.findMany({ orderBy: [{ position: 'asc' }, { nom: 'asc' }] });

function champsCatalogue(b: Record<string, unknown>) {
  const nom = texte(b.nom, 200);
  if (!nom) throw new Refus('Donnez un nom à la prestation.');
  const prix = Math.round(Number(b.prix));
  if (!Number.isFinite(prix) || prix < 0 || prix > 2_147_483_647) throw new Refus('Le prix doit être un nombre positif.');
  return { nom, prix };
}

export async function ajouterArticleCatalogue(b: Record<string, unknown>) {
  if (await prisma.catalogueFacture.count() >= 200) throw new Refus('200 prestations au plus : retirez-en avant d’en ajouter une autre.');
  const position = (await prisma.catalogueFacture.aggregate({ _max: { position: true } }))._max.position ?? -1;
  return prisma.catalogueFacture.create({ data: { ...champsCatalogue(b), position: position + 1 } });
}

export async function modifierArticleCatalogue(id: number, b: Record<string, unknown>): Promise<void> {
  try { await prisma.catalogueFacture.update({ where: { id }, data: champsCatalogue(b) }); }
  catch (e) { if ((e as { code?: string }).code === 'P2025') throw new Refus('Prestation introuvable.', 404); throw e; }
}

export const supprimerArticleCatalogue = async (id: number): Promise<void> => { await prisma.catalogueFacture.deleteMany({ where: { id } }); };

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
  // bornée comme les réponses de candidature (rh.ts) : une commande à très nombreux articles ne doit pas gonfler
  // sans limite details.articles, réécrit en entier à chaque renvoi (changement de statut)
  const articles = (Array.isArray(p.items) ? p.items as Article[] : []).slice(0, 50).map(a => ({
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
    // seules les clés sont journalisées : la valeur peut porter des données personnelles (pseudo, description)
    console.warn('[facture] événement monitoring.invoice ignoré : forme inattendue', p && typeof p === 'object' ? Object.keys(p) : typeof p);
    return;
  }
  const discordId = texte(p.playerDiscord, 22);
  const nom = texte(p.playerName, 120).replace(/[`*_<>@]/g, '');
  // rattachement par ID Discord seulement : le pseudo en jeu est modifiable et pas garanti unique, un homonyme
  // créditerait la mauvaise fiche (donc son quota et sa paie)
  const employe = /^\d{15,22}$/.test(discordId) ? await prisma.employe.findUnique({ where: { discordId } }) : null;
  // montant hors bornes (colonne entière) : donnée invalide, ignorée — un 500 ferait réessayer le bot dix fois pour rien
  const montant = entier(parsed.amount);
  if (montant <= 0 || montant > 2_147_483_647) {
    console.warn('[facture] événement monitoring.invoice ignoré : montant invalide');
    return;
  }
  // identifiant propre à l'événement : le bot renvoie le même corps (même sentAt) à chaque nouvelle tentative, donc une
  // reprise après un échec d'enregistrement du socle retombe sur la même ligne au lieu d'en créer une seconde
  const idBot = 'inv-' + crypto.createHash('sha256')
    .update([e.sentAt, discordId, parsed.amount, parsed.payerName, p.jobId, p.logTimestamp, p.description].map(v => String(v ?? '')).join('|'))
    .digest('hex').slice(0, 40);
  await prisma.facture.create({
    data: {
      idBot,
      source: 'monitoring',
      clientNom: texte(parsed.payerName, 200),
      sousTotal: montant,
      total: montant,
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
  }).catch(err => { if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err; });   // déjà enregistré
}

// Factures qui comptent dans les totaux (quota, classement, paie, DOT) : une facture annulée sans avoir (saisie manuelle
// passée à « annulée ») ne compte plus ; une annulée AVEC avoir reste comptée, et son avoir (montants négatifs) la compense.
export async function facturesComptees(): Promise<Prisma.FactureWhereInput> {
  const avoirs = await prisma.facture.findMany({ where: { avoirDeId: { not: null } }, select: { avoirDeId: true } });
  return { NOT: { statutPaiement: 'ANNULEE', id: { notIn: avoirs.map(a => a.avoirDeId as number) } } };
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
  const comptees = await facturesComptees();
  const [employes, factures, total, quotas] = await Promise.all([
    prisma.employe.findMany({ where: { statut: 'actif' } }),
    prisma.facture.groupBy({ by: ['employeId'], where: { dateFacture: { gte: debut, lt: fin }, employeId: { not: null }, ...comptees }, _sum: { total: true } }),
    prisma.facture.aggregate({ where: { dateFacture: { gte: debut, lt: fin }, ...comptees }, _sum: { total: true } }),
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
    debutSemaine: jourDeSemaineParis(debut),
    semaineCourante: jourDeSemaineParis(semaineCourante),
    montantSemaine: total._sum.total ?? 0,
    objectifEquipe: entierRegle('facture_objectif_hebdo'),
    employes: lignes.map(({ position, ...l }) => l),
    classement: classement.map(({ position, ...l }) => l),
  };
}
