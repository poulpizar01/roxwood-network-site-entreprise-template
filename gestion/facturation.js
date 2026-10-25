/* GESTION — Factures (permission « factures ») : toutes les factures (reçues du bot ou saisies à la main), quelle
   que soit leur provenance, avec le détail d'origine et un aperçu à l'écran, prêt à être capturé. Serveur :
   server/src/entreprise/routes/compta.ts (/api/compta/factures). */

// séparateur de milliers comme formaterPrix (layout.js), sans « HT »
function formaterArgentStats(valeur) {
  const n = Math.round(Number(valeur) || 0);
  return `${n < 0 ? '-' : ''}${Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;
}
function formaterDateAdmin(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? echapper(iso || '') : d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
}
// AAAA-MM-JJ -> jj/mm/aaaa (même correspondance que champDateFr, gestion.js)
function formaterJourFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

// ---- tri des colonnes du tableau des factures ----
const TRI_FACTURES = gestion.creerTri({
  date: (a, b) => new Date(a.dateFacture) - new Date(b.dateFacture),
  source: (a, b) => labelSourceFacture(a.source).localeCompare(labelSourceFacture(b.source), "fr", { sensitivity: "base" }),
  client: (a, b) => (a.clientNom || "").localeCompare(b.clientNom || "", "fr", { sensitivity: "base" }),
  numero: (a, b) => (a.numeroFacture || "").localeCompare(b.numeroFacture || "", "fr", { numeric: true }),
  total: (a, b) => a.total - b.total,
  statut: (a, b) => a.statutPaiement.localeCompare(b.statutPaiement, "fr", { sensitivity: "base" }),
}, { cle: "date", sens: -1 });
function majEnteteFactures() {
  document.getElementById("factures-entete").innerHTML = `<th>${TRI_FACTURES.bouton("date", "Date")}</th><th>${TRI_FACTURES.bouton("source", "Provenance")}</th>
    <th data-titre>${TRI_FACTURES.bouton("client", "Client")}</th><th>${TRI_FACTURES.bouton("numero", "N°")}</th>
    <th style="text-align:right;">${TRI_FACTURES.bouton("total", "Total")}</th><th>${TRI_FACTURES.bouton("statut", "Statut")}</th><th class="col-actions" aria-label="Actions"></th>`;
}
document.getElementById("table-factures").addEventListener("click", e => {
  const bouton = e.target.closest("[data-tri]");
  if (!bouton) return;
  TRI_FACTURES.cycler(bouton.dataset.tri);
  afficherFactures();
  majEnteteFactures();
  document.querySelector(`#factures-entete [data-tri="${TRI_FACTURES.etat?.cle ?? bouton.dataset.tri}"]`)?.focus();
});
majEnteteFactures();

// Résultat d'une copie : notification en bas de l'écran.
function signalerCopie(_bouton, reussie, texte) {
  if (!reussie) { gestion.notifier("Copie impossible : sélectionnez le tableau à la main puis Ctrl+C.", "erreur"); return; }
  gestion.notifier(texte);
}

// Une carte de chiffre clé : libellé, montant, précision ; « accent » pour celui qui compte le plus.
const carteChiffre = (libelle, valeur, precision, accent) => `<div class="compta-chiffre${accent ? " accent" : ""}">
  <span class="compta-chiffre-libelle">${libelle}</span><strong>${valeur}</strong>${precision ? `<small>${precision}</small>` : ""}</div>`;

// ---------------------------------------------------------------------------
// Factures — consultation (toutes provenances, détail de la source), saisie manuelle, téléchargement.
// Serveur : /api/compta/factures.
// ---------------------------------------------------------------------------

let FACTURE_COURANTE = null;
let FACTURES_TOUTES = null;   // chargées une fois ; provenance, statut, recherche et semaine filtrent ensuite côté client (instantané)
let FACTURES_SOURCE = "";
let FACTURES_STATUT = "";

// ---- semaine affichée : même recette que Run (pilule, flèches, raccourci clavier T, lundi AAAA-MM-JJ calendrier
// Paris), à une différence près : navigation libre dans les deux sens (une facture peut être antérieure, ou son
// échéance postérieure à aujourd'hui) — pas de blocage vers le futur comme classementRuns le fait côté serveur. ----
const jourParisISOFacture = d => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
function lundiDeFacture(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function decalerSemaineFacture(iso, sens) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * sens);
  return d.toISOString().slice(0, 10);
}
const FACTURES_SEMAINE_COURANTE = lundiDeFacture(jourParisISOFacture(new Date()));
let FACTURES_SEMAINE = FACTURES_SEMAINE_COURANTE;

function majNavSemaineFactures() {
  const courante = FACTURES_SEMAINE === FACTURES_SEMAINE_COURANTE;
  const debut = new Date(`${FACTURES_SEMAINE}T00:00:00Z`);
  const fin = new Date(debut); fin.setUTCDate(fin.getUTCDate() + 6);
  const options = { day: "numeric", month: "short", timeZone: "UTC" };
  const bouton = document.getElementById("factures-semaine-aujourdhui");
  bouton.textContent = courante ? "Cette semaine" : `Sem. du ${debut.toLocaleDateString("fr-FR", options)}`;
  bouton.classList.toggle("sur-semaine-courante", courante);
  bouton.setAttribute("aria-label", courante ? "Cette semaine" : `${bouton.textContent} : revenir à cette semaine`);
  bouton.title = courante ? "Raccourci : touche T" : "Revenir à cette semaine (touche T)";
}
function allerSemaineFacture(iso) {
  FACTURES_SEMAINE = iso;
  majNavSemaineFactures();
  afficherFactures();
}
document.getElementById("factures-semaine-aujourdhui").addEventListener("click", () => allerSemaineFacture(FACTURES_SEMAINE_COURANTE));
document.getElementById("factures-semaine-precedente").addEventListener("click", () => allerSemaineFacture(decalerSemaineFacture(FACTURES_SEMAINE, -1)));
document.getElementById("factures-semaine-suivante").addEventListener("click", () => allerSemaineFacture(decalerSemaineFacture(FACTURES_SEMAINE, 1)));
// raccourci clavier « T » (même logique que Run et l'agenda) : revient à la semaine en cours, sauf champ de saisie ou fenêtre ouverte
document.addEventListener("keydown", e => {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1 || e.key.toLowerCase() !== "t") return;
  if (e.target.closest?.("input, textarea, select, [contenteditable]") || document.querySelector(".modale-fond:not(.cache), [role=alertdialog]")) return;
  const bouton = document.getElementById("factures-semaine-aujourdhui");
  bouton.click();
  bouton.classList.remove("raccourci");
  void bouton.offsetWidth;
  bouton.classList.add("raccourci");
});
majNavSemaineFactures();

