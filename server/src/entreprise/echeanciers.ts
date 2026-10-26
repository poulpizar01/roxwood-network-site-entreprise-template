// ENTREPRISE — échéanciers (table echeanciers/echeances), deux usages :
// - « facturation » : plan de plusieurs échéances datées, chacune donnant lieu à sa propre facture quand on clique
//   « Facturer » (avant ou après sa date prévue) — une échéance ne se facture jamais deux fois : une fois son
//   factureId posé, elle est verrouillée. Rattaché à un contrat client (une seule échéancier par contrat, tenu à
//   jour par synchroniserEcheancierContrat, appelée depuis contrats.ts) ou libre (partenaire saisi à la main).
// - « paiement » : règlement en plusieurs fois d'UNE facture déjà émise ; chaque échéance se marque « réglée » à la
//   main (aucune information de paiement partiel ne nous parvient du bot).
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../socle/db.js';
import { debutPeriode, indexPeriode, periode, type Periodicite } from './contrats-periodes.js';
import { Refus } from './refus.js';
import { jourParis, jourValide, versDate, versJour } from './texte.js';

export const TYPES_ECHEANCIER = ['facturation', 'paiement'] as const;
export type TypeEcheancier = typeof TYPES_ECHEANCIER[number];
export const RYTHMES = ['journalier', 'hebdomadaire', 'mensuel'] as const;
export type Rythme = typeof RYTHMES[number];

const texte = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const STATUTS_PAYES = ['PAID', 'PAYEE'];

// ---- pure : répartition d'un total en N échéances, générateur de dates ----
// La dernière échéance absorbe l'arrondi (même principe que les modules de paiement échelonné du marché) : la somme
// des parts est toujours exactement égale au total, jamais un centime perdu ou en trop.
export function repartir(total: number, nombre: number): number[] {
  if (nombre <= 0) return [];
  const part = Math.floor(total / nombre);
  const parts = new Array(nombre).fill(part);
  parts[nombre - 1] = total - part * (nombre - 1);
  return parts;
}

// dates des N échéances à partir de `premiere`, au rythme choisi (même calendrier que les contrats : un mois
// commencé un 31 se cale sur le dernier jour des mois plus courts)
export function datesGenerees(premiere: string, rythme: Rythme, nombre: number): string[] {
  return Array.from({ length: nombre }, (_, i) => debutPeriode(premiere, rythme as Periodicite, i));
}

// ---- lecture ----
type EcheanceLigne = {
  id: number; datePrevue: Date; periodeDebut: Date | null; periodeFin: Date | null; montant: number; note: string;
  factureId: number | null; payeeLe: Date | null; moyenPaiement: string;
  facture?: { id: number; numeroFacture: string; statutPaiement: string } | null;
};

// statut affiché d'une échéance : pour une facturation, dérivé du statut courant de sa facture (un avoir ou une
// annulation la rouvre à facturer sans qu'il faille réécrire quoi que ce soit ici)
function statutEcheance(type: TypeEcheancier, e: EcheanceLigne, aujourdhui: string) {
  const prevue = versJour(e.datePrevue);
  if (type === 'paiement') return e.payeeLe ? 'payee' : prevue > aujourdhui ? 'a-venir' : 'a-regler';
  if (!e.factureId) return prevue > aujourdhui ? 'a-venir' : 'a-facturer';
  if (e.facture?.statutPaiement === 'ANNULEE') return 'annulee';
  if (e.facture && STATUTS_PAYES.includes(e.facture.statutPaiement)) return 'payee';
  return 'facturee';
}

function versEcheance(type: TypeEcheancier, e: EcheanceLigne, aujourdhui: string) {
  return {
    id: e.id, datePrevue: versJour(e.datePrevue),
    periodeDebut: e.periodeDebut ? versJour(e.periodeDebut) : null, periodeFin: e.periodeFin ? versJour(e.periodeFin) : null,
    montant: e.montant, note: e.note,
    factureId: e.factureId, facture: e.facture ? { id: e.facture.id, numeroFacture: e.facture.numeroFacture } : null,
    payeeLe: e.payeeLe, moyenPaiement: e.moyenPaiement,
    statut: statutEcheance(type, e, aujourdhui),
  };
}

const INCLURE_ECHEANCES = { echeances: { orderBy: { datePrevue: 'asc' as const }, include: { facture: { select: { id: true, numeroFacture: true, statutPaiement: true } } } } };

