/* GESTION — agenda : événements personnels, partagés avec l’équipe ou adressés à un grade, classés par types colorés.
   Ce que chacun voit, crée et modifie est décidé par le serveur selon son grade (droits réglés dans Grades ;
   server/src/entreprise/routes/agenda.ts) ; la page ne fait qu'afficher les droits qu'il renvoie.
   Vues : jour, semaine (grille horaire), mois ; sur téléphone, une vue liste s'impose (bandeau de la semaine et
   rendez-vous du jour choisi), une grille de 7 colonnes n'y étant pas lisible. */

let AGENDA_VUE_CHOISIE = "semaine"; // "jour" | "semaine" | "mois" : le choix de la personne sur écran large
// Le site vit à l’heure de Paris (serveur RP français) : « aujourd’hui » et la ligne de l’heure actuelle en dépendent,
// quel que soit le fuseau réglé sur l’ordinateur de la personne.
const PARIS = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function maintenantParis() {
  const p = Object.fromEntries(PARIS.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}
const aujourdhuiParis = () => new Date(maintenantParis().iso + "T00:00");
let AGENDA_REF = aujourdhuiParis(); // jour affiché ou choisi
let CACHE_EVENEMENTS = [];
const AGENDA_HEURE_HAUTEUR = 52; // hauteur en pixels d'une heure dans la grille
const AGENDA_TELEPHONE = matchMedia("(max-width: 760px)");
const agendaVue = () => (AGENDA_TELEPHONE.matches ? "liste" : AGENDA_VUE_CHOISIE);

function formaterDateISO(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const j = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${j}`;
}

function lundiDeLaSemaine(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const jour = d.getDay(); // 0 = dimanche ... 6 = samedi
  d.setDate(d.getDate() + (jour === 0 ? -6 : 1 - jour));
  return d;
}

function capitaliser(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
const nomCourtJour = d => d.toLocaleDateString("fr-FR", { weekday: "short" });
const jourLong = d => capitaliser(d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }));

// Bornes de la période chargée : un jour, une semaine (aussi pour la liste du téléphone), ou la grille du mois
// (du lundi de la semaine du 1er au dimanche de la semaine du dernier jour).
function periodeAgenda() {
  const ref = new Date(AGENDA_REF); ref.setHours(0, 0, 0, 0);
  const vue = agendaVue();
  if (vue === "jour") return { debut: new Date(ref), fin: new Date(ref) };
  if (vue === "semaine" || vue === "liste") {
    const lundi = lundiDeLaSemaine(ref);
    const dim = new Date(lundi); dim.setDate(lundi.getDate() + 6);
    return { debut: lundi, fin: dim };
  }
  const debut = lundiDeLaSemaine(new Date(ref.getFullYear(), ref.getMonth(), 1));
  const fin = lundiDeLaSemaine(new Date(ref.getFullYear(), ref.getMonth() + 1, 0)); fin.setDate(fin.getDate() + 6);
  return { debut, fin };
}

// Période réellement choisie, sans les jours des mois voisins ajoutés à la grille du mois pour la compléter
// (periodeAgenda() les inclut pour l'affichage du calendrier ; les statistiques des participants ne doivent
// compter qu'un mois entier, pas deux mois et demi).
function periodeParticipants() {
  const vue = agendaVue();
  if (vue !== "mois") return periodeAgenda();
  const ref = new Date(AGENDA_REF); ref.setHours(0, 0, 0, 0);
  return { debut: new Date(ref.getFullYear(), ref.getMonth(), 1), fin: new Date(ref.getFullYear(), ref.getMonth() + 1, 0) };
}

function joursDeLaPeriode() {
  const { debut, fin } = periodeAgenda();
  const jours = []; const d = new Date(debut);
  while (d <= fin) { jours.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return jours;
}

// Décale le jour de référence d'une unité de la vue (la liste avance d'une semaine, en gardant le jour choisi).
function decalerAgenda(sens) {
  const d = new Date(AGENDA_REF);
  const vue = agendaVue();
  if (vue === "jour") d.setDate(d.getDate() + sens);
  else if (vue === "semaine" || vue === "liste") d.setDate(d.getDate() + 7 * sens);
  else { d.setDate(1); d.setMonth(d.getMonth() + sens); }
  AGENDA_REF = d;
}

const estAujourdhui = date => formaterDateISO(date) === maintenantParis().iso;

function minutesDepuisMinuit(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

const heureActuelleHHMM = () => maintenantParis().hhmm;

// un événement sans horaire (sur plusieurs jours) occupe la journée entière, sur chaque jour qu'il traverse
const segmentJour = e => e.heure_debut && e.heure_fin ? { debut: e.heure_debut, fin: e.heure_fin } : { debut: "00:00", fin: "24:00" };
const texteHoraire = e => e.heure_debut && e.heure_fin ? `${e.heure_debut} – ${e.heure_fin}` : "Toute la journée";
const evenementsDu = iso => CACHE_EVENEMENTS.filter(e => e.jour <= iso && e.jour_fin >= iso)
  .sort((a, b) => minutesDepuisMinuit(segmentJour(a).debut) - minutesDepuisMinuit(segmentJour(b).debut));

function majEnteteAgenda() {
  const span = document.getElementById("agenda-plage-dates");
  const { debut, fin } = periodeAgenda();
  const vue = agendaVue();
  // Le bouton du milieu dit où l'on est : la période actuelle par son nom (« Aujourd’hui », « Cette semaine », « Ce
  // mois-ci »), toute autre par sa date (« Sem. du 5 oct. ») — pas de « hier » ni de « semaine prochaine », qu'il faudrait
  // recalculer de tête. Un clic ramène toujours à la période actuelle, ce que son nom accessible indique.
  const auj = aujourdhuiParis(), ref = new Date(AGENDA_REF); ref.setHours(0, 0, 0, 0);
  const parSemaine = vue === "semaine" || vue === "liste";
  let ecart, nom, actuelle;
  if (vue === "jour") {
    ecart = Math.round((ref - auj) / 864e5);
    nom = ecart === 0 ? "Aujourd’hui" : capitaliser(ref.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }));
    actuelle = "aujourd’hui";
  } else if (parSemaine) {
    ecart = Math.round((lundiDeLaSemaine(ref) - lundiDeLaSemaine(auj)) / (7 * 864e5));
    nom = ecart === 0 ? "Cette semaine" : `Sem. du ${debut.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
    actuelle = "cette semaine";
  } else {
    ecart = (ref.getFullYear() - auj.getFullYear()) * 12 + ref.getMonth() - auj.getMonth();
    nom = ecart === 0 ? "Ce mois-ci" : capitaliser(ref.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }));
    actuelle = "ce mois-ci";
  }
  const bouton = document.getElementById("agenda-aujourdhui");
  bouton.textContent = nom;
  bouton.classList.toggle("sur-periode-actuelle", ecart === 0);
  bouton.setAttribute("aria-label", ecart === 0 ? nom : `${nom} : revenir à ${actuelle}`);
  bouton.title = ecart === 0 ? "Raccourci : touche T" : `Revenir à ${actuelle} (touche T)`;
  const unite = vue === "jour" ? ["Jour précédent", "Jour suivant"] : parSemaine ? ["Semaine précédente", "Semaine suivante"] : ["Mois précédent", "Mois suivant"];
  document.getElementById("agenda-semaine-precedente").setAttribute("aria-label", unite[0]);
  document.getElementById("agenda-semaine-suivante").setAttribute("aria-label", unite[1]);
  const mois = d => d.toLocaleDateString("fr-FR", { month: "long" });
  if (vue === "jour") span.textContent = capitaliser(AGENDA_REF.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  else if (vue === "mois" || vue === "liste") span.textContent = capitaliser(AGENDA_REF.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }));
  else span.textContent = debut.getMonth() === fin.getMonth()
    ? `Du ${debut.getDate()} au ${fin.getDate()} ${mois(fin)} ${fin.getFullYear()}`
    : `Du ${debut.getDate()} ${mois(debut)} au ${fin.getDate()} ${mois(fin)} ${fin.getFullYear()}`;
  document.querySelectorAll(".agenda-vue-bouton").forEach(b => {
    const actif = b.dataset.vue === AGENDA_VUE_CHOISIE;
    b.classList.toggle("actif", actif);
    b.setAttribute("aria-pressed", String(actif));
  });
}

function defilerVersMaintenant() {
  const conteneur = document.getElementById("agenda-grille-conteneur");
  const minutes = Math.max(minutesDepuisMinuit(heureActuelleHHMM()) - 90, 7 * 60); // un peu avant maintenant, 7 h au plus tôt
  conteneur.scrollTop = (minutes / 60) * AGENDA_HEURE_HAUTEUR;
}

// Événements qui se chevauchent : côte à côte plutôt que l'un sur l'autre. Chaque groupe d'événements liés par un
// chevauchement est réparti en colonnes ; chacun reçoit sa colonne et le nombre de colonnes de son groupe.
function disposerEvenements(evts) {
  const places = evts.map(e => { const s = segmentJour(e); return { e, debut: minutesDepuisMinuit(s.debut), fin: Math.max(minutesDepuisMinuit(s.fin), minutesDepuisMinuit(s.debut) + 15) }; });
  let groupe = [], finGroupe = -1;
  const fermer = () => {
    const colonnes = [];
    for (const p of groupe) {
      let c = colonnes.findIndex(fin => fin <= p.debut);
      if (c < 0) { c = colonnes.length; colonnes.push(0); }
      colonnes[c] = p.fin; p.col = c;
    }
    for (const p of groupe) p.nbCols = colonnes.length;
  };
  for (const p of places) {
    if (groupe.length && p.debut >= finGroupe) { fermer(); groupe = []; finGroupe = -1; }
    groupe.push(p); finGroupe = Math.max(finGroupe, p.fin);
  }
  if (groupe.length) fermer();
  return places;
}

