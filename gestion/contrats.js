/* GESTION — contrats passés avec d'autres entreprises du serveur : registre interne (pas d'échange avec leur site).
   Cycle : en négociation → actif → terminé (verse une écriture DOT, revérifié côté serveur) ou annulé.
   Droits revérifiés par le serveur (entreprise/routes/contrats.ts) : l'interface ne fait que suivre. */

const $c = id => document.getElementById(id);
let CACHE_CONTRATS = [];
let FILTRE_STATUT = '';

const LIBELLES_STATUT = { negociation: 'En négociation', actif: 'Actif', termine: 'Terminé', annule: 'Annulé' };
const CLASSES_STATUT = { negociation: 'puce-or', actif: 'puce-ok', termine: 'puce-masquee', annule: 'puce-off' };
const LIBELLES_SENS = { on_paie: 'On paie', on_est_paye: 'On est payé' };
const formaterMontant = n => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;
const dateCourte = iso => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric' });

async function chargerContrats() {
  gestion.message('zone-message-contrats', '');
  try {
    const r = await socle.api('/api/contrats');
    CACHE_CONTRATS = r.contrats || [];
    afficherContrats();
  } catch (e) { gestion.message('zone-message-contrats', `Impossible de charger les contrats : ${e.message}`); }
}

function ligneContrat(c) {
  const actions = [
    c.statut === 'negociation' ? `<button type="button" role="menuitem" data-contrat-modifier="${c.id}">${gestion.ico('pencil')} Modifier</button>` : '',
    c.statut === 'negociation' ? `<button type="button" role="menuitem" data-contrat-statut="${c.id}:actif">${gestion.ico('sync')} Passer actif</button>` : '',
    c.statut === 'actif' ? `<button type="button" role="menuitem" data-contrat-statut="${c.id}:termine">${gestion.ico('coins')} Clôturer (verse la DOT)</button>` : '',
    (c.statut === 'negociation' || c.statut === 'actif') ? `<button type="button" role="menuitem" data-contrat-statut="${c.id}:annule">${gestion.ico('fermer')} Annuler le contrat</button>` : '',
    c.statut !== 'termine' ? `<button type="button" role="menuitem" class="danger" data-contrat-supprimer="${c.id}">${gestion.ico('trash')} Supprimer</button>` : '',
  ].filter(Boolean).join('');
  return `<div class="comptes-ligne">
    <span class="comptes-identite"><span class="admin-avatar" aria-hidden="true">${echapper(initiales(c.partenaire))}</span>
      <span><span class="comptes-nom"><strong>${echapper(c.partenaire)}</strong> <span class="puce ${CLASSES_STATUT[c.statut] || ''}">${echapper(LIBELLES_STATUT[c.statut] || c.statut)}</span></span>
      <span class="comptes-pseudo">${echapper(c.objet)}</span></span></span>
    <span class="rh-cellule" data-libelle="Sens">${echapper(LIBELLES_SENS[c.sens] || c.sens)}</span>
    <span class="rh-cellule" data-libelle="Montant"><strong>${formaterMontant(c.montant)}</strong></span>
    <span class="rh-cellule" data-libelle="Créé le">${dateCourte(c.creeLe)}</span>
    <div class="comptes-menu">
      <button type="button" class="comptes-menu-bouton" aria-haspopup="menu" aria-expanded="false" aria-label="Actions pour ${echapper(c.partenaire)}">${gestion.ico('points')}</button>
      <div class="comptes-menu-liste cache" role="menu">${actions || '<span class="champ-aide" style="padding:8px 12px;display:block;">Aucune action.</span>'}</div>
    </div>
  </div>`;
}

function afficherContrats() {
  const terme = $c('recherche-contrats').value.trim().toLowerCase();
  const filtres = CACHE_CONTRATS.filter(c => (!FILTRE_STATUT || c.statut === FILTRE_STATUT)
    && (!terme || [c.partenaire, c.objet].some(v => v.toLowerCase().includes(terme))));
  $c('contrats-liste').innerHTML = filtres.length
    ? filtres.map(ligneContrat).join('')
    : `<p class="comptes-vide">${CACHE_CONTRATS.length ? 'Aucun contrat ne correspond à ces critères.' : 'Aucun contrat pour le moment. Créez-en un pour commencer.'}</p>`;
}
$c('recherche-contrats').addEventListener('input', afficherContrats);
document.querySelectorAll('[data-statut-contrat]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-statut-contrat]').forEach(x => { x.classList.toggle('actif', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  FILTRE_STATUT = b.dataset.statutContrat;
  afficherContrats();
}));