// `montantFacture`/`montantRegle` (jamais `facture`/`regle` seuls) pour ne pas entrer en collision avec la relation
// `facture` de l'échéancier (la facture réglée, pour un paiement en plusieurs fois)
function totaux(type: TypeEcheancier, echeances: ReturnType<typeof versEcheance>[]) {
  const prevu = echeances.reduce((s, e) => s + e.montant, 0);
  const montantRegle = echeances.filter(e => e.statut === 'payee').reduce((s, e) => s + e.montant, 0);
  if (type === 'paiement') return { prevu, montantRegle, reste: prevu - montantRegle };
  const montantFacture = echeances.filter(e => ['facturee', 'payee'].includes(e.statut)).reduce((s, e) => s + e.montant, 0);
  return { prevu, montantFacture, montantRegle, reste: prevu - montantFacture };
}

// « paiement » seulement : la facture réglée en plusieurs fois, document de référence jamais touché (numéro, articles,
// montants) — affichée dans le relevé de l'échéancier (gestion/echeanciers.js) exactement comme dans Facturation.
const INCLURE_FACTURE_PAIEMENT = { facture: { select: { id: true, numeroFacture: true, clientNom: true, sousTotal: true, livraison: true, reduction: true, total: true, details: true, dateFacture: true, dateEcheance: true, statutPaiement: true } } };

export async function listerEcheanciers() {
  const aujourdhui = jourParis();
  const lignes = await prisma.echeancier.findMany({
    orderBy: { creeLe: 'desc' },
    include: { ...INCLURE_ECHEANCES, ...INCLURE_FACTURE_PAIEMENT, contrat: { select: { id: true, partenaire: true } } },
  });
  return lignes.map(({ echeances, ...e }) => {
    const liste = echeances.map(x => versEcheance(e.type as TypeEcheancier, x, aujourdhui));
    return { ...e, echeances: liste, ...totaux(e.type as TypeEcheancier, liste), aFacturerOuARegler: liste.some(x => x.statut === 'a-facturer' || x.statut === 'a-regler') };
  });
}

async function echeancierOu404(id: number) {
  const e = await prisma.echeancier.findUnique({ where: { id }, include: INCLURE_ECHEANCES });
  if (!e) throw new Refus('Échéancier introuvable.', 404);
  return e;
}

// bloque la suppression d'une facture réglée en plusieurs fois (routes/compta.ts) : la facture reste le document de
// référence du plan, le supprimer laisserait les échéances déjà réglées sans quittance possible
export async function planPaiementDeFacture(factureId: number) {
  return prisma.echeancier.findUnique({ where: { factureId }, select: { id: true } });
}

// ---- intégration contrats.ts : échéancier d'un contrat client, affiché dans sa fiche (gestion/contrats.js) ----
export async function echeanciersDeContrats(contratIds: number[]) {
  const carte = new Map<number, { id: number; echeances: ReturnType<typeof versEcheance>[]; aFacturer: { nombre: number; montant: number } | null }>();
  if (!contratIds.length) return carte;
  const aujourdhui = jourParis();
  const lignes = await prisma.echeancier.findMany({ where: { contratId: { in: contratIds } }, include: INCLURE_ECHEANCES });
  for (const { echeances, contratId, id } of lignes) {
    const liste = echeances.map(x => versEcheance('facturation', x, aujourdhui));
    const dues = liste.filter(x => x.statut === 'a-facturer');
    carte.set(contratId!, { id, echeances: liste, aFacturer: dues.length ? { nombre: dues.length, montant: dues.reduce((s, x) => s + x.montant, 0) } : null });
  }
  return carte;
}

// verrou de modification (lireChamps, contrats.ts) : une fois une échéance facturée, le rythme et la date de début
// ne changent plus (les échéances déjà émises se calent dessus)
export async function contratAEcheancesFacturees(contratId: number): Promise<boolean> {
  return (await prisma.echeance.count({ where: { factureId: { not: null }, echeancier: { contratId } } })) > 0;
}

// Accueil, « À traiter » : contrats clients avec au moins une échéance due et non facturée
export async function nombreContratsAFacturer(): Promise<number> {
  const du = await prisma.echeance.findMany({
    where: { factureId: null, datePrevue: { lte: versDate(jourParis()) }, echeancier: { type: 'facturation', contratId: { not: null } } },
    select: { echeancier: { select: { contratId: true } } },
  });
  return new Set(du.map(d => d.echeancier.contratId)).size;
}

