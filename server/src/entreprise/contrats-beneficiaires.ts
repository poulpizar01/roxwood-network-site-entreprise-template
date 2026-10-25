// ENTREPRISE — bénéficiaires d'un contrat client : lecture d'un collage de tablette (entreprise ou illégale) et contrôle
// d'une liste avant enregistrement. Fonctions pures, testées par test/contrats-beneficiaires.test.ts : le texte vient
// d'un client sans compte, rien n'est enregistré sans passer par lireBeneficiaires.
//
// Collage d'une tablette (Ctrl+A, Copier, depuis l'onglet des membres) : une personne par ligne « ID ⇥ Prénom Nom ⇥ »,
// son rang (et pour la tablette entreprise, sa dernière prise de service) sur les lignes suivantes. Seules les lignes
// « chiffres ⇥ nom » comptent : titres, compteur, rangs, dates et texte parasite en fin de collage sont ignorés.
// Sans aucune ligne de ce genre, le collage est lu comme une simple liste : un nom par ligne.

export const MAX_BENEFICIAIRES = 50;
export const MAX_NOM = 80;
export type Beneficiaire = { nom: string; idUnique: string | null };

// nom comparé sans casse, accents, ni tirets/espaces multiples (même règle que le relevé de la DOT)
export const cleNom = (v: string): string => v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-\s]+/g, ' ');
// espaces (insécables compris) ramenés à un seul, rien autour
export const nettoyerNom = (v: unknown): string => String(v ?? '').replace(/[\s ]+/g, ' ').trim();
const RE_ID = /^\d{1,12}$/;
// un nom de personne : des lettres (accents compris), espaces, tirets, apostrophes, points ; au moins une lettre
const RE_NOM = /^[\p{L}][\p{L}\p{M} .'’-]*$/u;

const RE_PERSONNE = /^\s*(\d{1,12})\t+([^\t]*)/;
export type Lecture = {
  format: 'entreprise' | 'illegale' | 'liste' | null;
  personnes: Beneficiaire[];
  doublons: number;          // lignes en double dans le collage, fusionnées
  illisibles: string[];      // lignes qui ressemblaient à une personne mais restent illisibles (au plus 10)
};

export function lireCollage(texte: string): Lecture {
  const lignes = String(texte ?? '').replace(/\r\n?/g, '\n').split('\n');
  const enTete = lignes.some(l => /id\s*unique/i.test(l) && /\bnom\b/i.test(l));
  const brutes: Beneficiaire[] = [], illisibles: string[] = [];
  for (const l of lignes) {
    const m = RE_PERSONNE.exec(l);
    if (!m) continue;
    const nom = nettoyerNom(m[2]);
    if (nom && nom.length <= MAX_NOM && RE_NOM.test(nom)) brutes.push({ nom, idUnique: m[1] });
    else illisibles.push(nettoyerNom(l));
  }
  let format: Lecture['format'] = brutes.length || enTete ? (/derni[eè]re prise de service/i.test(texte) ? 'entreprise' : 'illegale') : null;
  if (!brutes.length && !enTete) {
    // simple liste : un nom par ligne, au moins deux mots (« Rechercher... », un compteur, un titre ne passent pas)
    for (const l of lignes) {
      const nom = nettoyerNom(l);
      if (!nom) continue;
      if (nom.includes(' ') && nom.length <= MAX_NOM && RE_NOM.test(nom)) brutes.push({ nom, idUnique: null });
      else illisibles.push(nom);
    }
    format = brutes.length ? 'liste' : null;
  }
  const { liste, doublons } = dedoublonner(brutes);
  return { format, personnes: liste, doublons, illisibles: illisibles.filter(Boolean).slice(0, 10) };
}

// une personne par ID unique ; sans ID, une par nom. Un nom saisi à la main qui retrouve le même nom porteur d'un ID
// est la même personne : seule la version avec l'ID reste (deux homonymes d'ID différents, eux, restent deux).
export function dedoublonner(personnes: Beneficiaire[]): { liste: Beneficiaire[]; doublons: number } {
  const ids = new Set<string>(), nomsAvecId = new Set<string>(), nomsSansId = new Set<string>();
  for (const p of personnes) if (p.idUnique) nomsAvecId.add(cleNom(p.nom));
  const liste: Beneficiaire[] = [];
  for (const p of personnes) {
    const cle = cleNom(p.nom);
    if (p.idUnique ? ids.has(p.idUnique) : nomsSansId.has(cle) || nomsAvecId.has(cle)) continue;
    if (p.idUnique) ids.add(p.idUnique); else nomsSansId.add(cle);
    liste.push(p);
  }
  return { liste, doublons: personnes.length - liste.length };
}

// liste envoyée par le client avant enregistrement : chaque nom contrôlé, refus explicite plutôt que troncature ou
// tri silencieux ; doublons fusionnés (même règle que l'aperçu). Renvoie la liste à enregistrer, ou le motif du refus.
export function lireBeneficiaires(v: unknown): { liste: Beneficiaire[] } | { refus: string } {
  if (!Array.isArray(v)) return { refus: 'Liste de bénéficiaires illisible. Rechargez la page et recommencez.' };
  const brutes: Beneficiaire[] = [];
  for (const x of v) {
    const o = (x && typeof x === 'object' ? x : { nom: x }) as Record<string, unknown>;
    const nom = nettoyerNom(o.nom);
    if (!nom) continue;
    if (nom.length > MAX_NOM) return { refus: `« ${nom.slice(0, 30)}… » dépasse ${MAX_NOM} caractères : raccourcissez-le.` };
    if (!RE_NOM.test(nom)) return { refus: `« ${nom} » n’est pas un nom valide : seuls les lettres, espaces, tirets et apostrophes sont acceptés.` };
    const id = o.idUnique == null || o.idUnique === '' ? null : String(o.idUnique).trim();
    if (id !== null && !RE_ID.test(id)) return { refus: `L’ID unique de ${nom} est invalide.` };
    brutes.push({ nom, idUnique: id });
  }
  const { liste } = dedoublonner(brutes);
  if (liste.length > MAX_BENEFICIAIRES) return { refus: `${MAX_BENEFICIAIRES} personnes au plus par contrat : retirez-en ${liste.length - MAX_BENEFICIAIRES}.` };
  return { liste };
}