const LIBELLES_STATUT_ABSENCE = { en_attente: "en attente de validation", approuve: "approuvée", refuse: "refusée" };
const libelleStatutAbsence = e => `absence ${LIBELLES_STATUT_ABSENCE[e.statut_absence] || LIBELLES_STATUT_ABSENCE.en_attente}`;
// une absence refusée garde la classe de son statut (le nom reste explicite ailleurs : fiche, bandeau)
const classeAbsence = e => e.absence ? ` absence-${e.statut_absence === "approuve" ? "approuvee" : e.statut_absence === "refuse" ? "refusee" : "en-attente"}` : "";
const descriptionEvenement = e => `${e.titre}, ${texteHoraire(e)}${typeDe(e) ? `, ${typeDe(e).nom}` : ""}, pour ${e.destinataire || "moi"}${e.absence ? `, ${libelleStatutAbsence(e)}` : ""}`;

// Événements sans horaire (sur un ou plusieurs jours) : une bande par événement, étirée sur les jours qu'il couvre
// (comme dans un agenda courant), plutôt qu'un bloc plein écran répété dans chaque colonne horaire.
const diffJours = (a, b) => Math.round((a - b) / 864e5);
function evenementsToutJour(jours) {
  const debut = formaterDateISO(jours[0]), fin = formaterDateISO(jours[jours.length - 1]);
  return CACHE_EVENEMENTS.filter(e => !e.heure_debut && e.jour <= fin && e.jour_fin >= debut);
}
// colonnes (clampées à la période affichée) puis rangée : la première rangée libre à ce point, comme disposerEvenements
function disposerToutJour(evts, jours) {
  const places = evts.map(e => ({
    e,
    col1: Math.max(0, diffJours(new Date(e.jour + "T00:00"), jours[0])),
    col2: Math.min(jours.length - 1, diffJours(new Date(e.jour_fin + "T00:00"), jours[0])),
  })).sort((a, b) => a.col1 - b.col1 || a.col2 - b.col2);
  const finRangee = [];
  for (const p of places) {
    let r = finRangee.findIndex(fin => fin < p.col1);
    if (r < 0) { r = finRangee.length; finRangee.push(-1); }
    finRangee[r] = p.col2;
    p.rangee = r;
  }
  return places;
}

// ---- vues jour et semaine : grille horaire ----
function rendreGrilleAgenda(jours) {
  const grille = document.getElementById("agenda-grille");
  grille.style.setProperty("--agenda-jours", jours.length);
  grille.style.setProperty("--agenda-heure", AGENDA_HEURE_HAUTEUR + "px");

  const entete = jours.map(d => `
    <button type="button" class="agenda-jour-entete${estAujourdhui(d) ? " aujourdhui" : ""}" data-aller-jour="${formaterDateISO(d)}"${jours.length > 1 ? ` aria-label="Voir la journée du ${jourLong(d)}"` : " disabled"}>
      <span class="agenda-jour-nom">${nomCourtJour(d)}</span><span class="agenda-jour-num">${d.getDate()}</span>
    </button>`).join("");

  const toutJourPlaces = disposerToutJour(evenementsToutJour(jours), jours);
  const toutJour = toutJourPlaces.length ? `
    <div class="agenda-toutjour">
      <span class="agenda-coin" aria-hidden="true"></span>
      ${toutJourPlaces.map(p => `
        <div class="agenda-toutjour-barre${classeAbsence(p.e)}" data-id="${p.e.id}" tabindex="0" role="button"
             style="${styleType(p.e)}grid-column:${p.col1 + 2} / ${p.col2 + 3};grid-row:${p.rangee + 1}" aria-label="${echapper(descriptionEvenement(p.e))}">
          ${echapper(p.e.titre)}
        </div>`).join("")}
    </div>` : "";

  let heures = "";
  for (let h = 1; h < 24; h++) heures += `<span style="top:${h * AGENDA_HEURE_HAUTEUR}px">${String(h).padStart(2, "0")}:00</span>`;

  const colonnes = jours.map(d => {
    const iso = formaterDateISO(d);
    let cases = "";
    for (let h = 0; h < 24; h++) {
      const debut = String(h).padStart(2, "0") + ":00";
      const fin = h === 23 ? "23:59" : String(h + 1).padStart(2, "0") + ":00";
      cases += `<button type="button" class="agenda-case" data-jour="${iso}" data-heure-debut="${debut}" data-heure-fin="${fin}" aria-label="Ajouter un événement le ${jourLong(d)} à ${debut}"></button>`;
    }
    const evts = disposerEvenements(evenementsDu(iso).filter(e => e.heure_debut)).map(p => {
      const top = (p.debut / 60) * AGENDA_HEURE_HAUTEUR;
      const hauteur = Math.max(((p.fin - p.debut) / 60) * AGENDA_HEURE_HAUTEUR - 2, 22);
      const largeur = 100 / p.nbCols;
      return `
        <div class="agenda-evenement${hauteur < 44 ? " court" : ""}" data-id="${p.e.id}" tabindex="0" role="button"
             style="${styleType(p.e)}top:${top}px;height:${hauteur}px;left:calc(${p.col * largeur}% + 2px);width:calc(${largeur}% - 4px)" aria-label="${echapper(descriptionEvenement(p.e))}">
          <span class="agenda-evenement-titre">${echapper(p.e.titre)}</span>
          <span class="agenda-evenement-heure">${texteHoraire(p.e)}</span>
        </div>`;
    }).join("");
    const maintenant = estAujourdhui(d)
      ? `<div class="agenda-maintenant" style="top:${(minutesDepuisMinuit(heureActuelleHHMM()) / 60) * AGENDA_HEURE_HAUTEUR}px"></div>` : "";
    return `<div class="agenda-colonne${estAujourdhui(d) ? " aujourdhui" : ""}">${cases}${evts}${maintenant}</div>`;
  }).join("");

  grille.className = "agenda-grille agenda-horaire";
  grille.innerHTML = `
    <div class="agenda-horaire-fixe">
      <div class="agenda-horaire-entete"><span class="agenda-coin"></span>${entete}</div>
      ${toutJour}
    </div>
    <div class="agenda-horaire-corps"><div class="agenda-heures" aria-hidden="true">${heures}</div>${colonnes}</div>`;
}

// ---- vue mois ----
function rendreMoisAgenda() {
  const grille = document.getElementById("agenda-grille");
  const moisCourant = AGENDA_REF.getMonth();
  const nomsJours = joursDeLaPeriode().slice(0, 7).map(d => `<span>${nomCourtJour(d)}</span>`).join("");
  const cases = joursDeLaPeriode().map(d => {
    const iso = formaterDateISO(d);
    const evs = evenementsDu(iso);
    const puces = evs.slice(0, 3).map(e => `
      <span class="agenda-mois-evenement${classeAbsence(e)}" style="${styleType(e)}" data-id="${e.id}" tabindex="0" role="button" aria-label="${echapper(descriptionEvenement(e))}">
        ${e.heure_debut ? `<span class="agenda-mois-heure">${e.heure_debut}</span> ` : ""}${echapper(e.titre)}
      </span>`).join("");
    const plus = evs.length > 3 ? `<button type="button" class="agenda-mois-plus" data-aller-jour="${iso}">${evs.length - 3} de plus</button>` : "";
    return `
      <div class="agenda-mois-case${d.getMonth() !== moisCourant ? " hors-mois" : ""}${estAujourdhui(d) ? " aujourdhui" : ""}" data-jour="${iso}">
        <button type="button" class="agenda-mois-num" data-aller-jour="${iso}" aria-label="Voir la journée du ${jourLong(d)}">${d.getDate()}</button>
        <div class="agenda-mois-evenements">${puces}${plus}</div>
        <button type="button" class="agenda-mois-ajouter" data-ajouter-jour="${iso}" aria-label="Ajouter un événement le ${jourLong(d)}"><svg class="ico" aria-hidden="true"><use href="#ico-plus"></use></svg></button>
      </div>`;
  }).join("");
  grille.className = "agenda-grille agenda-mois";
  grille.innerHTML = `<div class="agenda-mois-entete">${nomsJours}</div><div class="agenda-mois-corps">${cases}</div>`;
}