// ---- création (libre, sans contrat) ----
function lireGenerateur(b: Record<string, unknown>): { dates: string[]; montants: number[] } | null {
  if (!b.premiere || !b.nombre) return null;
  if (!jourValide(b.premiere)) throw new Refus('La première date est invalide (jj/mm/aaaa).');
  const nombre = Math.round(Number(b.nombre));
  if (!Number.isInteger(nombre) || nombre < 1 || nombre > 120) throw new Refus('Le nombre d’échéances doit être entre 1 et 120.');
  if (!RYTHMES.includes(b.rythme as Rythme)) throw new Refus('Choisissez le rythme : journalier, hebdomadaire ou mensuel.');
  const total = Math.round(Number(b.montantTotal));
  if (!Number.isFinite(total) || total <= 0 || total > 2_147_483_647) throw new Refus('Le montant total doit être un nombre positif.');
  return { dates: datesGenerees(b.premiere as string, b.rythme as Rythme, nombre), montants: repartir(total, nombre) };
}

export async function creerEcheancierLibre(b: Record<string, unknown>, compteId: number) {
  const partenaire = texte(b.partenaire, 200);
  if (!partenaire) throw new Refus('Le nom du client ou du fournisseur est obligatoire.');
  const genere = lireGenerateur(b);
  return prisma.echeancier.create({
    data: {
      type: 'facturation', partenaire, notes: texte(b.notes, 500), compteId,
      echeances: genere ? { create: genere.dates.map((datePrevue, i) => ({ datePrevue: versDate(datePrevue), montant: genere.montants[i] })) } : undefined,
    },
  });
}

// Paiement en plusieurs fois d'une facture déjà émise : la facture reste le document de référence (standard du
// secteur — numérotation, archivage, jamais recréée ni supprimée), l'échéancier n'est que son plan de règlement.
export async function creerEcheancierPaiement(factureId: number, b: Record<string, unknown>, compteId: number) {
  const facture = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!facture) throw new Refus('Facture introuvable.', 404);
  if (facture.avoirDeId !== null || facture.statutPaiement === 'ANNULEE') throw new Refus('Un avoir, ou une facture annulée, ne se paie pas en plusieurs fois.');
  if (STATUTS_PAYES.includes(facture.statutPaiement)) throw new Refus('Cette facture est déjà payée.', 409);
  if (await planPaiementDeFacture(factureId)) throw new Refus('Un plan de règlement existe déjà pour cette facture.', 409);
  const genere = lireGenerateur({ ...b, montantTotal: facture.total });
  if (!genere) throw new Refus('Indiquez la première date, le nombre d’échéances et le rythme.');
  try {
    return await prisma.echeancier.create({
      data: {
        type: 'paiement', partenaire: facture.clientNom, notes: texte(b.notes, 500), compteId, factureId,
        echeances: { create: genere.dates.map((datePrevue, i) => ({ datePrevue: versDate(datePrevue), montant: genere.montants[i] })) },
      },
    });
  } catch (e) {
    // factureId unique en base : une seconde requête presque simultanée (double clic), passée malgré le contrôle
    // ci-dessus, échoue proprement ici plutôt qu'avec une erreur technique brute
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Refus('Un plan de règlement existe déjà pour cette facture.', 409);
    throw e;
  }
}

export async function supprimerEcheancier(id: number): Promise<void> {
  const e = await echeancierOu404(id);
  await prisma.echeancier.delete({ where: { id } });
  // le plan disparaît : la facture reste, mais ne doit pas rester « payée » pour un règlement qui n'existe plus
  if (e.factureId) await prisma.facture.updateMany({ where: { id: e.factureId, statutPaiement: 'PAYEE' }, data: { statutPaiement: 'EN_ATTENTE' } });
}

// ---- une échéance ----
function lireEcheance(b: Record<string, unknown>) {
  if (!jourValide(b.datePrevue)) throw new Refus('La date est invalide (jj/mm/aaaa).');
  const montant = Math.round(Number(b.montant));
  if (!Number.isFinite(montant) || montant <= 0 || montant > 2_147_483_647) throw new Refus('Le montant doit être un nombre positif.');
  return { datePrevue: versDate(b.datePrevue as string), montant, note: texte(b.note, 200) };
}

export async function ajouterEcheance(echeancierId: number, b: Record<string, unknown>) {
  await echeancierOu404(echeancierId);
  return prisma.echeance.create({ data: { echeancierId, ...lireEcheance(b) } });
}

