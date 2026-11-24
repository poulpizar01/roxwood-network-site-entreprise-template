// ENTREPRISE — échéanciers (tables echeanciers / echeances), deux usages :
// - « facturation » : une échéance par période d'un contrat client (un seul échéancier par contrat, tenu à jour par
//   synchroniserEcheancierContrat, appelée depuis contrats.ts), ou un plan libre (partenaire saisi à la main). Chaque
//   échéance se facture une fois (« Facturer », avant ou après sa date) ; une facture annulée, ou annulée par un avoir,
//   libère son échéance : son statut se dérive de la facture, rien à réécrire.
// - « paiement » : règlement en plusieurs fois d'UNE facture déjà émise ; chaque échéance se marque réglée à la main
//   (aucune information de paiement partiel ne nous parvient du bot).
// La reprise des contrats d'avant les échéanciers (reprendreContratsExistants) ne modifie, ne crée ni ne supprime
// aucune facture : elle ne fait que relier les périodes déjà facturées à leur facture.
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../socle/db.js';
import { debutPeriode, indexPeriode, periode, type Periodicite } from './contrats-periodes.js';
import { envoyerFactureSurDiscord } from './facture.js';
import { Refus } from './refus.js';
import { jourParis, jourValide, versDate, versJour } from './texte.js';

export const TYPES_ECHEANCIER = ['facturation', 'paiement'] as const;
export type TypeEcheancier = typeof TYPES_ECHEANCIER[number];
export const RYTHMES = ['journalier', 'hebdomadaire', 'mensuel'] as const;
export type Rythme = typeof RYTHMES[number];

const texte = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const STATUTS_PAYES = ['PAID', 'PAYEE'];
const AVANCE_RECONDUCTION = 12;   // échéances générées d'avance pour un contrat sans date de fin
const ENTIER_MAX = 2_147_483_647;

// ---- pur : répartition d'un total en N échéances, générateur de dates ----
// La dernière échéance absorbe l'arrondi : la somme des parts est toujours exactement égale au total.
export function repartir(total: number, nombre: number): number[] {
  if (nombre <= 0) return [];
  const part = Math.floor(total / nombre);
  const parts = new Array(nombre).fill(part);
  parts[nombre - 1] = total - part * (nombre - 1);
  return parts;
}

// dates des N échéances à partir de `premiere`, au rythme choisi (même calendrier que les contrats)
export function datesGenerees(premiere: string, rythme: Rythme, nombre: number): string[] {
  return Array.from({ length: nombre }, (_, i) => debutPeriode(premiere, rythme as Periodicite, i));
}

// ---- lecture ----
type FactureLue = { id: number; numeroFacture: string; statutPaiement: string };
type EcheanceLigne = {
  id: number; datePrevue: Date; periodeDebut: Date | null; periodeFin: Date | null; montant: number; note: string;
  factureId: number | null; payeeLe: Date | null; moyenPaiement: string; facture?: FactureLue | null;
};

// une facture « libère » son échéance quand elle est annulée ou qu'un avoir l'annule
const libere = (e: { factureId: number | null; facture?: FactureLue | null }, avoirs: ReadonlySet<number>): boolean =>
  e.factureId !== null && (e.facture?.statutPaiement === 'ANNULEE' || avoirs.has(e.factureId));
// l'échéance tient encore une facture en vigueur : elle ne se modifie ni ne se refacture
const verrouillee = (e: { factureId: number | null; facture?: FactureLue | null }, avoirs: ReadonlySet<number>): boolean =>
  e.factureId !== null && !libere(e, avoirs);

async function facturesAvecAvoir(ids: (number | null)[]): Promise<Set<number>> {
  const liste = ids.filter((x): x is number => x !== null);
  if (!liste.length) return new Set();
  return new Set((await prisma.facture.findMany({ where: { avoirDeId: { in: liste } }, select: { avoirDeId: true } })).map(a => a.avoirDeId!));
}

