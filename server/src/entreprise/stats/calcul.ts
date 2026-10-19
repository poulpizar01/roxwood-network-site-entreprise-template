// ENTREPRISE — moteur de calcul des ventes et des primes.
// Fonctions PURES uniquement (ni réseau ni base) : elles reproduisent exactement les chiffres du Google Sheet de la
// Direction — c'est de l'argent RP versé en main propre, toute erreur se voit aussitôt. Testées par
// server/test/stats-calc.test.ts (voir ENTREPRISE.md pour les lancer).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { normaliserPseudo, normaliserTexte } from '../texte.js';
export { normaliserPseudo, normaliserTexte };

export type Palier = { seuil: number; montant: number };
// ---- parsing tolérant (espaces insécables, $, virgule décimale) -------------

export function parseMontant(brut: unknown): { valeur: number; estValide: boolean; estVide: boolean } {
  if (brut == null || brut === "") return { valeur: 0, estValide: true, estVide: true };
  if (typeof brut === "number" && isFinite(brut)) return { valeur: brut, estValide: true, estVide: false };
  //   (espace insécable) et   (espace fine insécable) sont les
  // espaces que Google Sheets/Excel insèrent dans les nombres formatés.
  const nettoye = String(brut)
    .replace(/[\u00a0\u202f\s]/g, "")
    .replace(/\$/g, "")
    .replace(",", ".");
  const nombre = Number(nettoye);
  if (nettoye === "" || !isFinite(nombre)) return { valeur: 0, estValide: false, estVide: false };
  return { valeur: nombre, estValide: true, estVide: false };
}

// Colonne N : le Sheet fait SIERREUR(CNUM(...);0) — vide ou non numérique -> 0,
// mais on remonte quand même l'info pour la détection d'anomalie.
export function parseQuantite(brut: unknown) {
  if (brut == null || brut === "") return { valeur: 0, estValide: true, estVide: true };
  const { valeur, estValide } = parseMontant(brut);
  return { valeur: estValide ? Math.trunc(valeur) : 0, estValide, estVide: false };
}

// ---- semaine ISO 8601 (uniquement pour le contrôle de cohérence non bloquant,
// JAMAIS pour filtrer les données — la colonne P fait autorité) ----------

function dateDepuisJJMMAAAA(brut: unknown): Date | null {
  const m = String(brut || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, j, mo, a] = m;
  const d = new Date(Date.UTC(Number(a), Number(mo) - 1, Number(j)));
  if (d.getUTCFullYear() !== Number(a) || d.getUTCMonth() !== Number(mo) - 1 || d.getUTCDate() !== Number(j)) return null;
  return d;
}

// Semaine ISO 8601 (lundi début de semaine, semaine 1 = celle contenant le
// premier jeudi de l'année) — renvoie { numero, anneeIso } ou null.
export function semaineISO(date: Date): { numero: number; anneeIso: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const jourSemaine = d.getUTCDay() || 7; // dimanche -> 7
  d.setUTCDate(d.getUTCDate() + 4 - jourSemaine); // jeudi de cette semaine-là
  const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const numero = Math.ceil(((d.getTime() - debutAnnee.getTime()) / 86400000 + 1) / 7);
  return { numero, anneeIso: d.getUTCFullYear() };
}

// Exportée pour l'affichage (ex : "du 31 août au 6 septembre" à côté d'un
// code "S36-26" dans le sélecteur de semaine) — jamais utilisée pour filtrer
// ou recalculer quoi que ce soit, uniquement pour montrer une date indicative.
export function lundiDeSemaineISO(anneeIso: number, numero: number): Date {
  const simple = new Date(Date.UTC(anneeIso, 0, 1 + (numero - 1) * 7));
  const jourSemaine = simple.getUTCDay() || 7;
  const lundi = new Date(simple);
  if (jourSemaine <= 4) lundi.setUTCDate(simple.getUTCDate() - jourSemaine + 1);
  else lundi.setUTCDate(simple.getUTCDate() + 8 - jourSemaine);
  return lundi;
}

// "S17-26" -> { numero: 17, anneeIso: 2026 } ou null si le format ne correspond pas.
export function analyserCodeSemaine(brut: unknown): { numero: number; anneeIso: number } | null {
  const m = String(brut || "").trim().match(/^S(\d{1,2})-(\d{2})$/i);
  if (!m) return null;
  return { numero: Number(m[1]), anneeIso: 2000 + Number(m[2]) };
}