// ---- vue liste (téléphone) : bandeau de la semaine, rendez-vous du jour choisi ----
function rendreListeAgenda() {
  const grille = document.getElementById("agenda-grille");
  const choisi = formaterDateISO(AGENDA_REF);
  const bandeau = joursDeLaPeriode().map(d => {
    const iso = formaterDateISO(d);
    const points = evenementsDu(iso).slice(0, 3).map(e => `<i style="${styleType(e)}"></i>`).join("");
    const nb = evenementsDu(iso).length;
    return `<button type="button" class="agenda-bandeau-jour${iso === choisi ? " actif" : ""}${estAujourdhui(d) ? " aujourdhui" : ""}" data-choisir-jour="${iso}"
        aria-pressed="${iso === choisi}" aria-label="${jourLong(d)}${nb ? `, ${nb} événement${nb > 1 ? "s" : ""}` : ""}">
      <span class="agenda-jour-nom">${nomCourtJour(d)}</span><span class="agenda-jour-num">${d.getDate()}</span><span class="agenda-points">${points}</span>
    </button>`;
  }).join("");
  const evs = evenementsDu(choisi);
  const liste = evs.length
    ? `<ul class="agenda-liste-evenements">${evs.map(e => `
        <li><div class="agenda-carte${classeAbsence(e)}" style="${styleType(e)}" data-id="${e.id}" tabindex="0" role="button" aria-label="${echapper(descriptionEvenement(e))}">
          <span class="agenda-carte-heures">${e.heure_debut ? `${e.heure_debut}<small>${e.heure_fin}</small>` : "<small>Toute la journée</small>"}</span>
          <span class="agenda-carte-texte"><strong>${echapper(e.titre)}</strong><small>${typeDe(e) ? `${echapper(typeDe(e).nom)} · ` : ""}${echapper(e.destinataire || "Moi")}${e.auteur && !e.mien ? ` · ajouté par ${echapper(e.auteur)}` : ""}${e.absence ? ` · ${libelleStatutAbsence(e)}` : ""}</small></span>
        </div></li>`).join("")}</ul>`
    : `<p class="agenda-vide">Rien de prévu ce jour-là.</p>`;
  grille.className = "agenda-grille agenda-liste";
  grille.innerHTML = `
    <div class="agenda-bandeau" role="group" aria-label="Jours de la semaine">${bandeau}</div>
    <h2 class="agenda-liste-titre">${jourLong(AGENDA_REF)}</h2>
    ${liste}
    <button type="button" class="btn btn-fantome agenda-liste-ajouter" data-ajouter-jour="${choisi}"><svg class="ico" aria-hidden="true"><use href="#ico-plus"></use></svg> Ajouter un événement</button>`;
}

function rendreAgenda(reinitialiserDefilement) {
  const vue = agendaVue();
  const conteneur = document.getElementById("agenda-grille-conteneur");
  conteneur.dataset.vue = vue;
  if (vue === "mois") return rendreMoisAgenda();
  if (vue === "liste") return rendreListeAgenda();
  const scrollAvant = conteneur.scrollTop;
  rendreGrilleAgenda(joursDeLaPeriode());
  if (reinitialiserDefilement) defilerVersMaintenant();
  else conteneur.scrollTop = scrollAvant;
}

async function chargerAgenda(reinitialiserDefilement) {
  majEnteteAgenda();
  gestion.message("zone-message-agenda", "");
  const { debut, fin } = periodeAgenda();
  try {
    const data = await socle.api(`/api/agenda?debut=${formaterDateISO(debut)}&fin=${formaterDateISO(fin)}`);
    CACHE_EVENEMENTS = data.evenements || [];
    if (data.droits) AGENDA_DROITS = data.droits;
    if (data.types) { AGENDA_TYPES = data.types; dessinerLegende(); }
  } catch (e) {
    gestion.message("zone-message-agenda", "Impossible de charger l’agenda : " + e.message);
    CACHE_EVENEMENTS = [];
  }
  rendreAgenda(reinitialiserDefilement);
}

// Un seul écouteur pour la grille, quelle que soit la vue (elle est redessinée à chaque changement).
const grilleAgenda = document.getElementById("agenda-grille");
function ouvrirEvenementExistant(id) {
  const e = CACHE_EVENEMENTS.find(x => String(x.id) === String(id));
  if (e) ouvrirModaleEvenement({ id: e.id, jour: e.jour, jourFin: e.jour_fin, heureDebut: e.heure_debut, heureFin: e.heure_fin, titre: e.titre, notes: e.notes, evenement: e });
}
grilleAgenda.addEventListener("click", ev => {
  const cible = ev.target.closest("[data-id], [data-aller-jour], [data-choisir-jour], [data-ajouter-jour], .agenda-case");
  if (!cible) return;
  if (cible.dataset.id) return ouvrirEvenementExistant(cible.dataset.id);
  if (cible.dataset.allerJour) { AGENDA_REF = new Date(cible.dataset.allerJour + "T00:00"); AGENDA_VUE_CHOISIE = "jour"; return chargerAgenda(true); }
  if (cible.dataset.choisirJour) { AGENDA_REF = new Date(cible.dataset.choisirJour + "T00:00"); majEnteteAgenda(); return rendreAgenda(false); }
  if (cible.dataset.ajouterJour) return ouvrirModaleEvenement({ jour: cible.dataset.ajouterJour });
  ouvrirModaleEvenement({ jour: cible.dataset.jour, heureDebut: cible.dataset.heureDebut, heureFin: cible.dataset.heureFin });
});
grilleAgenda.addEventListener("keydown", ev => {
  const el = ev.target.closest("[data-id][role=button]");
  if (el && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); ouvrirEvenementExistant(el.dataset.id); }
});

// Onglet Participants : pas de sélecteur propre, il affiche la période choisie ici (jour, semaine ou mois).
const panneauParticipantsVisible = () => !document.getElementById("panneau-agenda-participants").classList.contains("cache");
async function chargerPeriode(reinitialiserDefilement) {
  await chargerAgenda(reinitialiserDefilement);
  if (panneauParticipantsVisible()) chargerParticipants();
}
document.getElementById("agenda-semaine-precedente").addEventListener("click", () => { decalerAgenda(-1); chargerPeriode(true); });
document.getElementById("agenda-semaine-suivante").addEventListener("click", () => { decalerAgenda(1); chargerPeriode(true); });
// Raccourci T (« today », comme les agendas courants) : revient à la période actuelle. Ignoré pendant une saisie, une
// fenêtre ouverte ou avec Ctrl / Alt / Cmd ; « t » ou « T » (avec Maj, la touche arrive en majuscule). Le bouton
// s'illumine un instant : on voit ce que la touche a fait. En jeu, le clavier reste au jeu hors des champs : le bouton suffit.
document.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1 || e.key.toLowerCase() !== "t") return;
  if (e.target.closest?.("input, textarea, select, [contenteditable]") || document.querySelector(".modale-fond:not(.cache), [role=alertdialog]")) return;
  e.preventDefault();
  const bouton = document.getElementById("agenda-aujourdhui");
  bouton.click();
  bouton.classList.remove("raccourci");
  void bouton.offsetWidth;   // relance l'animation si la touche est répétée
  bouton.classList.add("raccourci");
});
document.getElementById("agenda-aujourdhui").addEventListener("click", () => {
  AGENDA_REF = aujourdhuiParis();
  chargerPeriode(true);
});
document.querySelectorAll(".agenda-vue-bouton").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.vue === AGENDA_VUE_CHOISIE) return;
    AGENDA_VUE_CHOISIE = btn.dataset.vue;
    chargerPeriode(true);
  });
});
AGENDA_TELEPHONE.addEventListener("change", () => chargerAgenda(true));
document.getElementById("agenda-nouvel-evenement").addEventListener("click", () => {
  // le jour choisi (liste, jour), sinon aujourd'hui s'il est dans la période affichée, sinon son premier jour
  const { debut, fin } = periodeAgenda();
  const auj = aujourdhuiParis();
  const vue = agendaVue();
  const jour = vue === "liste" || vue === "jour" ? AGENDA_REF : auj >= debut && auj <= fin ? auj : debut;
  ouvrirModaleEvenement({ jour: formaterDateISO(jour) });
});

// ---- fenêtre « ajouter / modifier un événement » ----

// droits renvoyés par GET /api/agenda (destinataires proposés à la création) ; types et personnes qu'on peut inviter
let AGENDA_DROITS = { destinations: [{ valeur: "perso", libelle: "Personnel" }], peut_inviter: false };
let AGENDA_TYPES = [];
let AGENDA_PERSONNES = null;
let AGENDA_ERREUR_PERSONNES = "";
let AGENDA_MOI = null;
let AGENDA_INVITES_SELECTIONNES = [];
let AGENDA_INVITES_ACTIF = -1;
const COULEUR_SANS_TYPE = "#d4b26a";   // l'or de la maison : un événement sans type
const typeDe = e => AGENDA_TYPES.find(t => t.id === e.type_id) || null;
// couleur d'un type (#rrggbb, contrôlée par le serveur) → variables de la grille ; fonds calculés ici (pas de color-mix :
// le navigateur de l'ordinateur en jeu est ancien)
function styleType(e) {
  const c = /^#[0-9a-f]{6}$/i.test(typeDe(e)?.couleur || "") ? typeDe(e).couleur : COULEUR_SANS_TYPE;
  const rvb = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)).join(", ");
  return `--vis:${c};--vis-fond:rgba(${rvb}, 0.16);--vis-fond-fort:rgba(${rvb}, 0.28);--vis-bord:rgba(${rvb}, 0.45);`;
}
const valeurDestination = e => (e.destination === "grade" ? `grade:${e.destination_grade}` : e.destination === "tous" ? "tous" : "perso");

// légende : les types et leur couleur ; « Gérer les types » pour qui en a le droit
function dessinerLegende() {
  const legende = document.getElementById("agenda-legende");
  const gere = !!AGENDA_MOI && socle.peut(AGENDA_MOI, "agenda-types");
  legende.classList.toggle("cache", !AGENDA_TYPES.length && !gere);
  legende.innerHTML = (AGENDA_TYPES.length
    ? `<span class="agenda-legende-titre">Types</span>` + AGENDA_TYPES.map(t => `<span class="agenda-pastille" style="${styleType({ type_id: t.id })}">${echapper(t.nom)}</span>`).join("")
    : `<span class="agenda-legende-titre">Aucun type d’événement pour l’instant.</span>`)
    + (gere ? `<button type="button" class="agenda-legende-gerer" data-gerer-types>${AGENDA_TYPES.length ? "Gérer les types" : "Créer des types"}</button>` : "");
}

