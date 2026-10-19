// ENTREPRISE — lecture du relevé Tablettes collé dans Comptabilité : montants, ligne récap « TOTAL », CA brut de la DOT.
// Fonctions pures, testées par test/releve.test.ts : une erreur ici change l'impôt déclaré sans rien d'anormal à l'écran.
import { normaliserNom } from './paie-horaire.js';

// Montant écrit tel que la tablette ou un tableur l'affiche : « 12 500 $ », « 12,500 », « 1.234.567 », « 12 500,50 »,
// « 1,234.56 ». Le dernier séparateur n'est décimal que s'il est le seul de son genre et suivi de 1 ou 2 chiffres ;
// sinon tous sont des séparateurs de milliers (« 1,500 » vaut 1 500, jamais 1,5). Illisible : 0.
export function montantReleve(v: unknown): number {
  const brut = String(v ?? '').replace(/[^\d,.-]/g, '');
  const negatif = brut.startsWith('-'), t = brut.replace(/-/g, '');
  const i = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  const decimal = i !== -1 && t.split(t[i]).length === 2 && /^\d{1,2}$/.test(t.slice(i + 1));
  const chiffres = decimal ? `${t.slice(0, i).replace(/[,.]/g, '')}.${t.slice(i + 1)}` : t.replace(/[,.]/g, '');
  const n = Number(chiffres);
  return chiffres && Number.isFinite(n) ? (negatif ? -n : n) : 0;
}

// ligne récap de la tablette (« TOTAL », « Totaux ») : jamais additionnée, jamais un membre
export const estLigneTotal = (l: unknown[]) => ['total', 'totaux'].includes(normaliserNom(l[0]));

export const minuscules = (c: unknown[]) => c.map(x => String(x).trim().toLowerCase());
// premier titre de colonne qui correspond à l'un des noms possibles (les relevés ne disent pas toujours le même mot)
export const indexColonne = (colonnes: string[], alias: string[]) => { for (const a of alias) { const i = colonnes.indexOf(a); if (i !== -1) return i; } return -1; };

// CA brut : colonne « Total entreprise » du relevé (« total » en repli), additionnée ligne par ligne — jamais la ligne
// récap « TOTAL » (comptée deux fois, et fausse dès qu'un membre est retiré du relevé). null : pas de colonne.
export function caBrutReleve(colonnes: string[], lignes: string[][]): number | null {
  const i = indexColonne(minuscules(colonnes), ['total entreprise', 'total']);
  return i === -1 ? null : Math.round(lignes.filter(l => !estLigneTotal(l)).reduce((s, l) => s + montantReleve(l[i]), 0));
}

// Impôt de la DOT : taux de la tranche du bénéfice imposable, appliqué à tout ce bénéfice (barème de l'organisme RP).
// Sous la première tranche, nul ou négatif : aucune tranche, 0 $ (jamais le taux de la dernière, ni un impôt négatif) ;
// au-delà de la dernière : la dernière.
export type Tranche = { seuilMin: number; seuilMax: number; taux: number };
export function impotDot<T extends Tranche>(imposable: number, bareme: T[]): { tranche: T | null; impots: number } {
  const b = Math.max(0, Math.round(imposable));
  const tries = [...bareme].sort((x, y) => x.seuilMin - y.seuilMin), derniere = tries.at(-1);
  const tranche = tries.find(t => b >= t.seuilMin && b <= t.seuilMax) ?? (derniere && b > derniere.seuilMax ? derniere : null);
  return { tranche, impots: tranche ? Math.round(b * tranche.taux) : 0 };
}
