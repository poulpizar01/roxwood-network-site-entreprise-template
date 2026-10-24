// ENTREPRISE — déclaration DOT hebdomadaire (routes/compta.ts) : relevé Tablettes, résumé et tableau des salariés
// d'une semaine donnée, verrouillage (manuel, bouton « Valider » ; ou automatique, verrouillage-dot.ts si personne ne
// l'a fait). Une fois verrouillée (compta_dot_declarations), une semaine est figée : son résumé, ses salariés et ses
// mouvements ne sont plus recalculés, même si le barème, le relevé Tablettes ou le solde bancaire changent ensuite.
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../socle/db.js';
import { gradeDe } from '../socle/droits.js';
import { reglage } from '../socle/reglages.js';
import { calculerPaie, paieGrades } from './paie.js';
import { Refus } from './refus.js';
import { nomComplet } from './rh.js';
import { heuresServiceSemaine } from './services.js';
import { caBrutReleve, estLigneTotal as estTotal, impotDot, indexColonne, minuscules, montantReleve, normaliserNom } from './stats/releve.js';
import { debutSemaineParis, jourDeSemaineParis, jourValide, versDate } from './texte.js';

export const PLAFOND_DEPENSE_DEDUCTIBLE = 2_000_000;
export const CLE_SOLDE_BANCAIRE = 'dot.solde_bancaire';
export const TYPES_ECRITURE = ['depense', 'retrait', 'recette'];

// ---------- semaine (AAAA-MM-JJ du lundi, calendrier Paris) : clé commune aux mouvements, primes et déclarations ----------
export const semaineCourante = (): string => jourDeSemaineParis(debutSemaineParis());
// semaine demandée (?semaine=AAAA-MM-JJ) : ramenée à son lundi, jamais dans le futur (même règle que classementRuns)
export function semaineDemandee(valeur: unknown): string {
  const courante = semaineCourante();
  if (typeof valeur !== 'string' || !jourValide(valeur)) return courante;
  const iso = jourDeSemaineParis(debutSemaineParis(valeur));
  return iso > courante ? courante : iso;
}
// clé @db.Date (compta_dot_ecritures, primes_employe_semaine, compta_dot_declarations) depuis une semaine AAAA-MM-JJ
export const semaineDate = (iso: string): Date => versDate(iso);
function plageSemaine(iso: string) {
  const debut = debutSemaineParis(iso), fin = new Date(debut); fin.setUTCDate(fin.getUTCDate() + 7);
  return { debut, fin };
}

export const estVerrouillee = async (iso: string) => !!(await prisma.declarationDot.findUnique({ where: { semaine: semaineDate(iso) }, select: { semaine: true } }));
export function refuserSiVerrouillee(verrouillee: boolean) {
  if (verrouillee) throw new Refus('La déclaration de cette semaine est verrouillée : elle ne peut plus être modifiée.', 409);
}

// ---------- relevé Tablettes (le navigateur découpe le tableau collé ; le serveur revalide, garde chaque import, ne
// renvoie que le plus récent — pas daté par semaine : son CA brut n'est figé que par le verrouillage de la DOT) ----------

// La ligne récap « TOTAL » collée depuis la tablette saute la case « Rang » (un grade ne se totalise pas), ce qui décale
// le reste de la ligne : on y remet un « - », seulement pour cette ligne et si elle est trop courte. Appliqué à
// l'enregistrement et à la lecture, pour tout relevé enregistré.
export function corrigerLigneTotale(colonnes: string[], lignes: string[][]) {
  const iRang = indexColonne(minuscules(colonnes), ['rang', 'grade']);
  if (iRang <= 0 || iRang >= colonnes.length - 1) return lignes;
  return lignes.map(l => (estTotal(l) && l.length < colonnes.length ? [...l.slice(0, iRang), '-', ...l.slice(iRang)] : l));
}