function statutEcheance(type: TypeEcheancier, e: EcheanceLigne, aujourdhui: string, avoirs: ReadonlySet<number>) {
  const prevue = versJour(e.datePrevue);
  if (type === 'paiement') return e.payeeLe ? 'payee' : prevue > aujourdhui ? 'a-venir' : 'a-regler';
  if (!verrouillee(e, avoirs)) return prevue > aujourdhui ? 'a-venir' : 'a-facturer';
  return e.facture && STATUTS_PAYES.includes(e.facture.statutPaiement) ? 'payee' : 'facturee';
}

function versEcheance(type: TypeEcheancier, e: EcheanceLigne, aujourdhui: string, avoirs: ReadonlySet<number>) {
  const active = verrouillee(e, avoirs);
  return {
    id: e.id, datePrevue: versJour(e.datePrevue),
    periodeDebut: e.periodeDebut ? versJour(e.periodeDebut) : null, periodeFin: e.periodeFin ? versJour(e.periodeFin) : null,
    montant: e.montant, note: e.note,
    factureId: active ? e.factureId : null, facture: active && e.facture ? { id: e.facture.id, numeroFacture: e.facture.numeroFacture } : null,
    payeeLe: e.payeeLe, moyenPaiement: e.moyenPaiement,
    statut: statutEcheance(type, e, aujourdhui, avoirs),
  };
}

const INCLURE_ECHEANCES = { echeances: { orderBy: [{ datePrevue: 'asc' as const }, { id: 'asc' as const }], include: { facture: { select: { id: true, numeroFacture: true, statutPaiement: true } } } } };
const INCLURE_FACTURE_PAIEMENT = { facture: { select: { id: true, numeroFacture: true, clientNom: true, sousTotal: true, livraison: true, reduction: true, total: true, details: true, dateFacture: true, dateEcheance: true, statutPaiement: true } } };

// `montantFacture` / `montantRegle` (jamais `facture` / `regle` seuls) : pas de collision avec la relation `facture`
// de l'échéancier (la facture réglée en plusieurs fois)
function totaux(type: TypeEcheancier, echeances: ReturnType<typeof versEcheance>[]) {
  const prevu = echeances.reduce((s, e) => s + e.montant, 0);
  const montantRegle = echeances.filter(e => e.statut === 'payee').reduce((s, e) => s + e.montant, 0);
  if (type === 'paiement') return { prevu, montantRegle, reste: prevu - montantRegle };
  const montantFacture = echeances.filter(e => ['facturee', 'payee'].includes(e.statut)).reduce((s, e) => s + e.montant, 0);
  // reste = ce qui est dû maintenant (échéances échues non facturées) : les périodes à venir ne sont pas encore à facturer
  return { prevu, montantFacture, montantRegle, reste: echeances.filter(e => e.statut === 'a-facturer').reduce((s, e) => s + e.montant, 0) };
}

export async function listerEcheanciers() {
  const aujourdhui = jourParis();
  const lignes = await prisma.echeancier.findMany({
    orderBy: { creeLe: 'desc' },
    include: { ...INCLURE_ECHEANCES, ...INCLURE_FACTURE_PAIEMENT, contrat: { select: { id: true, partenaire: true } } },
  });
  const avoirs = await facturesAvecAvoir(lignes.flatMap(l => l.echeances.map(x => x.factureId)));
  return lignes.map(({ echeances, ...e }) => {
    const liste = echeances.map(x => versEcheance(e.type as TypeEcheancier, x, aujourdhui, avoirs));
    return { ...e, echeances: liste, ...totaux(e.type as TypeEcheancier, liste), aFacturerOuARegler: liste.some(x => x.statut === 'a-facturer' || x.statut === 'a-regler') };
  });
}

async function echeancierOu404(id: number) {
  const e = await prisma.echeancier.findUnique({ where: { id }, include: INCLURE_ECHEANCES });
  if (!e) throw new Refus('Échéancier introuvable.', 404);
  return e;
}

// bloque la suppression d'une facture réglée en plusieurs fois (routes/compta.ts) : la facture reste le document de
// référence du plan, la supprimer laisserait les échéances déjà réglées sans quittance possible
export async function planPaiementDeFacture(factureId: number) {
  return prisma.echeancier.findUnique({ where: { factureId }, select: { id: true } });
}

