// ENTREPRISE — périodes d'un contrat (journalier, hebdomadaire, mensuel) : fin d'un contrat, échéances, et ce qui
// reste à facturer. Fonctions pures sur des jours AAAA-MM-JJ (calendrier de Paris, sans heure), testées par
// test/contrats-periodes.test.ts : une erreur ici facture deux fois la même période, ou en oublie une.
// Les périodes se calent sur la date de début du contrat, pas sur le calendrier : pas de prorata. Un mois commencé un
// 31 se termine la veille du même jour du mois suivant, ramené au dernier jour des mois plus courts.

export const PERIODICITES = ['journalier', 'hebdomadaire', 'mensuel'] as const;
export type Periodicite = typeof PERIODICITES[number];
export type Periode = { debut: string; fin: string };

const JOUR = 24 * 3600e3;
const enDate = (j: string) => new Date(`${j}T00:00:00Z`);
const enJour = (d: Date) => d.toISOString().slice(0, 10);
export const ajouterJours = (j: string, n: number) => enJour(new Date(enDate(j).getTime() + n * JOUR));
const ecartJours = (a: string, b: string) => Math.round((enDate(b).getTime() - enDate(a).getTime()) / JOUR);

// n-ième mois après `debut`, même jour du mois, ramené au dernier jour d'un mois plus court (31 janv. → 28 févr.)
function moisApres(debut: string, n: number): string {
  const d = enDate(debut);
  const mois = d.getUTCMonth() + n, annee = d.getUTCFullYear() + Math.floor(mois / 12), m = ((mois % 12) + 12) % 12;
  const dernier = new Date(Date.UTC(annee, m + 1, 0)).getUTCDate();
  return enJour(new Date(Date.UTC(annee, m, Math.min(d.getUTCDate(), dernier))));
}

// premier jour de la n-ième période (0 = la première)
export function debutPeriode(dateDebut: string, p: Periodicite, n: number): string {
  if (p === 'journalier') return ajouterJours(dateDebut, n);
  if (p === 'hebdomadaire') return ajouterJours(dateDebut, 7 * n);
  return moisApres(dateDebut, n);
}
export const periode = (dateDebut: string, p: Periodicite, n: number): Periode =>
  ({ debut: debutPeriode(dateDebut, p, n), fin: ajouterJours(debutPeriode(dateDebut, p, n + 1), -1) });

// numéro de la période qui contient ce jour (négatif avant le début du contrat)
export function indexPeriode(dateDebut: string, p: Periodicite, jour: string): number {
  if (jour < dateDebut) return -1;
  if (p === 'journalier') return ecartJours(dateDebut, jour);
  if (p === 'hebdomadaire') return Math.floor(ecartJours(dateDebut, jour) / 7);
  const a = enDate(dateDebut), b = enDate(jour);
  let n = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (debutPeriode(dateDebut, p, n) > jour) n--;   // le même jour du mois n'est pas encore atteint
  return n;
}

// terminé : marqué comme tel, ou date de fin (incluse) dépassée. Revérifié à chaque lecture : la tâche quotidienne
// qui pose le statut peut avoir du retard, jamais un contrat échu ne couvre encore quelqu'un.
export const contratTermine = (c: { statut: string; dateFin: string | null }, aujourdhui: string): boolean =>
  c.statut === 'termine' || (c.dateFin !== null && c.dateFin < aujourdhui);

// fin de la période en cours (« Mettre fin au contrat » : à la fin de la période en cours, le préavis habituel)
export const finPeriodeEnCours = (dateDebut: string, p: Periodicite, aujourdhui: string): string =>
  aujourdhui < dateDebut ? ajouterJours(debutPeriode(dateDebut, p, 1), -1) : periode(dateDebut, p, indexPeriode(dateDebut, p, aujourdhui)).fin;

