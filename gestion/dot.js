/* GESTION — DOT (permission « compta ») : relevé Tablettes collé et résumé de la déclaration DOT hebdomadaire.
   Serveur : server/src/entreprise/routes/compta.ts. */

// séparateur de milliers comme formaterPrix (layout.js), sans « HT »
function formaterArgentStats(valeur) {
  const n = Math.round(Number(valeur) || 0);
  return `${n < 0 ? '-' : ''}${Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;
}
document.querySelectorAll(".compta-sous-onglet").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".compta-sous-onglet").forEach((b) => { b.classList.toggle("actif", b === btn); b.setAttribute("aria-selected", String(b === btn)); });
    const nom = btn.dataset.comptaOnglet;
    document.getElementById("compta-panneau-tablettes").classList.toggle("cache", nom !== "tablettes");
    document.getElementById("compta-panneau-dot").classList.toggle("cache", nom !== "dot");
    if (nom === "dot") chargerDot();
  });
});

// ---------------------------------------------------------------------------
// Comptabilité -> DOT — la déclaration hebdomadaire versée à la DOT. Tout le calcul est fait par le serveur
// (GET /api/compta/dot/resume) : la page l'affiche comme un compte de résultat, sans rien recalculer. Une semaine
// verrouillée (« Valider la déclaration », ou verrouillage automatique si personne ne l'a fait) devient lecture
// seule : son résumé ne change plus, même si le barème ou le relevé Tablettes changent ensuite.
// ---------------------------------------------------------------------------

let CACHE_ECRITURES_DOT = [];
let RESUME_DOT = null;

// ---- semaine affichée : lundi (AAAA-MM-JJ, calendrier Paris) de la semaine en cours par défaut ; navigation vers le
// passé seulement (le serveur ramène toute semaine future à la semaine en cours, même principe que Quota). ----
const jourParisISODot = d => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
function lundiDeDot(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function decalerSemaineDot(iso, sens) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * sens);
  return d.toISOString().slice(0, 10);
}
const DOT_SEMAINE_COURANTE = lundiDeDot(jourParisISODot(new Date()));
let DOT_SEMAINE = DOT_SEMAINE_COURANTE;

function majNavSemaineDot() {
  const courante = DOT_SEMAINE === DOT_SEMAINE_COURANTE;
  const debut = new Date(`${DOT_SEMAINE}T00:00:00Z`);
  const options = { day: "numeric", month: "short", timeZone: "UTC" };
  const bouton = document.getElementById("dot-aujourdhui");
  bouton.textContent = courante ? "Cette semaine" : `Sem. du ${debut.toLocaleDateString("fr-FR", options)}`;
  bouton.classList.toggle("sur-semaine-courante", courante);
  bouton.setAttribute("aria-label", courante ? "Cette semaine" : `${bouton.textContent} : revenir à cette semaine`);
  bouton.title = courante ? "Raccourci : touche T" : "Revenir à cette semaine (touche T)";
  document.getElementById("dot-semaine-suivante").disabled = courante;
}
function allerSemaineDot(iso) {
  DOT_SEMAINE = iso > DOT_SEMAINE_COURANTE ? DOT_SEMAINE_COURANTE : iso;
  majNavSemaineDot();
  chargerDot();
}
document.getElementById("dot-semaine-precedente").addEventListener("click", () => allerSemaineDot(decalerSemaineDot(DOT_SEMAINE, -1)));
document.getElementById("dot-semaine-suivante").addEventListener("click", () => allerSemaineDot(decalerSemaineDot(DOT_SEMAINE, 1)));
document.getElementById("dot-aujourdhui").addEventListener("click", () => allerSemaineDot(DOT_SEMAINE_COURANTE));
// raccourci clavier « T » (même logique que l'agenda et Quota) : revient à la semaine en cours
document.addEventListener("keydown", e => {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1 || e.key.toLowerCase() !== "t") return;
  if (document.getElementById("compta-panneau-dot").classList.contains("cache")) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable]") || document.querySelector(".modale-fond:not(.cache), [role=alertdialog]")) return;
  document.getElementById("dot-aujourdhui").click();
});

async function chargerDot() {
  await Promise.all([chargerDotResume(), chargerDotEcritures(), chargerDotBareme(), chargerDotSalaries()]);
}

const pourcent = t => `${Math.round((Number(t) || 0) * 1000) / 10} %`.replace(".", ",");
const tranche = t => `${formaterArgentStats(t.seuilMin)} à ${formaterArgentStats(t.seuilMax)}`;
// « 19 octobre 2026 » (jour AAAA-MM-JJ sans fuseau), « 1er » pour le premier du mois
const dateLongue = jour => new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(/^1 /, "1er ");

// barèmes (lecture seule) : chargés une fois ; la tranche appliquée est surlignée après chaque résumé
let BAREME_DOT = null;
async function chargerDotBareme() {
  if (BAREME_DOT) return surlignerTranches();
  try {
    BAREME_DOT = await socle.api("/api/compta/dot/bareme");
    document.getElementById("corps-table-dot-bareme").innerHTML = (BAREME_DOT.tranches || []).map(t => `
      <tr data-seuil="${t.seuilMin}">
        <td class="dot-tranche">${tranche(t)}</td>
        <td class="dot-montant">${pourcent(t.taux)}</td>
        <td class="dot-montant">${formaterArgentStats(t.salaireMaxEmploye)}</td>
        <td class="dot-montant">${formaterArgentStats(t.salaireMaxPatron)}</td>
        <td class="dot-montant">${formaterArgentStats(t.primeMaxEmploye)}</td>
        <td class="dot-montant">${formaterArgentStats(t.primeMaxPatron)}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="champ-aide">Aucun barème réglé : demandez-le à la personne qui s’occupe du site.</td></tr>`;
    document.getElementById("corps-table-dot-bareme-richesse").innerHTML = (BAREME_DOT.tranchesRichesse || []).map(t => `
      <tr data-seuil="${t.seuilMin}"><td class="dot-tranche">${tranche(t)}</td><td class="dot-montant">+ ${pourcent(t.taux)}</td></tr>`).join("")
      || `<tr><td colspan="2" class="champ-aide">Aucun barème réglé : demandez-le à la personne qui s’occupe du site.</td></tr>`;
    surlignerTranches();
  } catch (e) {
    gestion.message("zone-message-dot", "Les barèmes n’ont pas pu se charger (" + e.message + "). Rechargez la page.");
  }
}
function surlignerTranches() {
  const marquer = (idCorps, t) => document.querySelectorAll(`#${idCorps} tr[data-seuil]`).forEach(tr => {
    const active = !!t && Number(tr.dataset.seuil) === t.seuilMin;
    tr.classList.toggle("dot-tranche-active", active);
    if (active) tr.setAttribute("aria-current", "true"); else tr.removeAttribute("aria-current");
  });
  marquer("corps-table-dot-bareme", RESUME_DOT && RESUME_DOT.tranche);
  marquer("corps-table-dot-bareme-richesse", RESUME_DOT && RESUME_DOT.trancheRichesse);
}