function labelSourceFacture(s) {
  return s === "order" ? "Commande Discord" : s === "monitoring" ? "Facture en jeu" : s === "manuel" ? "Saisie manuelle" : s;
}
// statut de paiement : correspondance exacte, confirmée côté bot (enum PaymentStatus, prisma/schema.prisma du bot —
// UNPAID/PAID, fermé, toute nouvelle valeur exigerait une migration du bot) + les codes de la saisie manuelle.
// Une valeur hors de cette liste (bot modifié sans mise à jour ici) s'affiche telle quelle plutôt que d'être mal classée.
const STATUTS_PAIEMENT = {
  UNPAID: ["Non payée", "puce-off"], PAID: ["Payée", "puce-ok"],
  PAYEE: ["Payée", "puce-ok"], EN_ATTENTE: ["En attente", "puce-or"], ANNULEE: ["Annulée", "puce-off"],
};
function badgeStatutFacture(statut) {
  if (!statut) return "—";
  const [libelle, classe] = STATUTS_PAIEMENT[statut] || [statut, ""];
  return `<span class="puce ${classe}">${echapper(libelle)}</span>`;
}
// même badge, mais pour l'aperçu de facture (rendreDocumentFacture) : le point de .puce vient d'un ::before sur un
// conteneur inline-flex, qu'html2canvas (copie en image) place au-dessus du texte au lieu de devant — repris ici en
// éléments réels (span) dans un conteneur inline simple, sans flex, pour copier à l'identique de l'affichage.
function badgeStatutDoc(statut) {
  if (!statut) return "—";
  const [libelle, classe] = STATUTS_PAIEMENT[statut] || [statut, ""];
  // le point en caractère (•), dans le même texte que le libellé, pas un élément séparé positionné à côté : un
  // positionnement en pixels (essayé avant) se décale selon l'échelle d'affichage (devicePixelRatio) une fois
  // rendu par html2canvas — un seul passage de texte, par nature, suit la même échelle que lui-même.
  return `<span class="facture-doc-statut ${classe}">• ${echapper(libelle)}</span>`;
}
// catégorie générique d'un statut (paye/attente/annulee), pour filtrer ensemble les valeurs du bot et celles de la
// saisie manuelle — un statut hors de la liste n'entre dans aucune catégorie (ne répond à aucun filtre)
// (correspondance explicite, pas d'après la couleur du badge : « Non payée » du bot est rouge mais reste à encaisser)
const CATEGORIES_STATUT = { PAID: "paye", PAYEE: "paye", UNPAID: "attente", EN_ATTENTE: "attente", ANNULEE: "annulee" };
function categorieStatutFacture(statut) {
  return Object.prototype.hasOwnProperty.call(CATEGORIES_STATUT, statut) ? CATEGORIES_STATUT[statut] : "";
}

async function chargerFactures() {
  gestion.message("zone-message-factures", "");
  try {
    FACTURES_TOUTES = (await socle.api("/api/compta/factures")).factures;
    afficherFactures();
  } catch (e) {
    gestion.message("zone-message-factures", "Impossible de charger les factures : " + e.message);
  }
}

// filtre statut : même pastille de couleur que la puce affichée dans le tableau (categorieStatutFacture -> puce-*),
// pour reconnaître d'un coup d'œil ce que chaque option du menu va montrer
const LIBELLES_STATUT_FILTRE = { "": "Tous les statuts", attente: "En attente", paye: "Payée", annulee: "Annulée" };
const COULEURS_STATUT_FILTRE = { "": "var(--text-faint)", attente: "var(--accent-dark)", paye: "var(--ok)", annulee: "var(--erreur)" };
// filtre provenance : même geste que le statut (select, pas des pilules — design-critique du 2026-10-21, trop de
// place prise pour un seul choix actif à la fois)
const LIBELLES_SOURCE_FILTRE = { "": "Toutes les provenances", order: "Commande Discord", monitoring: "Facture en jeu", manuel: "Saisie manuelle" };

// provenance, statut (deux <select>), recherche (client ou n°) et semaine affichée (FACTURES_SEMAINE, toujours
// renseignée — comme Run) appliqués ensemble, sur les données déjà chargées
function facturesFiltrees() {
  const recherche = document.getElementById("factures-recherche").value.trim().toLowerCase();
  const debutSemaine = new Date(`${FACTURES_SEMAINE}T00:00:00Z`);
  const finSemaine = new Date(debutSemaine.getTime() + 7 * 86400000);
  return TRI_FACTURES.appliquer((FACTURES_TOUTES || []).filter(f =>
    (!FACTURES_SOURCE || f.source === FACTURES_SOURCE) &&
    (!FACTURES_STATUT || categorieStatutFacture(f.statutPaiement) === FACTURES_STATUT) &&
    (!recherche || f.clientNom.toLowerCase().includes(recherche) || f.numeroFacture.toLowerCase().includes(recherche)) &&
    (new Date(f.dateFacture) >= debutSemaine && new Date(f.dateFacture) < finSemaine)
  ));
}