// ---- intégration contrats.ts : échéancier d'un contrat client, affiché dans sa fiche ----
export async function echeanciersDeContrats(contratIds: number[]) {
  const carte = new Map<number, { id: number; echeances: ReturnType<typeof versEcheance>[]; aFacturer: { nombre: number; montant: number } | null }>();
  if (!contratIds.length) return carte;
  const aujourdhui = jourParis();
  const lignes = await prisma.echeancier.findMany({ where: { contratId: { in: contratIds } }, include: INCLURE_ECHEANCES });
  const avoirs = await facturesAvecAvoir(lignes.flatMap(l => l.echeances.map(x => x.factureId)));
  for (const { echeances, contratId, id } of lignes) {
    const liste = echeances.map(x => versEcheance('facturation', x, aujourdhui, avoirs));
    const dues = liste.filter(x => x.statut === 'a-facturer');
    carte.set(contratId!, { id, echeances: liste, aFacturer: dues.length ? { nombre: dues.length, montant: dues.reduce((s, x) => s + x.montant, 0) } : null });
  }
  return carte;
}

// verrou de modification (contrats.ts) : dès qu'une échéance a porté une facture, le rythme et la date de début ne
// changent plus (les échéances émises se calent dessus), même si cette facture a été annulée depuis
export async function contratAEcheancesFacturees(contratId: number): Promise<boolean> {
  return (await prisma.echeance.count({ where: { factureId: { not: null }, echeancier: { contratId } } })) > 0;
}

// Accueil, « À traiter » : contrats clients actifs avec au moins une échéance due et non facturée (ou libérée)
export async function nombreContratsAFacturer(): Promise<number> {
  const du = await prisma.echeance.findMany({
    where: { datePrevue: { lte: versDate(jourParis()) }, echeancier: { type: 'facturation', contratId: { not: null } } },
    select: { factureId: true, facture: { select: { statutPaiement: true } }, echeancier: { select: { contratId: true } } },
  });
  const avoirs = await facturesAvecAvoir(du.map(d => d.factureId));
  return new Set(du.filter(d => !verrouillee({ factureId: d.factureId, facture: d.facture && { id: 0, numeroFacture: '', statutPaiement: d.facture.statutPaiement } }, avoirs)).map(d => d.echeancier.contratId)).size;
}

// ---- création (libre, sans contrat) ----
function lireGenerateur(b: Record<string, unknown>): { dates: string[]; montants: number[] } | null {
  if (!b.premiere || !b.nombre) return null;
  if (!jourValide(b.premiere)) throw new Refus('La première date est invalide (jj/mm/aaaa).');
  const nombre = Math.round(Number(b.nombre));
  if (!Number.isInteger(nombre) || nombre < 1 || nombre > 120) throw new Refus('Le nombre d’échéances doit être entre 1 et 120.');
  if (!RYTHMES.includes(b.rythme as Rythme)) throw new Refus('Choisissez le rythme : journalier, hebdomadaire ou mensuel.');
  const total = Math.round(Number(b.montantTotal));
  if (!Number.isFinite(total) || total <= 0 || total > ENTIER_MAX) throw new Refus('Le montant total doit être un nombre positif.');
  return { dates: datesGenerees(b.premiere as string, b.rythme as Rythme, nombre), montants: repartir(total, nombre) };
}

export async function creerEcheancierLibre(b: Record<string, unknown>, compteId: number) {
  const partenaire = texte(b.partenaire, 200);
  if (!partenaire) throw new Refus('Le nom du client est obligatoire.');
  const genere = lireGenerateur(b);
  return prisma.echeancier.create({
    data: {
      type: 'facturation', partenaire, notes: texte(b.notes, 500), compteId,
      echeances: genere ? { create: genere.dates.map((datePrevue, i) => ({ datePrevue: versDate(datePrevue), montant: genere.montants[i] })) } : undefined,
    },
  });
}

