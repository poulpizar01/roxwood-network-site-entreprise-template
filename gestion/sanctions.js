/* GESTION — ressources humaines : sanctions, toutes les fiches confondues. Droits revérifiés par le serveur
   (server/src/entreprise/routes/rh.ts, entreprise/sanctions.ts) : l'interface ne fait que masquer ce qui serait de
   toute façon refusé. */

const $s = id => document.getElementById(id);
const dateHeure = d => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '—');

// tri par colonne (en-tête), même composant que RH/Comptes/Contrats (gestion.creerTri)
const COMPARER_SANCTIONS = {
  employe: (a, b) => a.employeNom.localeCompare(b.employeNom, 'fr', { sensitivity: 'base' }),
  type: (a, b) => (a.type?.nom || '').localeCompare(b.type?.nom || '', 'fr', { sensitivity: 'base' }),
  date: (a, b) => new Date(a.creeLe) - new Date(b.creeLe),
  note: (a, b) => (a.note || '').localeCompare(b.note || '', 'fr', { sensitivity: 'base' }),
  auteur: (a, b) => (a.auteurNom || '').localeCompare(b.auteurNom || '', 'fr', { sensitivity: 'base' }),
};
const COLONNES_SANCTIONS = [['employe', 'Employé'], ['type', 'Type'], ['date', 'Date'], ['note', 'Note'], ['auteur', 'Ajoutée par']];
const TRI_SANCTIONS = gestion.creerTri(COMPARER_SANCTIONS);

let CACHE_SANCTIONS = [];
let TYPES_SANCTION = [];   // [{ id, nom, couleur }], réglés dans la modale « Gérer les types »
let EMPLOYES_ACTIFS = [];   // pour le menu « Employé » de la modale d'ajout
let PEUT_SANCTIONNER = false;
let FILTRE_TYPE_SANCTION = null;   // id du type affiché seul, null : tous
const RANG_SANCTION = new Map();   // id de sanction → sa place dans l'historique de l'employé (1re, 2e…)

// légende : les types et leur couleur, chacun bouton de filtre (un second clic revient à tous) ; « Gérer les types »
// (ou « Créer des types ») pour qui en a le droit
function dessinerLegendeSanction() {
  const legende = $s('sanctions-legende');
  if (FILTRE_TYPE_SANCTION && !TYPES_SANCTION.some(t => t.id === FILTRE_TYPE_SANCTION)) FILTRE_TYPE_SANCTION = null;
  legende.classList.toggle('cache', !TYPES_SANCTION.length && !PEUT_SANCTIONNER);
  legende.innerHTML = (TYPES_SANCTION.length
    ? '<span class="agenda-legende-titre">Filtrer par type</span>' + TYPES_SANCTION.map(t => `<button type="button" class="sanction-filtre${FILTRE_TYPE_SANCTION === t.id ? ' actif' : ''}" data-filtre-type="${Number(t.id)}" aria-pressed="${FILTRE_TYPE_SANCTION === t.id}" style="--vis:${echapper(t.couleur)}">${echapper(t.nom)}</button>`).join('')
    : '<span class="agenda-legende-titre">Aucun type de sanction pour l’instant.</span>')
    + (PEUT_SANCTIONNER ? `<button type="button" class="agenda-legende-gerer" data-gerer-types>${TYPES_SANCTION.length ? 'Gérer les types' : 'Créer des types'}</button>` : '');
}
$s('sanctions-legende').addEventListener('click', e => {
  if (e.target.closest('[data-gerer-types]')) { ouvrirTypesSanction(); return; }
  const filtre = e.target.closest('[data-filtre-type]');
  if (!filtre) return;
  const id = Number(filtre.dataset.filtreType);
  FILTRE_TYPE_SANCTION = FILTRE_TYPE_SANCTION === id ? null : id;
  dessinerLegendeSanction();
  afficherSanctions();
  $s('sanctions-legende').querySelector(`[data-filtre-type="${id}"]`)?.focus();
});

// type : pastille teintée de sa couleur (fond clair, texte lisible), « Sans type » si le type a été supprimé
const pastilleType = t => (t
  ? `<span class="sanction-type" style="--vis:${echapper(t.couleur)}">${echapper(t.nom)}</span>`
  : '<span class="sanction-type sanction-type--aucun">Sans type</span>');