// Écart (en jours, entre les lundis des deux semaines) entre la semaine SAISIE
// (colonne P, qui fait autorité) et la semaine ISO déduite de la date (colonne
// B). Simple avertissement non bloquant : la coupure RP du lundi 11h30 et
// les corrections manuelles produisent légitimement des écarts d'une semaine
// pile — on les remonte quand même en anomalie informative, à charge pour la
// Direction de les confirmer d'un coup d'œil ; ce n'est jamais utilisé pour
// changer un calcul.
export function ecartSemaineEnJours(codeSemaineSaisie: unknown, dateJJMMAAAA: unknown): number | null {
  const semaineSaisie = analyserCodeSemaine(codeSemaineSaisie);
  const date = dateDepuisJJMMAAAA(dateJJMMAAAA);
  if (!semaineSaisie || !date) return null;
  const semaineDeduite = semaineISO(date);
  const lundiSaisie = lundiDeSemaineISO(semaineSaisie.anneeIso, semaineSaisie.numero);
  const lundiDeduit = lundiDeSemaineISO(semaineDeduite.anneeIso, semaineDeduite.numero);
  return Math.round((lundiSaisie.getTime() - lundiDeduit.getTime()) / 86400000);
}

// ---- paliers de primes -----------------------------------------------------
// « on retient le plus haut seuil inférieur ou égal à la valeur ; en dessous de
// 20, prime = 0 ». bareme : [{ seuil, montant }, ...] pas nécessairement trié.

export function montantPalier(bareme: Palier[] | null | undefined, valeur: number): number {
  const tries = [...(bareme || [])].sort((a, b) => a.seuil - b.seuil);
  let retenu: Palier | null = null;
  for (const p of tries) {
    if (valeur >= p.seuil) retenu = p;
    else break;
  }
  return retenu ? retenu.montant : 0;
}

// Pour la barre de progression de l'écran agent.
export function infoPalier(bareme: Palier[] | null | undefined, valeur: number) {
  const tries = [...(bareme || [])].sort((a, b) => a.seuil - b.seuil);
  let retenu: Palier | null = null;
  let indexRetenu = -1;
  tries.forEach((p, i) => {
    if (valeur >= p.seuil) {
      retenu = p;
      indexRetenu = i;
    }
  });
  const suivant = tries[indexRetenu + 1] || null;
  const atteint = retenu as Palier | null;   // affecté dans le forEach : TypeScript ne le suit pas
  return {
    atteint: atteint ? atteint.seuil : 0,
    montant: atteint ? atteint.montant : 0,
    suivant: suivant ? suivant.seuil : null,
    restant: suivant ? Math.max(0, suivant.seuil - valeur) : null,
    montantSuivant: suivant ? suivant.montant : null,
  };
}

// ---- classement des lignes brutes du Sheet + détection d'anomalies --------
// Chaque ligne brute est un tableau de 16 valeurs (colonnes A à P, index 0 à 15).

const COL = {
  NUMERO: 0, DATE: 1, IDENTITE: 2, FORMATEUR: 3, CLIENT: 4, TEL: 5,
  INTERIEUR: 6, GARAGE: 7, GARAGE_INDISPO: 8, GARAGE_REFUS: 9,
  ENTREPRISE_IDENTITE: 10, ENTREPRISE_ID: 11, TYPE: 12, LOC: 13, ACHAT: 14, SEMAINE: 15,
};

function texteColonne(ligne: unknown[], i: number): string {
  const v = ligne[i];
  return v == null ? "" : String(v).trim();
}