// Paiement en plusieurs fois d'une facture déjà émise : la facture reste le document de référence (jamais recréée ni
// supprimée), l'échéancier n'est que son plan de règlement.
export async function creerEcheancierPaiement(factureId: number, b: Record<string, unknown>, compteId: number) {
  const facture = await prisma.facture.findUnique({ where: { id: factureId } });
  if (!facture) throw new Refus('Facture introuvable.', 404);
  if (facture.avoirDeId !== null || facture.statutPaiement === 'ANNULEE') throw new Refus('Un avoir, ou une facture annulée, ne se paie pas en plusieurs fois.');
  if (STATUTS_PAYES.includes(facture.statutPaiement)) throw new Refus('Cette facture est déjà payée.', 409);
  if (await prisma.facture.findFirst({ where: { avoirDeId: factureId }, select: { id: true } })) throw new Refus('Cette facture est annulée par un avoir : elle ne se paie plus.', 409);
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
    // factureId unique en base : une seconde requête presque simultanée (double clic) échoue proprement ici
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Refus('Un plan de règlement existe déjà pour cette facture.', 409);
    throw e;
  }
}

export async function supprimerEcheancier(id: number): Promise<void> {
  const e = await echeancierOu404(id);
  if (e.contratId !== null) throw new Refus('L’échéancier d’un contrat suit le contrat : modifiez le contrat plutôt que de le supprimer.', 409);
  await prisma.$transaction(async tx => {
    await tx.echeancier.delete({ where: { id } });
    // le plan disparaît : la facture reste, mais ne doit pas rester « payée » pour un règlement qui n'existe plus
    if (e.factureId) await tx.facture.updateMany({ where: { id: e.factureId, statutPaiement: 'PAYEE' }, data: { statutPaiement: 'EN_ATTENTE' } });
  });
}

// ---- une échéance ----
function lireEcheance(b: Record<string, unknown>) {
  if (!jourValide(b.datePrevue)) throw new Refus('La date est invalide (jj/mm/aaaa).');
  const montant = Math.round(Number(b.montant));
  if (!Number.isFinite(montant) || montant <= 0 || montant > ENTIER_MAX) throw new Refus('Le montant doit être un nombre positif.');
  return { datePrevue: versDate(b.datePrevue as string), montant, note: texte(b.note, 200) };
}

export async function ajouterEcheance(echeancierId: number, b: Record<string, unknown>) {
  const e = await echeancierOu404(echeancierId);
  if (e.contratId !== null) throw new Refus('Les échéances d’un contrat suivent son calendrier : modifiez le contrat pour en ajouter.', 409);
  return prisma.echeance.create({ data: { echeancierId, ...lireEcheance(b) } });
}

async function echeanceModifiable(id: number) {
  const e = await prisma.echeance.findUnique({ where: { id }, include: { facture: { select: { id: true, numeroFacture: true, statutPaiement: true } } } });
  if (!e) throw new Refus('Échéance introuvable.', 404);
  if (e.payeeLe || verrouillee(e, await facturesAvecAvoir([e.factureId]))) throw new Refus('Cette échéance a déjà été facturée ou réglée : elle ne se modifie plus.', 409);
  return e;
}

export async function modifierEcheance(id: number, b: Record<string, unknown>): Promise<void> {
  const e = await echeanceModifiable(id);
  const donnees = lireEcheance(b);
  // une échéance de période de contrat garde sa date prévue (le premier jour de sa période) : seul son montant change
  await prisma.echeance.update({ where: { id }, data: e.periodeDebut ? { montant: donnees.montant, note: donnees.note } : donnees });
}

export async function supprimerEcheance(id: number): Promise<void> {
  const e = await echeanceModifiable(id);
  const echeancier = await prisma.echeancier.findUnique({ where: { id: e.echeancierId }, select: { contratId: true } });
  if (echeancier?.contratId !== null) throw new Refus('Une échéance de contrat ne se supprime pas : mettez fin au contrat ou changez ses dates.', 409);
  await prisma.echeance.delete({ where: { id } });
}

