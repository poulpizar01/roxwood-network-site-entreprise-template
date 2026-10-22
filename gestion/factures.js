/* GESTION — Factures (permission « factures ») : toutes les factures (reçues du bot ou saisies à la main), quelle
   que soit leur provenance, avec le détail d'origine et le téléchargement d'une facture. Serveur :
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
// catégorie générique d'un statut (paye/attente/annulee), pour filtrer ensemble les valeurs du bot et celles de la
// saisie manuelle — un statut hors de la liste n'entre dans aucune catégorie (ne répond à aucun filtre)
function categorieStatutFacture(statut) {
  if (STATUTS_PAIEMENT[statut]?.[1] === "puce-ok") return "paye";
  if (STATUTS_PAIEMENT[statut]?.[1] === "puce-or") return "attente";
  if (STATUTS_PAIEMENT[statut]?.[1] === "puce-off") return "annulee";
  return "";
}

// statut logistique d'une commande boutique (order.updated) : correspondance exacte, confirmée côté bot (enum
// OrderStatus, prisma/schema.prisma du bot), mêmes libellés que ceux que le bot affiche sur Discord.
const STATUTS_COMMANDE = { PENDING: "En attente", PREPARING: "En préparation", DELIVERED: "Livrée", CANCELLED: "Annulée" };

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
const COULEURS_STATUT_FILTRE = { "": "var(--text-faint)", attente: "var(--gold-strong)", paye: "var(--success)", annulee: "var(--danger-strong)" };
// filtre provenance : même geste que le statut (select, pas des pilules — design-critique du 2026-10-21, trop de
// place prise pour un seul choix actif à la fois)
const LIBELLES_SOURCE_FILTRE = { "": "Toutes les provenances", order: "Commande Discord", monitoring: "Facture en jeu", manuel: "Saisie manuelle" };

// provenance, statut (deux <select>), recherche (client ou n°) et semaine affichée (FACTURES_SEMAINE, toujours
// renseignée — comme Run) appliqués ensemble, sur les données déjà chargées
function facturesFiltrees() {
  const recherche = document.getElementById("factures-recherche").value.trim().toLowerCase();
  const debutSemaine = new Date(`${FACTURES_SEMAINE}T00:00:00Z`);
  const finSemaine = new Date(debutSemaine.getTime() + 7 * 86400000);
  return (FACTURES_TOUTES || []).filter(f =>
    (!FACTURES_SOURCE || f.source === FACTURES_SOURCE) &&
    (!FACTURES_STATUT || categorieStatutFacture(f.statutPaiement) === FACTURES_STATUT) &&
    (!recherche || f.clientNom.toLowerCase().includes(recherche) || f.numeroFacture.toLowerCase().includes(recherche)) &&
    (new Date(f.dateFacture) >= debutSemaine && new Date(f.dateFacture) < finSemaine)
  );
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
    </tr>`).join("");
  document.querySelectorAll("[data-facture-voir]").forEach(btn => btn.addEventListener("click", () => voirFacture(Number(btn.dataset.factureVoir))));
}

ameliorerSelect(document.getElementById("factures-filtre-source"));
document.getElementById("factures-filtre-source").addEventListener("change", e => {
  FACTURES_SOURCE = e.target.value;
  afficherFactures();
});
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
// bloc « source » du détail : ce que le bot a réellement envoyé, propre à chaque événement (docs/webhooks.md)
function detailSourceFacture(f) {
  const d = f.details || {};
  if (f.source === "order") {
    return `<p class="champ-aide" style="margin:10px 0 6px;">Commande Discord — ticket ${echapper(d.ticketId) || "—"}, statut ${echapper(STATUTS_COMMANDE[d.status] || d.status) || "—"}${d.confirmed ? ", confirmée" : ""}.</p>` + tableArticlesFacture(d.articles);
  }
  if (f.source === "monitoring") {
    return `<p class="champ-aide" style="margin:10px 0 0;">Paiement constaté en jeu — ${echapper(d.playerName) || "joueur inconnu"} (métier : ${echapper(d.jobId) || "—"})${d.description ? `, « ${echapper(d.description)} »` : ""}.</p>`;
  }
  return `<p class="champ-aide" style="margin:10px 0 6px;">Saisie à la main${f.saisiePar ? ` par ${echapper(f.saisiePar)}` : ""}.</p>` + tableArticlesFacture(d.articles);
}

async function voirFacture(id) {
  try {
    const f = await socle.api(`/api/compta/factures/${id}`);
    FACTURE_COURANTE = f;
    document.getElementById("titre-modale-detail-facture").textContent = f.numeroFacture ? `Facture ${f.numeroFacture}` : `Facture n° ${f.id}`;
    const noteAvoir = f.avoirDeId
      ? `<p class="champ-aide" style="margin:0 0 10px;">Avoir émis pour la facture n° ${f.avoirDeId}.</p>`
      : f.avoirEmis ? `<p class="champ-aide" style="margin:0 0 10px;">Un avoir a été émis pour cette facture.</p>` : "";
    document.getElementById("corps-detail-facture").innerHTML = `
      <p style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <strong>${echapper(f.clientNom) || "Client inconnu"}</strong>
        <span class="champ-aide">${echapper(labelSourceFacture(f.source))}</span>
      </p>
      ${noteAvoir}
      ${detailSourceFacture(f)}
      <div class="facture-totaux">
        <div><span>Sous-total</span><span>${formaterArgentStats(f.sousTotal)}</span></div>
        <div><span>Livraison</span><span>${formaterArgentStats(f.livraison)}</span></div>
        <div><span>Réduction</span><span>-${formaterArgentStats(f.reduction)}</span></div>
        <div class="total"><span>Total</span><span>${formaterArgentStats(f.total)}</span></div>
      </div>
      <p>Statut de paiement : ${badgeStatutFacture(f.statutPaiement)}</p>`;
    document.getElementById("facture-detail-date").value = f.dateFacture;
    document.getElementById("facture-detail-echeance").value = f.dateEcheance || "";
    gestion.message("zone-message-facture-dates", "");
    // marquer payée/annulée : seulement une saisie manuelle encore en attente (routes/compta.ts, changerStatutManuel)
    document.getElementById("facture-actions-statut").classList.toggle("cache", !(f.source === "manuel" && f.statutPaiement === "EN_ATTENTE"));
    // avoir : une facture payée (bot ou saisie manuelle), pas déjà créditée, pas elle-même un avoir
    document.getElementById("facture-action-avoir").classList.toggle("cache", !(["PAID", "PAYEE"].includes(f.statutPaiement) && !f.avoirDeId && !f.avoirEmis));
    document.getElementById("bouton-supprimer-facture").classList.toggle("cache", f.source !== "manuel");
    document.getElementById("modale-detail-facture").classList.remove("cache");
  } catch (e) {
    gestion.message("zone-message-factures", "Impossible d'ouvrir cette facture : " + e.message);
  }
}
champDateFr(document.getElementById("facture-detail-date"));
champDateFr(document.getElementById("facture-detail-echeance"));
// modifiable sur toute facture (bot ou saisie manuelle) : seules les dates, jamais les montants ni le statut
document.getElementById("bouton-facture-dates-enregistrer").addEventListener("click", async () => {
  const f = FACTURE_COURANTE;
  if (!f) return;
  gestion.message("zone-message-facture-dates", "");
  try {
    await socle.api(`/api/compta/factures/${f.id}/dates`, {
      method: "PATCH",
      body: { dateFacture: document.getElementById("facture-detail-date").value, dateEcheance: document.getElementById("facture-detail-echeance").value },
    });
    gestion.notifier("Dates enregistrées ✓");
    await Promise.all([voirFacture(f.id), chargerFactures()]);
  } catch (e) {
    gestion.message("zone-message-facture-dates", e.message);
  }
});
function fermerModaleDetailFacture() { document.getElementById("modale-detail-facture").classList.add("cache"); }
document.getElementById("fermer-modale-detail-facture").addEventListener("click", fermerModaleDetailFacture);
document.getElementById("modale-detail-facture").addEventListener("click", (ev) => { if (ev.target.id === "modale-detail-facture") fermerModaleDetailFacture(); });

// Téléchargement : un fichier HTML autonome (styles en ligne), jamais l'impression du navigateur — print() gèle le
// navigateur embarqué de l'ordinateur en jeu et obligerait le joueur à fermer FiveM (docs/design.md §10). La personne
// ouvre le fichier reçu dans son propre navigateur et l'imprime elle-même si elle le souhaite.
function documentFacture(f) {
  const d = f.details || {};
  const articles = Array.isArray(d.articles) ? d.articles : [];
  const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Facture ${esc(f.numeroFacture || f.id)}</title><style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; max-width: 700px; margin: 40px auto; padding: 0 20px; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #1a1a1a; padding-bottom: 10px; margin-bottom: 20px; }
  h1 { font-size: 1.3rem; margin: 0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.95rem; }
  th, td { border-bottom: 1px solid #ccc; padding: 6px 4px; text-align: left; }
  th:last-child, td:last-child, th:nth-last-child(2), td:nth-last-child(2) { text-align: right; }
  .totaux { width: 280px; margin-left: auto; font-size: 0.95rem; }
  .totaux div { display: flex; justify-content: space-between; padding: 3px 0; }
  .totaux .total { border-top: 1px solid #1a1a1a; margin-top: 4px; padding-top: 8px; font-weight: 700; font-size: 1.1rem; }
</style></head><body>
  <header><h1>${esc(socle.nomSite)}</h1><div>Facture ${esc(f.numeroFacture || `n° ${f.id}`)}<br>${esc(formaterDateAdmin(f.dateFacture))}${f.dateEcheance ? `<br>Échéance : ${esc(formaterDateAdmin(f.dateEcheance))}` : ""}</div></header>
  <p>Client : <strong>${esc(f.clientNom) || "—"}</strong></p>
  ${articles.length ? `<table><thead><tr><th>Article</th><th>Qté</th><th>Prix unitaire</th></tr></thead><tbody>${
    articles.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.quantity)}</td><td>${formaterArgentStats(a.unitPrice)}</td></tr>`).join("")
  }</tbody></table>` : ""}
  <div class="totaux">
    <div><span>Sous-total</span><span>${formaterArgentStats(f.sousTotal)}</span></div>
    <div><span>Livraison</span><span>${formaterArgentStats(f.livraison)}</span></div>
    <div><span>Réduction</span><span>-${formaterArgentStats(f.reduction)}</span></div>
    <div class="total"><span>Total</span><span>${formaterArgentStats(f.total)}</span></div>
  </div>
  <p>Statut de paiement : ${esc(f.statutPaiement) || "—"}</p>
</body></html>`;
}
document.getElementById("bouton-telecharger-facture").addEventListener("click", () => {
  const f = FACTURE_COURANTE;
  if (!f) return;
  const url = URL.createObjectURL(new Blob([documentFacture(f)], { type: "text/html" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `facture-${f.numeroFacture || f.id}.html`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  gestion.notifier("Facture téléchargée ✓");
});

document.getElementById("bouton-supprimer-facture").addEventListener("click", async () => {
  const f = FACTURE_COURANTE;
  if (!f) return;
  const ok = await gestion.confirmer("Cette facture saisie à la main sera définitivement supprimée.", "Supprimer cette facture ?", "Supprimer la facture");
  if (!ok) return;
  try {
    await socle.api(`/api/compta/factures/${f.id}`, { method: "DELETE" });
    fermerModaleDetailFacture();
    chargerFactures();
  } catch (e) {
    gestion.message("zone-message-factures", "Impossible de supprimer cette facture : " + e.message);
  }
});

// marquer payée / marquer annulée / créer un avoir : rechargent le détail (pour les actions possibles suivantes) et
// la liste (chiffres et badge) ensemble
async function actionFacture(route, confirmation) {
  const f = FACTURE_COURANTE;
  if (!f) return;
  if (confirmation && !(await gestion.confirmer(confirmation.texte, confirmation.titre, confirmation.libelle, { danger: false }))) return;
  try {
    await socle.api(`/api/compta/factures/${f.id}/${route}`, { method: "POST" });
    await Promise.all([voirFacture(f.id), chargerFactures()]);
  } catch (e) {
    gestion.message("zone-message-factures", "Action impossible : " + e.message);
  }
}
document.getElementById("bouton-facture-payer").addEventListener("click", () => actionFacture("payer"));
document.getElementById("bouton-facture-annuler").addEventListener("click", () =>
  actionFacture("annuler", { texte: "Cette facture sera marquée annulée.", titre: "Annuler cette facture ?", libelle: "Marquer annulée" }));
document.getElementById("bouton-facture-avoir").addEventListener("click", () =>
  actionFacture("avoir", { texte: "Une facture d'avoir sera créée (montants négatifs), liée à celle-ci. Si elle a été saisie à la main, elle passera elle-même à « annulée ».", titre: "Créer un avoir pour cette facture ?", libelle: "Créer l'avoir" }));

// saisie manuelle : le total s'affiche en aperçu (sous-total + livraison − réduction en %) mais n'est jamais envoyé,
// pour qu'il ne puisse jamais contredire les autres montants — c'est le serveur qui le calcule (routes/compta.ts).
// Liste d'articles de la saisie manuelle (description/quantité/prix unitaire), même principe que order.updated : le
// montant des articles n'est plus saisi directement, il se calcule depuis ces lignes. Toujours au moins une ligne à
// l'écran ; la retirer vide ses champs plutôt que de fermer le formulaire sur une liste vide.
function creerLigneArticle() {
  const ligne = document.createElement("div");
  ligne.className = "facture-article-ligne";
  ligne.innerHTML = `
    <input type="text" class="facture-article-nom" maxlength="200" autocomplete="off" placeholder="Description" aria-label="Description de l'article">
    <input type="number" class="facture-article-qte" min="1" step="1" value="1" aria-label="Quantité">
    <div class="champ-dollar"><input type="number" class="facture-article-prix" min="0" step="1" value="0" aria-label="Prix unitaire"></div>
    <button type="button" class="facture-article-retirer" aria-label="Retirer cet article"><svg class="ico" aria-hidden="true"><use href="#ico-trash"></use></svg></button>`;
  return ligne;
}
function ajouterLigneArticle(focus) {
  const ligne = creerLigneArticle();
  document.getElementById("facture-articles").appendChild(ligne);
  if (focus) ligne.querySelector(".facture-article-nom").focus();
}
function reinitialiserArticlesFacture() {
  const zone = document.getElementById("facture-articles");
  zone.innerHTML = "";
  ajouterLigneArticle(false);
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
  document.getElementById("facture-apercu-articles").textContent = formaterArgentStats(sousTotal);
  document.getElementById("facture-apercu-livraison").textContent = formaterArgentStats(livraison);
  document.getElementById("facture-apercu-reduction-ligne").classList.toggle("cache", !reduction);
  document.getElementById("facture-apercu-reduction-libelle").textContent = `Réduction (${pourcentage} %)`;
  document.getElementById("facture-apercu-reduction").textContent = "-" + formaterArgentStats(reduction);
  document.getElementById("facture-total-apercu").textContent = formaterArgentStats(sousTotal + livraison - reduction);
}
["facture-livraison", "facture-reduction"].forEach(id => document.getElementById(id).addEventListener("input", majApercuTotalFacture));

champDateFr(document.getElementById("facture-date"));
champDateFr(document.getElementById("facture-echeance"));
function ouvrirModaleNouvelleFacture() {
  document.getElementById("formulaire-nouvelle-facture").reset();
  document.getElementById("facture-date").value = jourParisISOFacture(new Date());
  document.getElementById("facture-echeance").value = "";
  document.querySelectorAll("#formulaire-nouvelle-facture .champ-erreur").forEach(p => p.classList.add("cache"));
  reinitialiserArticlesFacture();
  majApercuTotalFacture();
  gestion.message("zone-message-modale-facture", "");
  document.getElementById("modale-nouvelle-facture").classList.remove("cache");
  document.getElementById("facture-client").focus();
}
function fermerModaleNouvelleFacture() { document.getElementById("modale-nouvelle-facture").classList.add("cache"); }
document.getElementById("bouton-nouvelle-facture").addEventListener("click", ouvrirModaleNouvelleFacture);
document.getElementById("fermer-modale-nouvelle-facture").addEventListener("click", fermerModaleNouvelleFacture);
document.getElementById("modale-nouvelle-facture").addEventListener("click", (ev) => { if (ev.target.id === "modale-nouvelle-facture") fermerModaleNouvelleFacture(); });

document.getElementById("formulaire-nouvelle-facture").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  gestion.message("zone-message-modale-facture", "");
  document.querySelectorAll("#formulaire-nouvelle-facture .champ-erreur").forEach(p => p.classList.add("cache"));
  const dateFacture = document.getElementById("facture-date").value;
  if (!dateFacture) {
    document.getElementById("erreur-facture-date").classList.remove("cache");
    document.getElementById("facture-date").focus();
    return;
  }
  const corps = {
    numeroFacture: document.getElementById("facture-numero").value.trim(),
    clientNom: document.getElementById("facture-client").value.trim(),
    articles: articlesFactureSaisis(),
    livraison: document.getElementById("facture-livraison").value,
    reductionPourcentage: document.getElementById("facture-reduction").value,
    dateFacture,
    dateEcheance: document.getElementById("facture-echeance").value,
  };
  try {
    await socle.api("/api/compta/factures", { method: "POST", body: corps });
    fermerModaleNouvelleFacture();
    chargerFactures();
  } catch (e) {
    gestion.message("zone-message-modale-facture", e.message);
  }
});

gestion.coque('factures').then(() => chargerFactures());