// ---- menu « ⋯ » par ligne (même recette que RH/Comptes) ----
let MENU_OUVERT = null;
function fermerMenu(rendreFocus) {
  if (!MENU_OUVERT) return;
  MENU_OUVERT.querySelector('.comptes-menu-liste').classList.add('cache');
  const b = MENU_OUVERT.querySelector('.comptes-menu-bouton');
  b.setAttribute('aria-expanded', 'false');
  if (rendreFocus) b.focus();
  MENU_OUVERT = null;
}
$c('contrats-liste').addEventListener('click', async e => {
  const ouvreur = e.target.closest('.comptes-menu-bouton');
  if (ouvreur) {
    const menu = ouvreur.closest('.comptes-menu');
    if (MENU_OUVERT === menu) return fermerMenu(true);
    fermerMenu(false);
    const liste = menu.querySelector('.comptes-menu-liste');
    liste.classList.remove('cache');
    liste.classList.toggle('vers-le-haut', ouvreur.getBoundingClientRect().bottom + liste.offsetHeight + 16 > innerHeight);
    ouvreur.setAttribute('aria-expanded', 'true');
    liste.querySelector('[role=menuitem]')?.focus();
    MENU_OUVERT = menu;
    return;
  }
  const modifier = e.target.closest('[data-contrat-modifier]');
  if (modifier) { fermerMenu(false); ouvrirModaleContrat(Number(modifier.dataset.contratModifier)); return; }
  const statutBtn = e.target.closest('[data-contrat-statut]');
  if (statutBtn) {
    fermerMenu(false);
    const [id, statut] = statutBtn.dataset.contratStatut.split(':');
    await changerStatut(Number(id), statut);
    return;
  }
  const supprimer = e.target.closest('[data-contrat-supprimer]');
  if (supprimer) { fermerMenu(false); await supprimerContrat(Number(supprimer.dataset.contratSupprimer)); }
});
document.addEventListener('click', e => { if (MENU_OUVERT && !MENU_OUVERT.contains(e.target)) fermerMenu(false); });
document.addEventListener('keydown', e => {
  if (!MENU_OUVERT) return;
  if (e.key === 'Escape') { e.preventDefault(); fermerMenu(true); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...MENU_OUVERT.querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
});

const MESSAGES_STATUT = {
  actif: { titre: 'Passer ce contrat en actif ?', bouton: 'Passer actif', texte: 'Le contrat devient actif.' },
  termine: { titre: 'Clôturer ce contrat ?', bouton: 'Clôturer', texte: 'Une écriture est versée dans la DOT de la semaine en cours (dépense si on paie, recette si on est payé). Le contrat ne pourra plus être modifié ni supprimé.' },
  annule: { titre: 'Annuler ce contrat ?', bouton: 'Annuler le contrat', texte: 'Aucune écriture n’est versée dans la DOT.' },
};
async function changerStatut(id, statut) {
  const c = CACHE_CONTRATS.find(x => x.id === id);
  const m = MESSAGES_STATUT[statut];
  if (!c || !m) return;
  if (!await gestion.confirmer(m.texte, m.titre, m.bouton, { danger: statut === 'annule' })) return;
  try {
    await socle.api(`/api/contrats/${id}/statut`, { method: 'POST', body: { statut } });
    gestion.notifier(`${LIBELLES_STATUT[statut]} ✓`);
    chargerContrats();
  } catch (err) { gestion.message('zone-message-contrats', err.message); }
}
async function supprimerContrat(id) {
  const c = CACHE_CONTRATS.find(x => x.id === id);
  if (!c) return;
  if (!await gestion.confirmer('Cette action est définitive.', `Supprimer le contrat avec ${c.partenaire} ?`, 'Supprimer le contrat', { danger: true })) return;
  try {
    await socle.api(`/api/contrats/${id}`, { method: 'DELETE' });
    gestion.notifier('Contrat supprimé ✓');
    chargerContrats();
  } catch (err) { gestion.message('zone-message-contrats', err.message); }
}

// ---- modale : nouveau contrat ou modification (seulement en négociation) ----
let CONTRAT_EN_EDITION = null, OUVREUR_MODALE_CONTRAT = null;
function ouvrirModaleContrat(id) {
  gestion.message('zone-message-modale-contrat', '');
  CONTRAT_EN_EDITION = id || null;
  const c = id ? CACHE_CONTRATS.find(x => x.id === id) : null;
  $c('modale-contrat-titre').textContent = c ? 'Modifier le contrat' : 'Nouveau contrat';
  $c('contrat-partenaire').value = c ? c.partenaire : '';
  $c('contrat-objet').value = c ? c.objet : '';
  $c('contrat-sens').value = c ? c.sens : 'on_paie';
  $c('contrat-montant').value = c ? c.montant : '';
  $c('contrat-notes').value = c ? c.notes : '';
  OUVREUR_MODALE_CONTRAT = document.activeElement;
  $c('modale-contrat').classList.remove('cache');
  $c('contrat-partenaire').focus();
}
const fermerModaleContrat = () => { $c('modale-contrat').classList.add('cache'); if (OUVREUR_MODALE_CONTRAT?.isConnected) OUVREUR_MODALE_CONTRAT.focus(); };
$c('bouton-nouveau-contrat').addEventListener('click', () => ouvrirModaleContrat(null));
$c('fermer-modale-contrat').addEventListener('click', fermerModaleContrat);
$c('contrat-annuler').addEventListener('click', fermerModaleContrat);
$c('modale-contrat').addEventListener('click', e => { if (e.target.id === 'modale-contrat') fermerModaleContrat(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$c('modale-contrat').classList.contains('cache') && !document.querySelector('[role="alertdialog"]')) fermerModaleContrat(); });
$c('formulaire-contrat').addEventListener('submit', async e => {
  e.preventDefault();
  gestion.message('zone-message-modale-contrat', '');
  const corps = {
    partenaire: $c('contrat-partenaire').value.trim(), objet: $c('contrat-objet').value.trim(),
    sens: $c('contrat-sens').value, montant: Number($c('contrat-montant').value), notes: $c('contrat-notes').value.trim(),
  };
  try {
    if (CONTRAT_EN_EDITION) await socle.api(`/api/contrats/${CONTRAT_EN_EDITION}`, { method: 'PUT', body: corps });
    else await socle.api('/api/contrats', { method: 'POST', body: corps });
    fermerModaleContrat();
    gestion.notifier(CONTRAT_EN_EDITION ? 'Contrat enregistré ✓' : 'Contrat créé ✓');
    chargerContrats();
  } catch (err) { gestion.message('zone-message-modale-contrat', err.message); }
});

gestion.coque('contrats').then(chargerContrats);