// Résultat d'une copie : notification en bas de l'écran ; le bouton garde son libellé et sa taille.
function signalerCopie(_bouton, reussie, texte) {
  if (!reussie) { gestion.notifier("Copie impossible : sélectionnez le tableau à la main puis Ctrl+C.", "erreur"); return; }
  gestion.notifier(texte);
}

// nombre d'unités (RUN), sans « $ » : séparateur de milliers seulement, à ne pas confondre avec les colonnes en $
function formaterNombreStats(valeur) {
  return Math.round(Number(valeur) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// Une carte de chiffre clé : libellé, montant, précision ; « accent » pour celui qui compte le plus.
const carteChiffre = (libelle, valeur, precision, accent) => `<div class="compta-chiffre${accent ? " accent" : ""}">
  <span class="compta-chiffre-libelle">${libelle}</span><strong>${valeur}</strong>${precision ? `<small>${precision}</small>` : ""}</div>`;

// Verrouillage : bandeau de statut, et tout ce qui s'écrit sur cette semaine (mouvements, primes, solde bancaire)
// masqué ou désactivé. « Valider » n'apparaît que sur une semaine qui ne l'est pas encore.
function majEtatVerrouillage(r) {
  const verrouillee = !!r.verrouillee;
  document.getElementById("bouton-valider-declaration").classList.toggle("cache", verrouillee);
  const bandeau = document.getElementById("dot-bandeau-verrouillee");
  if (verrouillee) {
    const qui = r.verrouilleeAuto ? "automatiquement (personne ne l’avait validée)" : "manuellement";
    bandeau.innerHTML = `${gestion.ico("lock")} Déclaration verrouillée ${qui} le ${formaterDateHeureCompta(r.verrouilleeLe)} : elle ne change plus, même si le relevé Tablettes ou le barème changent ensuite.`;
  } else if (r.enAttenteVerrouillage) {
    bandeau.innerHTML = `${gestion.ico("sync")} Semaine passée non validée : elle sera verrouillée automatiquement d’ici peu, telle qu’elle est maintenant.`;
  }
  bandeau.classList.toggle("cache", !verrouillee && !r.enAttenteVerrouillage);
  document.getElementById("formulaire-solde-bancaire").classList.toggle("cache", verrouillee);
}

// ---------- résumé : chiffres clés, compte de résultat, taux ----------
async function chargerDotResume() {
  gestion.message("zone-message-dot", "");
  try {
    const r = RESUME_DOT = await socle.api(`/api/compta/dot/resume?semaine=${DOT_SEMAINE}`);
    DOT_SEMAINE = r.semaine; // le serveur ramène une semaine future demandée à la semaine en cours
    majNavSemaineDot();
    majEtatVerrouillage(r);
    const val = v => (v == null ? "—" : formaterArgentStats(v));
    const tauxTotal = r.tauxImposition == null ? null : r.tauxImposition + (r.tauxRichesse || 0);

    document.getElementById("dot-titre-semaine").textContent = `Déclaration de la semaine du ${dateLongue(r.semaine)}`;
    const source = document.getElementById("dot-source");
    if (r.caBrutSource) {
      const s = r.caBrutSource;
      source.textContent = `Relevé Tablettes importé le ${formaterDateHeureCompta(s.importeLe)}${s.importePar ? ` par ${s.importePar}` : ""}, ${s.nbLignes} membre${s.nbLignes > 1 ? "s" : ""}.`;
    } else if (r.verrouillee) {
      source.textContent = "Aucun relevé Tablettes au moment du verrouillage : le CA brut ne comptait que les recettes exceptionnelles.";
    } else {
      source.innerHTML = `Aucun relevé Tablettes : le CA brut ne compte que les recettes exceptionnelles. <button type="button" class="lien-bouton" id="dot-aller-tablettes">Importer le relevé</button>`;
      document.getElementById("dot-aller-tablettes").addEventListener("click", () => document.querySelector('[data-compta-onglet="tablettes"]').click());
    }

    document.getElementById("dot-chiffres").innerHTML = [
      carteChiffre("À verser à la DOT", val(r.montantImpots), tauxTotal == null ? "aucun bénéfice à déclarer"
        : r.tauxRichesse ? `taux ${pourcent(tauxTotal)} : ${pourcent(r.tauxImposition)} sur le bénéfice + ${pourcent(r.tauxRichesse)} de richesse` : `taux ${pourcent(tauxTotal)} sur le bénéfice`, true),
      carteChiffre("Bénéfice imposable", val(r.beneficeImposable), r.tranche ? `tranche ${tranche(r.tranche)}` : r.beneficeImposable == null ? "en attente du relevé" : "sous la première tranche"),
      carteChiffre("Bénéfice net", val(r.beneficeNet), "après impôt, primes et retraits"),
    ].join("");

    afficherCompteResultat(r);
    afficherTaux(r);
    surlignerTranches();
    majAlertesPlafonds();
  } catch (e) {
    gestion.message("zone-message-dot", "Le résumé de la déclaration n’a pas pu se charger (" + e.message + "). Rechargez la page.");
  }
}

// Compte de résultat : produits, charges, impôt, affectation. Chaque ligne porte sa part du CA brut (barre fine,
// une seule teinte : c'est une grandeur, pas une catégorie) ; le montant écrit reste la référence.
function afficherCompteResultat(r) {
  const ca = r.caBrut || 0;
  const plafond = r.depensePlafonnee ? r.salairesSemaine + r.depensesManuelles - r.depenseDeductible : 0;
  const lignes = [
    { groupe: "Produits" },
    { libelle: "Relevé Tablettes", valeur: r.caBrutTablette, signe: "+" },
    { libelle: "Recettes exceptionnelles", valeur: r.caBrutRecettes, signe: "+" },
    { libelle: "Chiffre d’affaires brut", valeur: r.caBrut, type: "sous-total" },
    { groupe: "Charges déductibles" },
    { libelle: "Salaires de la semaine", valeur: r.salairesSemaine, signe: "−" },
    { libelle: "Dépenses déductibles", valeur: r.depensesManuelles, signe: "−" },
    plafond > 0 && { libelle: "Part non déductible", detail: "au-delà de 2 000 000 $", valeur: plafond, signe: "+" },
    { libelle: "Bénéfice imposable", valeur: r.beneficeImposable, type: "sous-total" },
    { groupe: "Impôt et affectation" },
    { libelle: "Impôt dû à la DOT", detail: r.tauxImposition == null ? "" : pourcent(r.tauxImposition + (r.tauxRichesse || 0)), valeur: r.montantImpots, signe: "−" },
    { libelle: "Bénéfice après impôt", valeur: r.beneficeApresImpots, type: "sous-total" },
    { libelle: "Primes", valeur: r.montantPrimes, signe: "−" },
    { libelle: "Retraits", valeur: r.retraits, signe: "−" },
    { libelle: "Bénéfice net", valeur: r.beneficeNet, type: "total" },
  ].filter(Boolean);
  const part = v => (ca > 0 && v != null ? Math.max(0, Math.min(100, Math.abs(v) / ca * 100)) : 0);
  document.getElementById("dot-calcul").innerHTML = lignes.map(l => l.groupe
    ? `<p class="dot-resultat-groupe">${l.groupe}</p>`
    : `<div class="dot-ligne${l.type ? ` dot-ligne--${l.type}` : ""}${l.signe === "−" ? " dot-ligne--charge" : ""}">
        <span class="dot-ligne-libelle">${l.signe ? `<span class="dot-signe" aria-hidden="true">${l.signe}</span>` : ""}${l.libelle}${l.detail ? ` <small>${l.detail}</small>` : ""}</span>
        <strong class="dot-ligne-valeur${l.valeur < 0 ? " negatif" : ""}">${l.valeur == null ? "—" : formaterArgentStats(l.valeur)}</strong>
        <span class="dot-ligne-barre" aria-hidden="true"><span style="width:${part(l.valeur)}%"></span></span>
      </div>`).join("");
}

// taux appliqué = taux de la tranche du bénéfice + taux de la richesse (solde bancaire), plafonds de la tranche
function afficherTaux(r) {
  const ligne = (terme, def, detail, classe = "") => `<div class="${classe}"><dt>${terme}${detail ? `<small>${detail}</small>` : ""}</dt><dd>${def}</dd></div>`;
  document.getElementById("dot-taux").innerHTML = [
    ligne("Sur le bénéfice", r.tauxImposition == null ? "—" : pourcent(r.tauxImposition), r.tranche ? `tranche ${tranche(r.tranche)}` : "aucune tranche atteinte"),
    ligne("De richesse", `+ ${pourcent(r.tauxRichesse)}`, r.trancheRichesse ? `solde de ${tranche(r.trancheRichesse)}` : "solde sous 1 500 000 $"),
    ligne("Taux appliqué", r.tauxImposition == null ? "—" : pourcent(r.tauxImposition + (r.tauxRichesse || 0)), "", "dot-taux-total"),
  ].join("");
  const champ = document.getElementById("dot-solde-bancaire");
  if (document.activeElement !== champ) champ.value = r.soldeBancaire || 0;
  const p = r.plafonds;
  document.querySelector("#dot-plafonds tbody").innerHTML = `
    <tr><th scope="row">Salaire</th><td>${p ? formaterArgentStats(p.salaireMaxEmploye) : "—"}</td><td>${p ? formaterArgentStats(p.salaireMaxPatron) : "—"}</td></tr>
    <tr><th scope="row">Prime</th><td>${p ? formaterArgentStats(p.primeMaxEmploye) : "—"}</td><td>${p ? formaterArgentStats(p.primeMaxPatron) : "—"}</td></tr>`;
}

document.getElementById("formulaire-solde-bancaire").addEventListener("submit", async ev => {
  ev.preventDefault();
  const montant = Math.round(Number(document.getElementById("dot-solde-bancaire").value) || 0);
  try {
    await socle.api("/api/compta/dot/solde-bancaire", { method: "PUT", body: { montant } });
    gestion.notifier("Solde bancaire enregistré ✓");
    await chargerDotResume();
  } catch (e) {
    gestion.notifier("Solde non enregistré : " + e.message, "erreur");
  }
});

// « Valider la déclaration » : fige la semaine affichée (résumé, salariés, mouvements) — ne change plus ensuite.
document.getElementById("bouton-valider-declaration").addEventListener("click", async () => {
  const ok = await gestion.confirmer(
    `La déclaration de la semaine du ${dateLongue(DOT_SEMAINE)} sera figée telle qu’elle est maintenant : plus aucun mouvement, prime ou solde bancaire ne pourra la changer. Vérifiez le compte de résultat avant de continuer.`,
    "Valider cette déclaration ?", "Valider la déclaration", { danger: false },
  );
  if (!ok) return;
  try {
    await socle.api("/api/compta/dot/verrouiller", { method: "POST", body: { semaine: DOT_SEMAINE } });
    gestion.notifier("Déclaration validée ✓");
    await chargerDot();
  } catch (e) {
    gestion.message("zone-message-dot", "Déclaration non validée : " + e.message);
  }
});

// ---------- tableau des salariés ----------
let DOT_SALARIES = [];
async function chargerDotSalaries() {
  const corps = document.getElementById("corps-table-dot-salaries");
  try {
    const r = await socle.api(`/api/compta/dot/salaries?semaine=${DOT_SEMAINE}`);
    DOT_SALARIES = r.agents || [];
    const verrouillee = !!r.verrouillee;
    corps.innerHTML = DOT_SALARIES.length
      ? DOT_SALARIES.map(a => `<tr data-employe="${a.employeId}">
            <td>${echapper(a.nom)}${a.ambigu ? ` <span class="grades-tag alerte" title="Un autre employé actif porte le même nom RP : vente, CA total réalisé et paie à l’heure sont comptés à 0 ici.">Nom ambigu</span>` : ""}</td>
            <td>${echapper(a.grade)}</td>
            <td class="dot-montant">${formaterNombreStats(a.run)}</td>
            <td class="dot-montant">${formaterArgentStats(a.facture)}</td>
            <td class="dot-montant">${formaterArgentStats(a.vente)}</td>
            <td class="dot-montant"><strong>${formaterArgentStats(a.caTotalRealise)}</strong></td>
            <td class="dot-montant" data-plafond="salaire"><strong data-valeur-plafond>${formaterArgentStats(a.salaireTotal)}</strong><span class="visuellement-cache" data-texte-plafond></span></td>
            <td class="dot-montant" data-plafond="prime">${verrouillee
              ? `<strong>${formaterArgentStats(a.prime)}</strong>`
              : `<input type="number" class="table-input dot-prime" min="0" step="1" inputmode="numeric" value="${a.prime}" data-prime-employe="${a.employeId}" aria-label="Prime de ${echapper(a.nom)}">`}<span class="visuellement-cache" data-texte-plafond></span></td>
          </tr>`).join("")
      : `<tr><td colspan="8" class="champ-aide">Aucun employé actif : les fiches se créent dans Ressources humaines.</td></tr>`;
    corps.querySelectorAll("[data-prime-employe]").forEach(input => input.addEventListener("change", () => enregistrerPrimeSalarie(input)));
    majResumeSalaries(verrouillee);
    majAlertesPlafonds();
  } catch (e) {
    corps.innerHTML = `<tr><td colspan="8" class="champ-aide">Le tableau des salariés n’a pas pu se charger (${echapper(e.message)}). Rechargez la page.</td></tr>`;
  }
}

function majResumeSalaries(verrouillee) {
  const n = DOT_SALARIES.length;
  const somme = cle => DOT_SALARIES.reduce((s, a) => s + (Number(a[cle]) || 0), 0);
  document.getElementById("dot-salaries-resume").textContent = n
    ? `${n} salarié${n > 1 ? "s" : ""} actif${n > 1 ? "s" : ""} : ${formaterArgentStats(somme("salaireTotal"))} de salaires et ${formaterArgentStats(somme("prime"))} de primes cette semaine.${verrouillee ? "" : " La prime se saisit dans la dernière colonne."}`
    : "Aucun salarié actif cette semaine.";
}

// Plafonds de la tranche (barème) : le grade ne dit pas qui est patron, donc deux niveaux — au-dessus du plafond
// employé (permis pour un patron seulement), au-dessus du plafond patron (jamais permis). La couleur du montant porte
// l'alerte (bulle d'aide au survol, texte pour les lecteurs d'écran) : rien n'est inséré dans la cellule, pour que la
// colonne ne bouge jamais selon qui est en alerte ou non.
function majAlertesPlafonds() {
  const p = RESUME_DOT && RESUME_DOT.plafonds;
  document.querySelectorAll("#corps-table-dot-salaries tr[data-employe]").forEach(tr => {
    const a = DOT_SALARIES.find(x => x.employeId === Number(tr.dataset.employe));
    if (!a) return;
    [["salaire", a.salaireTotal, p && p.salaireMaxEmploye, p && p.salaireMaxPatron], ["prime", a.prime, p && p.primeMaxEmploye, p && p.primeMaxPatron]].forEach(([cle, v, maxE, maxP]) => {
      const td = tr.querySelector(`[data-plafond="${cle}"]`);
      const cible = td.querySelector("[data-valeur-plafond], strong, input");
      const texte = td.querySelector("[data-texte-plafond]");
      cible.classList.remove("dot-plafond-depasse", "dot-plafond-hors");
      texte.textContent = "";
      cible.removeAttribute("title");
      if (!p || !v || v <= maxE) return;
      const hors = v > maxP;
      cible.classList.add(hors ? "dot-plafond-hors" : "dot-plafond-depasse");
      const message = hors
        ? `Au-dessus du plafond patron de la tranche (${formaterArgentStats(maxP)}) : à réduire avant de déclarer.`
        : `Au-dessus du plafond employé (${formaterArgentStats(maxE)}) : permis seulement pour un patron (${formaterArgentStats(maxP)} au plus).`;
      cible.title = message;
      texte.textContent = message;
    });
  });
}

// Prime saisie pour la semaine affichée : enregistrée au changement, reprise aussitôt dans le compte de résultat.
async function enregistrerPrimeSalarie(input) {
  const employeId = Number(input.dataset.primeEmploye);
  const montant = Math.max(0, Math.round(Number(input.value) || 0));
  const agent = DOT_SALARIES.find(a => a.employeId === employeId);
  try {
    await socle.api(`/api/compta/dot/salaries/${employeId}/prime?semaine=${DOT_SEMAINE}`, { method: "PUT", body: { montant } });
    if (agent) agent.prime = montant;
    input.value = montant;
    majResumeSalaries(false);
    gestion.notifier(`Prime de ${agent ? agent.nom : "l’employé"} enregistrée ✓`);
    await chargerDotResume();
  } catch (e) {
    gestion.notifier("Prime non enregistrée : " + e.message, "erreur");
    input.value = agent ? agent.prime : 0;
  }
}

// « Copier le tableau » : colonnes séparées par des tabulations, montants copiés comme de vrais nombres.
document.getElementById("bouton-copier-salaries").addEventListener("click", async e => {
  if (!DOT_SALARIES.length) { gestion.notifier("Rien à copier : aucun salarié à déclarer.", "erreur"); return; }
  const nombre = v => String(Math.round(Number(v) || 0));
  const lignes = DOT_SALARIES.map(a => [a.nom, a.grade, nombre(a.run), nombre(a.facture), nombre(a.vente), nombre(a.caTotalRealise), nombre(a.salaireTotal), nombre(a.prime)].join("\t"));
  const n = lignes.length;
  signalerCopie(e.currentTarget, await copierTexte(lignes.join("\n")), `${n} salarié${n > 1 ? "s" : ""} copié${n > 1 ? "s" : ""} ✓ Collez dans la colonne A du document DOT.`);
});

// ---------- mouvements de la semaine (une liste, filtrée par type) ----------
const TYPES_ECRITURE = {
  recette: { libelle: "Recette", pluriel: "les recettes exceptionnelles", tout: "Toutes les recettes exceptionnelles seront supprimées", ajout: "Recette ajoutée" },
  depense: { libelle: "Dépense", pluriel: "les dépenses déductibles", tout: "Toutes les dépenses déductibles seront supprimées", ajout: "Dépense ajoutée" },
  retrait: { libelle: "Retrait", pluriel: "les retraits", tout: "Tous les retraits seront supprimés", ajout: "Retrait ajouté" },
};
let FILTRE_ECRITURE = "";
let ECRITURES_VERROUILLEES = false;

async function chargerDotEcritures() {
  try {
    const r = await socle.api(`/api/compta/dot/ecritures?semaine=${DOT_SEMAINE}`);
    CACHE_ECRITURES_DOT = r.ecritures || [];
    ECRITURES_VERROUILLEES = !!r.verrouillee;
    document.getElementById("bouton-nouvelle-ecriture").classList.toggle("cache", ECRITURES_VERROUILLEES);
    rendreEcrituresDot();
  } catch (e) {
    gestion.message("zone-message-dot", "Les mouvements n’ont pas pu se charger (" + e.message + "). Rechargez la page.");
  }
}

function rendreEcrituresDot() {
  const total = type => CACHE_ECRITURES_DOT.filter(e => e.type === type).reduce((t, e) => t + Number(e.montant || 0), 0);
  document.querySelectorAll("[data-total-ecriture]").forEach(s => { s.textContent = formaterArgentStats(total(s.dataset.totalEcriture)); });
  const lignes = CACHE_ECRITURES_DOT.filter(e => !FILTRE_ECRITURE || e.type === FILTRE_ECRITURE);
  const vide = FILTRE_ECRITURE
    ? `Aucun mouvement de ce type cette semaine.`
    : ECRITURES_VERROUILLEES ? `Aucun mouvement cette semaine.` : `Aucun mouvement cette semaine. Ajoutez une recette, une dépense ou un retrait avec « Ajouter un mouvement ».`;
  document.getElementById("corps-table-dot-ecritures").innerHTML = lignes.length
    ? lignes.map(e => {
      const t = TYPES_ECRITURE[e.type] || { libelle: e.type };
      return `<tr>
          <td>${echapper(e.date_ecriture) || "—"}</td>
          <td>${echapper(e.justificatif)}</td>
          <td><span class="dot-tag dot-tag--${echapper(e.type)}">${t.libelle}</span></td>
          <td class="dot-montant">${e.type === "recette" ? "+ " : "− "}${formaterArgentStats(e.montant)}</td>
          <td class="col-actions">${ECRITURES_VERROUILLEES ? "" : `<button type="button" class="actions-icone actions-icone--erreur" data-ecriture-supprimer="${e.id}" title="Supprimer" aria-label="Supprimer le mouvement « ${echapper(e.justificatif)} »">${gestion.ico("trash")}</button>`}</td>
        </tr>`;
    }).join("")
    : `<tr><td colspan="5" class="champ-aide">${vide}</td></tr>`;
  document.querySelectorAll("[data-ecriture-supprimer]").forEach(btn => btn.addEventListener("click", () => supprimerEcritureDot(Number(btn.dataset.ecritureSupprimer))));
  // tout effacer : seulement un type à la fois (le serveur n'efface jamais tout le journal d'un coup)
  const reset = document.getElementById("bouton-reinitialiser-ecritures");
  reset.classList.toggle("cache", ECRITURES_VERROUILLEES || !FILTRE_ECRITURE || !lignes.length);
  if (FILTRE_ECRITURE) document.getElementById("libelle-reinitialiser-ecritures").textContent = `Effacer ${TYPES_ECRITURE[FILTRE_ECRITURE].pluriel}`;
}

document.querySelectorAll("[data-filtre-ecriture]").forEach(btn => btn.addEventListener("click", () => {
  FILTRE_ECRITURE = btn.dataset.filtreEcriture;
  document.querySelectorAll("[data-filtre-ecriture]").forEach(b => { b.classList.toggle("actif", b === btn); b.setAttribute("aria-pressed", String(b === btn)); });
  rendreEcrituresDot();
}));

async function supprimerEcritureDot(id) {
  const e = CACHE_ECRITURES_DOT.find(x => x.id === id);
  const ok = await gestion.confirmer(`« ${e ? e.justificatif : "Ce mouvement"} » sera retiré du calcul de la déclaration.`, "Supprimer ce mouvement ?", "Supprimer le mouvement");
  if (!ok) return;
  try {
    await socle.api(`/api/compta/dot/ecritures/${id}`, { method: "DELETE" });
    gestion.notifier("Mouvement supprimé ✓");
    await Promise.all([chargerDotEcritures(), chargerDotResume()]);
  } catch (err) {
    gestion.notifier("Mouvement non supprimé : " + err.message, "erreur");
  }
}

document.getElementById("bouton-reinitialiser-ecritures").addEventListener("click", async () => {
  const type = FILTRE_ECRITURE;
  if (!type) return;
  const ok = await gestion.confirmer(`${TYPES_ECRITURE[type].tout}. Cette action est irréversible.`, `Effacer ${TYPES_ECRITURE[type].pluriel} ?`, "Tout effacer");
  if (!ok) return;
  try {
    await socle.api(`/api/compta/dot/ecritures?type=${type}&semaine=${DOT_SEMAINE}`, { method: "DELETE" });
    gestion.notifier("Mouvements effacés ✓");
    await Promise.all([chargerDotEcritures(), chargerDotResume()]);
  } catch (err) {
    gestion.notifier("Mouvements non effacés : " + err.message, "erreur");
  }
});

// « Copier » : les mouvements affichés, au format tableur (tabulations), montant comme un vrai nombre
document.getElementById("bouton-copier-ecritures").addEventListener("click", async e => {
  const lignes = CACHE_ECRITURES_DOT.filter(x => !FILTRE_ECRITURE || x.type === FILTRE_ECRITURE)
    .map(x => [x.date_ecriture, x.justificatif, ...(FILTRE_ECRITURE ? [] : [TYPES_ECRITURE[x.type]?.libelle || x.type]), String(x.montant)].join("\t"));
  if (!lignes.length) { gestion.notifier("Rien à copier : aucun mouvement affiché.", "erreur"); return; }
  signalerCopie(e.currentTarget, await copierTexte(lignes.join("\n")), `Mouvements copiés ✓ (${lignes.length} ligne${lignes.length > 1 ? "s" : ""})`);
});

// fenêtre d'ajout : le type se choisit dans la fenêtre (présélectionné d'après le filtre affiché)
ajouterSelecteurDate(document.getElementById("ecriture-dot-date"));

function ouvrirModaleEcritureDot() {
  const type = FILTRE_ECRITURE || "depense";
  document.querySelectorAll('input[name="ecriture-dot-type"]').forEach(r => { r.checked = r.value === type; });
  document.getElementById("ecriture-dot-date").value = "";
  document.getElementById("ecriture-dot-justificatif").value = "";
  document.getElementById("ecriture-dot-montant").value = "";
  gestion.message("zone-message-modale-ecriture-dot", "");
  document.getElementById("modale-ecriture-dot").classList.remove("cache");
  document.getElementById("ecriture-dot-justificatif").focus();
}
function fermerModaleEcritureDot() {
  document.getElementById("modale-ecriture-dot").classList.add("cache");
}
document.getElementById("bouton-nouvelle-ecriture").addEventListener("click", ouvrirModaleEcritureDot);
document.getElementById("fermer-modale-ecriture-dot").addEventListener("click", fermerModaleEcritureDot);
document.getElementById("annuler-modale-ecriture-dot").addEventListener("click", fermerModaleEcritureDot);
document.getElementById("modale-ecriture-dot").addEventListener("click", ev => { if (ev.target.id === "modale-ecriture-dot") fermerModaleEcritureDot(); });

document.getElementById("formulaire-ecriture-dot").addEventListener("submit", async ev => {
  ev.preventDefault();
  gestion.message("zone-message-modale-ecriture-dot", "");
  const type = document.querySelector('input[name="ecriture-dot-type"]:checked')?.value;
  const date = document.getElementById("ecriture-dot-date").value.trim();
  const justificatif = document.getElementById("ecriture-dot-justificatif").value.trim();
  const montant = document.getElementById("ecriture-dot-montant").value;
  if (!type) { gestion.message("zone-message-modale-ecriture-dot", "Choisissez le type de mouvement."); return; }
  try {
    await socle.api("/api/compta/dot/ecritures", { method: "POST", body: { type, date, justificatif, montant, semaine: DOT_SEMAINE } });
    fermerModaleEcritureDot();
    gestion.notifier(`${TYPES_ECRITURE[type].ajout} ✓`);
    await Promise.all([chargerDotEcritures(), chargerDotResume()]);
  } catch (e) {
    gestion.message("zone-message-modale-ecriture-dot", e.message);
  }
});

// Découpe un texte collé en colonnes + lignes. On essaie d'abord les
// tabulations (\t) : c'est ce que produit un copier-coller de cellules
// depuis Excel / Google Sheets, y compris les cellules vides — c'est donc la
// méthode la plus fiable. À défaut, on se rabat sur des blocs d'au moins 2
// espaces comme séparateur (utile pour un texte tapé ou copié depuis
// Discord), sachant que dans ce cas une cellule vide au milieu d'une ligne
// (ex : « Rang » sur une ligne TOTAL) ne peut pas être détectée automatiquement
// — d'où le conseil, dans la modale, d'y mettre un tiret avant de coller.
function analyserTexteTablette(texte) {
  const lignesBrutes = String(texte || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (!lignesBrutes.length) return null;
  const decouper = (ligne) => (ligne.includes("\t") ? ligne.split("\t") : ligne.trim().split(/ {2,}/)).map((c) => c.trim());
  const colonnes = decouper(lignesBrutes[0]).filter((c) => c !== "");
  if (!colonnes.length) return null;
  let lignes = lignesBrutes.slice(1).map((ligne) => decouper(ligne));
  // La ligne récap "TOTAL" collée depuis la tablette n'a pas de case "Rang",
  // ce qui décale le reste vers la gauche. Corrigée ici, avant l'aperçu, pour
  // que l'aperçu montre ce qui sera enregistré : même règle que
  // corrigerLigneTotale côté serveur (routes/compta.ts), à garder identique.
  lignes = corrigerLigneTotaleDecaleeTablette(colonnes, lignes);
  lignes = lignes.map((cellules) => {
    const rangee = [];
    for (let i = 0; i < colonnes.length; i++) rangee.push(cellules[i] === undefined ? "" : cellules[i]);
    return rangee;
  });
  return { colonnes, lignes };
}

// Cherche, parmi les titres de colonnes (déjà mis en minuscules/sans
// espaces), le premier qui correspond à l'un des noms possibles — même règle
// que indexColonne côté serveur (routes/compta.ts).
function indexColonneTabletteClient(colonnesNormalisees, aliases) {
  for (const nom of aliases) {
    const i = colonnesNormalisees.indexOf(nom);
    if (i !== -1) return i;
  }
  return -1;
}

// Même règle que corrigerLigneTotale côté serveur (routes/compta.ts), à garder
// identique : l'aperçu affiché avant d'enregistrer correspond ainsi à ce qui
// sera sauvegardé.
function corrigerLigneTotaleDecaleeTablette(colonnes, lignes) {
  const colonnesNormalisees = colonnes.map((c) => String(c).trim().toLowerCase());
  const indexRang = indexColonneTabletteClient(colonnesNormalisees, ["rang", "grade"]);
  if (indexRang <= 0 || indexRang >= colonnes.length - 1) return lignes;
  return lignes.map((ligne) => {
    if (
      Array.isArray(ligne) &&
      String(ligne[0] || "").trim().toLowerCase() === "total" &&
      ligne.length < colonnes.length
    ) {
      const corrigee = ligne.slice();
      corrigee.splice(indexRang, 0, "-");
      return corrigee;
    }
    return ligne;
  });
}

function comptaLigneEstTotal(cellules) {
  const premier = (cellules[0] || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return premier === "total" || premier === "totaux";
}

function comptaColonneEstNumerique(lignes, index) {
  const valeurs = lignes.map((l) => (l[index] || "").trim()).filter((v) => v !== "" && v !== "-");
  return valeurs.length > 0 && valeurs.every((v) => /^-?[\d\s.,]+$/.test(v));
}

// `avecSuppression` : ajoute une colonne avec une croix par ligne (sauf la
// ligne Total) pour retirer un membre du relevé — utilisée seulement sur le
// tableau enregistré, pas sur l'aperçu de la modale d'import.
function rendreTableCompta(colonnes, lignes, avecSuppression) {
  const numerique = colonnes.map((_, i) => comptaColonneEstNumerique(lignes, i));
  const thead = `<thead><tr>${colonnes
    .map((c, i) => `<th${numerique[i] ? ' style="text-align:right;"' : ""}>${echapper(c)}</th>`)
    .join("")}${avecSuppression ? '<th class="col-actions" aria-label="Actions"></th>' : ""}</tr></thead>`;
  const tbody = `<tbody>${lignes
    .map((ligne, index) => {
      const total = comptaLigneEstTotal(ligne);
      const cellules = colonnes
        .map((_, i) => `<td${numerique[i] ? ' style="text-align:right;"' : ""}>${echapper(ligne[i] || "")}</td>`)
        .join("");
      const action = avecSuppression
        ? `<td class="col-actions">${total ? "" : `<button type="button" class="actions-icone actions-icone--erreur" data-index="${index}" data-nom="${echapper(ligne[0] || "")}" title="Retirer ${echapper(ligne[0] || "cette ligne")} du relevé" aria-label="Retirer ${echapper(ligne[0] || "cette ligne")} du relevé">${gestion.ico("trash")}</button>`}</td>`
        : "";
      return `<tr${total ? ' class="ligne-total"' : ""}>${cellules}${action}</tr>`;
    })
    .join("")}</tbody>`;
  return thead + tbody;
}

async function supprimerLigneTablette(index, nom) {
  const ok = await gestion.confirmer(`« ${nom} » sera retiré du relevé Tablettes. Les totaux (CA brut, DOT) seront recalculés sans cette ligne.`, "Retirer ce membre du relevé ?", "Retirer du relevé");
  if (!ok) return;
  try {
    await socle.api(`/api/compta/tablettes/lignes/${index}`, { method: "DELETE", body: { nom } });
    gestion.message("zone-message-tablette", `« ${nom} » retiré du relevé ✓`, "succes");
    chargerTablette();
  } catch (e) {
    gestion.message("zone-message-tablette", "Impossible de retirer cette ligne : " + e.message);
  }
}

function formaterDateHeureCompta(brut) {
  const iso = String(brut).includes("T") ? brut : String(brut).replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return (
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) +
    " à " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  );
}

// Paie à l'heure (server/src/entreprise/stats/paie-horaire.ts) : une ligne par membre d'un grade payé à l'heure, avec
// le calcul écrit en toutes lettres.
function afficherPaieHoraire(p) {
  const bloc = document.getElementById("compta-paie-horaire");
  if (!p || !p.lignes || !p.lignes.length) { bloc.classList.add("cache"); return; }
  bloc.classList.remove("cache");
  document.getElementById("compta-paie-horaire-aide").textContent = p.colonneHeures
    ? `Heures lues dans la colonne « ${p.colonneHeures} » du relevé, payées au taux horaire du grade (Comptabilité → table remunerations_grades).`
    : "Le relevé n'a pas de colonne « Heures de service » : impossible de calculer la paie à l'heure.";
  const heures = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
  document.getElementById("corps-table-paie-horaire").innerHTML = p.lignes.map((l) => `<tr>
      <td>${echapper(l.nom)}</td>
      <td>${echapper(l.grade)}${l.gradeSource === "releve" ? ' <span class="champ-aide" title="Sans fiche RH à ce nom : grade lu dans la colonne Rang du relevé">*</span>' : ""}</td>
      <td style="text-align:right;">${l.lisible ? heures(l.minutes) : `<span class="puce puce-or" title="Durée illisible : comptée 0 $">${echapper(l.heures || "vide")}</span>`}</td>
      <td style="text-align:right;">${formaterArgentStats(l.taux)} / h</td>
      <td class="champ-aide">${l.lisible ? `${l.minutes} min ÷ 60 × ${formaterArgentStats(l.taux)}` : "durée illisible"}</td>
      <td style="text-align:right;"><strong>${formaterArgentStats(l.montant)}</strong></td>
    </tr>`).join("") + `<tr class="ligne-total"><td colspan="5">Total paie à l'heure</td><td style="text-align:right;"><strong>${formaterArgentStats(p.total)}</strong></td></tr>`;
}

// Chiffres clés du relevé : le total « entreprise » (CA brut de la DOT), le nombre de membres, la paie à l'heure.
// CA brut calculé par le serveur (somme des membres) : la ligne TOTAL de la tablette est fausse dès qu'un membre est
// retiré, et une autre colonne « total » peut précéder « Total entreprise ».
let RELEVE_TABLETTE = null;
function afficherSyntheseTablette(releve, caBrut, paie) {
  const membres = releve.lignes.filter(l => !comptaLigneEstTotal(l)).length;
  document.getElementById("compta-tablette-synthese").innerHTML = [
    carteChiffre("CA brut", caBrut == null ? "—" : formaterArgentStats(caBrut), caBrut == null ? "colonne « Total entreprise » introuvable" : "repris dans la déclaration DOT", true),
    carteChiffre("Membres du relevé", String(membres), ""),
    paie && paie.lignes && paie.lignes.length ? carteChiffre("Paie à l’heure", formaterArgentStats(paie.total), "comprise dans les salaires") : "",
  ].join("");
}
document.getElementById("bouton-copier-tablette").addEventListener("click", async e => {
  if (!RELEVE_TABLETTE) return;
  const lignes = [RELEVE_TABLETTE.colonnes, ...RELEVE_TABLETTE.lignes].map(l => l.map(c => String(c ?? "")).join("\t"));
  signalerCopie(e.currentTarget, await copierTexte(lignes.join("\n")), `Relevé copié ✓ (${RELEVE_TABLETTE.lignes.length} lignes, avec les titres)`);
});

async function chargerTablette() {
  gestion.message("zone-message-tablette", "");
  try {
    const reponse = await socle.api("/api/compta/tablettes");
    const vide = document.getElementById("compta-tablette-vide");
    const resultat = document.getElementById("compta-tablette-resultat");
    const boutonReset = document.getElementById("bouton-reinitialiser-tablette");
    if (!reponse.import) {
      vide.classList.remove("cache");
      resultat.classList.add("cache");
      boutonReset.classList.add("cache");
      document.getElementById("bouton-copier-tablette").classList.add("cache");
      afficherPaieHoraire(null);
      return;
    }
    vide.classList.add("cache");
    resultat.classList.remove("cache");
    boutonReset.classList.remove("cache");
    document.getElementById("compta-tablette-info").textContent =
      `Importé par ${reponse.import.importe_par || "un membre"} le ${formaterDateHeureCompta(reponse.import.importe_le)}.`;
    RELEVE_TABLETTE = reponse.import;
    document.getElementById("bouton-copier-tablette").classList.remove("cache");
    afficherSyntheseTablette(reponse.import, reponse.ca_brut, reponse.paie_horaire);
    const table = document.getElementById("table-tablette");
    table.innerHTML = rendreTableCompta(reponse.import.colonnes, reponse.import.lignes, true);
    table.querySelectorAll("[data-index]").forEach((btn) => {
      btn.addEventListener("click", () => supprimerLigneTablette(Number(btn.dataset.index), btn.dataset.nom));
    });
    afficherPaieHoraire(reponse.paie_horaire);
  } catch (e) {
    gestion.message("zone-message-tablette", "Impossible de charger les données : " + e.message);
  }
}

function majApercuImportTablette() {
  const texte = document.getElementById("import-tablette-texte").value;
  const analyse = analyserTexteTablette(texte);
  const zoneApercu = document.getElementById("apercu-import-tablette");
  const bouton = document.getElementById("bouton-enregistrer-import-tablette");
  if (!analyse || !analyse.lignes.length) {
    zoneApercu.classList.add("cache");
    bouton.disabled = true;
    return;
  }
  document.getElementById("table-apercu-import").innerHTML = rendreTableCompta(analyse.colonnes, analyse.lignes);
  zoneApercu.classList.remove("cache");
  bouton.disabled = false;
}

function ouvrirModaleImportTablette() {
  document.getElementById("import-tablette-texte").value = "";
  document.getElementById("apercu-import-tablette").classList.add("cache");
  document.getElementById("bouton-enregistrer-import-tablette").disabled = true;
  gestion.message("zone-message-modale-import", "");
  document.getElementById("modale-import-tablette").classList.remove("cache");
  document.getElementById("import-tablette-texte").focus();
}
function fermerModaleImportTablette() {
  document.getElementById("modale-import-tablette").classList.add("cache");
}

document.getElementById("bouton-importer-tablette").addEventListener("click", ouvrirModaleImportTablette);
document.getElementById("fermer-modale-import-tablette").addEventListener("click", fermerModaleImportTablette);
document.getElementById("bouton-annuler-import-tablette").addEventListener("click", fermerModaleImportTablette);
document.getElementById("import-tablette-texte").addEventListener("input", majApercuImportTablette);

document.getElementById("bouton-enregistrer-import-tablette").addEventListener("click", async () => {
  const analyse = analyserTexteTablette(document.getElementById("import-tablette-texte").value);
  if (!analyse || !analyse.lignes.length) {
    gestion.message("zone-message-modale-import", "Collez d'abord vos données.");
    return;
  }
  const corps = { colonnes: analyse.colonnes, lignes: analyse.lignes };
  // le serveur n'accepte pas de requête de plus de 64 Ko : prévenu ici, avec la taille, plutôt qu'une erreur vague
  const taille = new Blob([JSON.stringify(corps)]).size;
  if (taille > 60000) {
    gestion.message("zone-message-modale-import", `Relevé trop long (${Math.ceil(taille / 1024)} Ko pour 60 Ko au plus) : collez-le en retirant les colonnes inutiles.`);
    return;
  }
  try {
    await socle.api("/api/compta/tablettes", {
      method: "POST",
      body: corps,
    });
    fermerModaleImportTablette();
    chargerTablette();
  } catch (e) {
    gestion.message("zone-message-modale-import", "Impossible d'enregistrer : " + e.message);
  }
});

document.getElementById("bouton-reinitialiser-tablette").addEventListener("click", async () => {
  const ok = await gestion.confirmer(
    "Le tableau affiché dans « Tablettes » sera vidé. Rien n'est perdu : cet ancien relevé reste conservé côté serveur, seul l'affichage redevient vide. Vous pourrez importer un nouveau relevé dès que vous le souhaitez.",
    "Réinitialiser la feuille « Tablettes » ?",
    "Vider l’affichage",
    { danger: false }   // rien n’est effacé côté serveur
  );
  if (!ok) return;
  try {
    await socle.api("/api/compta/tablettes", { method: "DELETE" });
    chargerTablette();
  } catch (e) {
    gestion.message("zone-message-tablette", "Impossible de réinitialiser : " + e.message);
  }
});


gestion.coque('dot').then(() => chargerTablette());