// « Nouveau montant à partir du … » : toutes les échéances non encore facturées à partir de cette date (facturation
// seulement : le montant d'un paiement en plusieurs fois est fixé par le total de la facture qu'il règle)
export async function ajusterMontantAPartirDe(echeancierId: number, date: unknown, montant: unknown): Promise<void> {
  const e = await echeancierOu404(echeancierId);
  if (e.type !== 'facturation') throw new Refus('Seul un échéancier de facturation accepte un nouveau montant.');
  if (!jourValide(date)) throw new Refus('La date est invalide (jj/mm/aaaa).');
  const m = Math.round(Number(montant));
  if (!Number.isFinite(m) || m <= 0 || m > ENTIER_MAX) throw new Refus('Le montant doit être un nombre positif.');
  const avoirs = await facturesAvecAvoir(e.echeances.map(x => x.factureId));
  const libres = e.echeances.filter(x => !verrouillee({ factureId: x.factureId, facture: x.facture }, avoirs) && versJour(x.datePrevue) >= (date as string)).map(x => x.id);
  await prisma.echeance.updateMany({ where: { id: { in: libres } }, data: { montant: m } });
}

// ajoute `nombre` échéances après la dernière, au même montant et au rythme donné (plan libre uniquement : celles d'un
// contrat suivent son calendrier)
export async function etendre(echeancierId: number, nombre: number, rythme: unknown): Promise<void> {
  if (!Number.isInteger(nombre) || nombre < 1 || nombre > 60) throw new Refus('Le nombre d’échéances à ajouter doit être entre 1 et 60.');
  if (!RYTHMES.includes(rythme as Rythme)) throw new Refus('Choisissez le rythme : journalier, hebdomadaire ou mensuel.');
  const e = await echeancierOu404(echeancierId);
  if (e.contratId !== null) throw new Refus('Les échéances d’un contrat suivent son calendrier : modifiez le contrat pour le prolonger.', 409);
  if (!e.echeances.length) throw new Refus('Ajoutez d’abord au moins une échéance pour fixer le montant et le rythme.');
  const derniere = e.echeances[e.echeances.length - 1];
  const dates = datesGenerees(versJour(derniere.datePrevue), rythme as Rythme, nombre + 1).slice(1);
  await prisma.echeance.createMany({ data: dates.map(datePrevue => ({ echeancierId, datePrevue: versDate(datePrevue), montant: derniere.montant })) });
}

// ---- facturer : une facture par échéance choisie (jamais deux fois la même, factureId verrouille la ligne) ----
// `ids` vide : toutes les échéances dues (non facturées ou libérées, date prévue passée ou du jour). Une sélection
// précise peut inclure une échéance pas encore due. compteId null : sans auteur humain (facturation automatique, 9.3).
export async function facturerEcheances(echeancierId: number, ids: number[], compteId: number | null): Promise<number[]> {
  const e = await echeancierOu404(echeancierId);
  if (e.type !== 'facturation') throw new Refus('Seul un échéancier de facturation se facture.');
  const aujourdhui = jourParis();
  const avoirs = await facturesAvecAvoir(e.echeances.map(x => x.factureId));
  const libres = e.echeances.filter(x => !verrouillee(x, avoirs));
  const choisies = ids.length ? libres.filter(x => ids.includes(x.id)) : libres.filter(x => versJour(x.datePrevue) <= aujourdhui);
  if (!choisies.length) throw new Refus(ids.length ? 'Une échéance choisie a déjà été facturée. Rechargez la page.' : 'Aucune échéance n’est due pour le moment.', ids.length ? 409 : 400);
  if (ids.length && choisies.length < new Set(ids).size) throw new Refus('Une échéance choisie a déjà été facturée ou n’existe plus. Rechargez la page.', 409);
  const crees: number[] = [];
  await prisma.$transaction(async tx => {
    if (e.contratId !== null) await tx.$queryRaw`SELECT id FROM contrats WHERE id = ${e.contratId} FOR UPDATE`;
    for (const x of choisies) {
      const f = await tx.facture.create({
        data: {
          source: 'manuel', clientNom: e.partenaire, sousTotal: x.montant, livraison: 0, reduction: 0, total: x.montant,
          statutPaiement: 'EN_ATTENTE', compteId, dateFacture: new Date(),
          contratId: e.contratId, periodeDebut: x.periodeDebut, periodeFin: x.periodeFin,
        },
      });
      // reconditionné sur l'état lu (non facturée, ou facture libérée) : un double clic ou une nouvelle tentative
      // simultanée ne facture jamais deux fois la même échéance
      const { count } = await tx.echeance.updateMany({ where: { id: x.id, factureId: x.factureId }, data: { factureId: f.id } });
      if (!count) throw new Refus('Une échéance choisie a déjà été facturée. Rechargez la page.', 409);
      crees.push(f.id);
    }
  });
  return crees;
}