export async function dernierReleve() {
  const r = await prisma.importCompta.findFirst({ where: { type: 'tablettes' }, orderBy: [{ importeLe: 'desc' }, { id: 'desc' }] });
  const colonnes = (r?.colonnes as string[] | undefined) ?? [];
  // une réinitialisation enregistre un import sans colonnes : comme « aucun relevé »
  if (!r || !colonnes.length) return null;
  const auteur = r.compteId ? await prisma.compte.findUnique({ where: { id: r.compteId }, select: { nom: true, pseudo: true } }) : null;
  // nom RP (modifiable par chacun) suivi du pseudo Discord (non modifiable sur le site) : on sait qui a importé
  return { colonnes, lignes: corrigerLigneTotale(colonnes, r.lignes as string[][]), importeLe: r.importeLe, importePar: auteur ? (auteur.nom ? `${auteur.nom} (@${auteur.pseudo})` : `@${auteur.pseudo}`) : null };
}
export const enregistrerReleve = (colonnes: string[], lignes: string[][], compteId: number) =>
  prisma.importCompta.create({ data: { type: 'tablettes', colonnes, lignes, compteId } });

// ---------- mouvements (recette | depense | retrait) d'une semaine, bruts (table) ----------
export async function ecrituresBrutes(iso: string) {
  const e = await prisma.ecritureDot.findMany({ where: { semaine: semaineDate(iso) }, orderBy: { id: 'desc' } });
  return e.map(x => ({ id: x.id, type: x.type, date_ecriture: x.dateEcriture, justificatif: x.justificatif, montant: x.montant }));
}

// ---------- tableau des salariés d'une semaine ----------
// Liste : les employés actifs (RH fait foi pour le nom et le grade — jamais le relevé). RUN (unités) et FACTURE ($)
// sont les quotas réels de la semaine demandée (tables runs/factures, mêmes chiffres que les pages Paie et Quota) :
// deux pipelines différentes pour la même activité, le relevé Tablettes n'est pas la source qui fait foi ailleurs sur
// le site. VENTE et CA TOTAL RÉALISÉ restent lus dans le relevé Tablettes (colonnes « Ventes » et « Total
// entreprise », retrouvées par nom) : 0 si l'employé n'y figure pas. Salaire = calculerPaie (fixe du grade + palier
// run/facture le plus haut atteint, jamais cumulé) + paie à l'heure (services.ts, heuresServiceSemaine — plus le
// relevé Tablettes : rattachée par employeId, jamais par nom) ; la Prime est saisie pour cette semaine (tableau des
// salariés).
const ALIAS_NOM_SALARIES = ['nom', "nom de l'employé", 'nom du salarié', 'employé', 'employe'];
export async function salariesDot(iso: string) {
  const releve = await dernierReleve();
  const colonnesMin = releve ? minuscules(releve.colonnes) : [];
  const lignes = releve ? releve.lignes.filter(l => !estTotal(l)) : [];
  const iNomReleve = indexColonne(colonnesMin, ALIAS_NOM_SALARIES);
  const iVente = indexColonne(colonnesMin, ['vente', 'ventes']);
  const iTotalEntreprise = indexColonne(colonnesMin, ['total entreprise', 'total']);
  const ligneParNom = new Map<string, string[]>(iNomReleve === -1 ? [] : lignes.map((l): [string, string[]] => [normaliserNom(l[iNomReleve]), l]).filter(([n]) => n));

  const [employes, config, heuresParEmploye, remuGrades, primes] = await Promise.all([
    prisma.employe.findMany({ where: { statut: 'actif' }, select: { id: true, prenom: true, nom: true, discordPseudo: true, idUnique: true, gradeCle: true } }),
    paieGrades(),
    heuresServiceSemaine(iso),
    prisma.remunerationGrade.findMany(),
    prisma.primeEmployeSemaine.findMany({ where: { semaine: semaineDate(iso) } }),
  ]);
  const configParGrade = new Map(config.map(c => [c.cle, c]));
  const tauxHoraireParGrade = new Map(remuGrades.map(r => [r.gradeCle, r.tauxHoraire]));
  const primeParEmploye = new Map(primes.map(p => [p.employeId, p.montant]));
  // deux fiches actives avec le même nom normalisé liraient sinon silencieusement la même ligne du relevé (vente) :
  // on compte les occurrences pour les signaler plutôt que de deviner à qui elle appartient.
  const comptesParNom = new Map<string, number>();
  for (const e of employes) { const cle = normaliserNom(nomComplet(e)); comptesParNom.set(cle, (comptesParNom.get(cle) ?? 0) + 1); }

  const idsEmployes = employes.map(e => e.id);
  const { debut, fin } = plageSemaine(iso);
  const [sommeRuns, sommeFactures] = idsEmployes.length ? await Promise.all([
    prisma.run.groupBy({ by: ['employeId'], where: { employeId: { in: idsEmployes }, creeLe: { gte: debut, lt: fin } }, _sum: { quantite: true } }),
    prisma.facture.groupBy({ by: ['employeId'], where: { employeId: { in: idsEmployes }, dateFacture: { gte: debut, lt: fin } }, _sum: { total: true } }),
  ]) : [[], []];
  const runsParEmploye = new Map(sommeRuns.map(s => [s.employeId as number, s._sum.quantite ?? 0]));
  const facturesParEmploye = new Map(sommeFactures.map(s => [s.employeId as number, s._sum.total ?? 0]));

  const agents = employes.map(e => {
    const nom = nomComplet(e), cle = normaliserNom(nom);
    const ambigu = (comptesParNom.get(cle) ?? 0) > 1;
    const ligne = ambigu ? undefined : ligneParNom.get(cle);
    const run = runsParEmploye.get(e.id) ?? 0, facture = facturesParEmploye.get(e.id) ?? 0;
    const vente = ligne && iVente !== -1 ? Math.round(montantReleve(ligne[iVente])) : 0;
    const caTotalRealise = ligne && iTotalEntreprise !== -1 ? Math.round(montantReleve(ligne[iTotalEntreprise])) : 0;
    const c = configParGrade.get(e.gradeCle);
    const salaire = c ? calculerPaie({ salaireFixe: c.salaireFixe, salaireActif: c.salaireActif, paliersRun: c.paliersRun, runs: run, paliersFacture: c.paliersFacture, factures: facture }).total : 0;
    const heuresServiceMinutes = heuresParEmploye.get(e.id) ?? 0;
    const montantHoraire = Math.round((heuresServiceMinutes * (tauxHoraireParGrade.get(e.gradeCle) ?? 0)) / 60);
    return {
      employeId: e.id, nom, grade: gradeDe(e.gradeCle)?.libelle ?? e.gradeCle, run, facture, vente, caTotalRealise,
      heuresServiceMinutes, salaireTotal: salaire + montantHoraire, prime: primeParEmploye.get(e.id) ?? 0, ambigu,
    };
  });
  return { agents, tabletteTrouvee: !!releve };
}