const rangTexte = n => (n === 1 ? '1re sanction' : `${n}e sanction`);

// ligne de la liste (même composant que Contrats/RH : identité, cellules nommées, menu « ⋯ »)
function ligneSanction(s) {
  const actions = PEUT_SANCTIONNER
    ? `<button type="button" role="menuitem" class="danger" data-retirer-sanction="${s.id}" data-employe-sanction="${s.employeId}">${gestion.ico('trash')} Retirer la sanction</button>`
    : '';
  const rang = RANG_SANCTION.get(s.id) || 1;
  return `<div class="comptes-ligne">
    <span class="comptes-identite"><span class="admin-avatar" aria-hidden="true">${echapper(initiales(s.employeNom))}</span>
      <span class="comptes-nom"><strong>${echapper(s.employeNom)}</strong><small class="sanction-rang${rang >= 3 ? ' sanction-rang--alerte' : ''}">${rangTexte(rang)}</small></span></span>
    <span class="rh-cellule" data-libelle="Type">${pastilleType(s.type)}</span>
    <span class="rh-cellule" data-libelle="Date">${dateHeure(s.creeLe)}</span>
    <span class="rh-cellule" data-libelle="Note">${s.note ? echapper(s.note) : '—'}</span>
    <span class="rh-cellule" data-libelle="Ajoutée par">${echapper(s.auteurNom) || 'Compte supprimé'}</span>
    <div class="comptes-menu">
      <button type="button" class="comptes-menu-bouton" aria-haspopup="menu" aria-expanded="false" aria-label="Actions pour ${echapper(s.employeNom)}">${gestion.ico('points')}</button>
      <div class="comptes-menu-liste cache" role="menu">${actions || '<span class="champ-aide" style="padding:8px 12px;display:block;">Aucune action.</span>'}</div>
    </div>
  </div>`;
}
function afficherSanctions() {
  const f = $s('recherche-sanctions').value.trim().toLowerCase();
  const filtrees = TRI_SANCTIONS.appliquer(CACHE_SANCTIONS.filter(s => (!f || s.employeNom.toLowerCase().includes(f))
    && (!FILTRE_TYPE_SANCTION || s.type?.id === FILTRE_TYPE_SANCTION)));
  const entete = COLONNES_SANCTIONS.map(([cle, libelle]) => TRI_SANCTIONS.bouton(cle, libelle)).join('');
  const vide = !CACHE_SANCTIONS.length
    ? `Aucune sanction enregistrée.${PEUT_SANCTIONNER ? ' « Ajouter une sanction » l’inscrit dans l’historique de l’employé, qui la voit dans Mon compte.' : ''}`
    : 'Aucune sanction pour ces critères.';
  $s('rh-sanctions-liste').innerHTML = filtrees.length
    ? `<div class="comptes-entete entete-tri">${entete}<span></span></div>${filtrees.map(ligneSanction).join('')}`
    : `<p class="comptes-vide">${vide}</p>`;
}
// rang de chaque sanction dans l'historique de son employé (la plus ancienne est la 1re)
function calculerRangs() {
  RANG_SANCTION.clear();
  const parEmploye = new Map();
  [...CACHE_SANCTIONS].sort((a, b) => new Date(a.creeLe) - new Date(b.creeLe)).forEach(s => {
    const n = (parEmploye.get(s.employeId) || 0) + 1;
    parEmploye.set(s.employeId, n);
    RANG_SANCTION.set(s.id, n);
  });
}
$s('recherche-sanctions').addEventListener('input', afficherSanctions);