// ---- facturation automatique (option « facturationAutomatique » du contrat, contrats.ts) ----
// Chaque heure : facture seule les échéances dues d'un contrat CLIENT EN COURS qui l'a activée, puis poste chaque
// facture créée dans le salon du contrat (exigé à l'activation). Un contrat terminé n'est jamais facturé seul : ses
// périodes restantes se facturent à la main. La facture est créée même si l'envoi Discord échoue (elle reste à
// envoyer à la main) ; un envoi en échec n'est jamais retenté seul, pour ne pas poster deux fois.
export async function facturerEtEnvoyerAutomatique(): Promise<{ facturees: number; envoyees: number; erreurs: number }> {
  const echeanciers = await prisma.echeancier.findMany({
    where: { type: 'facturation', contrat: { facturationAutomatique: true, statut: 'actif', partie: 'client' } },
    select: { id: true, contratId: true },
  });
  let facturees = 0, envoyees = 0, erreurs = 0;
  for (const { id } of echeanciers) {
    const dues = await echeancierOu404(id);
    const avoirs = await facturesAvecAvoir(dues.echeances.map(x => x.factureId));
    const aujourdhui = jourParis();
    if (!dues.echeances.some(x => !verrouillee(x, avoirs) && versJour(x.datePrevue) <= aujourdhui)) continue;
    let crees: number[];
    try { crees = await facturerEcheances(id, [], null); }
    catch (err) { erreurs++; console.error(`[echeanciers] facturation automatique (échéancier ${id})`, err); continue; }
    facturees += crees.length;
    for (const factureId of crees) {
      try { if (await envoyerFactureSurDiscord(factureId)) envoyees++; }
      catch (err) { erreurs++; console.error(`[echeanciers] envoi Discord automatique (facture ${factureId})`, err); }
    }
  }
  return { facturees, envoyees, erreurs };
}

export function planifierFacturationAutomatique(): void {
  const run = () => facturerEtEnvoyerAutomatique()
    .then(({ facturees, envoyees, erreurs }) => { if (facturees || erreurs) console.log(`[echeanciers] facturation automatique : ${facturees} facture(s) créée(s), ${envoyees} envoyée(s) sur Discord${erreurs ? `, ${erreurs} erreur(s)` : ''}`); })
    .catch(e => console.error('[echeanciers] facturation automatique', e));
  setTimeout(run, 60e3).unref();   // une minute après le démarrage (la reprise des contrats est passée), puis toutes les heures
  setInterval(run, 3600e3).unref();
}

// ---- paiement en plusieurs fois : réglé à la main seulement ----
// Marquer réglée ne crée aucune facture : seule la facture d'origine change de statut, une fois toutes ses échéances
// réglées. Annuler le règlement la rouvre si c'est son dernier versement qui l'avait close.
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
  if (e.echeancier.type !== 'paiement') throw new Refus('Seule une échéance de paiement se règle ainsi.');
  await prisma.echeance.update({ where: { id }, data: { payeeLe: null, moyenPaiement: '' } });
  await soldeFactureSelonEcheances(e.echeancierId);
}
// la facture passe « payée » quand sa dernière échéance se règle, et redevient « en attente » si on annule ce dernier
// règlement — jamais touchée par un simple versement partiel
async function soldeFactureSelonEcheances(echeancierId: number): Promise<void> {
  const [echeancier, echeances] = await Promise.all([
    prisma.echeancier.findUnique({ where: { id: echeancierId }, select: { factureId: true } }),
    prisma.echeance.findMany({ where: { echeancierId }, select: { payeeLe: true } }),
  ]);
  if (!echeancier?.factureId) return;
  const statutPaiement = echeances.every(x => x.payeeLe) ? 'PAYEE' : 'EN_ATTENTE';
  await prisma.facture.updateMany({ where: { id: echeancier.factureId, statutPaiement: { not: 'ANNULEE' } }, data: { statutPaiement } });
}