async function remplirChoixInvites() {
  if (AGENDA_PERSONNES === null) {
    try {
      AGENDA_PERSONNES = (await socle.api("/api/agenda/personnes")).personnes || [];
      AGENDA_PERSONNES.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
      AGENDA_ERREUR_PERSONNES = "";
    } catch (e) { AGENDA_ERREUR_PERSONNES = e.message; }
  }
  if (AGENDA_ERREUR_PERSONNES) {
    document.getElementById("recherche-evenement-invites").disabled = true;
    document.getElementById("etat-evenement-invites").textContent = `Impossible de charger les personnes : ${AGENDA_ERREUR_PERSONNES}`;
    return;
  }
  document.getElementById("recherche-evenement-invites").disabled = false;
  dessinerInvitesSelectionnes();
  afficherSuggestionsInvites();
}

function dessinerInvitesSelectionnes() {
  const liste = document.getElementById("liste-evenement-invites");
  liste.innerHTML = AGENDA_INVITES_SELECTIONNES.map(p => `
    <li class="agenda-invite-puce${p.present === false ? " agenda-invite-absent" : ""}">
      ${p.source === "invitation" ? `<button type="button" class="agenda-invite-presence" data-presence-invite="${Number(p.invitation_id)}" aria-pressed="${p.present !== false}">${p.present === false ? "Absent" : "Présent"}</button>` : ""}
      <span>${echapper(p.nom)}</span>
      <button type="button" data-retirer-invite="${p.source === "invitation" ? `invitation:${Number(p.invitation_id)}` : `employe:${Number(p.id)}`}" aria-label="Retirer ${echapper(p.nom)} des invités">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8"></path></svg>
      </button>
    </li>`).join("");
  document.getElementById("etat-evenement-invites").textContent = AGENDA_INVITES_SELECTIONNES.length
    ? `${AGENDA_INVITES_SELECTIONNES.length} ${AGENDA_INVITES_SELECTIONNES.length === 1 ? "personne invitée" : "personnes invitées"}.`
    : AGENDA_PERSONNES && !AGENDA_PERSONNES.some(p => p.discord)
      ? "Aucune personne ne peut être invitée avec les droits de votre grade."
      : "Aucune personne sélectionnée. Commencez à saisir un nom pour rechercher.";
}

const normaliserNomInvite = nom => String(nom || "").toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function afficherSuggestionsInvites() {
  const saisie = document.getElementById("recherche-evenement-invites");
  const suggestions = document.getElementById("suggestions-evenement-invites");
  const terme = normaliserNomInvite(saisie.value.trim());
  if (!terme) {
    suggestions.classList.add("cache");
    saisie.setAttribute("aria-expanded", "false");
    saisie.removeAttribute("aria-activedescendant");
    AGENDA_INVITES_ACTIF = -1;
    return;
  }
  const selectionnes = new Set(AGENDA_INVITES_SELECTIONNES.filter(p => p.source === "employe").map(p => Number(p.id)));
  const nomsSelectionnes = new Set(AGENDA_INVITES_SELECTIONNES.map(p => normaliserNomInvite(p.nom)));
  const personnes = AGENDA_PERSONNES || [];
  const correspondantes = personnes.filter(p => !selectionnes.has(Number(p.id)) && !nomsSelectionnes.has(normaliserNomInvite(p.nom))
    && normaliserNomInvite(p.nom).includes(terme));
  const disponibles = correspondantes.filter(p => p.discord).slice(0, 6);
  AGENDA_INVITES_ACTIF = -1;
  saisie.removeAttribute("aria-activedescendant");
  if (!disponibles.length) {
    const sansDiscord = correspondantes.length > 0;
    const texte = sansDiscord
      ? "Cette personne n’a pas de compte Discord relié et ne peut pas être invitée."
      : "Aucun résultat. Essayez un autre nom.";
    suggestions.innerHTML = `<li class="agenda-invites-vide" role="option" aria-disabled="true" aria-selected="false">${echapper(texte)}</li>`;
  } else {
    suggestions.innerHTML = disponibles.map((p, i) => `
      <li id="suggestion-invite-${i}" role="option" aria-selected="false" data-invite-id="${Number(p.id)}">${echapper(p.nom)}</li>`).join("");
    if (correspondantes.filter(p => p.discord).length > disponibles.length) {
      document.getElementById("etat-evenement-invites").textContent = "Plusieurs résultats : précisez le nom pour affiner la recherche.";
    }
  }
  suggestions.classList.remove("cache");
  saisie.setAttribute("aria-expanded", "true");
}

function choisirInvite(id) {
  const personne = AGENDA_PERSONNES?.find(p => Number(p.id) === Number(id));
  if (!personne || !personne.discord || AGENDA_INVITES_SELECTIONNES.some(p => p.source === "employe" && Number(p.id) === Number(id))) return;
  AGENDA_INVITES_SELECTIONNES.push({ ...personne, source: "employe" });
  document.getElementById("recherche-evenement-invites").value = "";
  document.getElementById("recherche-evenement-invites").disabled = false;
  dessinerInvitesSelectionnes();
  afficherSuggestionsInvites();
  document.getElementById("recherche-evenement-invites").focus();
}

function majChampInvites() {
  const perso = document.getElementById("evenement-destination").value === "perso";
  const invitationExistante = AGENDA_INVITES_SELECTIONNES.some(p => p.source === "invitation");
  const visible = modeEvenementChoisi() === "evenement" && AGENDA_EVENEMENT_MODIFIABLE && perso && (AGENDA_DROITS.peut_inviter || invitationExistante);
  document.getElementById("champ-evenement-invites").classList.toggle("cache", !visible);
  const recherche = document.getElementById("recherche-evenement-invites");
  recherche.disabled = !AGENDA_DROITS.peut_inviter;
  if (!AGENDA_DROITS.peut_inviter) {
    document.getElementById("suggestions-evenement-invites").classList.add("cache");
    recherche.setAttribute("aria-expanded", "false");
  }
}

// Événement ou Absence : choisi à la création seulement, jamais changé après (comme l'était la case « C'est une
// absence »). Une absence est toujours personnelle et n'a ni titre libre, ni horaire, ni partage, ni invités : le
// titre se déduit du motif, les notes restent le seul texte libre.
const modeEvenementChoisi = () => document.querySelector("#evenement-mode-filtres .comptes-filtre.actif")?.dataset.modeEvenement || "evenement";
function majModeEvenement() {
  const absence = modeEvenementChoisi() === "absence";
  document.getElementById("champ-evenement-titre").classList.toggle("cache", absence);
  document.getElementById("champ-evenement-motif").classList.toggle("cache", !absence);
  document.getElementById("champ-evenement-classement").classList.toggle("cache", absence);
  majChampHeures();
  majChampInvites();
}
document.getElementById("evenement-mode-filtres").addEventListener("click", e => {
  const b = e.target.closest("[data-mode-evenement]");
  if (!b) return;
  document.querySelectorAll("#evenement-mode-filtres [data-mode-evenement]").forEach(x => { x.classList.toggle("actif", x === b); x.setAttribute("aria-pressed", String(x === b)); });
  majModeEvenement();
});

