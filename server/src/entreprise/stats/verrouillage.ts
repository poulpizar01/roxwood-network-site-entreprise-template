// ENTREPRISE — calcul pur du rattrapage de verrouillage de la DOT (verrouillage-dot.ts) : les semaines terminées à
// figer, de la plus ancienne à la plus récente. Après la dernière semaine verrouillée : celles qui la suivent (une
// panne de plusieurs jours se rattrape). Sans aucune semaine verrouillée : la seule semaine précédente, jamais
// l'historique d'avant — un site qui n'a pas encore validé de déclaration ne se voit pas figer des mois de données.
const JOUR = 24 * 3600e3;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function semainesARattraper(courante: string, derniereVerrouillee: string | null, limite = 52): string[] {
  const fin = Date.parse(`${courante}T00:00:00Z`);
  if (!derniereVerrouillee) return [iso(fin - 7 * JOUR)];
  const semaines: string[] = [];
  for (let t = Date.parse(`${derniereVerrouillee}T00:00:00Z`) + 7 * JOUR; t < fin && semaines.length < limite; t += 7 * JOUR) semaines.push(iso(t));
  return semaines;
}