// ---- synchronisation avec un contrat client (appelée par contrats.ts et au démarrage) ----
type ContratSync = { id: number; partie: string; partenaire: string; montant: number; periodicite: string; dateDebut: Date; dateFin: Date | null };
type Tx = Prisma.TransactionClient;

// Un contrat fournisseur n'a pas d'échéancier (on le paie, on ne le facture pas). `regenerer` : retire d'abord les
// échéances sans facture pour les refaire au montant du contrat (changement du contrat) ; sinon (prolongation
// quotidienne) ne fait qu'ajouter les périodes manquantes, sans toucher à un montant ajusté à la main.
export async function synchroniserEcheancierContrat(contrat: ContratSync, regenerer = true, tx: Tx | typeof prisma = prisma): Promise<void> {
  if (contrat.partie !== 'client') return;
  const periodicite = contrat.periodicite as Periodicite;
  const dateDebut = versJour(contrat.dateDebut), dateFin = contrat.dateFin ? versJour(contrat.dateFin) : null, aujourdhui = jourParis();
  const echeancier = await tx.echeancier.upsert({
    where: { contratId: contrat.id },
    create: { type: 'facturation', contratId: contrat.id, partenaire: contrat.partenaire },
    update: { partenaire: contrat.partenaire },
  });
  if (regenerer) await tx.echeance.deleteMany({ where: { echeancierId: echeancier.id, factureId: null } });
  const horizon = dateFin !== null ? indexPeriode(dateDebut, periodicite, dateFin) : indexPeriode(dateDebut, periodicite, aujourdhui) + AVANCE_RECONDUCTION;
  if (horizon < 0) return;
  const existantes = new Set((await tx.echeance.findMany({ where: { echeancierId: echeancier.id }, select: { periodeDebut: true } })).map(x => versJour(x.periodeDebut)));
  const lignes = [];
  for (let n = 0; n <= horizon; n++) {
    const p = periode(dateDebut, periodicite, n);
    if (existantes.has(p.debut)) continue;
    lignes.push({ echeancierId: echeancier.id, datePrevue: versDate(p.debut), periodeDebut: versDate(p.debut), periodeFin: versDate(p.fin), montant: contrat.montant });
  }
  if (lignes.length) await tx.echeance.createMany({ data: lignes, skipDuplicates: true });
}

// tâche quotidienne : prolonge les contrats reconduits tacitement (12 périodes d'avance), sans rien régénérer
export async function prolongerEcheanciers(): Promise<number> {
  const contrats = await prisma.contrat.findMany({ where: { partie: 'client', statut: 'actif', dateFin: null } });
  for (const c of contrats) await synchroniserEcheancierContrat(c, false);
  return contrats.length;
}

// au démarrage : reprise des contrats existants (idempotente), puis prolongation des reconductions toutes les 6 h.
// Une erreur est journalisée sans empêcher le serveur de démarrer : la fiche des contrats retombe alors sur un échéancier
// incomplet, relancé au démarrage suivant.
export function planifierEcheanciers(): void {
  reprendreContratsExistants()
    .then(({ contrats, liees, ignorees }) => { if (liees || ignorees) console.log(`[echeanciers] reprise : ${contrats} contrat(s), ${liees} période(s) reliée(s) à leur facture, ${ignorees} ignorée(s)`); })
    .catch(e => console.error('[echeanciers] reprise des contrats', e));
  setInterval(() => { prolongerEcheanciers().catch(e => console.error('[echeanciers] prolongation', e)); }, 6 * 3600e3).unref();
}