const dateCourteFr = iso => new Date(iso + "T00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const MOTIFS_ABSENCE = { conge: "Congé", maladie: "Maladie", personnel: "Personnel", autre: "Autre" };
const ETATS_ABSENCE = {
  en_attente: ["En attente de validation", "puce-or"],
  approuve: ["Approuvée", "puce-ok"],
  refuse: ["Refusée", "puce-off"],
};

let OUVREUR_EVENEMENT = null;
let AGENDA_EVENEMENT_MODIFIABLE = true;
function ouvrirModaleEvenement(options) {
  const o = options || {};
  const e = o.evenement || null;
  const estEdition = !!o.id;
  const estAbsence = !!(e && e.absence);
  const modifiable = !e || e.modifiable;
  AGENDA_EVENEMENT_MODIFIABLE = modifiable;
  OUVREUR_EVENEMENT = document.activeElement;
  document.getElementById("titre-modale-evenement").textContent = !modifiable ? (estAbsence ? "Absence" : "Événement") : estEdition ? "Modifier l’événement" : "Nouvel événement";
  document.getElementById("evenement-id").value = o.id || "";
  document.getElementById("evenement-titre").value = o.titre || "";
  document.getElementById("evenement-jour").value = o.jour || maintenantParis().iso;
  document.getElementById("evenement-jour-fin").value = o.jourFin || o.jour || maintenantParis().iso;
  document.getElementById("evenement-heure-debut").value = o.heureDebut || "09:00";
  document.getElementById("evenement-heure-fin").value = o.heureFin || "10:00";
  document.getElementById("evenement-notes").value = o.notes || "";

  // choix Événement/Absence : à la création seulement, jamais changé après (l'édition garde le mode de l'existant)
  document.getElementById("champ-evenement-mode").classList.toggle("cache", estEdition);
  document.querySelectorAll("#evenement-mode-filtres [data-mode-evenement]").forEach(b => {
    const actif = b.dataset.modeEvenement === (estAbsence ? "absence" : "evenement");
    b.classList.toggle("actif", actif); b.setAttribute("aria-pressed", String(actif));
  });
  const selectMotif = document.getElementById("evenement-motif");
  selectMotif.value = (e && e.absence_motif) || "conge";
  majModeEvenement();

  // Type : « Sans type » puis les types de la Direction (un type supprimé depuis : « Sans type »)
  const selectType = document.getElementById("evenement-type");
  selectType.innerHTML = `<option value="">Sans type</option>` + AGENDA_TYPES.map(t => `<option value="${Number(t.id)}">${echapper(t.nom)}</option>`).join("");
  selectType.value = e && typeDe(e) ? String(e.type_id) : "";
  ameliorerSelect(selectType, v => AGENDA_TYPES.find(t => String(t.id) === v)?.couleur || COULEUR_SANS_TYPE);
  document.getElementById("champ-evenement-type").classList.toggle("cache", !AGENDA_TYPES.length);

  // Partage : les choix proposés sont limités aux droits de ce compte.
  const destination = e ? valeurDestination(e) : "perso";
  const choix = [...AGENDA_DROITS.destinations];
  if (!choix.some(c => c.valeur === destination)) choix.push({ valeur: destination, libelle: e.destinataire || destination });
  const selectDest = document.getElementById("evenement-destination");
  selectDest.innerHTML = choix.map(c => `<option value="${echapper(c.valeur)}">${echapper(c.libelle)}</option>`).join("");
  selectDest.value = destination;
  // Une liste d'invités ne peut coexister qu'avec un événement personnel.
  const destinationFigee = !!(e && e.invites?.length);
  ameliorerSelect(selectDest);
  AGENDA_INVITES_SELECTIONNES = (e?.invites || []).map(i => ({ source: "invitation", invitation_id: Number(i.invitation_id), nom: i.nom, present: i.present !== false }));
  document.getElementById("recherche-evenement-invites").value = "";
  document.getElementById("suggestions-evenement-invites").classList.add("cache");
  document.getElementById("recherche-evenement-invites").setAttribute("aria-expanded", "false");
  document.getElementById("etat-evenement-invites").textContent = "Chargement des personnes…";
  dessinerInvitesSelectionnes();
  if (modifiable && AGENDA_DROITS.peut_inviter) remplirChoixInvites();
  dessinerInvitesSelectionnes();
  majChampInvites();

  // bandeau d'état d'une absence existante : qui, quand, motif et statut en un coup d'œil (pas qu'un formulaire grisé)
  const bandeau = document.getElementById("evenement-absence-bandeau");
  bandeau.classList.toggle("cache", !estAbsence);
  if (estAbsence) {
    const [libelleEtat, classeEtat] = ETATS_ABSENCE[e.statut_absence] || ETATS_ABSENCE.en_attente;
    document.getElementById("evenement-absence-pastille").className = `puce ${classeEtat}`;
    document.getElementById("evenement-absence-pastille").textContent = libelleEtat;
    const periode = e.jour === e.jour_fin ? `le ${dateCourteFr(e.jour)}` : `du ${dateCourteFr(e.jour)} au ${dateCourteFr(e.jour_fin)}`;
    document.getElementById("evenement-absence-resume").textContent = `${e.auteur || "Cette personne"} · ${periode} · ${e.absence_motif_libelle || MOTIFS_ABSENCE[e.absence_motif] || "Motif inconnu"}${e.absence_motif_refus ? ` · ${e.absence_motif_refus}` : ""}`;
  }
  document.getElementById("champ-refus-absence-motif").classList.toggle("cache", !(e && e.peut_valider));
  document.getElementById("refus-absence-motif").value = "";

  // origine : qui l'a ajouté, qui a été invité et comment les personnes ont été prévenues
  const origine = document.getElementById("evenement-origine");
  const lignes = [];
  if (e && !e.mien && e.auteur) lignes.push(`Ajouté par ${e.auteur}.`);
  if (e?.invites?.length) {
    lignes.push(`Invités : ${e.invites.map(i => i.nom).join(", ")}.`);
    const nonPrevenus = e.invites.filter(i => !i.prevenu).map(i => i.nom);
    if (e.mien && nonPrevenus.length) lignes.push(`Pas prévenu sur Discord : ${nonPrevenus.join(", ")}.`);
  }
  origine.textContent = lignes.join(" ");
  origine.classList.toggle("cache", !lignes.length);

  document.querySelectorAll("#formulaire-evenement input, #formulaire-evenement textarea, #formulaire-evenement select")
    .forEach(c => { c.disabled = !modifiable; });
  if (destinationFigee) selectDest.disabled = true;
  selectMotif.disabled = estEdition || !modifiable;   // motif fixé à la création, jamais changé après coup
  if (e && e.peut_valider) document.getElementById("refus-absence-motif").disabled = false;   // la personne qui valide peut toujours écrire un motif de refus
  document.getElementById("bouton-enregistrer-evenement").classList.toggle("cache", !modifiable);
  document.getElementById("bouton-enregistrer-evenement").textContent = estEdition ? "Enregistrer" : "Ajouter";
  document.getElementById("bouton-supprimer-evenement").classList.toggle("cache", !estEdition || !modifiable);
  document.getElementById("bouton-approuver-absence").classList.toggle("cache", !(e && e.peut_valider));
  document.getElementById("bouton-refuser-absence").classList.toggle("cache", !(e && e.peut_valider));
  document.querySelectorAll("#formulaire-evenement .champ-erreur").forEach(p => p.classList.add("cache"));
  gestion.message("zone-message-modale-evenement", "");
  document.getElementById("modale-evenement").classList.remove("cache");
  const premierChamp = estAbsence && !estEdition ? selectMotif
    : document.getElementById("champ-evenement-type").classList.contains("cache") ? document.getElementById("evenement-titre") : selectType;
  (modifiable ? premierChamp : document.getElementById("fermer-modale-evenement")).focus();
}

// sur plusieurs jours, pas d'horaire : l'événement occupe chaque journée entière (voir segmentJour) ; une absence
// n'a jamais d'horaire, quelle que soit sa durée
function majChampHeures() {
  const absence = modeEvenementChoisi() === "absence";
  const jour = document.getElementById("evenement-jour").value, jourFin = document.getElementById("evenement-jour-fin").value;
  const multi = absence || (!!jour && !!jourFin && jourFin !== jour);
  document.getElementById("champ-evenement-heures").classList.toggle("cache", multi);
  document.getElementById("evenement-plusieurs-jours").classList.toggle("cache", absence || !multi);
}
document.getElementById("evenement-jour").addEventListener("input", majChampHeures);
document.getElementById("evenement-jour-fin").addEventListener("input", majChampHeures);
document.getElementById("evenement-destination").addEventListener("change", majChampInvites);
const rechercheInvites = document.getElementById("recherche-evenement-invites");
rechercheInvites.addEventListener("focus", () => {
  if (AGENDA_DROITS.peut_inviter && !AGENDA_ERREUR_PERSONNES) afficherSuggestionsInvites();
});
rechercheInvites.addEventListener("input", afficherSuggestionsInvites);
rechercheInvites.addEventListener("blur", () => setTimeout(() => {
  if (document.activeElement === rechercheInvites) return;
  const suggestions = document.getElementById("suggestions-evenement-invites");
  suggestions.classList.add("cache");
  rechercheInvites.setAttribute("aria-expanded", "false");
  rechercheInvites.removeAttribute("aria-activedescendant");
}, 0));
rechercheInvites.addEventListener("keydown", e => {
  const suggestions = document.getElementById("suggestions-evenement-invites");
  const options = [...suggestions.querySelectorAll('[role="option"][data-invite-id]')];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!options.length) return;
    e.preventDefault();
    AGENDA_INVITES_ACTIF = AGENDA_INVITES_ACTIF < 0
      ? e.key === "ArrowDown" ? 0 : options.length - 1
      : (AGENDA_INVITES_ACTIF + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options.forEach((option, i) => option.setAttribute("aria-selected", String(i === AGENDA_INVITES_ACTIF)));
    rechercheInvites.setAttribute("aria-activedescendant", options[AGENDA_INVITES_ACTIF].id);
  } else if (e.key === "Enter" && AGENDA_INVITES_ACTIF >= 0 && options[AGENDA_INVITES_ACTIF]) {
    e.preventDefault();
    choisirInvite(options[AGENDA_INVITES_ACTIF].dataset.inviteId);
  } else if (e.key === "Enter" && !suggestions.classList.contains("cache")) {
    e.preventDefault();
  } else if (e.key === "Escape" && !suggestions.classList.contains("cache")) {
    e.preventDefault();
    e.stopPropagation();
    suggestions.classList.add("cache");
    rechercheInvites.setAttribute("aria-expanded", "false");
    rechercheInvites.removeAttribute("aria-activedescendant");
  }
});
document.getElementById("suggestions-evenement-invites").addEventListener("pointerdown", e => {
  if (e.target.closest("[data-invite-id]")) e.preventDefault();
});
document.getElementById("suggestions-evenement-invites").addEventListener("click", e => {
  const option = e.target.closest("[data-invite-id]");
  if (option) choisirInvite(option.dataset.inviteId);
});
document.getElementById("liste-evenement-invites").addEventListener("click", e => {
  const presence = e.target.closest("[data-presence-invite]");
  if (presence) {
    const id = Number(presence.dataset.presenceInvite);
    const p = AGENDA_INVITES_SELECTIONNES.find(x => x.source === "invitation" && Number(x.invitation_id) === id);
    if (p) p.present = p.present === false;   // bascule présent/absent
    dessinerInvitesSelectionnes();
    document.querySelector(`[data-presence-invite="${id}"]`)?.focus();
    return;
  }
  const bouton = e.target.closest("[data-retirer-invite]");
  if (!bouton) return;
  const [source, id] = bouton.dataset.retirerInvite.split(":");
  AGENDA_INVITES_SELECTIONNES = AGENDA_INVITES_SELECTIONNES.filter(p => source === "invitation"
    ? p.source !== "invitation" || Number(p.invitation_id) !== Number(id)
    : p.source !== "employe" || Number(p.id) !== Number(id));
  dessinerInvitesSelectionnes();
  majChampInvites();
  afficherSuggestionsInvites();
  rechercheInvites.focus();
});
champDateFr(document.getElementById("evenement-jour"));
champDateFr(document.getElementById("evenement-jour-fin"));
champHeureFr(document.getElementById("evenement-heure-debut"));
champHeureFr(document.getElementById("evenement-heure-fin"));