async function echeanceModifiable(id: number) {
  const e = await prisma.echeance.findUnique({ where: { id } });
  if (!e) throw new Refus('Échéance introuvable.', 404);
  if (e.factureId || e.payeeLe) throw new Refus('Cette échéance a déjà été réglée : elle ne se modifie plus.', 409);
  return e;
}

export async function modifierEcheance(id: number, b: Record<string, unknown>): Promise<void> {
  await echeanceModifiable(id);
  await prisma.echeance.update({ where: { id }, data: lireEcheance(b) });
}

export async function supprimerEcheance(id: number): Promise<void> {
  await echeanceModifiable(id);
  await prisma.echeance.delete({ where: { id } });
}

// « Nouveau montant à partir du … » : toutes les échéances non encore facturées à partir de cette date (facturation
// seulement : le montant d'un paiement en plusieurs fois est fixé par le total de la facture qu'il règle)
export async function ajusterMontantAPartirDe(echeancierId: number, date: unknown, montant: unknown): Promise<void> {
  const e = await echeancierOu404(echeancierId);
  if (e.type !== 'facturation') throw new Refus('Seul un échéancier de facturation accepte un nouveau montant.');
  if (!jourValide(date)) throw new Refus('La date est invalide (jj/mm/aaaa).');
  const m = Math.round(Number(montant));
  if (!Number.isFinite(m) || m <= 0 || m > 2_147_483_647) throw new Refus('Le montant doit être un nombre positif.');
  await prisma.echeance.updateMany({ where: { echeancierId, factureId: null, datePrevue: { gte: versDate(date as string) } }, data: { montant: m } });
}

// ajoute `nombre` échéances après la dernière, au même montant et au rythme donné (échéancier libre, ou pour prolonger
// un contrat reconduit tacitement avant même d'avoir plus que quelques échéances d'avance)
export async function etendre(echeancierId: number, nombre: number, rythme: unknown): Promise<void> {
  if (!Number.isInteger(nombre) || nombre < 1 || nombre > 60) throw new Refus('Le nombre d’échéances à ajouter doit être entre 1 et 60.');
  if (!RYTHMES.includes(rythme as Rythme)) throw new Refus('Choisissez le rythme : journalier, hebdomadaire ou mensuel.');
  const e = await echeancierOu404(echeancierId);
  if (!e.echeances.length) throw new Refus('Ajoutez d’abord au moins une échéance pour fixer le montant et le rythme.');
  const derniere = e.echeances[e.echeances.length - 1];
  const dates = datesGenerees(versJour(derniere.datePrevue), rythme as Rythme, nombre + 1).slice(1);
  await prisma.echeance.createMany({ data: dates.map(datePrevue => ({ echeancierId, datePrevue: versDate(datePrevue), montant: derniere.montant })) });
}

// ---- facturer : une facture par échéance sélectionnée (jamais deux fois la même, factureId verrouille la ligne) ----
// `ids` vide : toutes les échéances dues (non facturées, date prévue passée ou du jour) — bouton « Facturer » de la
// fiche contrat ; une sélection précise (passée par la page Échéanciers) peut inclure une échéance pas encore due.
export async function facturerEcheances(echeancierId: number, ids: number[], compteId: number): Promise<number[]> {
  const e = await echeancierOu404(echeancierId);
  if (e.type !== 'facturation') throw new Refus('Seul un échéancier de facturation se facture.');
  const aujourdhui = jourParis();
  const choisies = ids.length ? e.echeances.filter(x => ids.includes(x.id)) : e.echeances.filter(x => !x.factureId && versJour(x.datePrevue) <= aujourdhui);
  if (!choisies.length) throw new Refus('Choisissez au moins une échéance.');
  if (choisies.some(x => x.factureId)) throw new Refus('Une échéance choisie a déjà été facturée. Rechargez la page.', 409);
  const crees: number[] = [];
  await prisma.$transaction(async tx => {
    for (const x of choisies) {
      const f = await tx.facture.create({
        data: {
          source: 'manuel', clientNom: e.partenaire, sousTotal: x.montant, livraison: 0, reduction: 0, total: x.montant,
          statutPaiement: 'EN_ATTENTE', compteId, dateFacture: new Date(),
          contratId: e.contratId, periodeDebut: x.periodeDebut, periodeFin: x.periodeFin,
        },
      });
      // reconditionné sur factureId: null (pas seulement vérifié en lecture avant la transaction) : un double clic
      // ou une nouvelle tentative réseau simultanée ne facture jamais deux fois la même échéance
      const { count } = await tx.echeance.updateMany({ where: { id: x.id, factureId: null }, data: { factureId: f.id } });
      if (!count) throw new Refus('Une échéance choisie a déjà été facturée. Rechargez la page.', 409);
      crees.push(f.id);
    }
  });
  return crees;
}

