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
// Comptabilité -> DOT — la déclaration hebdomadaire versée à la DOT.
// Deux blocs qui se rechargent ensemble à chaque écriture : le résumé chiffré, et le journal dépense/retraits
// (modifiable à la main).
// ---------------------------------------------------------------------------

let CACHE_ECRITURES_DOT = [];

async function chargerDot() {
  await Promise.all([chargerDotResume(), chargerDotEcritures(), chargerDotBareme(), chargerDotSalaries()]);
}

// barème d'imposition (lecture seule) : chargé une fois, il ne change jamais pendant que la page est ouverte
let BAREME_DOT_CHARGE = false;
async function chargerDotBareme() {
  if (BAREME_DOT_CHARGE) return;
  try {
    const r = await socle.api("/api/compta/dot/bareme");
    document.getElementById("corps-table-dot-bareme").innerHTML = (r.tranches || []).map(t => `
      <tr>
        <td>${formaterArgentStats(t.seuilMin)} – ${formaterArgentStats(t.seuilMax)}</td>
        <td>${Math.round(t.taux * 100)} %</td>
        <td>${formaterArgentStats(t.salaireMaxEmploye)}</td>
        <td>${formaterArgentStats(t.salaireMaxPatron)}</td>
        <td>${formaterArgentStats(t.primeMaxEmploye)}</td>
        <td>${formaterArgentStats(t.primeMaxPatron)}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="champ-aide">Aucun barème réglé.</td></tr>`;
    BAREME_DOT_CHARGE = true;
  } catch (e) {
    gestion.message("zone-message-dot", "Impossible de charger le barème : " + e.message);
  }
}

// Résultat d'une copie : notification en bas de l'écran (la zone de message en haut de l'onglet était hors de vue quand
// on copiait en bas) ; le bouton garde son libellé et sa taille.
function signalerCopie(_bouton, reussie, texte) {
  if (!reussie) { gestion.notifier("Copie impossible : sélectionnez le tableau à la main puis Ctrl+C.", "erreur"); return; }
  gestion.notifier(texte);
}

// nombre d'unités (RUN), sans « $ » : séparateur de milliers seulement, à ne pas confondre avec les colonnes en $
function formaterNombreStats(valeur) {
  return Math.round(Number(valeur) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Tableau des salariés (routes/compta.ts, salariesDot) : Nom et Grade viennent de RH, RUN/FACTURE des quotas réels de
// la semaine (Paie/Quota), VENTE et CA TOTAL RÉALISÉ du relevé Tablettes, Salaire du calcul de la page Paie — la
// Prime reste à 0 $, saisie à la main dans le document de la DOT.
let DOT_SALARIES = [];
async function chargerDotSalaries() {
  const corps = document.getElementById("corps-table-dot-salaries");
  try {
    const r = await socle.api("/api/compta/dot/salaries");
    DOT_SALARIES = r.agents || [];
    corps.innerHTML = DOT_SALARIES.length
      ? DOT_SALARIES.map(a => `<tr>
            <td>${echapper(a.nom)}</td>
            <td>${echapper(a.grade)}</td>
            <td>${formaterNombreStats(a.run)}</td>
            <td>${formaterArgentStats(a.facture)}</td>
            <td>${formaterArgentStats(a.vente)}</td>
            <td><strong>${formaterArgentStats(a.caTotalRealise)}</strong></td>
            <td><strong>${formaterArgentStats(a.salaireTotal)}</strong></td>
            <td>${formaterArgentStats(0)}</td>
          </tr>`).join("")
      : `<tr><td colspan="8" class="champ-aide">Aucun employé actif pour le moment.</td></tr>`;
  } catch (e) {
    corps.innerHTML = `<tr><td colspan="8" class="champ-aide">Le tableau des salariés n’a pas pu se charger (${echapper(e.message)}). Rechargez la page.</td></tr>`;
  }
}

// « Copier le tableau » : colonnes séparées par des tabulations (Excel/Google Sheets), montants copiés comme de vrais
// nombres — RUN en unités, les autres colonnes en $. Le numéro de la première ligne où l'on colle se règle à côté du
// bouton (2 par défaut = juste sous les titres du document).
document.getElementById("bouton-copier-salaries").addEventListener("click", async e => {
  const bouton = e.currentTarget;
  if (!DOT_SALARIES.length) {
    gestion.notifier("Rien à copier : aucun salarié à déclarer.", "erreur");
    return;
  }
  const nombre = v => String(Math.round(Number(v) || 0));
  const lignes = DOT_SALARIES.map(a => [a.nom, a.grade, nombre(a.run), nombre(a.facture), nombre(a.vente), nombre(a.caTotalRealise), nombre(a.salaireTotal), "0"].join("\t"));
  signalerCopie(bouton, await copierTexte(lignes.join("\n")), `${lignes.length} salarié${lignes.length > 1 ? "s" : ""} copié${lignes.length > 1 ? "s" : ""} ✓ Collez en ligne ${document.getElementById("dot-copie-premiere-ligne").value || 2}, colonne A, du document DOT.`);
});

// Une carte de chiffre clé : libellé, montant, précision ; « accent » pour celui qui compte le plus.
const carteChiffre = (libelle, valeur, precision, accent) => `<div class="compta-chiffre${accent ? " accent" : ""}">
  <span class="compta-chiffre-libelle">${libelle}</span><strong>${valeur}</strong>${precision ? `<small>${precision}</small>` : ""}</div>`;

async function chargerDotResume() {
  gestion.message("zone-message-dot", "");
  try {
    const r = await socle.api("/api/compta/dot/resume");
    const val = (v) => (v == null ? "—" : formaterArgentStats(v));
    // Le CA Brut reflète toujours le dernier relevé Tablettes importé, quel
    // qu'il soit — pas d'avertissement sur son contenu, la Direction gère
    // elle-même ce qu'elle importe.
    const taux = r.tauxImposition == null ? "" : `${Math.round(r.tauxImposition * 100)} %`;
    document.getElementById("dot-chiffres").innerHTML = [
      carteChiffre("Impôts à déclarer", val(r.montantImpots), taux ? `taux de la tranche : ${taux}` : "aucun barème pour ce bénéfice"),
      carteChiffre("Bénéfice net", val(r.beneficeNet), "après impôts et retraits", true),
    ].join("");
    // le calcul tel que le fait le serveur : CA − dépenses = imposable ; − impôts ; − retraits = net
    const etape = (signe, libelle, valeur, classe = "") => `<li class="${classe}"><span class="dot-signe" aria-hidden="true">${signe}</span><span>${libelle}</span><strong>${valeur}</strong></li>`;
    document.getElementById("dot-calcul").innerHTML = [
      etape("", "CA brut" + (r.caBrutTrouve ? " <small>(total du relevé Tablettes)</small>" : " <small>(aucun relevé importé)</small>"), val(r.caBrut)),
      etape("−", "Dépenses déductibles", val(r.depenseDeductible)),
      etape("=", "Bénéfice imposable", val(r.beneficeImposable), "sous-total"),
      etape("−", `Impôts${taux ? ` (${taux})` : ""}`, val(r.montantImpots)),
      etape("=", "Bénéfice après impôts", val(r.beneficeApresImpots), "sous-total"),
      etape("−", "Retraits", val(r.retraits)),
      etape("=", "Bénéfice net", val(r.beneficeNet), "total"),
    ].join("");
    document.getElementById("dot-plafonds").innerHTML = r.plafonds
      ? `Plafonds de cette tranche : salaire ${formaterArgentStats(r.plafonds.salaireMaxEmploye)} (employé), ${formaterArgentStats(r.plafonds.salaireMaxPatron)} (patron) ; prime ${formaterArgentStats(r.plafonds.primeMaxEmploye)} (employé), ${formaterArgentStats(r.plafonds.primeMaxPatron)} (patron).`
      : "";
  } catch (e) {
    gestion.message("zone-message-dot", "Impossible de charger le résumé DOT : " + e.message);
  }
}

async function chargerDotEcritures() {
  try {
    const r = await socle.api("/api/compta/dot/ecritures");
    CACHE_ECRITURES_DOT = r.ecritures || [];
    const rendre = (type, idCorps) => {
      const lignes = CACHE_ECRITURES_DOT.filter((e) => e.type === type);
      document.getElementById(idCorps).innerHTML = lignes.length
        ? lignes.map((e) => `
          <tr>
            <td>${echapper(e.date_ecriture) || "—"}</td>
            <td>${echapper(e.justificatif)}</td>
            <td>${formaterArgentStats(e.montant)}</td>
            <td><button type="button" class="actions-icone actions-icone--danger" data-ecriture-supprimer="${e.id}" title="Supprimer" aria-label="Supprimer cette écriture">${gestion.ico('trash')}</button></td>
          </tr>`).join("")
        : `<tr><td colspan="4" class="champ-aide">Aucune ligne pour le moment.</td></tr>`;
    };
    rendre("depense", "corps-table-dot-depenses");
    rendre("retrait", "corps-table-dot-retraits");
    const total = type => CACHE_ECRITURES_DOT.filter(e => e.type === type).reduce((t, e) => t + Number(e.montant || 0), 0);
    document.getElementById("dot-total-depenses").textContent = formaterArgentStats(total("depense"));
    document.getElementById("dot-total-retraits").textContent = formaterArgentStats(total("retrait"));
    document.querySelectorAll("[data-ecriture-supprimer]").forEach((btn) => {
      btn.addEventListener("click", () => supprimerEcritureDot(Number(btn.dataset.ecritureSupprimer)));
    });
  } catch (e) {
    gestion.message("zone-message-dot", "Impossible de charger les écritures : " + e.message);
  }
}

async function supprimerEcritureDot(id) {
  const ok = await gestion.confirmer("Cette ligne sera retirée du calcul du bénéfice imposable.", "Supprimer cette écriture ?", "Supprimer l’écriture");
  if (!ok) return;
  try {
    await socle.api(`/api/compta/dot/ecritures/${id}`, { method: "DELETE" });
    await Promise.all([chargerDotEcritures(), chargerDotResume()]);
  } catch (e) {
    gestion.message("zone-message-dot", e.message);
  }
}

// « Réinitialiser » un des deux tableaux (dépenses OU retraits) : supprime
// toutes ses lignes d'un coup (l'autre tableau n'est jamais touché), comme
// le bouton équivalent de l'onglet Tablettes.
async function reinitialiserEcrituresDot(type) {
  const libelle = type === "depense" ? "des dépenses déductibles" : "des retraits";
  const ok = await gestion.confirmer(`Toutes les lignes ${libelle} seront supprimées. Cette action est irréversible.`, "Réinitialiser ce tableau ?", "Tout supprimer");
  if (!ok) return;
  try {
    await socle.api(`/api/compta/dot/ecritures?type=${type}`, { method: "DELETE" });
    await Promise.all([chargerDotEcritures(), chargerDotResume()]);
  } catch (e) {
    gestion.message("zone-message-dot", e.message);
  }
}
document.getElementById("bouton-reinitialiser-depenses").addEventListener("click", () => reinitialiserEcrituresDot("depense"));
document.getElementById("bouton-reinitialiser-retraits").addEventListener("click", () => reinitialiserEcrituresDot("retrait"));

// « Copier le tableau » (dépenses ou retraits) : même principe que les autres
// tableaux copiables — copie au format tableur (colonnes séparées par des
// tabulations), prêt à coller dans Excel/Google Sheets. Sans les titres des colonnes.
async function copierEcrituresDot(type, idCorps, bouton) {
  const lignes = [];
  document.querySelectorAll(`#${idCorps} tr`).forEach((tr) => {
    const cellules = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim());
    // montant copié comme un vrai nombre (« 1 200 $ » -> 1200) pour que le tableur puisse calculer dessus
    if (cellules.length === 4) lignes.push([cellules[0], cellules[1], cellules[2].replace(/[^\d-]/g, "")].join("\t"));
  });
  const n = lignes.length;
  signalerCopie(bouton, await copierTexte(lignes.join("\n")), `${type === "depense" ? "Dépenses copiées" : "Retraits copiés"} ✓ (${n} ligne${n > 1 ? "s" : ""})`);
}
document.getElementById("bouton-copier-depenses").addEventListener("click", e => copierEcrituresDot("depense", "corps-table-dot-depenses", e.currentTarget));
document.getElementById("bouton-copier-retraits").addEventListener("click", e => copierEcrituresDot("retrait", "corps-table-dot-retraits", e.currentTarget));

// champ texte brut (pas de date JJ/MM/AAAA réécrite en ISO comme champDateFr : la valeur saisie est gardée telle
// quelle, server/src/entreprise/routes/compta.ts) : le calendrier aide la saisie sans changer ce comportement.
ajouterSelecteurDate(document.getElementById("ecriture-dot-date"));

function ouvrirModaleEcritureDot(type) {
  document.getElementById("ecriture-dot-type").value = type;
  document.getElementById("titre-modale-ecriture-dot").textContent = type === "depense" ? "Nouvelle dépense déductible" : "Nouveau retrait";
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
document.getElementById("bouton-nouvelle-depense").addEventListener("click", () => ouvrirModaleEcritureDot("depense"));
document.getElementById("bouton-nouveau-retrait").addEventListener("click", () => ouvrirModaleEcritureDot("retrait"));
document.getElementById("fermer-modale-ecriture-dot").addEventListener("click", fermerModaleEcritureDot);
document.getElementById("modale-ecriture-dot").addEventListener("click", (ev) => { if (ev.target.id === "modale-ecriture-dot") fermerModaleEcritureDot(); });

document.getElementById("formulaire-ecriture-dot").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  gestion.message("zone-message-modale-ecriture-dot", "");
  const type = document.getElementById("ecriture-dot-type").value;
  const date = document.getElementById("ecriture-dot-date").value.trim();
  const justificatif = document.getElementById("ecriture-dot-justificatif").value.trim();
  const montant = document.getElementById("ecriture-dot-montant").value;
  try {
    await socle.api("/api/compta/dot/ecritures", { method: "POST", body: { type, date, justificatif, montant } });
    fermerModaleEcritureDot();
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
    .join("")}${avecSuppression ? '<th class="compta-col-actions" aria-label="Actions"></th>' : ""}</tr></thead>`;
  const tbody = `<tbody>${lignes
    .map((ligne, index) => {
      const total = comptaLigneEstTotal(ligne);
      const cellules = colonnes
        .map((_, i) => `<td${numerique[i] ? ' style="text-align:right;"' : ""}>${echapper(ligne[i] || "")}</td>`)
        .join("");
      const action = avecSuppression
        ? `<td class="compta-col-actions">${total ? "" : `<button type="button" class="actions-icone actions-icone--danger compta-supprimer-ligne" data-index="${index}" data-nom="${echapper(ligne[0] || "")}" title="Retirer ${echapper(ligne[0] || "cette ligne")} du relevé" aria-label="Retirer ${echapper(ligne[0] || "cette ligne")} du relevé">✕</button>`}</td>`
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
    table.querySelectorAll(".compta-supprimer-ligne").forEach((btn) => {
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


gestion.coque('comptabilite').then(() => chargerTablette());