// ---- menu « ⋯ » par ligne (même recette que Contrats/RH/Comptes) ----
let MENU_SANCTION_OUVERT = null;
function fermerMenuSanction(rendreFocus) {
  if (!MENU_SANCTION_OUVERT) return;
  MENU_SANCTION_OUVERT.querySelector('.comptes-menu-liste').classList.add('cache');
  const b = MENU_SANCTION_OUVERT.querySelector('.comptes-menu-bouton');
  b.setAttribute('aria-expanded', 'false');
  if (rendreFocus) b.focus();
  MENU_SANCTION_OUVERT = null;
}
$s('rh-sanctions-liste').addEventListener('click', async e => {
  const tri = e.target.closest('[data-tri]');
  if (tri) { TRI_SANCTIONS.cycler(tri.dataset.tri); afficherSanctions(); document.querySelector(`#rh-sanctions-liste [data-tri="${TRI_SANCTIONS.etat?.cle ?? tri.dataset.tri}"]`)?.focus(); return; }
  const ouvreur = e.target.closest('.comptes-menu-bouton');
  if (ouvreur) {
    const menu = ouvreur.closest('.comptes-menu');
    if (MENU_SANCTION_OUVERT === menu) return fermerMenuSanction(true);
    fermerMenuSanction(false);
    const liste = menu.querySelector('.comptes-menu-liste');
    liste.classList.remove('cache');
    liste.classList.toggle('vers-le-haut', ouvreur.getBoundingClientRect().bottom + liste.offsetHeight + 16 > innerHeight);
    ouvreur.setAttribute('aria-expanded', 'true');
    liste.querySelector('[role=menuitem]')?.focus();
    MENU_SANCTION_OUVERT = menu;
    return;
  }
  const retirer = e.target.closest('[data-retirer-sanction]');
  if (!retirer) return;
  fermerMenuSanction(false);
  if (!await gestion.confirmer('Cette sanction sera définitivement supprimée de l’historique.', 'Retirer cette sanction ?', 'Retirer la sanction', { danger: true })) return;
  try {
    await socle.api(`/api/rh/employes/${retirer.dataset.employeSanction}/sanctions/${retirer.dataset.retirerSanction}`, { method: 'DELETE' });
    gestion.notifier('Sanction retirée ✓');
    chargerSanctions();
  } catch (err) { gestion.message('zone-message-sanctions', err.message); }
});
document.addEventListener('click', e => { if (MENU_SANCTION_OUVERT && !MENU_SANCTION_OUVERT.contains(e.target)) fermerMenuSanction(false); });
document.addEventListener('keydown', e => {
  if (!MENU_SANCTION_OUVERT) return;
  if (e.key === 'Escape') { e.preventDefault(); fermerMenuSanction(true); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...MENU_SANCTION_OUVERT.querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
});
async function chargerSanctions() {
  gestion.message('zone-message-sanctions', '');
  try {
    const [r, employes] = await Promise.all([socle.api('/api/rh/sanctions'), socle.api('/api/rh/employes')]);
    CACHE_SANCTIONS = r.sanctions;
    calculerRangs();
    TYPES_SANCTION = r.types;
    PEUT_SANCTIONNER = r.peutSanctionner;
    EMPLOYES_ACTIFS = (employes.employes || []).filter(e => e.statut === 'actif');
    $s('bouton-nouvelle-sanction').classList.toggle('cache', !PEUT_SANCTIONNER);
    dessinerLegendeSanction();
    afficherSanctions();
  } catch (e) { gestion.message('zone-message-sanctions', `Impossible de charger les sanctions : ${e.message}`); }
}

// ---- ajout d'une sanction (modale, employé choisi dans une liste) ----
let OUVREUR_MODALE_SANCTION = null;
function ouvrirModaleSanction() {
  gestion.message('zone-message-modale-sanction', '');
  $s('sanction-employe').innerHTML = EMPLOYES_ACTIFS.map(e => `<option value="${e.id}">${echapper(e.nomComplet)}</option>`).join('') || '<option value="">Aucun employé actif</option>';
  ameliorerSelect($s('sanction-employe'), null, null, true);
  $s('sanction-type').innerHTML = TYPES_SANCTION.map(t => `<option value="${t.id}">${echapper(t.nom)}</option>`).join('') || '<option value="">Aucun type : créez-en un d’abord</option>';
  ameliorerSelect($s('sanction-type'), v => TYPES_SANCTION.find(t => String(t.id) === v)?.couleur || '#9fb4c7');
  $s('sanction-note').value = '';
  OUVREUR_MODALE_SANCTION = document.activeElement;
  $s('modale-sanction').classList.remove('cache');
  $s('sanction-employe').focus();
}
const fermerModaleSanction = () => { $s('modale-sanction').classList.add('cache'); if (OUVREUR_MODALE_SANCTION?.isConnected) OUVREUR_MODALE_SANCTION.focus(); };
$s('bouton-nouvelle-sanction').addEventListener('click', ouvrirModaleSanction);
$s('fermer-modale-sanction').addEventListener('click', fermerModaleSanction);
$s('annuler-modale-sanction').addEventListener('click', fermerModaleSanction);
$s('modale-sanction').addEventListener('click', e => { if (e.target.id === 'modale-sanction') fermerModaleSanction(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$s('modale-sanction').classList.contains('cache') && !document.querySelector('[role="alertdialog"]')) fermerModaleSanction(); });
$s('formulaire-sanction').addEventListener('submit', async e => {
  e.preventDefault();
  gestion.message('zone-message-modale-sanction', '');
  const employeId = $s('sanction-employe').value, typeId = $s('sanction-type').value;
  if (!employeId) { gestion.message('zone-message-modale-sanction', 'Aucun employé actif à sanctionner.'); return; }
  if (!typeId) { gestion.message('zone-message-modale-sanction', 'Créez d’abord un type de sanction (« Gérer les types »).'); return; }
  try {
    await socle.api(`/api/rh/employes/${employeId}/sanctions`, { method: 'POST', body: { typeId: Number(typeId), note: $s('sanction-note').value.trim() } });
    fermerModaleSanction();
    gestion.notifier('Sanction ajoutée ✓');
    chargerSanctions();
  } catch (err) { gestion.message('zone-message-modale-sanction', err.message); }
});

// ---- types de sanction (modale « Gérer les types ») : classement libre, comme les types d'agenda ----
const PALETTE_TYPES_SANCTION = ['#ef7f73', '#a99cf5', '#5fd39a', '#6fb7e8', '#e89a5f', '#d784c4', '#9fb4c7', '#e3cf6f'];
let OUVREUR_TYPES_SANCTION = null;
let TYPE_SANCTION_EN_EDITION = null;
function dessinerTypesSanction() {
  const ul = $s('types-sanction-liste');
  $s('types-sanction-compte').textContent = `${TYPES_SANCTION.length} ${TYPES_SANCTION.length === 1 ? 'type' : 'types'}`;
  ul.innerHTML = TYPES_SANCTION.length ? TYPES_SANCTION.map(t => `
    <li class="types-ligne${TYPE_SANCTION_EN_EDITION === t.id ? ' en-edition' : ''}" data-type="${Number(t.id)}">
      ${TYPE_SANCTION_EN_EDITION === t.id ? `
        <div class="types-edition-champs">
          <div class="champ"><label for="type-sanction-nom-${Number(t.id)}">Nom du type</label><input type="text" id="type-sanction-nom-${Number(t.id)}" value="${echapper(t.nom)}" maxlength="40" data-champ="nom"></div>
          <div class="champ types-couleur"><label for="type-sanction-couleur-${Number(t.id)}">Couleur</label><input type="color" id="type-sanction-couleur-${Number(t.id)}" value="${echapper(t.couleur)}" data-champ="couleur"></div>
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
    </li>`).join('') : '<li class="types-vide">Aucun type créé. Ajoutez-en un ci-dessous pour pouvoir sanctionner.</li>';
  const libres = PALETTE_TYPES_SANCTION.filter(c => !TYPES_SANCTION.some(t => t.couleur === c));
  $s('type-sanction-couleur').value = libres[0] || PALETTE_TYPES_SANCTION[TYPES_SANCTION.length % PALETTE_TYPES_SANCTION.length];
}
async function typesSanctionModifies(promesse, notification) {
  try {
    TYPES_SANCTION = (await promesse).types || [];
    gestion.message('zone-message-types-sanction', '');
    if (notification) gestion.notifier(notification);
    dessinerTypesSanction();
    dessinerLegendeSanction();
    afficherSanctions();
    return true;
  } catch (e) { gestion.message('zone-message-types-sanction', e.message); }
  return false;
}
function ouvrirTypesSanction() {
  OUVREUR_TYPES_SANCTION = document.activeElement;
  TYPE_SANCTION_EN_EDITION = null;
  dessinerTypesSanction();
  gestion.message('zone-message-types-sanction', '');
  $s('modale-types-sanction').classList.remove('cache');
  $s('type-sanction-nom').focus();
}
function fermerTypesSanction() {
  $s('modale-types-sanction').classList.add('cache');
  // le bouton de la légende a pu être redessiné : on revient sur le nouveau
  (OUVREUR_TYPES_SANCTION?.isConnected ? OUVREUR_TYPES_SANCTION : document.querySelector('[data-gerer-types]'))?.focus();
}
$s('fermer-modale-types-sanction').addEventListener('click', fermerTypesSanction);
$s('modale-types-sanction').addEventListener('click', e => { if (e.target.id === 'modale-types-sanction') fermerTypesSanction(); });
// fenêtre des types : Échap ferme, Tab reste dedans (sinon le clavier agit sur la page cachée derrière)
document.addEventListener('keydown', e => {
  const ouverte = document.querySelector('#modale-types-sanction:not(.cache)');
  if (!ouverte || document.querySelector('[role=alertdialog]')) return;
  if (e.key === 'Escape') { e.preventDefault(); fermerTypesSanction(); return; }
  if (e.key !== 'Tab') return;
  const focusables = [...ouverte.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const premier = focusables[0], dernier = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
  else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
});
$s('form-type-sanction').addEventListener('submit', e => {
  e.preventDefault();
  const nom = $s('type-sanction-nom').value.trim();
  if (!nom) { gestion.message('zone-message-types-sanction', 'Donnez un nom au type avant de l’ajouter.'); $s('type-sanction-nom').focus(); return; }
  typesSanctionModifies(socle.api('/api/rh/types-sanction', { method: 'POST', body: { nom, couleur: $s('type-sanction-couleur').value } }), `Type « ${nom} » ajouté ✓`)
    .then(ok => { if (ok) { $s('type-sanction-nom').value = ''; $s('type-sanction-nom').focus(); } });
});
$s('types-sanction-liste').addEventListener('click', async e => {
  const ligne = e.target.closest('[data-type]');
  if (!ligne) return;
  const typeId = Number(ligne.dataset.type);
  if (e.target.closest('[data-modifier-type]')) {
    TYPE_SANCTION_EN_EDITION = typeId;
    dessinerTypesSanction();
    $s(`type-sanction-nom-${typeId}`).focus();
    return;
  }
  if (e.target.closest('[data-annuler-edition]')) {
    TYPE_SANCTION_EN_EDITION = null;
    dessinerTypesSanction();
    document.querySelector(`[data-type="${typeId}"] [data-modifier-type]`)?.focus();
    return;
  }
  if (e.target.closest('[data-enregistrer-type]')) {
    const nom = ligne.querySelector('[data-champ="nom"]').value.trim();
    const couleur = ligne.querySelector('[data-champ="couleur"]').value;
    if (!nom) { gestion.message('zone-message-types-sanction', 'Donnez un nom au type.'); ligne.querySelector('[data-champ="nom"]').focus(); return; }
    const ok = await typesSanctionModifies(socle.api(`/api/rh/types-sanction/${typeId}`, { method: 'PUT', body: { nom, couleur } }), `Type « ${nom} » enregistré ✓`);
    if (ok) { TYPE_SANCTION_EN_EDITION = null; dessinerTypesSanction(); document.querySelector(`[data-type="${typeId}"] [data-modifier-type]`)?.focus(); }
    return;
  }
  const b = e.target.closest('[data-supprimer]');
  if (!b) return;
  const t = TYPES_SANCTION.find(x => x.id === typeId);
  if (!t || !await gestion.confirmer('Les sanctions qui l’utilisent resteront, sans type.', `Supprimer le type « ${t.nom} » ?`, 'Supprimer le type', { danger: true })) return;
  const ok = await typesSanctionModifies(socle.api(`/api/rh/types-sanction/${t.id}`, { method: 'DELETE' }), `Type « ${t.nom} » supprimé ✓`);
  if (ok) $s('type-sanction-nom').focus();
});

gestion.coque('sanctions').then(chargerSanctions);
