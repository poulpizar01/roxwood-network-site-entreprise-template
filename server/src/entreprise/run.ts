// ENTREPRISE — ventes d'objets en jeu (« runs »), reçues du bot Discord entreprise : événement monitoring.sale, un
// message par vente annoncée dans le salon de monitoring (docs/webhooks.md). Rattachée à la fiche RH du vendeur (ID
// Discord, sinon pseudo) quand elle existe ; sans fiche, gardée telle quelle (pas de fiche créée automatiquement).
// Idempotence : le socle écarte un envoi déjà traité, mais pas la reprise d'un envoi dont le marquage « traité » a échoué ;
// idBot (empreinte du corps, comme monitoring.invoice) l'assure ici — jobId n'identifie que le métier RP du vendeur.
import crypto from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { EvenementBot } from '../socle/contrat.js';
import { prisma } from '../socle/db.js';
import { gradeDe, tousLesGrades } from '../socle/droits.js';
import { entierRegle } from './parametres.js';
import { nomComplet } from './rh.js';
import { debutSemaineParis, finSemaineParis, instantEvenement, jourDeSemaineParis } from './texte.js';

const texte = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const entier = (v: unknown): number => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

export async function recevoirRun(e: EvenementBot): Promise<void> {
  const p = e.payload as Record<string, unknown> | null;
  const parsed = p?.parsed as Record<string, unknown> | null | undefined;
  // forme inattendue : ignorée (la renvoyer ne la rendrait pas valide), mais consignée — si le bot change de format,
  // c'est la seule trace qui le dira
  if (!p || typeof p !== 'object' || !parsed || typeof parsed !== 'object') {
    // seules les clés sont journalisées : la valeur peut porter des données personnelles (pseudo, description)
    console.warn('[run] événement monitoring.sale ignoré : forme inattendue', p && typeof p === 'object' ? Object.keys(p) : typeof p);
    return;
  }
  const discordId = texte(p.playerDiscord, 22);
  const nom = texte(p.playerName, 120).replace(/[`*_<>@]/g, '');
  // rattachement par ID Discord seulement (comme les factures) : le pseudo en jeu est modifiable et pas garanti unique,
  // un homonyme créditerait la mauvaise fiche
  const employe = /^\d{15,22}$/.test(discordId) ? await prisma.employe.findUnique({ where: { discordId } }) : null;
  // valeurs hors bornes (colonnes entières) ou sans sens : donnée invalide, ignorée — un 500 ferait réessayer le bot dix fois pour rien
  const quantite = entier(parsed.quantity), totalPrice = entier(parsed.totalPrice), companyShare = entier(parsed.companyShare);
  if ([quantite, totalPrice, companyShare].some(n => n < 0 || n > 2_147_483_647) || quantite === 0) {
    console.warn('[run] événement monitoring.sale ignoré : quantité ou montant invalide');
    return;
  }
  const idBot = 'run-' + crypto.createHash('sha256')
    .update([e.sentAt, discordId, parsed.quantity, parsed.totalPrice, p.jobId, p.logTimestamp, p.description].map(v => String(v ?? '')).join('|'))
    .digest('hex').slice(0, 40);
  await prisma.run.create({
    data: {
      idBot, creeLe: instantEvenement(p, e.sentAt),
      jobId: texte(p.jobId, 100), vendeurNom: nom, vendeurDiscordId: discordId || null, employeId: employe?.id ?? null,
      itemLabel: texte(parsed.itemLabel, 120), quantite, totalPrice,
      companyShare, description: texte(p.description, 500),
    },
  }).catch(err => { if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err; });   // déjà enregistrée
}

// ---------- objectif de run, en unités vendues (réglé dans la fiche du grade, page Grades ; affiché page Quota) ----------
// Un grade sans ligne n'a pas d'objectif (quota 0, jamais « en retard »).
export async function quotasRun() {
  const lignes = await prisma.runsQuotaGrade.findMany();
  const parGrade = new Map(lignes.map(l => [l.gradeCle, l.quota]));
  return tousLesGrades().map(g => ({ cle: g.cle, libelle: g.libelle, quota: parGrade.get(g.cle) ?? 0 }));
}

export async function definirQuotaRun(gradeCle: string, quota: number): Promise<void> {
  await prisma.runsQuotaGrade.upsert({ where: { gradeCle }, create: { gradeCle, quota }, update: { quota } });
}

// Quota de la semaine en cours pour un employé (Mon compte) : pas le classement complet, juste sa propre progression.
export async function monQuota(employeId: number) {
  const employe = await prisma.employe.findUnique({ where: { id: employeId }, select: { gradeCle: true } });
  if (!employe) return null;
  const debut = debutSemaineParis();
  const fin = finSemaineParis(debut);
  const [somme, quotas] = await Promise.all([
    prisma.run.aggregate({ where: { employeId, creeLe: { gte: debut, lt: fin } }, _sum: { quantite: true } }),
    quotasRun(),
  ]);
  return { unites: somme._sum.quantite ?? 0, quota: quotas.find(q => q.cle === employe.gradeCle)?.quota ?? 0 };
}

// Cumul des unités vendues (quantite) d'une semaine (la semaine en cours par défaut, ou une semaine passée choisie
// par son lundi — jamais une semaine future : on reste sur la semaine en cours), comparé à l'objectif de chacun ;
// objectifEquipe : réglage de toute l'équipe (Paramètres → Run), comparé au total de l'entreprise sur cette semaine.
export async function classementRuns(semaineDemandee?: string) {
  const semaineCourante = debutSemaineParis();
  const debut = semaineDemandee ? debutSemaineParis(semaineDemandee) : semaineCourante;
  if (debut > semaineCourante) debut.setTime(semaineCourante.getTime());
  const fin = finSemaineParis(debut);
  const [employes, sommes, total, quotas] = await Promise.all([
    prisma.employe.findMany({ where: { statut: 'actif' } }),
    prisma.run.groupBy({ by: ['employeId'], where: { creeLe: { gte: debut, lt: fin }, employeId: { not: null } }, _sum: { quantite: true } }),
    // total de l'entreprise, y compris les ventes non rattachées à une fiche (pas seulement la somme des employés)
    prisma.run.aggregate({ where: { creeLe: { gte: debut, lt: fin } }, _sum: { quantite: true } }),
    quotasRun(),
  ]);
  const quotaParGrade = new Map(quotas.map(q => [q.cle, q.quota]));
  const sommeParEmploye = new Map(sommes.map(s => [s.employeId as number, s._sum.quantite ?? 0]));
  const lignes = employes
    .map(e => {
      const unites = sommeParEmploye.get(e.id) ?? 0;
      const quota = quotaParGrade.get(e.gradeCle) ?? 0;
      const g = gradeDe(e.gradeCle);
      return { id: e.id, nomComplet: nomComplet(e), grade: e.gradeCle, gradeLibelle: g?.libelle ?? e.gradeCle, position: g?.position ?? Number.MAX_SAFE_INTEGER, unites, quota };
    })
    .sort((a, b) => a.position - b.position || a.nomComplet.localeCompare(b.nomComplet, 'fr'));
  const classement = [...lignes].filter(l => l.unites > 0).sort((a, b) => b.unites - a.unites).slice(0, 5);
  return {
    debutSemaine: jourDeSemaineParis(debut),
    semaineCourante: jourDeSemaineParis(semaineCourante),
    uniteSemaine: total._sum.quantite ?? 0,
    objectifEquipe: entierRegle('run_objectif_hebdo'),
    employes: lignes.map(({ position, ...l }) => l),
    classement: classement.map(({ position, ...l }) => l),
  };
}
