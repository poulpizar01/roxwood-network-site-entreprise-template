// Calculs de rémunération (src/entreprise/stats/calcul.ts) : paliers de primes, lecture des
// montants collés depuis un tableur, semaines ISO, calcul final par agent.
// C'est le module qui décide combien chaque agent touche : une régression ici
// est invisible à l'écran et se paie en argent RP.
//
// Les semaines ISO sont vérifiées sur des dates dont la réponse est connue
// indépendamment du code (voir commentaires), pas sur ce que le code produit.
import test from "node:test";
import assert from "node:assert/strict";
import {
  montantPalier, infoPalier, parseMontant, parseQuantite,
  semaineISO, lundiDeSemaineISO, analyserCodeSemaine, ecartSemaineEnJours,
  calculerFinances, formaterMontantStats, primesSelonGrade, salaireSemaine,
} from "../src/entreprise/stats/calcul.js";

// Barèmes réels du site (valeurs de départ, voir la migration stats).
const BAREME_VENTES = [
  { seuil: 20, montant: 10000 }, { seuil: 40, montant: 15000 }, { seuil: 60, montant: 20000 },
  { seuil: 80, montant: 25000 }, { seuil: 100, montant: 30000 },
];
const BAREME_LOCATIONS = [
  { seuil: 20, montant: 10000 }, { seuil: 40, montant: 30000 }, { seuil: 60, montant: 50000 },
  { seuil: 80, montant: 60000 }, { seuil: 100, montant: 70000 },
];

test("palier : on retient le plus haut seuil atteint, 0 en dessous du premier", () => {
  assert.equal(montantPalier(BAREME_VENTES, 0), 0);
  assert.equal(montantPalier(BAREME_VENTES, 19), 0, "sous le premier seuil : aucune prime");
  assert.equal(montantPalier(BAREME_VENTES, 20), 10000, "pile sur le seuil : palier acquis");
  assert.equal(montantPalier(BAREME_VENTES, 39), 10000);
  assert.equal(montantPalier(BAREME_VENTES, 100), 30000);
  assert.equal(montantPalier(BAREME_VENTES, 250), 30000, "au-delà du dernier seuil : plafonné");
});

test("palier : barème désordonné ou absent", () => {
  const desordre = [{ seuil: 100, montant: 30000 }, { seuil: 20, montant: 10000 }, { seuil: 60, montant: 20000 }];
  assert.equal(montantPalier(desordre, 65), 20000, "le barème est trié avant lecture");
  assert.equal(montantPalier([], 50), 0);
  assert.equal(montantPalier(null, 50), 0);
});

test("infoPalier : progression vers le palier suivant", () => {
  const info = infoPalier(BAREME_VENTES, 45);
  assert.equal(info.atteint, 40, "palier courant");
  assert.equal(info.montant, 15000);
  assert.equal(info.suivant, 60, "prochain seuil");
  assert.equal(info.restant, 15, "15 ventes pour l atteindre");
  assert.equal(info.montantSuivant, 20000);

  const auMax = infoPalier(BAREME_VENTES, 120);
  assert.equal(auMax.montant, 30000);
  assert.equal(auMax.suivant, null, "au dernier palier, plus rien à atteindre");
  assert.equal(auMax.restant, null);

  const sousLePremier = infoPalier(BAREME_VENTES, 5);
  assert.equal(sousLePremier.atteint, 0);
  assert.equal(sousLePremier.montant, 0);
  assert.equal(sousLePremier.restant, 15, "15 ventes avant la première prime");
});

test("montants collés depuis un tableur", () => {
  assert.deepEqual(parseMontant(""), { valeur: 0, estValide: true, estVide: true });
  assert.deepEqual(parseMontant(null), { valeur: 0, estValide: true, estVide: true });
  assert.equal(parseMontant(1500).valeur, 1500);
  assert.equal(parseMontant("1 400 000$").valeur, 1400000, "espaces et dollar retirés");
  assert.equal(parseMontant("1 400 000").valeur, 1400000, "espace insécable (Google Sheets)");
  assert.equal(parseMontant("1 400").valeur, 1400, "espace fine insécable (Excel)");
  assert.equal(parseMontant("12,5").valeur, 12.5, "virgule décimale");
  assert.equal(parseMontant("-2500").valeur, -2500);
  const invalide = parseMontant("à venir");
  assert.equal(invalide.estValide, false);
  assert.equal(invalide.valeur, 0, "cellule illisible : vaut 0, mais signalée");
});