export function classifierLignes(lignesBrutes: unknown[][]) {
  const lignes: LigneClassee[] = [];
  const anomalies: Anomalie[] = [];
  const compteursNumeroVente = new Map<string, number>();

  (lignesBrutes || []).forEach((ligneBrute, index) => {
    const numeroLigneSheet = index + 2; // ligne 1 = en-têtes
    const numeroVente = texteColonne(ligneBrute, COL.NUMERO);
    const dateBrute = texteColonne(ligneBrute, COL.DATE);
    const identite = texteColonne(ligneBrute, COL.IDENTITE);
    const formateur = texteColonne(ligneBrute, COL.FORMATEUR);
    const interieur = texteColonne(ligneBrute, COL.INTERIEUR);
    const garage = texteColonne(ligneBrute, COL.GARAGE);
    const typeBrut = texteColonne(ligneBrute, COL.TYPE);
    const semaineBrute = texteColonne(ligneBrute, COL.SEMAINE);

    const typeNormalise = normaliserTexte(typeBrut);
    let type: "Vente" | "Location" | null = null;
    if (typeNormalise === "vente") type = "Vente";
    else if (typeNormalise === "location") type = "Location";
    else if (typeBrut !== "") {
      anomalies.push({ ligne: numeroLigneSheet, numeroVente, type: "type_inconnu", detail: `Valeur inattendue en colonne M : "${typeBrut}".` });
    }

    const { valeur: montant, estValide: montantValide } = parseMontant(ligneBrute[COL.ACHAT]);
    if (!montantValide) {
      anomalies.push({ ligne: numeroLigneSheet, numeroVente, semaine: semaineBrute || null, type: "montant_invalide", detail: `Montant illisible en colonne O : "${texteColonne(ligneBrute, COL.ACHAT)}".` });
    }

    const { valeur: quantiteLoc, estVide: quantiteVide, estValide: quantiteValide } = parseQuantite(ligneBrute[COL.LOC]);
    if (type === "Location" && (quantiteVide || !quantiteValide)) {
      anomalies.push({ ligne: numeroLigneSheet, numeroVente, semaine: semaineBrute || null, type: "quantite_manquante", detail: "Colonne N (Loc) vide ou non numérique sur une ligne Location — comptée 0." });
    }

    if (!semaineBrute) {
      anomalies.push({ ligne: numeroLigneSheet, numeroVente, semaine: null, type: "semaine_absente", detail: "Colonne P (Semaine) vide — ligne exclue de tous les récaps." });
    } else {
      const ecart = ecartSemaineEnJours(semaineBrute, dateBrute);
      if (ecart != null && Math.abs(ecart) > 3) {
        anomalies.push({
          ligne: numeroLigneSheet, numeroVente, semaine: semaineBrute, type: "semaine_incoherente",
          detail: `Semaine saisie "${semaineBrute}" à ${Math.abs(ecart)} jour(s) de la semaine ISO déduite de la date "${dateBrute}" (avertissement non bloquant).`,
        });
      }
    }

    if (!interieur && !garage) {
      anomalies.push({ ligne: numeroLigneSheet, numeroVente, semaine: semaineBrute || null, type: "sans_bien", detail: "Ni intérieur (G) ni garage (H) — la ligne compte quand même dans la facture." });
    }

    if (numeroVente) {
      compteursNumeroVente.set(numeroVente, (compteursNumeroVente.get(numeroVente) || 0) + 1);
    }

    lignes.push({
      ligneSheet: numeroLigneSheet,
      numeroVente,
      date: dateBrute,
      identite,
      identiteNormalisee: normaliserPseudo(identite),
      formateur,
      formateurNormalise: normaliserPseudo(formateur),
      interieur,
      garage,
      type,
      quantiteLoc,
      montant,
      semaine: semaineBrute,
    });
  });

  compteursNumeroVente.forEach((n, numeroVente) => {
    if (n > 1) {
      anomalies.push({ ligne: null, numeroVente, semaine: null, type: "doublon_numero_vente", detail: `Le numéro de vente "${numeroVente}" apparaît ${n} fois — non dédupliqué (comme dans le Sheet).` });
    }
  });

  return { lignes, anomalies };
}

// ---- agrégation (comptages à partir des lignes classées) ------------------
// colonneCle : "identiteNormalisee" (agent) ou "formateurNormalise" (formateur).

export function compterAchats(lignes: any[], colonneCle: string, pseudoNormalise: string, semaine: string): number {
  return lignes.filter(
    (l) => l[colonneCle] === pseudoNormalise && l.semaine === semaine && l.type === "Vente" && (l.interieur !== "" || l.garage !== "")
  ).reduce((n, l) => n + (l.interieur !== "" ? 1 : 0) + (l.garage !== "" ? 1 : 0), 0);
}

export function compterLocations(lignes: any[], colonneCle: string, pseudoNormalise: string, semaine: string): number {
  return lignes
    .filter((l) => l[colonneCle] === pseudoNormalise && l.semaine === semaine && l.type === "Location")
    .reduce((n, l) => n + (l.interieur !== "" ? l.quantiteLoc : 0) + (l.garage !== "" ? l.quantiteLoc : 0), 0);
}

// colonneCle : « identiteNormalisee » par défaut ; le serveur regroupe par
// fiche RH (« cleAgent », voir lireLignes dans stats/ventes.ts).
export function sommeFacture(lignes: any[], pseudoNormalise: string, semaine: string, colonneCle = "identiteNormalisee"): number {
  return lignes
    .filter((l) => l[colonneCle] === pseudoNormalise && l.semaine === semaine)
    .reduce((s, l) => s + l.montant, 0);
}

// ---- finances — fonction PURE prenant des compteurs déjà agrégés, testable
// sans les lignes brutes du Sheet (server/test/stats-calc.test.ts). ----------

