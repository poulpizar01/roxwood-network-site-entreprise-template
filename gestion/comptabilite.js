/* GESTION — comptabilité (permission « compta ») : relevé Tablettes collé,
   rémunération (salaires par grade, paliers de primes) et préparation de la déclaration DOT hebdomadaire.
   Serveur : server/src/entreprise/routes/compta.ts et routes/stats.ts (rémunération). */

// séparateur de milliers comme formaterPrix (layout.js), sans « HT »
function formaterArgentStats(valeur) {
  const n = Math.round(Number(valeur) || 0);
  return `${n < 0 ? '-' : ''}${Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;
}
function formaterDateAdmin(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? echapper(iso || '') : d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
}
document.querySelectorAll(".compta-sous-onglet").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".compta-sous-onglet").forEach((b) => { b.classList.toggle("actif", b === btn); b.setAttribute("aria-selected", String(b === btn)); });
    const nom = btn.dataset.comptaOnglet;
    document.getElementById("compta-panneau-tablettes").classList.toggle("cache", nom !== "tablettes");
    document.getElementById("compta-panneau-parametres").classList.toggle("cache", nom !== "parametres");
    document.getElementById("compta-panneau-dot").classList.toggle("cache", nom !== "dot");
    if (nom === "dot") chargerDot();
    if (nom === "parametres") chargerRemuneration();
  });
});

// ---------------------------------------------------------------------------
// Comptabilité -> Rémunération : une carte par grade (fixe, primes, taux horaire), les deux barèmes de primes, et un
// simulateur. Enregistré dans remunerations_grades et baremes_primes (routes/stats.ts), les tables que lisent la DOT
// et les primes partout : un changement ici s'applique au prochain calcul.
// Salaire de la semaine = fixe (si activé) + palier ventes (si activé) + palier locations (si activé)
// + heures × taux horaire ; palier = le plus haut seuil atteint (stats/calcul.ts, montantPalier).
// ---------------------------------------------------------------------------

let REMU = { grades: [], baremesVentes: [], baremesLocations: [] };
const montantPalierRemu = (bareme, valeur) => [...bareme].sort((a, b) => a.seuil - b.seuil).reduce((m, p) => (valeur >= p.seuil ? p.montant : m), 0);
const interrupteurRemu = (attributs, actif, libelle, bloque) =>
  `<label class="d8-switch" title="${libelle}"><input type="checkbox" ${attributs} ${actif ? "checked" : ""} ${bloque ? "disabled" : ""} aria-label="${libelle}"><span class="d8-switch-piste"></span></label>`;

async function chargerRemuneration() {
  gestion.message("zone-message-parametres", "");
  try {
    REMU = await socle.api("/api/stats/remuneration");
    rendreGradesRemu();
    rendreBaremeRemu("vente");
    rendreBaremeRemu("location");
    rendreSimulateurRemu();
  } catch (e) {
    document.getElementById("remu-grades").innerHTML = "";
    gestion.message("zone-message-parametres", "Impossible de charger la rémunération : " + e.message);
  }
}

function rendreGradesRemu() {
  document.getElementById("remu-grades").innerHTML = REMU.grades.map(g => {
    const cle = echapper(g.grade), couleur = echapper(g.couleur || "#8a93b8");
    const nom = echapper(g.libelle);
    // grade égal ou supérieur au sien : affiché, jamais modifiable (le serveur le refuse aussi)
    const bloque = g.modifiable === false;
    return `<article class="remu-grade${bloque ? " remu-lecture" : ""}" style="--grade:${couleur}" data-grade="${cle}">
      <h4 class="remu-grade-nom"><span class="pastille-grade" style="background:${couleur}"></span>${nom}</h4>
      ${bloque ? `<p class="remu-lecture-note">Grade égal ou supérieur au vôtre : réglé par un supérieur.</p>` : ""}
      <div class="remu-ligne${g.salaireActif ? "" : " inactive"}">
        ${interrupteurRemu(`data-remu="salaireActif"`, g.salaireActif, `Salaire fixe pour ${nom}`, bloque)}
        <span class="remu-ligne-libelle">Salaire fixe</span>
        <span class="annonce-montant remu-montant"><input type="number" min="0" step="1000" inputmode="numeric" data-remu="salaireFixe" value="${Number(g.salaireFixe) || 0}" ${g.salaireActif && !bloque ? "" : "disabled"} aria-label="Salaire fixe de ${nom}, en dollars par semaine"><span aria-hidden="true">$ / sem.</span></span>
      </div>
      <div class="remu-ligne${g.primeVenteActive ? "" : " inactive"}">
        ${interrupteurRemu(`data-remu="primeVenteActive"`, g.primeVenteActive, `Prime ventes pour ${nom}`, bloque)}
        <span class="remu-ligne-libelle">Prime ventes</span><span class="remu-ligne-note">selon le barème</span>
      </div>
      <div class="remu-ligne${g.primeLocationActive ? "" : " inactive"}">
        ${interrupteurRemu(`data-remu="primeLocationActive"`, g.primeLocationActive, `Prime locations pour ${nom}`, bloque)}
        <span class="remu-ligne-libelle">Prime locations</span><span class="remu-ligne-note">selon le barème</span>
      </div>
      <!-- pas d’interrupteur : 0 $ / h = pas de paie à l’heure ; le champ reste toujours modifiable -->
      <div class="remu-ligne">
        <span class="remu-ligne-vide" aria-hidden="true"></span>
        <span class="remu-ligne-libelle">Paie à l’heure<small class="remu-ligne-aide">0 = aucune</small></span>
        <span class="annonce-montant remu-montant"><input type="number" min="0" step="100" inputmode="numeric" data-remu="tauxHoraire" value="${Number(g.tauxHoraire) || 0}" ${bloque ? "disabled" : ""} aria-label="Taux horaire de ${nom}, en dollars par heure (0 : pas de paie à l’heure)"><span aria-hidden="true">$ / h</span></span>
      </div>
    </article>`;
  }).join("") || `<p class="compta-aide">Aucun grade : créez-les d’abord dans la page Grades.</p>`;
}

// un seul écouteur pour toutes les cartes : un interrupteur ou un montant modifié s'enregistre aussitôt
document.getElementById("remu-grades").addEventListener("change", async e => {
  const champ = e.target.closest("[data-remu]"), carte = e.target.closest("[data-grade]");
  if (!champ || !carte) return;
  const cle = champ.dataset.remu;
  let valeur = champ.type === "checkbox" ? champ.checked : champ.value === "" ? 0 : Number(champ.value);
  if (champ.type !== "checkbox" && (!Number.isFinite(valeur) || valeur < 0)) {
    gestion.notifier("Montant invalide : un nombre positif, sans espace ni « $ ».", "erreur");
    return chargerRemuneration();
  }
  // retour immédiat : la ligne se grise ou se rallume avant même la réponse du serveur
  if (champ.type === "checkbox") {
    champ.closest(".remu-ligne").classList.toggle("inactive", !valeur);
    champ.closest(".remu-ligne").querySelector("input[type=number]")?.toggleAttribute("disabled", !valeur);
  }
  try {
    await socle.api(`/api/stats/remuneration/grades/${encodeURIComponent(carte.dataset.grade)}`, { method: "PATCH", body: { [cle]: valeur } });
    const g = REMU.grades.find(x => x.grade === carte.dataset.grade);
    if (g) g[cle] = valeur;
    gestion.notifier(`${g ? g.libelle : "Grade"} : rémunération enregistrée ✓`);
    rendreBaremeRemu("vente"); rendreBaremeRemu("location"); rendreSimulateurRemu();
  } catch (err) {
    gestion.notifier("Non enregistré : " + err.message, "erreur");
    chargerRemuneration();
  }
});

// ---- barèmes : « Dès 20 ventes → 10 000 $ », modifiables sur place, ajout en dernière ligne ----
function rendreBaremeRemu(type) {
  const bloc = document.querySelector(`.remu-bareme[data-type="${type}"]`);
  bloc.classList.toggle("remu-lecture", REMU.baremesModifiables === false);
  const paliers = [...(type === "vente" ? REMU.baremesVentes : REMU.baremesLocations)].sort((a, b) => a.seuil - b.seuil);
  const unite = type === "vente" ? "ventes" : "locations";
  const actif = type === "vente" ? "primeVenteActive" : "primeLocationActive";
  const utilisateurs = REMU.grades.filter(g => g[actif]).map(g => echapper(g.libelle));
  // paliers communs à tous les grades : modifiables par le grade le plus haut seulement (routes/stats.ts)
  const lecture = REMU.baremesModifiables === false, fige = lecture ? "disabled" : "";
  bloc.innerHTML = `
    <h4 class="remu-bareme-titre">Prime ${type === "vente" ? "ventes" : "locations"}</h4>
    <p class="remu-bareme-grades">${utilisateurs.length ? `Pour : ${utilisateurs.join(", ")}` : "Aucun grade ne la touche pour l’instant."}</p>
    ${lecture ? `<p class="remu-lecture-note">Ces paliers valent pour tous les grades, le vôtre compris : seul le grade le plus haut peut les modifier.</p>` : ""}
    <ol class="remu-paliers">
      ${paliers.map(p => `<li class="remu-palier" data-palier="${p.id}">
        <span class="remu-palier-des">Dès</span>
        <input type="number" min="1" step="1" inputmode="numeric" data-palier-champ="seuil" value="${p.seuil}" ${fige} aria-label="Seuil du palier, en ${unite}">
        <span class="remu-palier-unite">${unite}</span>
        <span class="remu-palier-fleche">${fleche("droite")}</span>
        <span class="annonce-montant remu-montant"><input type="number" min="0" step="1000" inputmode="numeric" data-palier-champ="montant" value="${p.montant}" ${fige} aria-label="Prime de ce palier, en dollars"><span aria-hidden="true">$</span></span>
        ${lecture ? "" : `<button type="button" class="actions-icone actions-icone--danger" data-palier-supprimer="${p.id}" aria-label="Supprimer le palier dès ${p.seuil} ${unite}">${gestion.ico("trash")}</button>`}
      </li>`).join("") || `<li class="remu-palier-vide">Aucun palier : pas de prime ${unite === "ventes" ? "aux ventes" : "aux locations"}.</li>`}
      ${lecture ? "" : `<li class="remu-palier remu-palier-nouveau">
        <span class="remu-palier-des">Dès</span>
        <input type="number" min="1" step="1" inputmode="numeric" data-nouveau="seuil" placeholder="${(paliers.at(-1)?.seuil || 0) + 20}" aria-label="Seuil du nouveau palier, en ${unite}">
        <span class="remu-palier-unite">${unite}</span>
        <span class="remu-palier-fleche">${fleche("droite")}</span>
        <span class="annonce-montant remu-montant"><input type="number" min="0" step="1000" inputmode="numeric" data-nouveau="montant" placeholder="${(paliers.at(-1)?.montant || 0) + 5000}" aria-label="Prime du nouveau palier, en dollars"><span aria-hidden="true">$</span></span>
        <button type="button" class="btn btn-fantome btn-petit" data-palier-ajouter>Ajouter</button>
      </li>`}
    </ol>`;
}

document.querySelectorAll(".remu-bareme").forEach(bloc => {
  const type = bloc.dataset.type;
  bloc.addEventListener("change", async e => {
    const champ = e.target.closest("[data-palier-champ]");
    if (!champ) return;
    const valeur = Number(champ.value);
    const seuil = champ.dataset.palierChamp === "seuil";
    if (champ.value === "" || !Number.isFinite(valeur) || valeur < (seuil ? 1 : 0) || (seuil && !Number.isInteger(valeur))) {
      gestion.notifier(seuil ? "Seuil invalide : un nombre entier, 1 ou plus." : "Montant invalide : un nombre positif.", "erreur");
      return chargerRemuneration();
    }
    try {
      await socle.api(`/api/stats/baremes/${champ.closest("[data-palier]").dataset.palier}`, { method: "PATCH", body: { [champ.dataset.palierChamp]: valeur } });
      gestion.notifier("Barème enregistré ✓");
    } catch (err) { gestion.notifier("Non enregistré : " + err.message, "erreur"); }
    chargerRemuneration();
  });
  bloc.addEventListener("click", async e => {
    const suppr = e.target.closest("[data-palier-supprimer]");
    if (suppr) {
      if (!await gestion.confirmer("Ce palier ne comptera plus dans les primes.", "Supprimer ce palier ?", "Supprimer le palier")) return;
      try { await socle.api(`/api/stats/baremes/${suppr.dataset.palierSupprimer}`, { method: "DELETE" }); gestion.notifier("Palier supprimé ✓"); }
      catch (err) { gestion.notifier("Non supprimé : " + err.message, "erreur"); }
      return chargerRemuneration();
    }
    if (!e.target.closest("[data-palier-ajouter]")) return;
    const seuil = Number(bloc.querySelector('[data-nouveau="seuil"]').value), montant = Number(bloc.querySelector('[data-nouveau="montant"]').value);
    if (!Number.isInteger(seuil) || seuil < 1) { gestion.notifier("Indiquez le nombre à atteindre (entier, 1 ou plus).", "erreur"); return bloc.querySelector('[data-nouveau="seuil"]').focus(); }
    if (bloc.querySelector('[data-nouveau="montant"]').value === "" || !Number.isFinite(montant) || montant < 0) { gestion.notifier("Indiquez le montant de la prime.", "erreur"); return bloc.querySelector('[data-nouveau="montant"]').focus(); }
    try { await socle.api("/api/stats/baremes", { method: "POST", body: { type, seuil, montant } }); gestion.notifier("Palier ajouté ✓"); }
    catch (err) { gestion.notifier("Non ajouté : " + err.message, "erreur"); }
    chargerRemuneration();
  });
  // Entrée dans la ligne d'ajout = « Ajouter »
  bloc.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.closest("[data-nouveau]")) { e.preventDefault(); bloc.querySelector("[data-palier-ajouter]").click(); } });
});

// ---- simulateur : même règle que le serveur, sur les réglages affichés ----
function rendreSimulateurRemu() {
  const select = document.getElementById("simu-grade"), avant = select.value;
  select.innerHTML = REMU.grades.map(g => `<option value="${echapper(g.grade)}">${echapper(g.libelle)}</option>`).join("");
  if (REMU.grades.some(g => g.grade === avant)) select.value = avant;
  else if (REMU.grades.length) select.value = REMU.grades.at(-1).grade;   // le grade le plus bas, le cas le plus courant
  ameliorerSelect(select);
  calculerSimulateurRemu();
}
function calculerSimulateurRemu() {
  const g = REMU.grades.find(x => x.grade === document.getElementById("simu-grade").value);
  const zone = document.getElementById("simu-resultat");
  if (!g) { zone.textContent = ""; return; }
  const n = id => Math.max(0, Number(document.getElementById(id).value) || 0);
  const ventes = n("simu-ventes"), locations = n("simu-locations"), heures = n("simu-heures");
  const lignes = [
    ["Salaire fixe", g.salaireActif ? Number(g.salaireFixe) || 0 : null, g.salaireActif ? "" : "non versé à ce grade"],
    ["Prime ventes", g.primeVenteActive ? montantPalierRemu(REMU.baremesVentes, ventes) : null, g.primeVenteActive ? `${ventes} vente${ventes > 1 ? "s" : ""}` : "non versée à ce grade"],
    ["Prime locations", g.primeLocationActive ? montantPalierRemu(REMU.baremesLocations, locations) : null, g.primeLocationActive ? `${locations} location${locations > 1 ? "s" : ""}` : "non versée à ce grade"],
    ["Paie à l’heure", Number(g.tauxHoraire) > 0 ? Math.round(heures * g.tauxHoraire) : null, Number(g.tauxHoraire) > 0 ? `${heures} h × ${formaterArgentStats(g.tauxHoraire)}` : "pas de taux horaire"],
  ];
  const total = lignes.reduce((t, [, v]) => t + (v || 0), 0);
  zone.innerHTML = `<ul class="remu-simu-detail">${lignes.map(([l, v, note]) => `<li class="${v === null ? "inactive" : ""}"><span>${l}<small>${echapper(note)}</small></span><strong>${v === null ? "—" : formaterArgentStats(v)}</strong></li>`).join("")}</ul>
    <p class="remu-simu-total"><span>${echapper(g.libelle)} toucherait</span><strong>${formaterArgentStats(total)}</strong></p>`;
}
["simu-grade", "simu-ventes", "simu-locations", "simu-heures"].forEach(id => {
  document.getElementById(id).addEventListener("input", calculerSimulateurRemu);
  document.getElementById(id).addEventListener("change", calculerSimulateurRemu);
});

// ---------------------------------------------------------------------------
// Comptabilité -> DOT — la déclaration hebdomadaire versée à la DOT.
// Trois blocs qui se rechargent ensemble à chaque changement de semaine ou
// d'écriture : le résumé chiffré, le journal dépense/retraits (modifiable
// à la main), et le tableau par salarié (calculé, prêt à copier).
// ---------------------------------------------------------------------------

let CACHE_ECRITURES_DOT = [];

async function chargerDot() {
  const select = document.getElementById("select-semaine-dot");
  if (!select.dataset.rempli) {
    try {
      const reponse = await socle.api("/api/compta/semaines");
      select.innerHTML = (reponse.semaines || []).map((s) => `<option value="${s.code}">${s.code}</option>`).join("");
      select.dataset.rempli = "1";
      // Sans ça, ce menu déroulant garde le rendu natif du navigateur (fond
      // blanc, police système) qui détonne sur le thème sombre du site — voir
      // ameliorerSelect dans layout.js, déjà utilisé pour les autres menus.
      ameliorerSelect(select);
    } catch (e) { /* la liste des semaines n'a pas pu charger — le résumé s'affichera quand même sans les primes */ }
  }
  await Promise.all([chargerDotResume(), chargerDotEcritures(), chargerDotSalaries()]);
}

document.getElementById("select-semaine-dot").addEventListener("change", () => {
  chargerDotResume();
  chargerDotSalaries();
});

// Résultat d'une copie : notification en bas de l'écran (la zone de message en haut de l'onglet était hors de vue quand
// on copiait en bas) ; le bouton garde son libellé et sa taille.
function signalerCopie(_bouton, reussie, texte) {
  if (!reussie) { gestion.notifier("Copie impossible : sélectionnez le tableau à la main puis Ctrl+C.", "erreur"); return; }
  gestion.notifier(texte);
}

// Une carte de chiffre clé : libellé, montant, précision ; « accent » pour celui qui compte le plus.
const carteChiffre = (libelle, valeur, precision, accent) => `<div class="compta-chiffre${accent ? " accent" : ""}">
  <span class="compta-chiffre-libelle">${libelle}</span><strong>${valeur}</strong>${precision ? `<small>${precision}</small>` : ""}</div>`;

async function chargerDotResume() {
  gestion.message("zone-message-dot", "");
  const semaine = document.getElementById("select-semaine-dot").value;
  try {
    const r = await socle.api("/api/compta/dot/resume" + (semaine ? `?semaine=${encodeURIComponent(semaine)}` : ""));
    document.getElementById("dot-resume-vide").classList.toggle("cache", r.montantTotalPrimes != null);
    const val = (v) => (v == null ? "—" : formaterArgentStats(v));
    // Le CA Brut reflète toujours le dernier relevé Tablettes importé, quel
    // qu'il soit — pas d'avertissement sur son contenu, la Direction gère
    // elle-même ce qu'elle importe.
    const taux = r.tauxImposition == null ? "" : `${Math.round(r.tauxImposition * 100)} %`;
    document.getElementById("dot-chiffres").innerHTML = [
      carteChiffre("Impôts à déclarer", val(r.montantImpots), taux ? `taux de la tranche : ${taux}` : "aucun barème pour ce bénéfice"),
      carteChiffre("Bénéfice net", val(r.beneficeNet), "après impôts et retraits", true),
      carteChiffre("Salaires de la semaine", val(r.montantTotalPrimes), r.beneficeApresPrimes == null ? "choisissez une semaine avec des ventes" : `reste ${val(r.beneficeApresPrimes)} après impôts et salaires`),
    ].join("");
    // le calcul tel que le fait le serveur : CA − dépenses = imposable ; − impôts ; − retraits = net (les salaires sont à part)
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

// « Réinitialiser » un des deux tableaux (dépenses OU retraits) : supprime
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

// « Copier le tableau » (dépenses ou retraits) : même principe que pour le
// tableau des salariés — copie au format tableur (colonnes séparées par des
// tabulations), prêt à coller dans Excel/Google Sheets.
async function copierEcrituresDot(type, idCorps, bouton) {
  const entetes = ["Date", "Justificatif", "Montant"];
  const lignes = [entetes.join("\t")];
  document.querySelectorAll(`#${idCorps} tr`).forEach((tr) => {
    const cellules = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim());
    // montant copié comme un vrai nombre (« 1 200 $ » -> 1200) pour que le tableur puisse calculer dessus
    if (cellules.length === 4) lignes.push([cellules[0], cellules[1], cellules[2].replace(/[^\d-]/g, "")].join("\t"));
  });
  const n = lignes.length - 1;
  signalerCopie(bouton, await copierTexte(lignes.join("\n")), `${type === "depense" ? "Dépenses copiées" : "Retraits copiés"} ✓ (${n} ligne${n > 1 ? "s" : ""}, avec les titres)`);
}
document.getElementById("bouton-copier-depenses").addEventListener("click", e => copierEcrituresDot("depense", "corps-table-dot-depenses", e.currentTarget));
document.getElementById("bouton-copier-retraits").addEventListener("click", e => copierEcrituresDot("retrait", "corps-table-dot-retraits", e.currentTarget));

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

