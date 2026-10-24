/* GESTION — ressources humaines : sanctions, toutes les fiches confondues. Droits revérifiés par le serveur
   (server/src/entreprise/routes/rh.ts, entreprise/sanctions.ts) : l'interface ne fait que masquer ce qui serait de
   toute façon refusé. */

const $s = id => document.getElementById(id);
const dateHeure = d => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '—');

let CACHE_SANCTIONS = [];
let TYPES_SANCTION = [];   // [{ id, nom, couleur }], réglés dans la modale « Gérer les types »
let EMPLOYES_ACTIFS = [];   // pour le menu « Employé » de la modale d'ajout
let PEUT_SANCTIONNER = false;

// légende : les types et leur couleur ; « Gérer les types » (ou « Créer des types ») pour qui en a le droit
function dessinerLegendeSanction() {
  const legende = $s('sanctions-legende');
  legende.classList.toggle('cache', !TYPES_SANCTION.length && !PEUT_SANCTIONNER);
  legende.innerHTML = (TYPES_SANCTION.length
    ? '<span class="agenda-legende-titre">Types</span>' + TYPES_SANCTION.map(t => `<span class="agenda-pastille" style="--vis:${echapper(t.couleur)}">${echapper(t.nom)}</span>`).join('')
    : '<span class="agenda-legende-titre">Aucun type de sanction pour l’instant.</span>')
    + (PEUT_SANCTIONNER ? `<button type="button" class="agenda-legende-gerer" data-gerer-types>${TYPES_SANCTION.length ? 'Gérer les types' : 'Créer des types'}</button>` : '');
}
$s('sanctions-legende').addEventListener('click', e => { if (e.target.closest('[data-gerer-types]')) ouvrirTypesSanction(); });

const ligneSanction = s => `<li><span><strong>${echapper(s.employeNom)}</strong> — ${s.type ? echapper(s.type.nom) : 'Sans type'}, ${dateHeure(s.creeLe)}${s.note ? ` : ${echapper(s.note)}` : ''} — par ${echapper(s.auteurNom) || 'un compte supprimé'}</span>${PEUT_SANCTIONNER ? `<button type="button" class="rh-historique-retirer" data-retirer-sanction="${s.id}" data-employe-sanction="${s.employeId}">Retirer</button>` : ''}</li>`;
function afficherSanctions() {
  const f = $s('recherche-sanctions').value.trim().toLowerCase();
  const filtrees = f ? CACHE_SANCTIONS.filter(s => s.employeNom.toLowerCase().includes(f)) : CACHE_SANCTIONS;
  $s('rh-sanctions-liste').innerHTML = filtrees.length ? filtrees.map(ligneSanction).join('') : `<li><span>${f ? 'Aucune sanction pour cette recherche.' : 'Aucune sanction enregistrée.'}</span></li>`;
}
$s('recherche-sanctions').addEventListener('input', afficherSanctions);
async function chargerSanctions() {
  gestion.message('zone-message-sanctions', '');
  try {
    const [r, employes] = await Promise.all([socle.api('/api/rh/sanctions'), socle.api('/api/rh/employes')]);
    CACHE_SANCTIONS = r.sanctions;
    TYPES_SANCTION = r.types;
    PEUT_SANCTIONNER = r.peutSanctionner;
    EMPLOYES_ACTIFS = (employes.employes || []).filter(e => e.statut === 'actif');
    $s('bouton-nouvelle-sanction').classList.toggle('cache', !PEUT_SANCTIONNER);
    dessinerLegendeSanction();
    afficherSanctions();
  } catch (e) { gestion.message('zone-message-sanctions', `Impossible de charger les sanctions : ${e.message}`); }
}
$s('rh-sanctions-liste').addEventListener('click', async e => {
  const b = e.target.closest('[data-retirer-sanction]');
  if (!b) return;
  if (!await gestion.confirmer('Cette sanction sera définitivement supprimée de l’historique.', 'Retirer cette sanction ?', 'Retirer la sanction', { danger: true })) return;
  try {
    await socle.api(`/api/rh/employes/${b.dataset.employeSanction}/sanctions/${b.dataset.retirerSanction}`, { method: 'DELETE' });
    gestion.notifier('Sanction retirée ✓');
    chargerSanctions();
  } catch (err) { gestion.message('zone-message-sanctions', err.message); }
});

// ---- ajout d'une sanction (modale, employé choisi dans une liste) ----
let OUVREUR_MODALE_SANCTION = null;
function ouvrirModaleSanction() {
  gestion.message('zone-message-modale-sanction', '');
  $s('sanction-employe').innerHTML = EMPLOYES_ACTIFS.map(e => `<option value="${e.id}">${echapper(e.nomComplet)}</option>`).join('') || '<option value="">Aucun employé actif</option>';
  ameliorerSelect($s('sanction-employe'), null, null, true);
  $s('sanction-type').innerHTML = TYPES_SANCTION.map(t => `<option value="${t.id}">${echapper(t.nom)}</option>`).join('') || '<option value="">Aucun type : créez-en un d’abord</option>';
  $s('sanction-note').value = '';
  OUVREUR_MODALE_SANCTION = document.activeElement;
  $s('modale-sanction').classList.remove('cache');
  $s('sanction-employe').focus();
}
const fermerModaleSanction = () => { $s('modale-sanction').classList.add('cache'); if (OUVREUR_MODALE_SANCTION?.isConnected) OUVREUR_MODALE_SANCTION.focus(); };
$s('bouton-nouvelle-sanction').addEventListener('click', ouvrirModaleSanction);
$s('fermer-modale-sanction').addEventListener('click', fermerModaleSanction);
$s('sanction-annuler').addEventListener('click', fermerModaleSanction);
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