// Éligibilité (salaireActif, primeVenteActive, primeLocationActive) réglée
// PAR GRADE depuis l'écran Comptabilité -> Paramètres (table remunerations_grades) :
// les trois interrupteurs sont indépendants et se cumulent librement (la
// Direction peut donner à un grade le salaire ET les primes).
export function calculerFinances({
  nbAchats,
  nbLocations,
  facture,
  formateurNbAchats = 0,
  formateurNbLocations = 0,
  formateurComptesDansQuota = false,
  baremeVentes,
  baremeLocations,
  tauxCommission,
  salaireFixe = 0,
  salaireActif = false,
  primeVenteActive = true,
  primeLocationActive = true,
}: ParamsFinances) {
  const nbAchatsEffectif = nbAchats + (formateurComptesDansQuota ? formateurNbAchats : 0);
  const nbLocationsEffectif = nbLocations + (formateurComptesDansQuota ? formateurNbLocations : 0);
  const quotaRealise = nbAchatsEffectif + nbLocationsEffectif;

  const primeVenteBrute = montantPalier(baremeVentes, nbAchatsEffectif);
  const primeLocationsBrute = montantPalier(baremeLocations, nbLocationsEffectif);
  const primeVente = primeVenteActive ? primeVenteBrute : 0;
  const primeLocations = primeLocationActive ? primeLocationsBrute : 0;
  const primeTotale = primeVente + primeLocations;

  const commission = Math.round(facture * tauxCommission);
  const salaireVerse = salaireActif ? (salaireFixe || 0) : 0;
  const totalAVerser = salaireVerse + primeTotale;
  const totalGagne = commission + primeTotale;

  return {
    quotaRealise,
    primeVente,
    primeLocations,
    primeTotale,
    commission,
    salaireVerse,
    totalAVerser,
    totalGagne,
    paliers: {
      vente: infoPalier(baremeVentes, nbAchatsEffectif),
      location: infoPalier(baremeLocations, nbLocationsEffectif),
    },
  };
}

// ---- salaire de la semaine : LA règle, utilisée partout (DOT, Mon profil, Ventes & statistiques) ----
// Un interrupteur coupé dans Comptabilité > Rémunération = rien de versé pour cette composante : ni salaire fixe, ni
// prime de ventes, ni prime de locations. La paie à l'heure dépend du taux horaire (0 = rien).
export type ReglageGrade = { salaireFixe?: number; salaireActif?: boolean; primeVenteActive?: boolean; primeLocationActive?: boolean };

export function primesSelonGrade(r: ReglageGrade, baremes: { ventes: Palier[]; locations: Palier[] }, ventes: number, locations: number) {
  const primeVente = r.primeVenteActive === false ? 0 : montantPalier(baremes.ventes, ventes);
  const primeLocations = r.primeLocationActive === false ? 0 : montantPalier(baremes.locations, locations);
  return { primeVente, primeLocations, primeTotale: primeVente + primeLocations };
}

export function salaireSemaine(r: ReglageGrade, baremes: { ventes: Palier[]; locations: Palier[] }, { ventes = 0, locations = 0, paieHoraire = 0 }: { ventes?: number; locations?: number; paieHoraire?: number }) {
  const salaireFixe = r.salaireActif ? r.salaireFixe || 0 : 0;
  const primes = primesSelonGrade(r, baremes, ventes, locations);
  return { salaireFixe, ...primes, paieHoraire, total: salaireFixe + primes.primeTotale + paieHoraire };
}

// ---- formatage (séparateur de milliers : espace insécable, suffixe $) ------

export function formaterMontantStats(valeur: unknown): string {
  const n = Math.round(Number(valeur) || 0);
  const chiffres = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? "-" : "") + chiffres + "$";
}

export type Anomalie = { ligne: number | null; numeroVente: string; semaine?: string | null; type: string; detail: string };
export type LigneClassee = {
  ligneSheet: number; numeroVente: string; date: string; identite: string; identiteNormalisee: string; formateur: string;
  formateurNormalise: string; interieur: string; garage: string; type: 'Vente' | 'Location' | null; quantiteLoc: number;
  montant: number; semaine: string;
};
type ParamsFinances = {
  nbAchats: number; nbLocations: number; facture: number; formateurNbAchats?: number; formateurNbLocations?: number;
  formateurComptesDansQuota?: boolean; baremeVentes: Palier[]; baremeLocations: Palier[]; tauxCommission: number;
  salaireFixe?: number; salaireActif?: boolean; primeVenteActive?: boolean; primeLocationActive?: boolean;
};
