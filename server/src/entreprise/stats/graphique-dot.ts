// ENTREPRISE — graphique DOT « Évolution sur 12 semaines » : une semaine = un point lu sur son résumé (figé si la semaine
// est verrouillée, calculé en direct sinon) et les repères au-dessus du graphique. Fonctions pures (dot.ts les alimente).
export interface ResumeSemaine {
  caBrut: number | null; depenseDeductible: number; montantImpots: number | null;
  montantPrimes: number; retraits: number; beneficeNet: number | null;
}
export interface PointGraphique {
  semaine: string;
  vide: boolean;        // pas de relevé Tablettes ni de recette : un trou, jamais un zéro
  provisoire: boolean;  // semaine pas encore verrouillée : chiffres calculés en direct, qui peuvent encore bouger
  ca: number; charges: number; impot: number; sorties: number; net: number;   // sorties = primes + retraits
}

export function pointGraphique(semaine: string, r: ResumeSemaine, provisoire: boolean): PointGraphique {
  if (r.caBrut === null) return { semaine, vide: true, provisoire, ca: 0, charges: 0, impot: 0, sorties: 0, net: 0 };
  return { semaine, vide: false, provisoire, ca: r.caBrut, charges: r.depenseDeductible, impot: r.montantImpots ?? 0, sorties: r.montantPrimes + r.retraits, net: r.beneficeNet ?? 0 };
}

// Moyennes et totaux : seulement les semaines déclarées (ni trou ni provisoire), pour ne pas tirer la moyenne vers le bas.
export function reperesGraphique(points: PointGraphique[]) {
  const pleines = points.filter(p => !p.vide && !p.provisoire);
  const somme = (cle: 'ca' | 'impot' | 'net') => pleines.reduce((s, p) => s + p[cle], 0);
  const n = pleines.length;
  return {
    semainesDeclarees: n,
    semainesSansReleve: points.filter(p => p.vide && !p.provisoire).length,
    caMoyen: n ? Math.round(somme('ca') / n) : null,
    impotTotal: n ? somme('impot') : null,
    tauxEffectif: n && somme('ca') > 0 ? somme('impot') / somme('ca') : null,   // part du CA versée en impôt (0 à 1)
    netMoyen: n ? Math.round(somme('net') / n) : null,
    semainesEnPerte: pleines.filter(p => p.net < 0).map(p => p.semaine),
  };
}