// prochaine échéance : premier jour de la période suivante, s'il est encore couvert par le contrat ; null sinon
export function prochaineEcheance(c: { dateDebut: string; dateFin: string | null; periodicite: Periodicite }, aujourdhui: string): string | null {
  const suivante = aujourdhui < c.dateDebut ? c.dateDebut : debutPeriode(c.dateDebut, c.periodicite, indexPeriode(c.dateDebut, c.periodicite, aujourdhui) + 1);
  return c.dateFin !== null && suivante > c.dateFin ? null : suivante;
}

// ---- facturation : chaque période commencée est à facturer une fois, et une seule ----
export type FactureContrat = { id: number; periodeDebut: string; periodeFin: string; payee: boolean };
export type EtatPeriode = Periode & { index: number; etat: 'payee' | 'facturee' | 'a-facturer' | 'a-venir'; factureId: number | null };

// toutes les périodes, de la première à celle qui suit aujourd'hui (une seule à venir, pour montrer l'échéance), sans
// dépasser la date de fin ; `limite` : les plus récentes seulement (frise de la fiche)
export function etatsPeriodes(
  c: { dateDebut: string; dateFin: string | null; periodicite: Periodicite }, factures: FactureContrat[], aujourdhui: string, limite = 400,
): EtatPeriode[] {
  const derniere = Math.min(
    indexPeriode(c.dateDebut, c.periodicite, aujourdhui) + 1,
    c.dateFin === null ? Infinity : indexPeriode(c.dateDebut, c.periodicite, c.dateFin),
  );
  const etats: EtatPeriode[] = [];
  for (let n = Math.max(0, derniere - limite + 1); n <= derniere; n++) {
    const p = periode(c.dateDebut, c.periodicite, n);
    const f = factures.find(x => x.periodeDebut <= p.debut && x.periodeFin >= p.fin);
    const etat = f ? (f.payee ? 'payee' : 'facturee') : p.debut > aujourdhui ? 'a-venir' : 'a-facturer';
    etats.push({ ...p, index: n, etat, factureId: f?.id ?? null });
  }
  return etats;
}

// périodes à facturer d'un bloc : la plus longue suite de périodes commencées et non facturées qui se suivent, en
// partant de la plus ancienne (une facture couvre des périodes consécutives, jamais des trous)
export function aFacturer(etats: EtatPeriode[]): { debut: string; fin: string; nombre: number } | null {
  const i = etats.findIndex(e => e.etat === 'a-facturer');
  if (i < 0) return null;
  let j = i;
  while (j + 1 < etats.length && etats[j + 1].etat === 'a-facturer') j++;
  return { debut: etats[i].debut, fin: etats[j].fin, nombre: j - i + 1 };
}

// une plage demandée pour une facture : bornes calées sur les périodes du contrat, toutes commencées, aucune déjà
// facturée. Renvoie le nombre de périodes, ou le motif du refus (texte affiché tel quel).
export function verifierPlage(
  c: { dateDebut: string; dateFin: string | null; periodicite: Periodicite }, factures: FactureContrat[], debut: string, fin: string, aujourdhui: string,
): { nombre: number } | { refus: string } {
  const i = indexPeriode(c.dateDebut, c.periodicite, debut), j = indexPeriode(c.dateDebut, c.periodicite, fin);
  if (i < 0 || debutPeriode(c.dateDebut, c.periodicite, i) !== debut || periode(c.dateDebut, c.periodicite, j).fin !== fin || j < i)
    return { refus: 'Les dates ne correspondent pas aux périodes du contrat. Repartez de sa fiche.' };
  if (debut > aujourdhui) return { refus: 'Une période qui n’a pas commencé ne se facture pas encore.' };
  if (c.dateFin !== null && debut > c.dateFin) return { refus: 'Le contrat est terminé avant cette période.' };
  if (factures.some(f => f.periodeDebut <= fin && f.periodeFin >= debut)) return { refus: 'Une partie de ces périodes est déjà facturée. Rouvrez la fiche du contrat pour voir ce qui reste.' };
  return { nombre: j - i + 1 };
}