test("quantités : toujours entières", () => {
  assert.equal(parseQuantite("12,9").valeur, 12, "tronqué, jamais arrondi au supérieur");
  assert.equal(parseQuantite("3").valeur, 3);
  assert.equal(parseQuantite("").estVide, true);
  assert.equal(parseQuantite("deux").estValide, false);
});

test("semaines ISO : dates dont la réponse est connue", () => {
  // 1er janvier 2026 = jeudi -> semaine 1 de 2026, commencée le lundi
  // 29 décembre 2025 (règle ISO 8601 : la semaine 1 contient le 1er jeudi).
  assert.deepEqual(semaineISO(new Date(Date.UTC(2026, 0, 1))), { numero: 1, anneeIso: 2026 });
  assert.equal(lundiDeSemaineISO(2026, 1).toISOString().slice(0, 10), "2025-12-29");

  // Mercredi 23 septembre 2026 -> semaine 39, lundi le 21.
  assert.deepEqual(semaineISO(new Date(Date.UTC(2026, 8, 23))), { numero: 39, anneeIso: 2026 });
  assert.equal(lundiDeSemaineISO(2026, 39).toISOString().slice(0, 10), "2026-09-21");

  // Piège : le 1er janvier 2027 est un vendredi, il appartient encore à la
  // semaine 53 de 2026 (2026 commence un jeudi, elle compte 53 semaines).
  assert.deepEqual(semaineISO(new Date(Date.UTC(2027, 0, 1))), { numero: 53, anneeIso: 2026 });

  // Aller-retour : chaque lundi retrouve sa propre semaine.
  for (const numero of [1, 9, 26, 39, 52, 53]) {
    const lundi = lundiDeSemaineISO(2026, numero);
    assert.deepEqual(semaineISO(lundi), { numero, anneeIso: 2026 }, `semaine ${numero}`);
  }
});

test("codes de semaine saisis à la main", () => {
  assert.deepEqual(analyserCodeSemaine("S39-26"), { numero: 39, anneeIso: 2026 });
  assert.deepEqual(analyserCodeSemaine("s5-27"), { numero: 5, anneeIso: 2027 }, "minuscule acceptée");
  assert.equal(analyserCodeSemaine("39-26"), null);
  assert.equal(analyserCodeSemaine("S39/26"), null);
  assert.equal(analyserCodeSemaine(""), null);
  assert.equal(analyserCodeSemaine(null), null);
});

test("écart entre la semaine saisie et la date de la vente", () => {
  assert.equal(ecartSemaineEnJours("S39-26", "23/09/2026"), 0, "cohérent");
  assert.equal(ecartSemaineEnJours("S39-26", "16/09/2026"), 7, "saisie une semaine en avance");
  assert.equal(ecartSemaineEnJours("S38-26", "23/09/2026"), -7, "saisie une semaine en retard");
  assert.equal(ecartSemaineEnJours("", "23/09/2026"), null, "sans code : pas d'avis");
  assert.equal(ecartSemaineEnJours("S39-26", "date invalide"), null);
});

test("calcul complet d'un agent", () => {
  const r = calculerFinances({
    nbAchats: 45, nbLocations: 22, facture: 1000000,
    baremeVentes: BAREME_VENTES, baremeLocations: BAREME_LOCATIONS,
    tauxCommission: 0.48, salaireFixe: 20000, salaireActif: true,
  });
  assert.equal(r.quotaRealise, 67);
  assert.equal(r.primeVente, 15000, "45 ventes -> palier 40");
  assert.equal(r.primeLocations, 10000, "22 locations -> palier 20");
  assert.equal(r.primeTotale, 25000);
  assert.equal(r.commission, 480000, "48 % de la facture");
  assert.equal(r.salaireVerse, 20000);
  assert.equal(r.totalAVerser, 45000, "salaire fixe + primes");
  assert.equal(r.totalGagne, 505000, "commission + primes");
});

