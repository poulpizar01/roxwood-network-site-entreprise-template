// ENTREPRISE — paie : salaire de base par grade (table remunerations_grades, salaireFixe/salaireActif — sans rapport
// avec la paie à l'heure, stats/paie-horaire.ts) et primes par palier de quota (table primes_palier_grades), réglés
// page Paie (permission « paie »). Simulateur : chiffres saisis à la main, ou repris des vraies tables run/facture
// d'un employé sur une semaine (routes/paie.ts).
import { prisma } from '../socle/db.js';
import { tousLesGrades } from '../socle/droits.js';
import { nomComplet } from './rh.js';
import { debutSemaineParis, versJour } from './texte.js';

export type Palier = { seuil: number; prime: number };
export const DOMAINES_PALIER = ['run', 'facture'] as const;
export type DomainePalier = typeof DOMAINES_PALIER[number];

// Un seul palier compte : le plus haut atteint (comme le barème d'imposition de la DOT) — jamais la somme des
// paliers franchis.
export function primeDePalier(paliers: readonly Palier[], valeur: number): number {
  const atteints = paliers.filter(p => valeur >= p.seuil);
  return atteints.length ? Math.max(...atteints.map(p => p.prime)) : 0;
}

export function calculerPaie(args: {
  salaireFixe: number | null; salaireActif: boolean;
  paliersRun: readonly Palier[]; runs: number;
  paliersFacture: readonly Palier[]; factures: number;
}) {
  const salaireBase = args.salaireActif ? args.salaireFixe ?? 0 : 0;
  const primeRun = primeDePalier(args.paliersRun, args.runs);
  const primeFacture = primeDePalier(args.paliersFacture, args.factures);
  return { salaireBase, primeRun, primeFacture, total: salaireBase + primeRun + primeFacture };
}

// Configuration de paie de chaque grade du site (page Paie). Un grade sans ligne de rémunération ou sans palier a
// les valeurs par défaut (pas de salaire, pas de prime).
export async function paieGrades() {
  const [remu, paliers] = await Promise.all([prisma.remunerationGrade.findMany(), prisma.primePalierGrade.findMany({ orderBy: { seuil: 'asc' } })]);
  const remuParGrade = new Map(remu.map(r => [r.gradeCle, r]));
  return tousLesGrades().map(g => {
    const r = remuParGrade.get(g.cle);
    return {
      cle: g.cle, libelle: g.libelle,
      salaireFixe: r?.salaireFixe ?? null, salaireActif: r?.salaireActif ?? false,
      paliersRun: paliers.filter(p => p.gradeCle === g.cle && p.domaine === 'run').map(p => ({ seuil: p.seuil, prime: p.prime })),
      paliersFacture: paliers.filter(p => p.gradeCle === g.cle && p.domaine === 'facture').map(p => ({ seuil: p.seuil, prime: p.prime })),
    };
  });
}

export async function definirSalaireBase(gradeCle: string, salaireFixe: number | null, salaireActif: boolean): Promise<void> {
  await prisma.remunerationGrade.upsert({
    where: { gradeCle }, create: { gradeCle, salaireFixe, salaireActif }, update: { salaireFixe, salaireActif },
  });
}

export async function definirPaliers(gradeCle: string, domaine: DomainePalier, paliers: readonly Palier[]): Promise<void> {
  await prisma.$transaction([
    prisma.primePalierGrade.deleteMany({ where: { gradeCle, domaine } }),
    ...(paliers.length ? [prisma.primePalierGrade.createMany({ data: paliers.map(p => ({ gradeCle, domaine, seuil: p.seuil, prime: p.prime })) })] : []),
  ]);
}

// Employés actifs, pour le choix du simulateur (mode « données réelles »).
export async function employesPourSimulateur() {
  const employes = await prisma.employe.findMany({ where: { statut: 'actif' }, select: { id: true, prenom: true, nom: true, discordPseudo: true, idUnique: true, gradeCle: true } });
  return employes.map(e => ({ id: e.id, nomComplet: nomComplet(e), grade: e.gradeCle }));
}

// Cumul des runs (unités) et factures ($) d'un employé sur une semaine (lundi de calendrier Paris ; une semaine
// future demandée est ramenée à la semaine en cours, même règle que classementRuns/classementFactures).
export async function statsEmployeSemaine(employeId: number, semaineDemandee?: string) {
  const semaineCourante = debutSemaineParis();
  const debut = semaineDemandee ? debutSemaineParis(semaineDemandee) : semaineCourante;
  if (debut > semaineCourante) debut.setTime(semaineCourante.getTime());
  const fin = new Date(debut); fin.setUTCDate(fin.getUTCDate() + 7);
  const [runs, factures] = await Promise.all([
    prisma.run.aggregate({ where: { employeId, creeLe: { gte: debut, lt: fin } }, _sum: { quantite: true } }),
    prisma.facture.aggregate({ where: { employeId, dateFacture: { gte: debut, lt: fin } }, _sum: { total: true } }),
  ]);
  return { debutSemaine: versJour(debut), runs: runs._sum.quantite ?? 0, factures: factures._sum.total ?? 0 };
}