function fermerModaleEvenement() {
  fermerSelectOuvert();
  document.getElementById("modale-evenement").classList.add("cache");
  if (OUVREUR_EVENEMENT?.isConnected) OUVREUR_EVENEMENT.focus();   // le focus revient d'où l'on venait
}

document.getElementById("fermer-modale-evenement").addEventListener("click", fermerModaleEvenement);
document.getElementById("modale-evenement").addEventListener("click", ev => { if (ev.target.id === "modale-evenement") fermerModaleEvenement(); });
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && !document.getElementById("modale-evenement").classList.contains("cache") && !document.querySelector("[role=alertdialog]")) {
    ev.preventDefault();
    fermerModaleEvenement();
  }
});

document.getElementById("formulaire-evenement").addEventListener("submit", async ev => {
  ev.preventDefault();
  gestion.message("zone-message-modale-evenement", "");
  document.querySelectorAll("#formulaire-evenement .champ-erreur").forEach(p => p.classList.add("cache"));

  const absence = !document.getElementById("champ-evenement-motif").classList.contains("cache");
  const titre = document.getElementById("evenement-titre").value.trim();
  const jour = document.getElementById("evenement-jour").value;
  const jourFin = document.getElementById("evenement-jour-fin").value;
  const heureDebut = document.getElementById("evenement-heure-debut").value;
  const heureFin = document.getElementById("evenement-heure-fin").value;
  const multi = absence || (!!jour && !!jourFin && jourFin !== jour);
  let premierChamp = null;
  if (!jour) {
    document.getElementById("erreur-evenement-jour").classList.remove("cache");
    premierChamp = document.getElementById("evenement-jour");
  }
  if (!jourFin || (jour && jourFin < jour)) {
    document.getElementById("erreur-evenement-jour-fin").classList.remove("cache");
    premierChamp ||= document.getElementById("evenement-jour-fin");
  }
  if (!absence && !titre) {
    document.getElementById("erreur-evenement-titre").classList.remove("cache");
    premierChamp = document.getElementById("evenement-titre");
  }
  if (!absence && !multi && (!heureDebut || !heureFin || heureFin <= heureDebut)) {
    document.getElementById("erreur-evenement-heures").classList.remove("cache");
    premierChamp ||= document.getElementById("evenement-heure-fin");
  }
  if (premierChamp) { premierChamp.focus(); return; }

  const id = document.getElementById("evenement-id").value;
  const notes = document.getElementById("evenement-notes").value.trim();
  const payload = absence
    ? { jour, jour_fin: jourFin, notes, absence_motif: document.getElementById("evenement-motif").value, ...(id ? {} : { absence: true }) }
    : {
      titre, jour, jour_fin: jourFin,
      heure_debut: multi ? null : heureDebut, heure_fin: multi ? null : heureFin,
      notes, type_id: document.getElementById("evenement-type").value || null,
    };
  let invitesEmployes = [];
  if (!absence) {
    const dest = document.getElementById("evenement-destination").value || "perso";
    payload.destination = dest.startsWith("grade:") ? "grade" : dest;
    if (dest.startsWith("grade:")) payload.destination_grade = dest.slice(6);
    invitesEmployes = AGENDA_INVITES_SELECTIONNES.filter(p => p.source === "employe").map(p => Number(p.id));
    const invitationsExistantes = AGENDA_INVITES_SELECTIONNES.filter(p => p.source === "invitation").map(p => Number(p.invitation_id));
    if (dest === "perso") {
      payload.invites_employe_ids = invitesEmployes;
      if (id) {
        payload.invitation_ids = invitationsExistantes;
        payload.absents_invitation_ids = AGENDA_INVITES_SELECTIONNES.filter(p => p.source === "invitation" && p.present === false).map(p => Number(p.invitation_id));
      }
    }
  }
  const bouton = document.getElementById("bouton-enregistrer-evenement");
  const texteInitial = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = invitesEmployes.length ? "Enregistrement et invitations…" : "Enregistrement…";
  let reponse = null;
  try {
    if (id) reponse = await socle.api("/api/agenda/" + id, { method: "PUT", body: payload });
    else reponse = await socle.api("/api/agenda", { method: "POST", body: payload });
    // l'agenda se place sur le jour de l'événement, pour qu'on le voie apparaître
    AGENDA_REF = new Date(jour + "T00:00");
    fermerModaleEvenement();
    await chargerAgenda(false);
    const tickets = reponse?.notifications?.filter(n => n.prevenu === "ticket").length || 0;
    const prives = reponse?.notifications?.filter(n => n.prevenu === "prive").length || 0;
    const resume = [
      tickets && `${tickets} ${tickets === 1 ? "invitation envoyée dans un ticket" : "invitations envoyées dans des tickets"} Discord`,
      prives && `${prives} ${prives === 1 ? "invitation envoyée en message privé" : "invitations envoyées en messages privés"} Discord`,
      // Discord lent ou beaucoup d'invités : la page n'attend pas, les dernières invitations partent juste après
      reponse?.en_cours && `${reponse.en_cours} ${reponse.en_cours === 1 ? "invitation encore en cours d’envoi" : "invitations encore en cours d’envoi"} sur Discord`,
      reponse?.annulations && `${reponse.annulations} ${reponse.annulations === 1 ? "annulation signalée" : "annulations signalées"} sur Discord`,
    ].filter(Boolean).join(" et ");
    const action = absence ? (id ? "Absence enregistrée" : "Demande d’absence envoyée, en attente de validation") : id ? "Événement enregistré" : "Événement créé";
    if (reponse?.avertissements?.length) {
      gestion.message("zone-message-agenda", `${action}${resume ? ` ; ${resume}` : ""}. ${reponse.avertissements.join(" ")}`);
    } else if (resume) gestion.notifier(`${action} ; ${resume} ✓`);
    else gestion.notifier(`${action} ✓`);
  } catch (e) {
    gestion.message("zone-message-modale-evenement", e.message);
  } finally {
    bouton.disabled = false;
    bouton.textContent = texteInitial;
  }
});

document.getElementById("bouton-supprimer-evenement").addEventListener("click", async () => {
  const id = document.getElementById("evenement-id").value;
  if (!id) return;
  const ok = await gestion.confirmer("Cette action est définitive et ne peut pas être annulée.", "Supprimer cet événement ?", "Supprimer l’événement");
  if (!ok) return;
  try {
    await socle.api("/api/agenda/" + id, { method: "DELETE" });
    fermerModaleEvenement();
    chargerAgenda(false);
  } catch (e) {
    gestion.message("zone-message-modale-evenement", e.message);
  }
});

async function validerAbsence(approuve) {
  const id = document.getElementById("evenement-id").value;
  if (!id) return;
  const motif = document.getElementById("refus-absence-motif").value.trim();
  if (!approuve && !await gestion.confirmer("L’auteur en est prévenu sur Discord, avec le motif indiqué s’il y en a un. L’absence reste visible un mois puis disparaît.", "Refuser cette absence ?", "Refuser l’absence", { danger: true })) return;
  try {
    const reponse = await socle.api(`/api/agenda/${id}/absence`, { method: "POST", body: { approuve, motif: approuve ? undefined : motif } });
    fermerModaleEvenement();
    gestion.notifier(approuve ? "Absence approuvée ✓" : "Absence refusée ✓");
    if (reponse?.avertissement) gestion.message("zone-message-agenda", reponse.avertissement);
    chargerAgenda(false);
  } catch (e) {
    gestion.message("zone-message-modale-evenement", e.message);
  }
}
document.getElementById("bouton-approuver-absence").addEventListener("click", () => validerAbsence(true));
document.getElementById("bouton-refuser-absence").addEventListener("click", () => validerAbsence(false));

// ---- types d'événements (permission « agenda-types ») ----
// palette proposée pour un nouveau type : lisible sur le fond sombre, distincte de l'or « sans type »
const PALETTE_TYPES = ["#ef7f73", "#a99cf5", "#5fd39a", "#6fb7e8", "#e89a5f", "#d784c4", "#9fb4c7", "#e3cf6f"];
let OUVREUR_TYPES = null;
let TYPE_EN_EDITION = null;
const zoneTypes = () => document.getElementById("zone-message-types");