// ---- paiement en plusieurs fois : réglé à la main seulement ----
// Marquer réglée ne crée aucune facture (son reçu, une quittance, se calcule à l'affichage depuis l'échéance et la
// facture d'origine, gestion/echeanciers.js) : seule la facture elle-même change de statut, une fois que toutes ses
// échéances sont réglées. Annuler le règlement rouvre la facture si c'est son dernier versement qui l'avait close.
export async function marquerEcheancePayee(id: number, moyenPaiement: unknown): Promise<void> {
  const e = await prisma.echeance.findUnique({ where: { id }, include: { echeancier: true } });
  if (!e) throw new Refus('Échéance introuvable.', 404);
  if (e.echeancier.type !== 'paiement') throw new Refus('Seule une échéance de paiement se règle ainsi.');
  if (e.payeeLe) return;
  await prisma.echeance.update({ where: { id }, data: { payeeLe: new Date(), moyenPaiement: texte(moyenPaiement, 40) } });
  await soldeFactureSelonEcheances(e.echeancierId);
}
export async function demarquerEcheancePayee(id: number): Promise<void> {
  const e = await prisma.echeance.findUnique({ where: { id }, include: { echeancier: true } });
  if (!e) throw new Refus('Échéance introuvable.', 404);
  await prisma.echeance.update({ where: { id }, data: { payeeLe: null, moyenPaiement: '' } });
  await soldeFactureSelonEcheances(e.echeancierId);
}
// la facture passe « payée » quand sa dernière échéance se règle, et redevient « en attente » si on annule ce
// dernier règlement — jamais touchée par un simple versement partiel
async function soldeFactureSelonEcheances(echeancierId: number): Promise<void> {
  const [echeancier, echeances] = await Promise.all([
    prisma.echeancier.findUnique({ where: { id: echeancierId }, select: { factureId: true } }),
    prisma.echeance.findMany({ where: { echeancierId }, select: { payeeLe: true } }),
  ]);
  if (!echeancier?.factureId) return;
  const statutPaiement = echeances.every(x => x.payeeLe) ? 'PAYEE' : 'EN_ATTENTE';
  await prisma.facture.update({ where: { id: echeancier.factureId }, data: { statutPaiement } });
}

// ---- synchronisation avec un contrat client (appelée par contrats.ts à la création et à chaque changement) ----
// Idempotente : retire les échéances non encore facturées puis régénère tout l'horizon (les échéances déjà
// facturées, elles, ne sont jamais touchées). Un contrat fournisseur n'a pas d'échéancier (on le paie, on ne le
// facture pas).
export async function synchroniserEcheancierContrat(contrat: {
  id: number; partie: string; partenaire: string; montant: number; periodicite: string; dateDebut: Date; dateFin: Date | null;
}): Promise<void> {
  if (contrat.partie !== 'client') return;
  const periodicite = contrat.periodicite as Periodicite;
  const dateDebut = versJour(contrat.dateDebut), dateFin = contrat.dateFin ? versJour(contrat.dateFin) : null, aujourdhui = jourParis();
  const echeancier = await prisma.echeancier.upsert({
    where: { contratId: contrat.id },
    create: { type: 'facturation', contratId: contrat.id, partenaire: contrat.partenaire },
    update: { partenaire: contrat.partenaire },
  });
  await prisma.echeance.deleteMany({ where: { echeancierId: echeancier.id, factureId: null } });
  const horizon = dateFin !== null
    ? indexPeriode(dateDebut, periodicite, dateFin)
    : indexPeriode(dateDebut, periodicite, aujourdhui) + 12;   // 12 échéances d'avance pour la reconduction tacite
  if (horizon < 0) return;
  const dejaFacturees = new Set((await prisma.echeance.findMany({ where: { echeancierId: echeancier.id }, select: { periodeDebut: true } })).map(x => versJour(x.periodeDebut)));
  const lignes = [];
  for (let n = 0; n <= horizon; n++) {
    const p = periode(dateDebut, periodicite, n);
    if (dejaFacturees.has(p.debut)) continue;
    lignes.push({ echeancierId: echeancier.id, datePrevue: versDate(p.debut), periodeDebut: versDate(p.debut), periodeFin: versDate(p.fin), montant: contrat.montant });
  }
  if (lignes.length) await prisma.echeance.createMany({ data: lignes });
}
