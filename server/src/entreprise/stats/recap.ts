// ENTREPRISE — récapitulatif d'une semaine par employé (quota, salaire fixe, primes), utilisé par la DOT.
// Les primes affichées partout (« Mon profil », chiffres du tableur, DOT) sont celles du TABLEUR de la Direction
// (ventes/locations de sa ligne, barèmes du site) : le calcul par semaine depuis les ventes du bot n'est gardé ici que
// pour le salaire fixe et le classement — jamais deux sources mélangées dans un même montant.
import { prisma } from '../../socle/db.js';
import { gradeDe, tousLesGrades } from '../../socle/droits.js';
import { reglage } from '../../socle/reglages.js';
import { normaliserTexte } from '../texte.js';
import { calculerFinances, compterAchats, compterLocations, primesSelonGrade, sommeFacture } from './calcul.js';
import { lireBaremes } from './tableur.js';
import { lireLignes } from './ventes.js';

// rémunération d'un grade du site ; un grade sans réglage : taux 0,48, pas de salaire, primes actives
export async function remunerations() {
  const lignes = await prisma.remunerationGrade.findMany();
  const parCle = new Map(lignes.map(l => [l.gradeCle, l]));
  return (cle: string | null | undefined) => {
    const r = cle ? parCle.get(cle) : undefined;
    return { taux: r?.taux ?? 0.48, salaireFixe: r?.salaireFixe ?? 0, salaireActif: r?.salaireActif ?? false, primeVenteActive: r?.primeVenteActive ?? true, primeLocationActive: r?.primeLocationActive ?? true };
  };
}

export async function recapSemaine(semaine: string) {
  const [{ lignes }, employes, baremes, remu] = await Promise.all([lireLignes(true, semaine), prisma.employe.findMany(), lireBaremes(), remunerations()]);
  const formateurDansQuota = reglage('stats.formateur_dans_quota') === '1';
  const parCle = new Map(employes.map(e => [`e:${e.id}`, e]));
  // toute l'équipe ACTIVE, même sans vente (0 partout), plus quiconque a vendu cette semaine (un inactif qui a encore
  // une vente y figure, un vendeur sans fiche apparaît sous le pseudo reçu)
  const cles = new Set([...employes.filter(e => e.statut === 'actif').map(e => `e:${e.id}`), ...lignes.filter(l => l.semaine === semaine).map(l => l.cleAgent)]);
  const agents = [...cles].map(cle => {
    const fiche = parCle.get(cle) ?? null;
    const r = remu(fiche?.gradeCle);
    const nbAchats = compterAchats(lignes, 'cleAgent', cle, semaine), nbLocations = compterLocations(lignes, 'cleAgent', cle, semaine);
    const facture = sommeFacture(lignes, cle, semaine, 'cleAgent');
    const finances = calculerFinances({
      nbAchats, nbLocations, facture,
      formateurNbAchats: compterAchats(lignes, 'cleFormateur', cle, semaine), formateurNbLocations: compterLocations(lignes, 'cleFormateur', cle, semaine),
      formateurComptesDansQuota: formateurDansQuota, baremeVentes: baremes.ventes, baremeLocations: baremes.locations,
      tauxCommission: r.taux, salaireFixe: r.salaireFixe ?? 0, salaireActif: r.salaireActif, primeVenteActive: r.primeVenteActive, primeLocationActive: r.primeLocationActive,
    });
    return {
      employeId: fiche?.id ?? null, idEmploye: fiche?.idEmploye ?? '', statut: fiche?.statut ?? '',
      identite: fiche ? fiche.discordPseudo : cle.slice(2), identiteRp: fiche ? `${fiche.prenom} ${fiche.nom}`.trim() : '',
      gradeCle: fiche?.gradeCle ?? null, grade: fiche ? gradeDe(fiche.gradeCle)?.libelle ?? fiche.gradeCle : '—', gradeConnu: !!fiche,
      nbAchats, nbLocations, facture, salaireFixe: r.salaireFixe ?? 0, ...finances,
    };
  });
  const rang = (cle: string | null) => gradeDe(cle)?.position ?? Number.MAX_SAFE_INTEGER;
  return agents.sort((a, b) => rang(a.gradeCle) - rang(b.gradeCle) || b.totalGagne - a.totalGagne);
}