// ---- reprise des contrats d'avant les échéanciers ----
// Idempotente, lancée au démarrage : pour chaque contrat client, relie chaque période déjà facturée (facture non
// annulée, sans avoir, avec ses bornes sur le calendrier du contrat) à son échéance, puis génère le reste de
// l'horizon. Ne modifie, ne crée ni ne supprime aucune facture et n'envoie rien. Une facture couvrant plusieurs
// périodes donne une échéance par période, toutes reliées à elle, son total réparti sans reste.
export async function reprendreContratsExistants(): Promise<{ contrats: number; liees: number; ignorees: number }> {
  const contrats = await prisma.contrat.findMany({ where: { partie: 'client' }, orderBy: { id: 'asc' } });
  let liees = 0, ignorees = 0;
  for (const c of contrats) {
    const factures = await prisma.facture.findMany({
      where: { contratId: c.id, periodeDebut: { not: null }, periodeFin: { not: null }, statutPaiement: { not: 'ANNULEE' }, avoirDeId: null },
      orderBy: { id: 'asc' }, select: { id: true, total: true, periodeDebut: true, periodeFin: true },
    });
    if (!factures.length) {
      await prisma.$transaction(tx => synchroniserEcheancierContrat(c, false, tx));
      continue;
    }
    const avoirs = await facturesAvecAvoir(factures.map(f => f.id));
    const dateDebut = versJour(c.dateDebut), p = c.periodicite as Periodicite;
    await prisma.$transaction(async tx => {
      await synchroniserEcheancierContrat(c, false, tx);   // crée l'échéancier et ses périodes ; relié ci-dessous
      const echeancier = await tx.echeancier.findUniqueOrThrow({ where: { contratId: c.id } });
      for (const f of factures) {
        if (avoirs.has(f.id)) continue;
        const debut = versJour(f.periodeDebut), fin = versJour(f.periodeFin);
        const i = indexPeriode(dateDebut, p, debut), j = indexPeriode(dateDebut, p, fin);
        // bornes qui ne tombent pas sur le calendrier du contrat : rien n'est supposé, la facture reste non reliée
        if (i < 0 || j < i || debutPeriode(dateDebut, p, i) !== debut || periode(dateDebut, p, j).fin !== fin) {
          console.warn(`[echeanciers] reprise : facture ${f.id} (contrat ${c.id}) hors du calendrier du contrat, non reliée`);
          ignorees++; continue;
        }
        const parts = repartir(f.total, j - i + 1);
        for (let n = i; n <= j; n++) {
          const periodeN = periode(dateDebut, p, n);
          const { count } = await tx.echeance.updateMany({
            where: { echeancierId: echeancier.id, periodeDebut: versDate(periodeN.debut), factureId: null },
            data: { factureId: f.id, montant: parts[n - i] },
          });
          if (count) liees++;
          else if (!await tx.echeance.findFirst({ where: { echeancierId: echeancier.id, periodeDebut: versDate(periodeN.debut), factureId: f.id }, select: { id: true } })) {
            // période déjà reliée à une autre facture (chevauchement de données anciennes) ou hors horizon
            ignorees++;
          }
        }
      }
    });
  }
  return { contrats: contrats.length, liees, ignorees };
}

// Une facture saisie à la main pour des périodes de contrat (route /api/compta/factures avec contratId, après
// verifierFacturationContrat) : relie les échéances de ces périodes, dans la même transaction. Son total est réparti
// sur les périodes couvertes. Une échéance dont la facture est annulée ou annulée par un avoir est reprise.
export async function lierEcheancesAFacture(tx: Tx, contratId: number, debut: Date, fin: Date, factureId: number, total: number): Promise<void> {
  const echeances = await tx.echeance.findMany({
    where: { echeancier: { contratId }, periodeDebut: { gte: debut }, periodeFin: { lte: fin } },
    orderBy: { periodeDebut: 'asc' }, include: { facture: { select: { id: true, numeroFacture: true, statutPaiement: true } } },
  });
  const avoirs = new Set((await tx.facture.findMany({ where: { avoirDeId: { in: echeances.map(x => x.factureId).filter((x): x is number => x !== null) } }, select: { avoirDeId: true } })).map(a => a.avoirDeId!));
  const libres = echeances.filter(x => !verrouillee(x, avoirs));
  const parts = repartir(total, libres.length);
  for (const [i, x] of libres.entries()) await tx.echeance.update({ where: { id: x.id }, data: { factureId, montant: parts[i] } });
}