// Tableau par salarié : la liste des salariés (et Salaire/Prime) vient
// toujours de Statistiques, mais RUN/FACTURE/VENTE viennent maintenant du
// même relevé Tablettes que le CA Brut plus haut (retrouvés par nom) — pour
// rester cohérent avec une seule et même source. Si un salarié n'apparaît
// pas dans le relevé Tablettes, ces trois colonnes restent à 0$.
async function chargerDotSalaries() {
  const semaine = document.getElementById("select-semaine-dot").value;
  const corps = document.getElementById("corps-table-dot-salaries");
  gestion.message("dot-primes-avertissement", "");
  if (!semaine) { DOT_SALARIES = []; corps.innerHTML = `<tr><td colspan="8" class="champ-aide">Choisissez une semaine.</td></tr>`; return; }
  try {
    const r = await socle.api(`/api/compta/dot/salaries?semaine=${encodeURIComponent(semaine)}`);
    const agents = r.agents || [];
    DOT_SALARIES = agents;
    // semaine passée sans archive du tableur : primes lues dans le tableur actuel (routes/compta.ts, salariesDot)
    gestion.message("dot-primes-avertissement", r.avertissementPrimes || "");
    corps.innerHTML = agents.length
      ? agents.map((a) => `<tr>
            <td>${echapper(a.identiteRp || a.identite)}${a.horsReferentiel ? ' <span class="champ-aide" title="Présent dans le relevé Tablettes, sans fiche dans le référentiel des employés (onglet Ressources humaines)">*</span>' : ""}</td>
            <td>${echapper(a.grade)}</td>
            <td>${formaterArgentStats(a.run)}</td>
            <td>${formaterArgentStats(a.facture)}</td>
            <td>${formaterArgentStats(a.vente)}</td>
            <td><strong>${formaterArgentStats(a.caTotalRealise)}</strong></td>
            <td><strong>${formaterArgentStats(a.salaireTotal)}</strong></td>
            <td>${formaterArgentStats(0)}</td>
          </tr>`).join("")
      : `<tr><td colspan="8" class="champ-aide">Aucune vente/location cette semaine-là.</td></tr>`;
  } catch (e) {
    corps.innerHTML = `<tr><td colspan="8" class="champ-aide">Le tableau des salariés n’a pas pu se charger (${echapper(e.message)}). Changez de semaine ou rechargez la page.</td></tr>`;
  }
}