test("salaire inactif, primes désactivées, ventes de formation", () => {
  const base = {
    nbAchats: 50, nbLocations: 50, facture: 100000,
    baremeVentes: BAREME_VENTES, baremeLocations: BAREME_LOCATIONS,
    tauxCommission: 0.48, salaireFixe: 20000,
  };
  assert.equal(calculerFinances({ ...base, salaireActif: false }).salaireVerse, 0);
  assert.equal(calculerFinances({ ...base, salaireActif: false }).totalAVerser, 45000, "primes seules");

  const sansPrimes = calculerFinances({ ...base, primeVenteActive: false, primeLocationActive: false });
  assert.equal(sansPrimes.primeTotale, 0, "grade sans prime (stagiaire)");
  assert.equal(sansPrimes.commission, 48000, "la commission reste due");

  // Ventes réalisées en formation : comptées dans le quota seulement si la
  // Direction l'a décidé (stats_config.formateur_compte_dans_quota).
  const avecFormateur = { ...base, salaireActif: false, formateurNbAchats: 10, formateurNbLocations: 10 };
  const hors = calculerFinances(avecFormateur);
  const dedans = calculerFinances({ ...avecFormateur, formateurComptesDansQuota: true });
  assert.equal(hors.quotaRealise, 100);
  assert.equal(dedans.quotaRealise, 120);
  assert.equal(hors.primeVente, 15000, "50 ventes -> palier 40");
  assert.equal(dedans.primeVente, 20000, "60 ventes -> palier 60");
});

test("formatage des montants", () => {
  assert.match(formaterMontantStats(1400000), /1.400.000/);
  assert.match(formaterMontantStats(0), /0/);
});

// ---- salaire de la semaine : un interrupteur coupé ne verse rien (règle de la Direction) ----
const BAREMES = { ventes: BAREME_VENTES, locations: BAREME_LOCATIONS };

test("salaireSemaine : tout activé = fixe + paliers + paie à l'heure", () => {
  const r = salaireSemaine({ salaireFixe: 8000, salaireActif: true, primeVenteActive: true, primeLocationActive: true }, BAREMES, { ventes: 25, locations: 45, paieHoraire: 6000 });
  assert.deepEqual(r, { salaireFixe: 8000, primeVente: 10000, primeLocations: 30000, primeTotale: 40000, paieHoraire: 6000, total: 54000 });
});

test("salaireSemaine : salaire fixe coupé = pas de fixe, même s'il est réglé", () => {
  const r = salaireSemaine({ salaireFixe: 8000, salaireActif: false, primeVenteActive: true, primeLocationActive: true }, BAREMES, { ventes: 25 });
  assert.equal(r.salaireFixe, 0);
  assert.equal(r.total, 10000);
});

test("salaireSemaine : prime ventes coupée = 0 $ de prime ventes, même au-dessus d'un palier", () => {
  const r = salaireSemaine({ salaireFixe: 0, salaireActif: false, primeVenteActive: false, primeLocationActive: true }, BAREMES, { ventes: 100, locations: 20 });
  assert.equal(r.primeVente, 0);
  assert.equal(r.primeLocations, 10000);
  assert.equal(r.total, 10000);
});

test("salaireSemaine : prime locations coupée = 0 $ de prime locations", () => {
  const r = primesSelonGrade({ primeVenteActive: true, primeLocationActive: false }, BAREMES, 40, 100);
  assert.deepEqual(r, { primeVente: 15000, primeLocations: 0, primeTotale: 15000 });
});

test("salaireSemaine : tout coupé, sans paie à l'heure = 0 $", () => {
  const r = salaireSemaine({ salaireFixe: 50000, salaireActif: false, primeVenteActive: false, primeLocationActive: false }, BAREMES, { ventes: 100, locations: 100 });
  assert.equal(r.total, 0);
});

test("primesSelonGrade : grade sans réglage = primes actives (comme calculerFinances)", () => {
  assert.equal(primesSelonGrade({}, BAREMES, 20, 0).primeVente, 10000);
});

test("salaireSemaine et calculerFinances donnent les mêmes primes et le même fixe", () => {
  for (const reglage of [
    { salaireFixe: 20000, salaireActif: true, primeVenteActive: true, primeLocationActive: false },
    { salaireFixe: 20000, salaireActif: false, primeVenteActive: false, primeLocationActive: true },
  ]) {
    const a = salaireSemaine(reglage, BAREMES, { ventes: 63, locations: 41 });
    const b = calculerFinances({ nbAchats: 63, nbLocations: 41, facture: 0, baremeVentes: BAREME_VENTES, baremeLocations: BAREME_LOCATIONS, tauxCommission: 0, ...reglage });
    assert.equal(a.primeTotale, b.primeTotale);
    assert.equal(a.salaireFixe, b.salaireVerse);
  }
});