function afficherFactures() {
  const toutes = FACTURES_TOUTES || [];
  document.querySelectorAll("#factures-filtre-source option").forEach(o => {
    const n = o.value ? toutes.filter(f => f.source === o.value).length : toutes.length;
    o.textContent = `${LIBELLES_SOURCE_FILTRE[o.value]} (${n})`;
  });
  document.querySelectorAll("#factures-filtre-statut option").forEach(o => {
    const n = o.value ? toutes.filter(f => categorieStatutFacture(f.statutPaiement) === o.value).length : toutes.length;
    o.textContent = `${LIBELLES_STATUT_FILTRE[o.value]} (${n})`;
  });
  // réinitialiser : visible seulement si un filtre (hors semaine, qui n'en est pas un) est actif
  document.getElementById("factures-filtres-reinitialiser").classList.toggle("cache",
    !FACTURES_SOURCE && !FACTURES_STATUT && !document.getElementById("factures-recherche").value.trim());
  const lignes = facturesFiltrees();
  const vide = document.getElementById("factures-vide"), resultat = document.getElementById("factures-resultat");
  // chiffres clés de la vue actuelle (provenance + statut + recherche) : le montant total facturé pèse plus que le
  // nombre de lignes, mis en avant (carteChiffre(..., accent=true))
  document.getElementById("factures-chiffres").innerHTML = [
    carteChiffre("Total facturé", formaterArgentStats(lignes.reduce((s, f) => s + f.total, 0)), FACTURES_SOURCE ? labelSourceFacture(FACTURES_SOURCE) : "Toutes provenances", true),
    carteChiffre("Factures", String(lignes.length), ""),
  ].join("");
  if (!lignes.length) { vide.classList.remove("cache"); resultat.classList.add("cache"); return; }
  vide.classList.add("cache"); resultat.classList.remove("cache");
  document.getElementById("corps-table-factures").innerHTML = lignes.map(f => `<tr>
      <td>${echapper(formaterDateAdmin(f.dateFacture))}</td>
      <td>${echapper(labelSourceFacture(f.source))}</td>
      <td><button type="button" class="table-lien" data-facture-voir="${f.id}">${echapper(f.clientNom) || "Client inconnu"}</button>${f.avoirDeId ? ' <span class="puce puce-off">Avoir</span>' : ""}</td>
      <td>${echapper(f.numeroFacture) || "—"}</td>
      <td style="text-align:right;">${formaterArgentStats(f.total)}</td>
      <td>${badgeStatutFacture(f.statutPaiement)}</td>
      <td class="col-actions">${menuLigneFacture(f)}</td>
    </tr>`).join("");
}
// Statut d'une facture saisie à la main : les trois valeurs possibles, dans chacune le libellé et l'icône de
// l'action qui y mène depuis une autre (ex. depuis « payée », l'action vers « en attente » est « Marquer en
// attente ») ; confirmation seulement pour ce qui défait un état normalement final (annuler, revenir en arrière).
const STATUTS_FACTURE_MANUELLE = {
  EN_ATTENTE: { libelle: "Marquer en attente", icone: "sync",
    confirmation: { texte: "Cette facture sera marquée en attente de paiement.", titre: "Remettre cette facture en attente ?", bouton: "Valider" } },
  PAYEE: { libelle: "Marquer payée", icone: "coins", confirmation: null },
  ANNULEE: { libelle: "Marquer annulée", icone: "fermer",
    confirmation: { texte: "Cette facture sera marquée annulée.", titre: "Annuler cette facture ?", bouton: "Valider" } },
};
// Actions secondaires d'une facture, regroupées sous un menu « ⋯ » (même composant que la liste RH, gestion/rh.js :
// trop de boutons côte à côte écrasait le rendu du tableau à 1 280 px). Consulter/Modifier n'y est pas : c'est
// l'action la plus fréquente, elle s'ouvre directement en tapant le nom du client (bouton .table-lien ci-dessus),
// pas depuis un menu — un menu qui mélange l'action principale aux actions rares coûte un tap de plus à la première
// et noie les secondes (design-critique du 2026-10-23). Le changement de statut propose les deux autres valeurs que
// la valeur actuelle (on peut revenir en arrière), sauf une fois qu'un avoir a été émis pour une facture payée (son
// statut ne peut plus changer, routes/compta.ts) ; Créer un avoir n'apparaît que si l'action a un sens pour cette
// facture ; Aperçu de la facture est toujours là.
function menuLigneFacture(f) {
  // un avoir n'est pas modifiable : il reprend tels quels les montants qu'il annule (server/src/entreprise/routes/compta.ts)
  const editable = f.source === "manuel" && !f.avoirDeId;
  const items = [];
  if (editable && !(f.statutPaiement === "PAYEE" && f.avoirEmis)) {
    for (const statut of ["EN_ATTENTE", "PAYEE", "ANNULEE"]) {
      if (statut === f.statutPaiement) continue;
      const a = STATUTS_FACTURE_MANUELLE[statut];
      items.push(`<button type="button" role="menuitem" data-facture-statut="${f.id}" data-statut-cible="${statut}">${gestion.ico(a.icone)} ${a.libelle}</button>`);
    }
  }
  if (["PAID", "PAYEE"].includes(f.statutPaiement) && !f.avoirDeId && !f.avoirEmis) {
    items.push(`<button type="button" role="menuitem" data-facture-avoir="${f.id}">${gestion.ico("receipt")} Créer un avoir</button>`);
  }
  items.push(`<button type="button" role="menuitem" data-facture-apercu="${f.id}">${gestion.ico("sheet")} Aperçu de la facture</button>`);
  const nom = echapper(f.numeroFacture ? `la facture ${f.numeroFacture}` : `la facture n° ${f.id}`);
  return `<div class="comptes-menu">
    <button type="button" class="comptes-menu-bouton" aria-haspopup="menu" aria-expanded="false" aria-label="Actions pour ${nom}">${gestion.ico("points")}</button>
    <div class="comptes-menu-liste cache" role="menu">${items.join("")}</div>
  </div>`;
}
// même comportement que le menu « ⋯ » de la liste RH (gestion/rh.js) : un seul menu ouvert à la fois, Échap et clic
// extérieur le ferment, les flèches déplacent le focus entre ses actions, il s'ouvre vers le haut s'il déborderait en bas.
let MENU_FACTURE_OUVERT = null;
function fermerMenuFacture(rendreFocus) {
  if (!MENU_FACTURE_OUVERT) return;
  MENU_FACTURE_OUVERT.querySelector(".comptes-menu-liste").classList.add("cache");
  const b = MENU_FACTURE_OUVERT.querySelector(".comptes-menu-bouton");
  b.setAttribute("aria-expanded", "false");
  if (rendreFocus) b.focus();
  MENU_FACTURE_OUVERT = null;
}
document.getElementById("corps-table-factures").addEventListener("click", ev => {
  const ouvreur = ev.target.closest(".comptes-menu-bouton");
  if (ouvreur) {
    const menu = ouvreur.closest(".comptes-menu");
    if (MENU_FACTURE_OUVERT === menu) return fermerMenuFacture(true);
    fermerMenuFacture(false);
    const liste = menu.querySelector(".comptes-menu-liste");
    liste.classList.remove("cache");
    liste.classList.toggle("vers-le-haut", ouvreur.getBoundingClientRect().bottom + liste.offsetHeight + 16 > innerHeight);
    ouvreur.setAttribute("aria-expanded", "true");
    liste.querySelector("[role=menuitem]").focus();
    MENU_FACTURE_OUVERT = menu;
    return;
  }
  const bouton = ev.target.closest("button[data-facture-voir], button[data-facture-statut], button[data-facture-avoir], button[data-facture-apercu]");
  if (!bouton) return;
  fermerMenuFacture(false);
  if (bouton.dataset.factureVoir) { ouvrirFactureForm(Number(bouton.dataset.factureVoir)); return; }
  if (bouton.dataset.factureStatut) {
    const cible = bouton.dataset.statutCible;
    const a = STATUTS_FACTURE_MANUELLE[cible];
    actionFactureLigne(Number(bouton.dataset.factureStatut), "statut", { libelle: a.libelle, confirmation: a.confirmation, corps: { statut: cible } });
    return;
  }
  if (bouton.dataset.factureAvoir) {
    actionFactureLigne(Number(bouton.dataset.factureAvoir), "avoir",
      { libelle: "Avoir créé", confirmation: { texte: "Une facture d'avoir sera créée (montants négatifs), liée à celle-ci. Si elle a été saisie à la main, elle passera elle-même à « annulée ».", titre: "Créer un avoir pour cette facture ?", bouton: "Créer l'avoir" } });
    return;
  }
  if (bouton.dataset.factureApercu) ouvrirApercuFacture(FACTURES_TOUTES.find(f => f.id === Number(bouton.dataset.factureApercu)));
});
document.addEventListener("click", ev => { if (MENU_FACTURE_OUVERT && !MENU_FACTURE_OUVERT.contains(ev.target)) fermerMenuFacture(false); });
document.addEventListener("keydown", ev => {
  if (!MENU_FACTURE_OUVERT) return;
  if (ev.key === "Escape") { ev.preventDefault(); fermerMenuFacture(true); }
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    const items = [...MENU_FACTURE_OUVERT.querySelectorAll("[role=menuitem]")], i = items.indexOf(document.activeElement);
    items[(i + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  }
});
// changer de statut / créer un avoir, depuis la ligne : recharge la liste (montants, statut, actions applicables)
async function actionFactureLigne(id, route, { libelle, confirmation, corps }) {
  if (confirmation && !(await gestion.confirmer(confirmation.texte, confirmation.titre, confirmation.bouton, { danger: false }))) return;
  try {
    await socle.api(`/api/compta/factures/${id}/${route}`, { method: "POST", body: corps });
    gestion.notifier(`${libelle} ✓`);
    await chargerFactures();
  } catch (e) {
    gestion.message("zone-message-factures", "Action impossible : " + e.message);
  }
}

ameliorerSelect(document.getElementById("factures-filtre-source"));
document.getElementById("factures-filtre-source").addEventListener("change", e => {
  FACTURES_SOURCE = e.target.value;
  afficherFactures();
});
// ?statut=attente (lien « À traiter » de l'Accueil) : filtre posé d'entrée ; une valeur inconnue est ignorée
const STATUT_DEMANDE = new URLSearchParams(location.search).get("statut");
if (STATUT_DEMANDE && Object.prototype.hasOwnProperty.call(LIBELLES_STATUT_FILTRE, STATUT_DEMANDE)) {
  document.getElementById("factures-filtre-statut").value = FACTURES_STATUT = STATUT_DEMANDE;
}
ameliorerSelect(document.getElementById("factures-filtre-statut"), v => COULEURS_STATUT_FILTRE[v]);
document.getElementById("factures-filtre-statut").addEventListener("change", e => {
  FACTURES_STATUT = e.target.value;
  afficherFactures();
});
document.getElementById("factures-recherche").addEventListener("input", afficherFactures);
document.getElementById("factures-filtres-reinitialiser").addEventListener("click", () => {
  // dispatchEvent("change") et pas seulement .value= : ameliorerSelect garde sa propre pastille de couleur (statut)
  // synchronisée par un écouteur « change », pas par la lecture directe de .value ; le listener « change » de chaque
  // select met lui-même FACTURES_SOURCE/FACTURES_STATUT à jour et réaffiche la liste
  ["factures-filtre-source", "factures-filtre-statut"].forEach(id => {
    const select = document.getElementById(id);
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  document.getElementById("factures-recherche").value = "";
  afficherFactures();
});

// table d'articles, partagée entre une commande Discord et une saisie manuelle (même forme : name/quantity/unitPrice)
function tableArticlesFacture(articles) {
  if (!Array.isArray(articles) || !articles.length) return "";
  return `<table class="table-admin"><thead><tr><th>Article</th><th style="text-align:right;">Qté</th><th style="text-align:right;">Prix unitaire</th></tr></thead><tbody>${
    articles.map(a => `<tr><td>${echapper(a.name)}</td><td style="text-align:right;">${a.quantity}</td><td style="text-align:right;">${formaterArgentStats(a.unitPrice)}</td></tr>`).join("")
  }</tbody></table>`;
}
// phrase « source » du détail : ce que le bot a réellement envoyé, propre à chaque événement (docs/webhooks.md) —
// ne répète pas labelSourceFacture (déjà affiché en badge dans l'en-tête). Ticket et statut logistique de la
// commande (order.updated) ne sont pas affichés : le statut de paiement l'est déjà ailleurs (badge), le ticket n'est
// pas utile à la Direction. Métier du joueur (monitoring.invoice, jobId) non plus : c'est l'identifiant de
// l'entreprise elle-même, pas une information propre à cette facture.
function detailSourceFacture(f) {
  const d = f.details || {};
  if (f.source === "order") return d.confirmed ? "Confirmée" : "";
  if (f.source === "monitoring") return `${echapper(d.playerName) || "Joueur inconnu"}${d.description ? ` · « ${echapper(d.description)} »` : ""}`;
  return `Saisie à la main${f.saisiePar ? ` par ${echapper(f.saisiePar)}` : ""}`;
}
// Aperçu à l'écran, jamais un fichier téléchargé ni l'impression du navigateur : print() gèle le navigateur embarqué
// de l'ordinateur en jeu et obligerait le joueur à fermer FiveM (docs/design.md §10). La personne capture l'écran
// elle-même (outil habituel de son système) ; « Plein écran » (gestion.js, pleinEcran) aide à cadrer la capture.
function rendreDocumentFacture(f) {
  const d = f.details || {};
  const articles = Array.isArray(d.articles) ? d.articles : [];
  // une facture en jeu (monitoring) n'a pas de sous-total/livraison/réduction détaillés, seulement un total
  const detail = f.source !== "monitoring";
  const note = detailSourceFacture(f);
  return `<div class="facture-doc">
    <header class="facture-doc-entete">
      <div class="facture-doc-marque"><img src="/assets/logo.png" alt="" class="facture-doc-logo"><strong>${echapper(socle.nomSite)}</strong></div>
      <div class="facture-doc-ref">
        <span class="facture-doc-ref-libelle">Facture</span>
        <strong>${echapper(f.numeroFacture) || `N° ${f.id}`}</strong>
        <span class="facture-doc-date">${echapper(formaterDateAdmin(f.dateFacture))}${f.dateEcheance ? ` · échéance ${echapper(formaterDateAdmin(f.dateEcheance))}` : ""}</span>
      </div>
    </header>
    <div class="facture-doc-bandeau" aria-hidden="true"></div>
    <div class="facture-doc-infos">
      <div><span class="facture-doc-petit">Client</span><strong>${echapper(f.clientNom) || "Client inconnu"}</strong></div>
      <div><span class="facture-doc-petit">Statut</span>${badgeStatutDoc(f.statutPaiement)}</div>
    </div>
    ${articles.length ? `<table class="facture-doc-table"><thead><tr><th>Article</th><th>Qté</th><th>Prix unitaire</th><th>Montant</th></tr></thead><tbody>${
      articles.map(a => `<tr><td>${echapper(a.name)}</td><td>${echapper(a.quantity)}</td><td>${formaterArgentStats(a.unitPrice)}</td><td>${formaterArgentStats(a.quantity * a.unitPrice)}</td></tr>`).join("")
    }</tbody></table>` : ""}
    <div class="facture-doc-totaux">
      ${detail ? `<div><span>Sous-total</span><span>${formaterArgentStats(f.sousTotal)}</span></div>
      <div><span>Livraison</span><span>${formaterArgentStats(f.livraison)}</span></div>
      ${f.reduction ? `<div><span>Réduction</span><span>${formaterArgentStats(-f.reduction)}</span></div>` : ""}` : ""}
      <div class="facture-doc-total"><span>Total</span><span>${formaterArgentStats(f.total)}</span></div>
    </div>
    ${note ? `<p class="facture-doc-note">${note}</p>` : ""}
  </div>`;
}
function ouvrirApercuFacture(f) {
  if (!f) return;
  document.getElementById("titre-modale-apercu-facture").textContent = f.numeroFacture ? `Facture ${f.numeroFacture}` : `Facture n° ${f.id}`;
  document.getElementById("apercu-facture-corps").innerHTML = rendreDocumentFacture(f);
  document.getElementById("modale-apercu-facture").classList.remove("cache");
  document.getElementById("fermer-modale-apercu-facture").focus();
}
function fermerApercuFacture() { document.getElementById("modale-apercu-facture").classList.add("cache"); }
pleinEcran(document.getElementById("bouton-apercu-plein-ecran"), document.getElementById("apercu-facture-boite"));
document.getElementById("fermer-modale-apercu-facture").addEventListener("click", fermerApercuFacture);
document.getElementById("modale-apercu-facture").addEventListener("click", ev => { if (ev.target.id === "modale-apercu-facture") fermerApercuFacture(); });

// Copie de l'aperçu en image (presse-papiers), un seul rendu déclenché par le clic — jamais généré à l'avance ni en
// boucle. Un canvas obtenu d'un SVG <foreignObject> (sans bibliothèque) est rendu « entaché » par Chrome dès qu'il
// contient du HTML, même de même origine sans rien d'externe (vérifié) : toBlob() le refuse toujours. html2canvas
// (gestion/vendor/, ~45 Ko compressé) contourne ça en dessinant lui-même sur le canvas (texte, formes, images), sans
// jamais passer par un <foreignObject> ; chargé seulement au premier clic, jamais au chargement de la page.
let html2canvasPromise = null;
function chargerHtml2Canvas() {
  if (!html2canvasPromise) html2canvasPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/gestion/vendor/html2canvas.min.js";
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error("bibliothèque de capture introuvable"));
    document.head.appendChild(s);
  });
  return html2canvasPromise;
}
// Badge de statut dessiné à la main sur un canvas (fond en pilule + texte), puis collé comme une image figée dans
// le clone qu'html2canvas capture plus bas : ses propres essais (point en ::before, en élément séparé, en caractère
// dans le texte) donnaient tous un résultat correct à l'écran mais décalé une fois rendu par html2canvas. Une image
// déjà prête n'a plus aucune mise en page à refaire, seulement des pixels à recopier tels quels.
function imageBadgeStatut(noeudBadge) {
  const cs = getComputedStyle(noeudBadge);
  const dpr = Math.min(devicePixelRatio || 1, 2) * 2;   // texte minuscule : une marge de netteté en plus
  const w = noeudBadge.offsetWidth, h = noeudBadge.offsetHeight;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * dpr); canvas.height = Math.ceil(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = cs.backgroundColor;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, w, h, h / 2);
  else { const r = h / 2; ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r); ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); }
  ctx.fill();
  ctx.fillStyle = cs.color;
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  if ("letterSpacing" in ctx) ctx.letterSpacing = cs.letterSpacing;
  // le canvas ne respecte pas text-transform tout seul : majuscules imposées à la main si la règle CSS les demande
  const texte = cs.textTransform === "uppercase" ? noeudBadge.textContent.trim().toUpperCase() : noeudBadge.textContent.trim();
  ctx.fillText(texte, w / 2, h / 2 + 1);
  return { url: canvas.toDataURL("image/png"), w, h };
}
async function imageDepuisApercu(noeud) {
  const html2canvas = await chargerHtml2Canvas();
  const dpr = Math.min(devicePixelRatio || 1, 2);   // net sans générer une image inutilement lourde
  if (document.fonts?.ready) await document.fonts.ready;   // métriques de police correctes avant de dessiner le badge
  const badgeNoeud = noeud.querySelector(".facture-doc-statut");
  const badge = badgeNoeud ? imageBadgeStatut(badgeNoeud) : null;
  const canvas = await html2canvas(noeud, {
    scale: dpr, backgroundColor: getComputedStyle(noeud).backgroundColor,
    onclone: doc => {
      // l'ombre portée (plusieurs couches floutées, var(--shadow)) rend comme un bloc gris plein : html2canvas ne
      // sait pas flouter un box-shadow. Retirée sur le clone qu'il capture, jamais sur l'aperçu affiché à l'écran.
      const carte = doc.querySelector(".facture-doc");
      if (carte) carte.style.boxShadow = "none";
      const b = badge && doc.querySelector(".facture-doc-statut");
      if (b) b.outerHTML = `<img src="${badge.url}" alt="${echapper(b.textContent.trim())}" style="width:${badge.w}px;height:${badge.h}px;display:inline-block;">`;
    },
  });
  return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("export de l'image impossible")), "image/png"));
}
// bouton affiché seulement si le navigateur sait copier une image (pas l'ancien navigateur embarqué de l'ordinateur
// en jeu) : « Plein écran » + capture manuelle restent la solution de repli, déjà en place.
if (window.ClipboardItem && navigator.clipboard?.write) document.getElementById("bouton-apercu-copier").classList.remove("cache");
document.getElementById("bouton-apercu-copier").addEventListener("click", async (ev) => {
  const bouton = ev.currentTarget;
  bouton.disabled = true;
  try {
    const blob = await imageDepuisApercu(document.querySelector("#apercu-facture-corps .facture-doc"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    gestion.notifier("Image copiée dans le presse-papiers ✓");
  } catch (e) {
    gestion.notifier("Impossible de copier l'image : " + (e?.message || "erreur inconnue"), "erreur");
  } finally {
    bouton.disabled = false;
  }
});

document.getElementById("bouton-supprimer-facture").addEventListener("click", async () => {
  const f = FACTURE_COURANTE;
  if (!f) return;
  const ok = await gestion.confirmer("Cette facture saisie à la main sera définitivement supprimée.", "Supprimer cette facture ?", "Supprimer la facture");
  if (!ok) return;
  try {
    await socle.api(`/api/compta/factures/${f.id}`, { method: "DELETE" });
    fermerModaleFactureForm();
    chargerFactures();
  } catch (e) {
    gestion.message("zone-message-factures", "Impossible de supprimer cette facture : " + e.message);
  }
});

// saisie manuelle : le total s'affiche en aperçu (sous-total + livraison − réduction en %) mais n'est jamais envoyé,
// pour qu'il ne puisse jamais contredire les autres montants — c'est le serveur qui le calcule (routes/compta.ts).
// Liste d'articles de la saisie manuelle (description/quantité/prix unitaire), même principe que order.updated : le
// montant des articles n'est plus saisi directement, il se calcule depuis ces lignes. Toujours au moins une ligne à
// l'écran ; la retirer vide ses champs plutôt que de fermer le formulaire sur une liste vide.
function creerLigneArticle(a) {
  const ligne = document.createElement("div");
  ligne.className = "facture-article-ligne";
  ligne.innerHTML = `
    <input type="text" class="facture-article-nom" maxlength="200" autocomplete="off" placeholder="Description" aria-label="Description de l'article" value="${echapper(a?.name || "")}">
    <input type="number" class="facture-article-qte" min="1" step="1" value="${Number.isInteger(a?.quantity) && a.quantity > 0 ? a.quantity : 1}" aria-label="Quantité">
    <div class="champ-dollar"><input type="number" class="facture-article-prix" min="0" step="1" value="${Number(a?.unitPrice) || 0}" aria-label="Prix unitaire"></div>
    <button type="button" class="facture-article-retirer" aria-label="Retirer cet article"><svg class="ico" aria-hidden="true"><use href="#ico-trash"></use></svg></button>`;
  return ligne;
}
function ajouterLigneArticle(focus, a) {
  const ligne = creerLigneArticle(a);
  document.getElementById("facture-articles").appendChild(ligne);
  if (focus) ligne.querySelector(".facture-article-nom").focus();
}
// reprend les articles d'une facture existante (modification), ou une ligne vide (création) : toujours au moins une
// ligne à l'écran
function remplirArticlesFacture(articles) {
  const zone = document.getElementById("facture-articles");
  zone.innerHTML = "";
  if (Array.isArray(articles) && articles.length) articles.forEach(a => ajouterLigneArticle(false, a));
  else ajouterLigneArticle(false);
}
document.getElementById("bouton-ajouter-article").addEventListener("click", () => ajouterLigneArticle(true));
document.getElementById("facture-articles").addEventListener("click", ev => {
  const bouton = ev.target.closest(".facture-article-retirer");
  if (!bouton) return;
  const lignes = document.querySelectorAll(".facture-article-ligne");
  if (lignes.length > 1) bouton.closest(".facture-article-ligne").remove();
  else bouton.closest(".facture-article-ligne").querySelectorAll("input").forEach(i => { i.value = i.type === "number" ? (i.classList.contains("facture-article-qte") ? "1" : "0") : ""; });
  majApercuTotalFacture();
});
document.getElementById("facture-articles").addEventListener("input", majApercuTotalFacture);

// une ligne sans quantité valide n'entre pas dans le sous-total (même règle que le serveur) : on peut laisser une
// ligne vide en train d'être remplie sans que l'aperçu affiche un montant qui n'existe pas encore. Le nom, lui,
// n'est pas obligatoire pour compter : un oubli de libellé ne doit pas faire disparaître une quantité et un prix
// déjà saisis (le serveur donne un nom par défaut à l'enregistrement).
function articlesFactureSaisis() {
  return Array.from(document.querySelectorAll(".facture-article-ligne")).map(ligne => ({
    name: ligne.querySelector(".facture-article-nom").value.trim(),
    quantity: Math.round(Number(ligne.querySelector(".facture-article-qte").value)),
    unitPrice: Math.round(Number(ligne.querySelector(".facture-article-prix").value)) || 0,
  }));
}
function articlesFactureValides() {
  return articlesFactureSaisis().filter(a => Number.isInteger(a.quantity) && a.quantity > 0);
}

// La réduction se saisit en pourcentage (même principe que order.updated, discountPercent) : plus simple à donner de
// tête (« 10 % ») qu'un montant en dollars qu'il faudrait recalculer à chaque changement du montant des articles.
function majApercuTotalFacture() {
  const n = id => Number(document.getElementById(id).value) || 0;
  const sousTotal = articlesFactureValides().reduce((s, a) => s + a.quantity * a.unitPrice, 0);
  const livraison = n("facture-livraison"), pourcentage = n("facture-reduction");
  const reduction = Math.round(sousTotal * pourcentage / 100);
  document.getElementById("facture-apercu-articles-ligne").classList.remove("cache");
  document.getElementById("facture-apercu-livraison-ligne").classList.remove("cache");
  document.getElementById("facture-apercu-articles").textContent = formaterArgentStats(sousTotal);
  document.getElementById("facture-apercu-livraison").textContent = formaterArgentStats(livraison);
  document.getElementById("facture-apercu-reduction-ligne").classList.toggle("cache", !reduction);
  document.getElementById("facture-apercu-reduction-libelle").textContent = `Réduction (${pourcentage} %)`;
  document.getElementById("facture-apercu-reduction").textContent = "-" + formaterArgentStats(reduction);
  document.getElementById("facture-total-apercu").textContent = formaterArgentStats(sousTotal + livraison - reduction);
}
["facture-livraison", "facture-reduction"].forEach(id => document.getElementById(id).addEventListener("input", majApercuTotalFacture));

// récapitulatif d'une facture reçue du bot (montants non modifiables) : valeurs du serveur, jamais recalculées côté
// client ; la ventilation (sous-total/livraison/réduction) n'a de sens que pour une commande Discord — un paiement
// constaté en jeu (monitoring) n'a ni livraison ni réduction, sous-total = total
function remplirRecapitulatifLecture(f) {
  const detail = f.source !== "monitoring";
  document.getElementById("facture-apercu-articles-ligne").classList.toggle("cache", !detail);
  document.getElementById("facture-apercu-livraison-ligne").classList.toggle("cache", !detail);
  document.getElementById("facture-apercu-reduction-ligne").classList.toggle("cache", !detail || !f.reduction);
  document.getElementById("facture-apercu-articles").textContent = formaterArgentStats(f.sousTotal);
  document.getElementById("facture-apercu-livraison").textContent = formaterArgentStats(f.livraison);
  document.getElementById("facture-apercu-reduction-libelle").textContent = "Réduction";
  document.getElementById("facture-apercu-reduction").textContent = formaterArgentStats(-f.reduction);
  document.getElementById("facture-total-apercu").textContent = formaterArgentStats(f.total);
}

champDateFr(document.getElementById("facture-date"));
champDateFr(document.getElementById("facture-echeance"));

// Ouvre le panel pour créer (id absent), consulter ou modifier (id présent) une facture — même panel, comme la fiche
// employé de Ressources humaines (gestion/rh.js, ouvrirFicheEmploye). Tous les champs ne sont éditables qu'à la
// création ou sur une facture saisie à la main et qui n'est pas elle-même un avoir (routes/compta.ts) : une facture
// reçue du bot (commande Discord, facture en jeu) ou un avoir s'affiche entièrement en lecture seule.
async function ouvrirFactureForm(id) {
  gestion.message("zone-message-modale-facture", "");
  let f = null;
  if (id) {
    try { f = await socle.api(`/api/compta/factures/${id}`); }
    catch (e) { gestion.message("zone-message-factures", "Impossible d'ouvrir cette facture : " + e.message); return; }
  }
  FACTURE_COURANTE = f;
  FACTURE_CONTRAT = null;   // rattachement à un contrat : posé après l'ouverture, seulement depuis la fiche d'un contrat
  noteContratFacture(f?.contratId ? { debut: f.periodeDebut?.slice(0, 10), fin: f.periodeFin?.slice(0, 10) } : null);
  // un avoir n'est pas modifiable : il reprend tels quels les montants qu'il annule (server/src/entreprise/routes/compta.ts)
  const editable = !f || (f.source === "manuel" && !f.avoirDeId);

  document.getElementById("titre-modale-facture-form").textContent = f ? (f.numeroFacture ? `Facture ${f.numeroFacture}` : `Facture n° ${f.id}`) : "Nouvelle facture";

  // provenance, détail de la source et statut : seulement pour une facture existante
  document.getElementById("facture-infos").classList.toggle("cache", !f);
  if (f) {
    const detail = detailSourceFacture(f);
    document.getElementById("facture-infos-texte").innerHTML = `${echapper(labelSourceFacture(f.source))}${detail ? ` · ${detail}` : ""}`;
    document.getElementById("facture-infos-statut").innerHTML = badgeStatutFacture(f.statutPaiement);
  }
  const noteAvoir = f?.avoirDeId ? `Avoir émis pour la facture n° ${f.avoirDeId}.` : f?.avoirEmis ? "Un avoir a été émis pour cette facture." : "";
  document.getElementById("facture-note-avoir").textContent = noteAvoir;
  document.getElementById("facture-note-avoir").classList.toggle("cache", !noteAvoir);
  document.getElementById("facture-aide-saisie").classList.toggle("cache", !!f);

  // client / n° : éditables (création, ou facture manuelle), texte simple sinon (le serveur les ignorerait de toute
  // façon pour une facture reçue du bot)
  document.getElementById("facture-identite-edition").classList.toggle("cache", !editable);
  document.getElementById("facture-identite-lecture").classList.toggle("cache", editable);
  document.getElementById("facture-client").value = f?.clientNom || "";
  document.getElementById("facture-client").required = editable;
  document.getElementById("facture-numero").value = f?.numeroFacture || "";
  if (!editable) {
    document.getElementById("facture-lecture-client").textContent = f.clientNom || "Client inconnu";
    document.getElementById("facture-lecture-numero").textContent = f.numeroFacture || "—";
  }

  // dates : éditables comme client/n° ci-dessus (lecture seule sur une facture reçue du bot ou un avoir)
  document.querySelectorAll("#formulaire-facture .champ-erreur").forEach(p => p.classList.add("cache"));
  document.getElementById("facture-dates-edition").classList.toggle("cache", !editable);
  document.getElementById("facture-dates-lecture").classList.toggle("cache", editable);
  document.getElementById("facture-date").value = f ? f.dateFacture : jourParisISOFacture(new Date());
  document.getElementById("facture-echeance").value = f?.dateEcheance || "";
  if (!editable) {
    document.getElementById("facture-lecture-date").textContent = formaterJourFr(f.dateFacture);
    document.getElementById("facture-lecture-echeance").textContent = f.dateEcheance ? formaterJourFr(f.dateEcheance) : "—";
  }

  // articles : lignes éditables (création, ou facture manuelle) ou tableau en lecture (commande Discord, bot)
  document.getElementById("facture-articles-edition").classList.toggle("cache", !editable);
  document.getElementById("facture-articles-lecture").classList.toggle("cache", editable);
  remplirArticlesFacture((f?.details || {}).articles);
  if (!editable) document.getElementById("facture-articles-lecture").innerHTML = tableArticlesFacture((f.details || {}).articles) || `<p class="champ-aide">Aucun article détaillé.</p>`;

  // livraison et réduction : éditables (création, ou facture manuelle) seulement
  document.getElementById("facture-fieldset-montants").classList.toggle("cache", !editable);
  document.getElementById("facture-livraison").value = f ? f.livraison : 0;
  // réduction saisie en pourcentage ; reconstituée depuis le montant enregistré et le sous-total, pour ne pas perdre
  // le pourcentage d'origine en rouvrant la facture
  document.getElementById("facture-reduction").value = f && f.sousTotal ? Math.round((f.reduction / f.sousTotal) * 100) : 0;
  if (editable) majApercuTotalFacture(); else remplirRecapitulatifLecture(f);

  // Supprimer : seule action de cycle de vie restée dans le panel (les autres sont sur la ligne du tableau, menuLigneFacture)
  const afficheSupprimer = !!(f && f.source === "manuel");
  document.getElementById("bouton-supprimer-facture").classList.toggle("cache", !afficheSupprimer);
  // rien à enregistrer sur une facture non modifiable (commande Discord, facture en jeu, avoir) : le panel ne sert
  // plus qu'à consulter, pas de bouton Enregistrer
  document.getElementById("bouton-facture-enregistrer").classList.toggle("cache", !editable);
  document.getElementById("bouton-facture-enregistrer").textContent = !f ? "Ajouter la facture" : "Enregistrer les modifications";
  document.getElementById("facture-pied").classList.toggle("cache", !editable && !afficheSupprimer);

  document.getElementById("modale-facture-form").classList.remove("cache");
  (editable ? document.getElementById("facture-client") : document.getElementById("fermer-modale-facture-form")).focus();
}
function fermerModaleFactureForm() { document.getElementById("modale-facture-form").classList.add("cache"); }
document.getElementById("bouton-nouvelle-facture").addEventListener("click", () => ouvrirFactureForm(null));
document.getElementById("fermer-modale-facture-form").addEventListener("click", fermerModaleFactureForm);
document.getElementById("bouton-annuler-facture").addEventListener("click", fermerModaleFactureForm);
document.getElementById("modale-facture-form").addEventListener("click", (ev) => { if (ev.target.id === "modale-facture-form") fermerModaleFactureForm(); });

document.getElementById("formulaire-facture").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  gestion.message("zone-message-modale-facture", "");
  document.querySelectorAll("#formulaire-facture .champ-erreur").forEach(p => p.classList.add("cache"));
  const dateFacture = document.getElementById("facture-date").value;
  if (!dateFacture) {
    document.getElementById("erreur-facture-date").classList.remove("cache");
    document.getElementById("facture-date").focus();
    return;
  }
  const corps = {
    ...(FACTURE_CONTRAT && !FACTURE_COURANTE ? { contratId: FACTURE_CONTRAT.id, periodeDebut: FACTURE_CONTRAT.debut, periodeFin: FACTURE_CONTRAT.fin } : {}),
    dateFacture,
    dateEcheance: document.getElementById("facture-echeance").value,
    numeroFacture: document.getElementById("facture-numero").value.trim(),
    clientNom: document.getElementById("facture-client").value.trim(),
    articles: articlesFactureSaisis(),
    livraison: document.getElementById("facture-livraison").value,
    reductionPourcentage: document.getElementById("facture-reduction").value,
  };
  try {
    if (FACTURE_COURANTE) {
      await socle.api(`/api/compta/factures/${FACTURE_COURANTE.id}`, { method: "PATCH", body: corps });
      gestion.notifier("Facture enregistrée ✓");
      await Promise.all([ouvrirFactureForm(FACTURE_COURANTE.id), chargerFactures()]);
    } else {
      await socle.api("/api/compta/factures", { method: "POST", body: corps });
      gestion.notifier("Facture ajoutée ✓");
      fermerModaleFactureForm();
      chargerFactures();
    }
  } catch (e) {
    gestion.message("zone-message-modale-facture", e.message);
  }
});