function dessinerTypes() {
  const ul = document.getElementById("types-liste");
  document.getElementById("types-compte").textContent = `${AGENDA_TYPES.length} ${AGENDA_TYPES.length === 1 ? "type" : "types"}`;
  ul.innerHTML = AGENDA_TYPES.length ? AGENDA_TYPES.map(t => `
    <li class="types-ligne${TYPE_EN_EDITION === t.id ? " en-edition" : ""}" data-type="${Number(t.id)}">
      ${TYPE_EN_EDITION === t.id ? `
        <div class="types-edition-champs">
          <div class="champ"><label for="type-nom-${Number(t.id)}">Nom du type</label><input type="text" id="type-nom-${Number(t.id)}" value="${echapper(t.nom)}" maxlength="40" data-champ="nom"></div>
          <div class="champ types-couleur"><label for="type-couleur-${Number(t.id)}">Couleur</label><input type="color" id="type-couleur-${Number(t.id)}" value="${echapper(t.couleur)}" data-champ="couleur"></div>
        </div>
        <div class="types-actions">
          <button type="button" class="btn btn-or" data-enregistrer-type>Enregistrer</button>
          <button type="button" class="btn btn-fantome" data-annuler-edition>Annuler</button>
        </div>` : `
        <div class="types-identite"><span class="types-pastille" style="background:${echapper(t.couleur)}" aria-hidden="true"></span><strong>${echapper(t.nom)}</strong></div>
        <div class="types-actions">
          <button type="button" class="btn btn-fantome" data-modifier-type>Modifier</button>
          <button type="button" class="types-supprimer" data-supprimer>Supprimer</button>
        </div>`}
    </li>`).join("") : `<li class="types-vide">Aucun type créé. Ajoutez-en un ci-dessous pour mieux repérer les événements.</li>`;
  const libres = PALETTE_TYPES.filter(c => !AGENDA_TYPES.some(t => t.couleur === c));
  document.getElementById("type-couleur").value = libres[0] || PALETTE_TYPES[AGENDA_TYPES.length % PALETTE_TYPES.length];
}

async function typesModifies(promesse, notification) {
  try {
    AGENDA_TYPES = (await promesse).types || [];
    gestion.message(zoneTypes(), "");
    if (notification) gestion.notifier(notification);
    dessinerTypes();
    dessinerLegende();
    rendreAgenda(false);
    return true;
  } catch (e) { gestion.message(zoneTypes(), e.message); }
  return false;
}

function ouvrirTypes() {
  OUVREUR_TYPES = document.activeElement;
  TYPE_EN_EDITION = null;
  dessinerTypes();
  gestion.message(zoneTypes(), "");
  document.getElementById("modale-types").classList.remove("cache");
  document.getElementById("type-nom").focus();
}
function fermerTypes() {
  document.getElementById("modale-types").classList.add("cache");
  // le bouton de la légende a pu être redessiné : on revient sur le nouveau
  (OUVREUR_TYPES?.isConnected ? OUVREUR_TYPES : document.querySelector("[data-gerer-types]"))?.focus();
}

document.getElementById("agenda-legende").addEventListener("click", ev => { if (ev.target.closest("[data-gerer-types]")) ouvrirTypes(); });
document.getElementById("fermer-modale-types").addEventListener("click", fermerTypes);
document.getElementById("modale-types").addEventListener("click", ev => { if (ev.target.id === "modale-types") fermerTypes(); });
document.getElementById("form-type").addEventListener("submit", ev => {
  ev.preventDefault();
  const nom = document.getElementById("type-nom").value.trim();
  if (!nom) { gestion.message(zoneTypes(), "Donnez un nom au type avant de l’ajouter."); document.getElementById("type-nom").focus(); return; }
  typesModifies(socle.api("/api/agenda/types", { method: "POST", body: { nom, couleur: document.getElementById("type-couleur").value } }), `Type « ${nom} » ajouté ✓`)
    .then(ok => { if (ok) document.getElementById("type-nom").value = ""; document.getElementById("type-nom").focus(); });
});
document.getElementById("types-liste").addEventListener("click", async ev => {
  const ligne = ev.target.closest("[data-type]");
  if (!ligne) return;
  const typeId = Number(ligne.dataset.type);
  if (ev.target.closest("[data-modifier-type]")) {
    TYPE_EN_EDITION = typeId;
    dessinerTypes();
    document.getElementById(`type-nom-${typeId}`).focus();
    return;
  }
  if (ev.target.closest("[data-annuler-edition]")) {
    TYPE_EN_EDITION = null;
    dessinerTypes();
    document.querySelector(`[data-type="${typeId}"] [data-modifier-type]`)?.focus();
    return;
  }
  if (ev.target.closest("[data-enregistrer-type]")) {
    const nom = ligne.querySelector('[data-champ="nom"]').value.trim();
    const couleur = ligne.querySelector('[data-champ="couleur"]').value;
    if (!nom) { gestion.message(zoneTypes(), "Donnez un nom au type."); ligne.querySelector('[data-champ="nom"]').focus(); return; }
    const ok = await typesModifies(socle.api(`/api/agenda/types/${typeId}`, { method: "PUT", body: { nom, couleur } }), `Type « ${nom} » enregistré ✓`);
    if (ok) {
      TYPE_EN_EDITION = null;
      dessinerTypes();
      document.querySelector(`[data-type="${typeId}"] [data-modifier-type]`)?.focus();
    }
    return;
  }
  const b = ev.target.closest("[data-supprimer]");
  if (!b) return;
  const t = AGENDA_TYPES.find(x => x.id === typeId);
  if (!t || !await gestion.confirmer("Ses événements restent dans l’agenda, sans type.", `Supprimer le type « ${t.nom} » ?`, "Supprimer le type")) return;
  const ok = await typesModifies(socle.api(`/api/agenda/types/${t.id}`, { method: "DELETE" }), `Type « ${t.nom} » supprimé ✓`);
  if (ok) document.getElementById("type-nom").focus();
});

// fenêtres de la page : Échap ferme, Tab reste dedans (sinon le clavier agit sur l'agenda caché derrière)
document.addEventListener("keydown", ev => {
  const ouverte = document.querySelector("#modale-types:not(.cache), #modale-evenement:not(.cache)");
  if (!ouverte || document.querySelector("[role=alertdialog]")) return;
  if (ev.key === "Escape" && ouverte.id === "modale-types") { ev.preventDefault(); fermerTypes(); return; }
  if (ev.key !== "Tab") return;
  const focusables = [...ouverte.querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const premier = focusables[0], dernier = focusables[focusables.length - 1];
  if (ev.shiftKey && document.activeElement === premier) { ev.preventDefault(); dernier.focus(); }
  else if (!ev.shiftKey && document.activeElement === dernier) { ev.preventDefault(); premier.focus(); }
});

// agenda.html?nouveau=1 (« Ajouter un rendez-vous » de l'Accueil) : ouvre directement la fenêtre, sur aujourd'hui ;
// le paramètre est retiré de l'adresse pour qu'un rechargement ne la rouvre pas
gestion.coque("agenda").then(async moi => {
  AGENDA_MOI = moi;
  document.getElementById("agenda-onglets").classList.toggle("cache", !socle.peut(moi, "rh-voir"));
  await chargerAgenda(true);
  if (new URLSearchParams(location.search).get("nouveau") !== "1") return;
  history.replaceState(null, "", location.pathname);
  ouvrirModaleEvenement({ jour: formaterDateISO(aujourdhuiParis()) });
});

// ---------------------------------------------------------------------------
// ---- onglets Agenda / Participants (permission rh-voir, comme Quota) ----
document.querySelectorAll("[data-agenda-onglet]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-agenda-onglet]").forEach(b => { b.classList.toggle("actif", b === btn); b.setAttribute("aria-selected", String(b === btn)); });
    const nom = btn.dataset.agendaOnglet;
    document.getElementById("panneau-agenda-calendrier").classList.toggle("cache", nom !== "calendrier");
    document.getElementById("panneau-agenda-participants").classList.toggle("cache", nom !== "participants");
    if (nom === "participants") chargerParticipants();
  });
});

/// ---- participants : qui a été invité à un événement personnel terminé, qui était présent, sur la période du
// sélecteur de l'agenda (jour, semaine ou mois). Les événements à venir sont comptés à part (entreprise/participants.ts).
let EMPLOYES_PARTICIPANTS = [];
let FILTRE_PARTICIPANTS = "invites";
const tauxPresence = e => (e.invitations > 0 ? e.presences / e.invitations : -1);
const comparerNomParticipant = (a, b) => a.nomComplet.localeCompare(b.nomComplet, "fr", { sensitivity: "base" });
const TRI_PARTICIPANTS = gestion.creerTri({
  nom: comparerNomParticipant,
  grade: (a, b) => a.gradeLibelle.localeCompare(b.gradeLibelle, "fr", { sensitivity: "base" }) || comparerNomParticipant(a, b),
  presence: (a, b) => tauxPresence(a) - tauxPresence(b) || a.invitations - b.invitations || comparerNomParticipant(a, b),
  absences: (a, b) => (a.invitations - a.presences) - (b.invitations - b.presences) || comparerNomParticipant(a, b),
  avenir: (a, b) => a.aVenir - b.aVenir || comparerNomParticipant(a, b),
});
const plurielParticipant = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
// vert dès 80 %, orange au-dessous, rouge à 0 ; la barre reste vide à 0 (une barre pleine se lirait « 100 % »)
const etatPresence = taux => (taux < 0 ? "gris" : taux === 0 ? "rouge" : taux < 0.8 ? "orange" : "vert");