// ---------- résumé d'une semaine ----------
// CA brut (relevé Tablettes + recettes exceptionnelles) − dépenses déductibles (plafonnées) = bénéfice imposable →
// impôts (taux du bénéfice + taux de la richesse, un seul impôt combiné) → bénéfice après impôts → primes → bénéfice
// après primes → retraits = bénéfice net.
// salariesPrecalcules : pour que construireEtVerrouiller ne relance pas salariesDot() une seconde fois en
// parallèle du tableau figé dans la même déclaration (les deux pourraient sinon diverger sur une écriture concurrente)
export async function resumeDot(iso: string, salariesPrecalcules?: Awaited<ReturnType<typeof salariesDot>>) {
  const [releve, ecritures, bareme, baremeRichesse, salaries, nombreEmployes] = await Promise.all([
    dernierReleve(), prisma.ecritureDot.findMany({ where: { semaine: semaineDate(iso) } }), prisma.baremeImposition.findMany({ orderBy: { seuilMin: 'asc' } }),
    prisma.baremeRichesse.findMany({ orderBy: { seuilMin: 'asc' } }), salariesPrecalcules ?? salariesDot(iso), prisma.employe.count({ where: { statut: 'actif' } }),
  ]);
  const caTablette = releve ? caBrutReleve(releve.colonnes, releve.lignes) : null;
  const recettes = ecritures.filter(e => e.type === 'recette').reduce((s, e) => s + e.montant, 0);
  const ca = caTablette === null && !recettes ? null : (caTablette ?? 0) + recettes;
  // dépense déductible = salaires de la semaine + dépenses manuelles saisies, plafonnés ensemble (barème RP)
  const salairesSemaine = salaries.agents.reduce((s, a) => s + a.salaireTotal, 0);
  const depensesManuelles = ecritures.filter(e => e.type === 'depense').reduce((s, e) => s + e.montant, 0);
  const depenses = Math.min(salairesSemaine + depensesManuelles, PLAFOND_DEPENSE_DEDUCTIBLE);
  const retraits = ecritures.filter(e => e.type === 'retrait').reduce((s, e) => s + e.montant, 0);
  const imposable = ca === null ? null : ca - depenses;
  // solde bancaire saisi à la main : sa tranche donne un taux qui s'ajoute à celui du bénéfice (pas un second impôt)
  const soldeBancaire = Math.round(Number(reglage(CLE_SOLDE_BANCAIRE) ?? 0)) || 0;
  const trancheRichesse = impotDot(soldeBancaire, baremeRichesse).tranche;
  const tauxRichesse = trancheRichesse?.taux ?? 0;
  // sous la première tranche ou en perte : 0 $ d'impôt, jamais le taux de la dernière tranche (stats/releve.ts)
  const tranche = imposable === null ? null : impotDot(imposable, bareme).tranche;
  const tauxImposition = tranche ? tranche.taux : imposable === null ? null : 0;
  const montantImpots = imposable === null || tauxImposition === null ? null : Math.round(Math.max(0, imposable) * (tauxImposition + tauxRichesse));
  const apresImpots = imposable === null || montantImpots === null ? null : imposable - montantImpots;
  const montantPrimes = salaries.agents.reduce((s, a) => s + a.prime, 0);
  const apresPrimes = apresImpots === null ? null : apresImpots - montantPrimes;
  return {
    semaine: iso,
    caBrut: ca, caBrutTrouve: caTablette !== null, caBrutTablette: caTablette, caBrutRecettes: recettes,
    salairesSemaine, depensesManuelles, depensePlafonnee: salairesSemaine + depensesManuelles > PLAFOND_DEPENSE_DEDUCTIBLE,
    tranche: tranche && { seuilMin: tranche.seuilMin, seuilMax: tranche.seuilMax },
    trancheRichesse: trancheRichesse && { seuilMin: trancheRichesse.seuilMin, seuilMax: trancheRichesse.seuilMax },
    caBrutSource: releve && caTablette !== null ? { importeLe: releve.importeLe, importePar: releve.importePar, nbLignes: releve.lignes.filter(l => !estTotal(l)).length } : null,
    depenseDeductible: depenses, beneficeImposable: imposable, tauxImposition, montantImpots,
    beneficeApresImpots: apresImpots,
    montantPrimes, beneficeApresPrimes: apresPrimes,
    retraits, beneficeNet: apresPrimes === null ? null : apresPrimes - retraits,
    soldeBancaire, tauxRichesse, nombreEmployes,
    plafonds: tranche ? { salaireMaxEmploye: tranche.salaireMaxEmploye, salaireMaxPatron: tranche.salaireMaxPatron, primeMaxEmploye: tranche.primeMaxEmploye, primeMaxPatron: tranche.primeMaxPatron } : null,
  };
}

// ---------- verrouillage (figer une semaine) ----------
// Calcule le résumé, le tableau des salariés et les mouvements de la semaine, puis les fige dans une déclaration :
// plus aucun recalcul ensuite, même si le barème, le relevé Tablettes ou le solde bancaire changent après coup.
// `compteId` null = verrouillage automatique (verrouillage-dot.ts), sinon manuel (« Valider la déclaration »).
export async function construireEtVerrouiller(iso: string, compteId: number | null, statut: 'validee' | 'auto') {
  if (await estVerrouillee(iso)) throw new Refus('Cette semaine est déjà verrouillée.', 409);
  const salaries = await salariesDot(iso);
  const [resume, ecritures] = await Promise.all([resumeDot(iso, salaries), ecrituresBrutes(iso)]);
  try {
    await prisma.declarationDot.create({ data: { semaine: semaineDate(iso), statut, compteId, resume, salaries, ecritures } });
  } catch (e) {
    // semaine (@id) déjà verrouillée par une requête presque simultanée (double clic, nouvelle tentative réseau)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Refus('Cette semaine est déjà verrouillée.', 409);
    throw e;
  }
}