// « Copier le tableau » : copie au format tableur (colonnes séparées par des
// tabulations) — se colle proprement dans Excel/Google Sheets :
//   - les montants sont copiés comme de VRAIS nombres (pas « 74 970 $ » en
//     texte), pour que le document puisse calculer dessus ;
//   - la colonne CA TOTAL REALISE est copiée sous forme de FORMULE (=RUN+FACTURE
//     +VENTE, même colonnes que le document DOT : C, D, E) et non comme un
//     chiffre figé, comme dans le document original. Le numéro de la première
//     ligne où l'on colle se règle à côté du bouton (2 par défaut = juste sous
//     les titres).
let DOT_SALARIES = []; // dernier tableau chargé (données brutes, pas le HTML)
function formuleCaTotal(numeroLigne) {
  return `=C${numeroLigne}+D${numeroLigne}+E${numeroLigne}`;
}
document.getElementById("bouton-copier-salaries").addEventListener("click", async e => {
  const bouton = e.currentTarget;
  if (!DOT_SALARIES.length) {
    gestion.notifier("Rien à copier : choisissez une semaine avec des salariés.", "erreur");
    return;
  }
  const champLigne = document.getElementById("dot-copie-premiere-ligne");
  let premiereLigne = champLigne ? parseInt(champLigne.value, 10) : 2;
  if (!Number.isInteger(premiereLigne) || premiereLigne < 1) premiereLigne = 2;
  const nombre = (v) => String(Math.round(Number(v) || 0));
  const lignes = DOT_SALARIES.map((a, i) => [
    a.identiteRp || a.identite,
    a.grade,
    nombre(a.run),
    nombre(a.facture),
    nombre(a.vente),
    formuleCaTotal(premiereLigne + i),
    nombre(a.salaireTotal),
    "0",
  ].join("\t"));
  signalerCopie(bouton, await copierTexte(lignes.join("\n")), `${lignes.length} salariés copiés ✓ Collez en ligne ${premiereLigne}, colonne A, du document DOT.`);
});