// facture d'un contrat : la note dit quelles périodes elle couvre (le serveur refuse une période déjà facturée)
let FACTURE_CONTRAT = null;
const jourCourtFacture = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
function noteContratFacture(p) {
  const note = document.getElementById("facture-note-contrat");
  note.textContent = p?.debut ? `Facture de contrat : périodes du ${jourCourtFacture(p.debut)} au ${jourCourtFacture(p.fin)}.` : "";
  note.classList.toggle("cache", !p?.debut);
}

// « Facturer » depuis la fiche d'un contrat client (gestion/contrats.js) :
// ?depuisContrat=<id>&client=…&montant=…&nombre=…&unite=…&debut=AAAA-MM-JJ&fin=AAAA-MM-JJ
// ouvre directement le formulaire de nouvelle facture, pré-rempli (une ligne : le nombre de périodes au montant du
// contrat) ; l'utilisateur vérifie et valide. L'URL est nettoyée pour qu'un rechargement ne rouvre pas le formulaire.
const PARAMS_CONTRAT = new URLSearchParams(location.search);
const ID_CONTRAT = Number(PARAMS_CONTRAT.get("depuisContrat"));
if (Number.isInteger(ID_CONTRAT) && ID_CONTRAT > 0) {
  const client = PARAMS_CONTRAT.get("client") || "", montant = Math.round(Number(PARAMS_CONTRAT.get("montant"))) || 0;
  const nombre = Math.max(1, Math.round(Number(PARAMS_CONTRAT.get("nombre"))) || 1), unite = PARAMS_CONTRAT.get("unite") || "période";
  const debut = PARAMS_CONTRAT.get("debut") || "", fin = PARAMS_CONTRAT.get("fin") || "";
  history.replaceState(null, "", location.pathname);
  gestion.coque('facturation').then(async () => {
    await chargerFactures();
    await ouvrirFactureForm(null);
    FACTURE_CONTRAT = { id: ID_CONTRAT, debut, fin };
    noteContratFacture({ debut, fin });
    document.getElementById("facture-client").value = client;
    const libelle = `Contrat : ${nombre} ${unite}${nombre > 1 && !unite.endsWith("s") ? "s" : ""}, du ${jourCourtFacture(debut)} au ${jourCourtFacture(fin)}`;
    remplirArticlesFacture([{ name: libelle.slice(0, 100), unitPrice: montant, quantity: nombre }]);
    majApercuTotalFacture();
  });
} else {
  gestion.coque('facturation').then(() => chargerFactures());
}