function ligneParticipant(e) {
  const taux = tauxPresence(e), pct = taux < 0 ? 0 : Math.round(taux * 100), etat = etatPresence(taux);
  const absences = e.invitations - e.presences;
  const presence = e.invitations
    ? `<div class="run-barre run-etat-${etat}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Présence de ${echapper(e.nomComplet)}"><div class="run-barre-remplie run-etat-${etat}" style="width:${pct}%"></div></div>
       <span class="run-progression-texte"><strong>${pct} %</strong> · ${e.presences} sur ${e.invitations}</span>`
    : `<span class="run-progression-texte run-sans-objectif">${e.aVenir ? "Rien de terminé" : "Pas invité"}</span>`;
  return `<tr>
    <td><span class="run-personne">
      <span class="admin-avatar" aria-hidden="true">${echapper(initiales(e.nomComplet))}</span>
      ${e.evenements.length
        ? `<button type="button" class="participants-nom" data-detail-participant="${e.id}" aria-label="Voir la participation de ${echapper(e.nomComplet)}">${echapper(e.nomComplet)}</button>`
        : `<span class="run-nom">${echapper(e.nomComplet)}</span>`}
    </span></td>
    <td>${echapper(e.gradeLibelle)}</td>
    <td class="run-cellule-progression">${presence}</td>
    <td class="participants-nombre${absences ? " participants-nombre--alerte" : ""}">${e.invitations ? absences : "—"}</td>
    <td class="participants-nombre">${e.aVenir || "—"}</td>
  </tr>`;
}
function majEnteteParticipants() {
  const t = TRI_PARTICIPANTS;
  document.getElementById("participants-entete").innerHTML = `<th data-titre>${t.bouton("nom", "Personne")}</th><th>${t.bouton("grade", "Grade")}</th><th>${t.bouton("presence", "Présence")}</th><th title="Absences non justifiées : une absence couverte par un congé approuvé ne compte pas dans ce total.">${t.bouton("absences", "Absences")}</th><th>${t.bouton("avenir", "À venir")}</th>`;
}
function afficherParticipants() {
  const terme = document.getElementById("participants-recherche").value.trim().toLocaleLowerCase("fr");
  const garder = {
    invites: e => e.invitations > 0 || e.aVenir > 0,
    absents: e => e.invitations > e.presences,
    tous: () => true,
  }[FILTRE_PARTICIPANTS];
  const filtres = TRI_PARTICIPANTS.appliquer(EMPLOYES_PARTICIPANTS.filter(e => garder(e) && (!terme || e.nomComplet.toLocaleLowerCase("fr").includes(terme))));
  const vide = !EMPLOYES_PARTICIPANTS.length ? "Aucun employé actif."
    : terme ? "Personne ne correspond à cette recherche."
    : FILTRE_PARTICIPANTS === "absents" ? "Aucune absence non justifiée sur cette période."
    : "Personne n’a été invité à un événement sur cette période. Invitez des employés depuis la fiche d’un événement.";
  document.getElementById("participants-corps").innerHTML = filtres.length
    ? filtres.map(ligneParticipant).join("")
    : `<tr><td colspan="5" class="run-vide">${vide}</td></tr>`;
}
function afficherSyntheseParticipants(s) {
  const taux = s.invitations ? Math.round((s.presences / s.invitations) * 100) : null;
  const etat = etatPresence(s.invitations ? s.presences / s.invitations : -1);
  document.getElementById("participants-taux").textContent = taux === null ? "—" : `${taux} %`;
  document.getElementById("participants-taux-libelle").textContent = s.invitations ? `${plurielParticipant(s.presences, "présence")} sur ${plurielParticipant(s.invitations, "invitation")}` : "aucune invitation terminée";
  const barre = document.getElementById("participants-barre");
  barre.className = `run-barre run-etat-${etat}`;
  barre.firstElementChild.className = `run-barre-remplie run-etat-${etat}`;
  barre.firstElementChild.style.width = `${taux ?? 0}%`;
  document.getElementById("participants-absences").textContent = String(s.absences);
  document.getElementById("participants-absences-libelle").textContent = (s.absences ? "sur les événements terminés" : "personne n’a manqué un événement")
    + (s.absencesJustifiees ? ` (+ ${plurielParticipant(s.absencesJustifiees, "absence justifiée")})` : "");
  document.getElementById("participants-evenements").textContent = String(s.evenementsPasses);
  document.getElementById("participants-evenements-libelle").textContent = `${s.evenementsPasses > 1 ? "terminés" : "terminé"}${s.evenementsAVenir ? `, ${s.evenementsAVenir} à venir` : ""}`;
}
// « Participation du 20 au 26 oct. » : la période se nomme par ses dates
function titreParticipants() {
  const { debut, fin } = periodeParticipants();
  const court = d => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  document.getElementById("participants-titre").textContent = formaterDateISO(debut) === formaterDateISO(fin)
    ? `Participation du ${court(debut)}` : `Participation du ${court(debut)} au ${court(fin)}`;
}
majEnteteParticipants();
document.getElementById("participants-table").addEventListener("click", e => {
  const tri = e.target.closest("[data-tri]");
  if (tri) {
    TRI_PARTICIPANTS.cycler(tri.dataset.tri);
    majEnteteParticipants();
    afficherParticipants();
    document.querySelector(`#participants-entete [data-tri="${tri.dataset.tri}"]`)?.focus();
    return;
  }
  const b = e.target.closest("[data-detail-participant]");
  if (b) ouvrirDetailParticipant(b.dataset.detailParticipant);
});
document.getElementById("participants-filtres").addEventListener("click", e => {
  const b = e.target.closest("[data-participants-filtre]");
  if (!b) return;
  document.querySelectorAll("[data-participants-filtre]").forEach(x => { x.classList.toggle("actif", x === b); x.setAttribute("aria-pressed", String(x === b)); });
  FILTRE_PARTICIPANTS = b.dataset.participantsFiltre;
  afficherParticipants();
});

// ---- détail : les événements où cette personne a été invitée sur la période affichée, en frise ----
const LIBELLES_ETAT_PARTICIPATION = { present: ["Présent", "puce-ok"], absent: ["Absent", "puce-off"], "absence-justifiee": ["Absence justifiée", "puce-ok"], "a-venir": ["À venir", "puce-masquee"] };
let OUVREUR_PARTICIPANT = null;
function ouvrirDetailParticipant(id) {
  const p = EMPLOYES_PARTICIPANTS.find(e => e.id === Number(id));
  if (!p) return;
  OUVREUR_PARTICIPANT = document.activeElement;
  document.getElementById("modale-participant-titre").textContent = p.nomComplet;
  const absences = p.invitations - p.presences;
  document.getElementById("modale-participant-resume").textContent = [
    p.invitations ? `${plurielParticipant(p.presences, "présence")} sur ${p.invitations}` : "",
    absences ? plurielParticipant(absences, "absence non justifiée") : "",
    p.absencesJustifiees ? plurielParticipant(p.absencesJustifiees, "absence justifiée") : "",
    p.aVenir ? `${p.aVenir} à venir` : "",
  ].filter(Boolean).join(", ");
  document.getElementById("liste-participant-evenements").innerHTML = p.evenements.map(ev => {
    const [libelle, classe] = LIBELLES_ETAT_PARTICIPATION[ev.etat];
    const date = new Date(`${ev.jour}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
    return `<li class="participant-etape participant-etape--${ev.etat}" style="--vis:${echapper(ev.type?.couleur || "#9fb4c7")}">
      <button type="button" class="participant-evenement" data-voir-evenement="${ev.id}" data-jour-evenement="${ev.jour}">
        <span class="participant-evenement-titre">${echapper(ev.titre)}</span>
        <span class="participant-evenement-quand">${capitaliser(date)}${ev.heureDebut ? `, ${ev.heureDebut}` : ""}${ev.type ? ` · ${echapper(ev.type.nom)}` : ""}</span>
      </button>
      <span class="puce ${classe}">${libelle}</span>
    </li>`;
  }).join("");
  document.getElementById("modale-participant").classList.remove("cache");
  document.getElementById("fermer-modale-participant").focus();
}
const fermerModaleParticipant = () => { document.getElementById("modale-participant").classList.add("cache"); if (OUVREUR_PARTICIPANT?.isConnected) OUVREUR_PARTICIPANT.focus(); };
document.getElementById("fermer-modale-participant").addEventListener("click", fermerModaleParticipant);
document.getElementById("modale-participant").addEventListener("click", e => { if (e.target.id === "modale-participant") fermerModaleParticipant(); });
document.getElementById("liste-participant-evenements").addEventListener("click", async e => {
  const b = e.target.closest("[data-voir-evenement]");
  if (!b) return;
  fermerModaleParticipant();
  document.querySelector('[data-agenda-onglet="calendrier"]').click();
  AGENDA_REF = new Date(`${b.dataset.jourEvenement}T00:00`);
  AGENDA_VUE_CHOISIE = "jour";
  await chargerAgenda(true);
  ouvrirEvenementExistant(b.dataset.voirEvenement);
});
async function chargerParticipants() {
  gestion.message("zone-message-participants", "");
  titreParticipants();
  const { debut, fin } = periodeParticipants();
  try {
    const r = await socle.api(`/api/agenda/participants?debut=${formaterDateISO(debut)}&fin=${formaterDateISO(fin)}`);
    EMPLOYES_PARTICIPANTS = r.employes;
    afficherSyntheseParticipants(r.synthese);
    afficherParticipants();
  } catch (e) { gestion.message("zone-message-participants", `Impossible de charger la participation : ${e.message}. Rechargez la page ; si le problème continue, prévenez la personne qui s’occupe du site.`); }
}
document.getElementById("participants-recherche").addEventListener("input", afficherParticipants);