// Découpe un texte collé en colonnes + lignes. On essaie d'abord les
// tabulations (\t) : c'est ce que produit un copier-coller de cellules
// depuis Excel / Google Sheets, y compris les cellules vides — c'est donc la
// méthode la plus fiable. À défaut, on se rabat sur des blocs d'au moins 2
// espaces comme séparateur (utile pour un texte tapé ou copié depuis
// Discord), sachant que dans ce cas une cellule vide au milieu d'une ligne
// (ex : « Rang » sur une ligne TOTAL) ne peut pas être détectée automatiquement
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
  const premier = (cellules[0] || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
  const ok = await gestion.confirmer(`« ${nom} » sera retiré du relevé Tablettes. Les totaux (CA brut, DOT) seront recalculés sans cette ligne.`, "Retirer ce membre du relevé ?", "Retirer du relevé");
  if (!ok) return;
  try {
    await socle.api(`/api/compta/tablettes/lignes/${index}`, { method: "DELETE", body: { nom } });
    gestion.message("zone-message-tablette", `« ${nom} » retiré du relevé ✓`, "succes");
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
    ? `Heures lues dans la colonne « ${p.colonneHeures} » du relevé, payées au taux horaire du grade (Rémunération), en plus des paliers. Incluses dans le salaire de la DOT.`
    : "Le relevé n'a pas de colonne « Heures de service » : impossible de calculer la paie à l'heure.";
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

// Chiffres clés du relevé : le total « entreprise » (CA brut de la DOT), le nombre de membres, la paie à l'heure.
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
    "Le tableau affiché dans « Tablettes » sera vidé. Rien n'est perdu : cet ancien relevé reste conservé côté serveur, seul l'affichage redevient vide. Vous pourrez importer un nouveau relevé dès que vous le souhaitez.",
    "Réinitialiser la feuille « Tablettes » ?",
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