// Primes du tableur : par fiche RH pour une ligne rattachée, par nom écrit pour une ligne sans fiche (personnes du
// relevé Tablettes qui n'ont pas — encore — de fiche).
// Semaine archivée (dimanche 23:59) : primes figées de son archive — le tableur actuel est déjà celui de la semaine
// suivante, souvent remis à zéro. Sinon le tableur actuel, primes selon le grade (interrupteurs de Rémunération) :
// celui de la fiche RH, sinon celui écrit dans le tableur. `source` dit lequel a servi.
export async function primesTableur(semaine?: string) {
  type Primes = { ventes: number; locations: number; primeVente: number; primeLocations: number; primeTotale: number };
  const parEmploye = new Map<number, Primes>(), parNomSansFiche = new Map<string, Primes>();
  const ranger = (employeId: number | null, nomNormalise: string, v: Primes) => {
    if (employeId) parEmploye.set(employeId, v);
    else if (nomNormalise && !parNomSansFiche.has(nomNormalise)) parNomSansFiche.set(nomNormalise, v);
  };
  const archive = semaine ? await prisma.tableurArchive.findUnique({ where: { semaine }, include: { lignes: true } }) : null;
  if (archive) {
    for (const l of archive.lignes) ranger(l.employeId, normaliserTexte(l.nom), { ventes: l.ventes, locations: l.locations, primeVente: l.primeVente, primeLocations: l.primeLocations, primeTotale: l.primeVente + l.primeLocations });
  } else {
    const [lignes, baremes, remu, employes] = await Promise.all([prisma.ligneTableur.findMany(), lireBaremes(), remunerations(), prisma.employe.findMany({ select: { id: true, gradeCle: true } })]);
    const gradeFiche = new Map(employes.map(e => [e.id, e.gradeCle]));
    const gradeParLibelle = new Map(tousLesGrades().map(g => [normaliserTexte(g.libelle), g.cle]));
    for (const l of lignes) {
      const grade = (l.employeId ? gradeFiche.get(l.employeId) : null) ?? gradeParLibelle.get(normaliserTexte(l.gradeSheet)) ?? null;
      ranger(l.employeId, l.nomNormalise, { ventes: l.nbVentes, locations: l.nbLocations, ...primesSelonGrade(remu(grade), baremes, l.nbVentes, l.nbLocations) });
    }
  }
  const zero: Primes = { ventes: 0, locations: 0, primeVente: 0, primeLocations: 0, primeTotale: 0 };
  const pour = (employeId: number | null, ...noms: string[]): Primes => {
    if (employeId) return parEmploye.get(employeId) ?? zero;
    for (const n of noms) { const v = parNomSansFiche.get(normaliserTexte(n)); if (v) return v; }
    return zero;
  };
  return Object.assign(pour, { source: archive ? 'archive' as const : 'actuel' as const });
}
export type PrimesTableur = Awaited<ReturnType<typeof primesTableur>>;

// récapitulatif dont les primes « par semaine » sont remplacées par celles du tableur (de cette semaine : son archive
// s'il y en a une) ; le salaire fixe reste. Un agent sans ligne du tableur retombe sur 0 (jamais sur le calcul par
// semaine).
export async function recapAvecPrimesTableur(semaine: string, primePour: PrimesTableur) {
  const agents = await recapSemaine(semaine);
  return agents.map(a => {
    const p = primePour(a.employeId, a.identite, a.identiteRp);
    return {
      ...a, nbAchats: p.ventes, nbLocations: p.locations, primeVente: p.primeVente, primeLocations: p.primeLocations, primeTotale: p.primeTotale,
      totalAVerser: a.totalAVerser - a.primeTotale + p.primeTotale, totalGagne: a.totalGagne - a.primeTotale + p.primeTotale,
    };
  });
}
