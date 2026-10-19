// ENTREPRISE — paie à l'heure (Comptabilité → Tablettes) : un grade dont le taux horaire est réglé (> 0) dans
// Comptabilité → Rémunération — les stagiaires — est payé selon ses heures de service de la semaine : colonne « Heures
// de service » du relevé Tablettes × taux. Ce montant s'ajoute aux paliers de primes, il ne les remplace pas.
// Le grade d'une ligne du relevé est celui de la fiche RH de même « Prénom Nom » (RH fait foi) ; sans fiche, celui de la
// colonne « Rang ». Une durée illisible n'est jamais devinée : la ligne est signalée, à 0 $. Fonctions pures, testées
// par test/paie-horaire.test.ts.

export const ALIAS_HEURES = ['heures de service', 'heure de service', 'heures', 'temps de service', 'durée de service', 'duree de service'];
const ALIAS_NOM = ['nom', 'nom de l\'employé', 'nom du salarié', 'employé', 'employe'];
const ALIAS_RANG = ['rang', 'grade', 'poste', 'rôle', 'role'];

export const normaliserNom = (v: unknown): string =>
  String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-\s]+/g, ' ');

function indexColonne(colonnes: string[], alias: string[]): number {
  const normalisees = colonnes.map(c => String(c).trim().toLowerCase());
  for (const nom of alias) { const i = normalisees.indexOf(nom); if (i !== -1) return i; }
  return -1;
}

// « 0h52min », « 1h », « 12h05 », « 45min », « 1:05 » → minutes ; null si illisible
export function dureeEnMinutes(texte: unknown): number | null {
  const t = String(texte ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t || t === '-') return null;
  let m = t.match(/^(\d{1,4})h(?:(\d{1,2})(?:min|mn|m)?)?$/);
  if (m) return Number(m[2] || 0) < 60 ? Number(m[1]) * 60 + Number(m[2] || 0) : null;
  m = t.match(/^(\d{1,5})(?:min|mn|m)$/);
  if (m) return Number(m[1]);
  m = t.match(/^(\d{1,4}):(\d{2})(?::\d{2})?$/);
  if (m) return Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  return null;
}

// taux : grade du site (clé ou libellé, sans casse ni accents) → { libellé, taux horaire } ; employes : fiches RH
export type GradeHoraire = { libelle: string; taux: number };
export type LignePaieHoraire = { index: number; nom: string; grade: string; gradeSource: 'rh' | 'releve'; heures: string; minutes: number | null; lisible: boolean; taux: number; montant: number };

export function calculerPaieHoraire({ colonnes, lignes, taux, employes = [] }: {
  colonnes: string[]; lignes: string[][]; taux: Map<string, GradeHoraire>; employes?: { prenom: string; nom: string; grade: string }[];
}): { colonneHeures: string | null; lignes: LignePaieHoraire[]; total: number } {
  const iNomTrouve = indexColonne(colonnes, ALIAS_NOM), iNom = iNomTrouve === -1 ? 0 : iNomTrouve;
  const iHeures = indexColonne(colonnes, ALIAS_HEURES), iRang = indexColonne(colonnes, ALIAS_RANG);
  const payes = new Map([...taux].filter(([, g]) => g.taux > 0).map(([cle, g]) => [normaliserNom(cle), { libelle: g.libelle, taux: Math.round(g.taux) }]));
  const ficheParNom = new Map(employes.map(e => [normaliserNom(`${e.prenom} ${e.nom}`), e]));
  const resultat = { colonneHeures: iHeures === -1 ? null : colonnes[iHeures], lignes: [] as LignePaieHoraire[], total: 0 };
  if (!payes.size) return resultat;
  lignes.forEach((ligne, index) => {
    const nom = String(ligne[iNom] ?? '').trim();
    if (!nom || ['total', 'totaux'].includes(normaliserNom(nom))) return;
    const fiche = ficheParNom.get(normaliserNom(nom));
    const paye = payes.get(normaliserNom(fiche ? fiche.grade : iRang !== -1 ? ligne[iRang] : ''));
    if (!paye) return;
    const heures = iHeures === -1 ? '' : String(ligne[iHeures] ?? '').trim();
    const minutes = dureeEnMinutes(heures);
    const montant = minutes === null ? 0 : Math.round((minutes * paye.taux) / 60);
    resultat.lignes.push({ index, nom, grade: paye.libelle, gradeSource: fiche ? 'rh' : 'releve', heures, minutes, lisible: minutes !== null, taux: paye.taux, montant });
    resultat.total += montant;
  });
  return resultat;
}
