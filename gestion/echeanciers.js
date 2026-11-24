/* GESTION — échéanciers : plans de facturation (celui d'un contrat client, tenu à jour par le serveur, ou un plan libre)
   et règlements en plusieurs fois d'une facture déjà émise. Une ligne ouvre la fiche (tiroir) : totaux, échéances,
   actions dans le pied ; une échéance ouvre sa propre fenêtre (modifier, supprimer, marquer réglée). Droits
   revérifiés par le serveur (entreprise/routes/echeanciers.ts) : l'interface ne fait que suivre. */

const $c = id => document.getElementById(id);
let CACHE_ECHEANCIERS = [];
let FILTRE_TYPE = '';
let MOI = null;
let ECHEANCIER_OUVERT = null, OUVREUR_TIROIR = null;

const formaterMontant = n => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;
const jourFr = (iso, options = { day: 'numeric', month: 'short', year: 'numeric' }) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...options }) : '');
const jourCourt = iso => jourFr(iso, { day: 'numeric', month: 'short' });
const peutGerer = () => !!MOI && socle.peut(MOI, 'factures');
const echeancierOuvert = () => CACHE_ECHEANCIERS.find(e => e.id === ECHEANCIER_OUVERT);

const LIBELLES_TYPE = { facturation: 'Facturation', paiement: 'Paiement en plusieurs fois' };
const ETATS_ECHEANCE = {
  'a-venir': ['À venir', 'puce-masquee'],
  'a-facturer': ['À facturer', 'puce-off'],
  'a-regler': ['À régler', 'puce-off'],
  facturee: ['Facturée, en attente de paiement', 'puce-or'],
  payee: ['Payée', 'puce-ok'],
};

async function chargerEcheanciers() {
  gestion.message('zone-message-echeanciers', '');
  try {
    CACHE_ECHEANCIERS = (await socle.api('/api/echeanciers')).echeanciers || [];
    afficherListe();
    if (ECHEANCIER_OUVERT) dessinerTiroir();
  } catch (e) { gestion.message('zone-message-echeanciers', `Impossible de charger les échéanciers : ${e.message}. Rechargez la page ; si le problème continue, prévenez la personne qui s’occupe du site.`); }
}

// ---- liste : toute la ligne ouvre la fiche (chevron en bout de ligne), comme Contrats ----
function lieA(e) {
  if (e.contrat) return `Contrat avec ${echapper(e.contrat.partenaire)}`;
  if (e.type === 'paiement') return e.facture?.numeroFacture ? `Facture ${echapper(e.facture.numeroFacture)}` : `Facture n° ${e.facture?.id ?? '—'}`;
  return 'Plan libre';
}
function ligneEcheancier(e) {
  const reste = e.reste > 0 ? formaterMontant(e.reste) : 'Rien';
  return `<button type="button" class="ligne-liste" data-ouvrir-echeancier="${e.id}" aria-label="Ouvrir l’échéancier de ${echapper(e.partenaire)}">
    <span class="ligne-identite">
      <span class="admin-avatar" aria-hidden="true">${echapper(initiales(e.partenaire))}</span>
      <span class="ligne-nom"><strong>${echapper(e.partenaire)}</strong><span class="echeancier-type${e.type === 'paiement' ? ' echeancier-type--paiement' : ''}">${LIBELLES_TYPE[e.type]}</span></span>
    </span>
    <span class="ligne-cellule" data-libelle="Lié à">${lieA(e)}</span>
    <span class="ligne-cellule" data-libelle="Prévu"><span class="contrat-montant">${formaterMontant(e.prevu)}</span></span>
    <span class="ligne-cellule ${e.aFacturerOuARegler ? 'contrat-facturation--a-faire' : 'contrat-facturation--ok'}" data-libelle="${e.type === 'paiement' ? 'Reste à régler' : 'À facturer'}">${reste}</span>
    <span class="ligne-chevron" aria-hidden="true">${fleche('droite')}</span>
  </button>`;
}
function afficherListe() {
  const terme = $c('recherche-echeanciers').value.trim().toLowerCase();
  const filtres = CACHE_ECHEANCIERS.filter(e => (!FILTRE_TYPE || e.type === FILTRE_TYPE) && (!terme || e.partenaire.toLowerCase().includes(terme)));
  const vide = !CACHE_ECHEANCIERS.length
    ? 'Aucun échéancier pour le moment. « Nouvel échéancier » en crée un ; celui d’un contrat client apparaît tout seul, et un paiement en plusieurs fois se propose depuis Facturation.'
    : 'Aucun échéancier ne correspond à ces critères.';
  $c('echeanciers-liste').innerHTML = filtres.length
    ? `<div class="liste-entete"><span>Client</span><span>Lié à</span><span>Prévu</span><span>À payer ou facturer</span><span></span></div>${filtres.map(ligneEcheancier).join('')}`
    : `<p class="comptes-vide">${vide}</p>`;
}
$c('recherche-echeanciers').addEventListener('input', afficherListe);
gestion.listeEnCartes($c('echeanciers-liste'), 700, true);
document.querySelectorAll('[data-type-echeancier]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-type-echeancier]').forEach(x => { x.classList.toggle('actif', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  FILTRE_TYPE = b.dataset.typeEcheancier;
  afficherListe();
}));
$c('echeanciers-liste').addEventListener('click', e => {
  const ligne = e.target.closest('[data-ouvrir-echeancier]');
  if (ligne) ouvrirTiroir(Number(ligne.dataset.ouvrirEcheancier));
});

// ---- fiche d'un échéancier (tiroir) ----
// Une échéance se sélectionne (case) pour être facturée ; la ligne elle-même ouvre sa fenêtre. Une échéance déjà
// facturée ou réglée n'a plus de fenêtre d'édition : elle se lit seulement.
function ligneEcheance(e, c) {
  const [libelle, classe] = ETATS_ECHEANCE[e.statut] || ETATS_ECHEANCE['a-venir'];
  const selectionnable = c.type === 'facturation' && !e.factureId && peutGerer();
  const modifiable = peutGerer() && !(c.type === 'facturation' && e.factureId) && !(c.type === 'paiement' && e.payeeLe);
  const periode = e.periodeDebut ? (e.periodeDebut === e.periodeFin ? jourCourt(e.periodeDebut) : `${jourCourt(e.periodeDebut)} – ${jourCourt(e.periodeFin)}`) : jourCourt(e.datePrevue);
  const corps = `<span class="echeancier-ligne-date">${periode}</span>
    <span class="puce ${classe}">${libelle}</span>
    ${e.note ? `<span class="echeancier-ligne-note">${echapper(e.note)}</span>` : ''}
    <span class="echeancier-ligne-montant">${formaterMontant(e.montant)}</span>`;
  const modifiableOuReglee = peutGerer() && !(c.type === 'facturation' && e.factureId);   // une échéance payée s'ouvre encore pour annuler le règlement
  return `<li class="echeancier-ligne">
    ${selectionnable ? `<input type="checkbox" data-selection-echeance="${e.id}" aria-label="Sélectionner l’échéance du ${jourCourt(e.datePrevue)}">` : c.type === 'facturation' && peutGerer() ? '<span class="echeancier-case" aria-hidden="true"></span>' : ''}
    ${modifiableOuReglee ? `<button type="button" class="echeancier-ligne-ouvrir" data-ouvrir-echeance="${e.id}" aria-label="Ouvrir l’échéance du ${jourCourt(e.datePrevue)}">${corps}</button>` : `<div class="echeancier-ligne-ouvrir">${corps}</div>`}
  </li>`;
}
function sectionTotaux(c) {
  const deuxieme = c.type === 'paiement' ? `<div><dt>Réglé</dt><dd>${formaterMontant(c.montantRegle)}</dd></div>` : `<div><dt>Facturé</dt><dd>${formaterMontant(c.montantFacture)}</dd></div>`;
  return `<dl class="echeancier-stats"><div><dt>Prévu</dt><dd>${formaterMontant(c.prevu)}</dd></div>${deuxieme}<div><dt>${c.type === 'paiement' ? 'Reste à régler' : 'À facturer maintenant'}</dt><dd>${formaterMontant(c.reste)}</dd></div></dl>`;
}
function dessinerTiroir() {
  const c = echeancierOuvert();
  if (!c) { fermerTiroir(); return; }
  $c('tiroir-echeancier-avatar').textContent = initiales(c.partenaire);
  $c('tiroir-echeancier-titre').textContent = c.partenaire;
  $c('tiroir-echeancier-sous-titre').innerHTML = `<span class="echeancier-type${c.type === 'paiement' ? ' echeancier-type--paiement' : ''}">${LIBELLES_TYPE[c.type]}</span><span>${lieA(c)}</span>`;
  const liste = c.echeances.length
    ? `<ul class="echeancier-liste" aria-label="Échéances, de la plus ancienne à la plus récente">${c.echeances.map(e => ligneEcheance(e, c)).join('')}</ul>`
    : '<p class="champ-aide">Aucune échéance pour le moment. « Ajouter une échéance » en crée une.</p>';
  const aide = c.contrat ? '<p class="champ-aide">Ces échéances suivent le contrat : changez ses dates ou son montant depuis la page Contrats. Le montant d’une échéance non facturée se corrige ici.</p>' : '';
  $c('tiroir-echeancier-corps').innerHTML = sectionTotaux(c)
    + `<section class="tiroir-section" aria-labelledby="titre-echeances-echeancier"><h3 id="titre-echeances-echeancier">Échéances</h3>${aide}${liste}</section>`
    + (c.notes ? `<section class="tiroir-section" aria-labelledby="titre-notes-echeancier"><h3 id="titre-notes-echeancier">Notes</h3><p class="contrat-notes">${echapper(c.notes)}</p></section>` : '');
  const libre = !c.contrat, facturation = c.type === 'facturation';
  // pied : l'action destructrice à gauche ; à droite, ce qu'on peut faire de ce plan. Sans droit, un pied vide disparaît.
  const boutons = peutGerer() ? [
    !c.contrat ? '<button type="button" class="btn btn-fantome grade-supprimer" data-supprimer-echeancier>Supprimer l’échéancier</button>' : '',
    '<span class="tiroir-pied-espace"></span>',
    facturation && !c.contrat ? '<button type="button" class="btn btn-fantome" data-etendre>Prolonger</button>' : '',
    facturation ? '<button type="button" class="btn btn-fantome" data-ajuster>Nouveau montant…</button>' : '',
    libre ? `<button type="button" class="btn btn-fantome" data-ajouter-echeance>${gestion.ico('plus')} Ajouter une échéance</button>` : '',
    facturation ? '<button type="button" class="btn btn-or" data-facturer-selection disabled>Facturer</button>' : '',
  ].filter(Boolean) : [];
  $c('tiroir-echeancier-pied').innerHTML = boutons.join('');
  $c('tiroir-echeancier-pied').classList.toggle('cache', !boutons.length);
  majBoutonFacturer();
}
// « Facturer » : la sélection ; sans sélection, toutes les échéances dues (même geste que le bouton de la fiche contrat)
function majBoutonFacturer() {
  const b = $c('tiroir-echeancier-pied').querySelector('[data-facturer-selection]');
  if (!b) return;
  const c = echeancierOuvert();
  const choisies = [...document.querySelectorAll('[data-selection-echeance]:checked')].map(x => Number(x.dataset.selectionEcheance));
  const dues = c.echeances.filter(e => e.statut === 'a-facturer');
  const n = choisies.length || dues.length;
  b.disabled = !n;
  b.textContent = choisies.length ? `Facturer la sélection (${choisies.length})` : dues.length ? `Facturer ce qui est dû (${dues.length})` : 'Rien à facturer';
}
$c('tiroir-echeancier-corps').addEventListener('change', e => { if (e.target.matches('[data-selection-echeance]')) majBoutonFacturer(); });
function ouvrirTiroir(id) {
  ECHEANCIER_OUVERT = id;
  OUVREUR_TIROIR = document.activeElement;
  dessinerTiroir();
  $c('tiroir-echeancier').classList.remove('cache');
  $c('tiroir-echeancier-corps').scrollTop = 0;
  $c('fermer-tiroir-echeancier').focus();
}
function fermerTiroir() {
  ECHEANCIER_OUVERT = null;
  $c('tiroir-echeancier').classList.add('cache');
  if (OUVREUR_TIROIR?.isConnected) OUVREUR_TIROIR.focus();
}
$c('fermer-tiroir-echeancier').addEventListener('click', fermerTiroir);
$c('tiroir-echeancier').addEventListener('click', e => {
  if (e.target.id === 'tiroir-echeancier') { fermerTiroir(); return; }
  const c = echeancierOuvert();
  if (!c) return;
  const ouvrir = e.target.closest('[data-ouvrir-echeance]');
  if (ouvrir) ouvrirModaleEcheance(c, c.echeances.find(x => x.id === Number(ouvrir.dataset.ouvrirEcheance)));
  else if (e.target.closest('[data-ajouter-echeance]')) ouvrirModaleEcheance(c, null);
  else if (e.target.closest('[data-ajuster]')) ouvrirAjuster(c);
  else if (e.target.closest('[data-etendre]')) ouvrirEtendre(c);
  else if (e.target.closest('[data-facturer-selection]')) facturer(c);
  else if (e.target.closest('[data-supprimer-echeancier]')) supprimerEcheancier(c);
});

async function action(promesse, zone, succes) {
  try { await promesse; if (succes) gestion.notifier(succes); await chargerEcheanciers(); return true; }
  catch (e) { gestion.message(zone, e.message); return false; }
}

// ---- facturer : une facture par échéance (le serveur revérifie, jamais deux fois la même) ----
async function facturer(c) {
  const choisies = [...document.querySelectorAll('[data-selection-echeance]:checked')].map(x => Number(x.dataset.selectionEcheance));
  const cibles = choisies.length ? c.echeances.filter(e => choisies.includes(e.id)) : c.echeances.filter(e => e.statut === 'a-facturer');
  if (!cibles.length) return;
  const total = cibles.reduce((s, e) => s + e.montant, 0);
  if (!await gestion.confirmer(`${cibles.length} facture${cibles.length > 1 ? 's' : ''} seront créées pour ${c.partenaire}, soit ${formaterMontant(total)}. Vous les retrouverez dans Facturation.`,
    `Facturer ${cibles.length} échéance${cibles.length > 1 ? 's' : ''} ?`, 'Facturer', { danger: false })) return;
  const ok = await action(socle.api(`/api/echeanciers/${c.id}/facturer`, { method: 'POST', body: { ids: choisies } }), 'zone-message-tiroir-echeancier',
    `${cibles.length} facture${cibles.length > 1 ? 's créées' : ' créée'} ✓`);
  if (ok) gestion.message('zone-message-tiroir-echeancier', '');
}
async function supprimerEcheancier(c) {
  if (!await gestion.confirmer(`Le plan et ses ${c.echeances.length} échéance${c.echeances.length > 1 ? 's' : ''} sont supprimés.${c.type === 'paiement' ? ' La facture reste, redevenue « en attente » si elle était payée.' : ' Les factures déjà créées restent.'}`,
    'Supprimer cet échéancier ?', 'Supprimer l’échéancier')) return;
  if (await action(socle.api(`/api/echeanciers/${c.id}`, { method: 'DELETE' }), 'zone-message-tiroir-echeancier', 'Échéancier supprimé ✓')) fermerTiroir();
}

// ---- une échéance ----
let ECHEANCE_COURANTE = null;
function ouvrirModaleEcheance(c, e) {
  ECHEANCE_COURANTE = e;
  gestion.message('zone-message-modale-echeance', '');
  const paiement = c.type === 'paiement';
  $c('modale-echeance-titre').textContent = e ? 'Échéance' : 'Ajouter une échéance';
  $c('echeance-date').value = e ? e.datePrevue : '';
  // une période de contrat garde sa date (le premier jour de sa période) : seul son montant se corrige
  $c('echeance-date').disabled = !!(e && e.periodeDebut);
  $c('echeance-montant').value = e ? e.montant : '';
  $c('echeance-note').value = e ? e.note : '';
  const payee = !!(e && e.payeeLe);
  $c('echeance-montant').disabled = $c('echeance-note').disabled = payee;
  $c('champ-echeance-moyen').classList.toggle('cache', !(paiement && e && !payee));
  $c('echeance-moyen').value = '';
  $c('bouton-supprimer-echeance').classList.toggle('cache', !e || payee || !!c.contrat);
  $c('bouton-regler-echeance').classList.toggle('cache', !(paiement && e && !payee));
  $c('bouton-annuler-reglement').classList.toggle('cache', !payee);
  $c('bouton-enregistrer-echeance').classList.toggle('cache', payee);
  $c('bouton-enregistrer-echeance').textContent = e ? 'Enregistrer' : 'Ajouter';
  $c('modale-echeance').classList.remove('cache');
  (payee ? $c('bouton-annuler-reglement') : $c('echeance-montant')).focus();
}
const fermerModaleEcheance = () => $c('modale-echeance').classList.add('cache');
$c('fermer-modale-echeance').addEventListener('click', fermerModaleEcheance);
$c('formulaire-echeance').addEventListener('submit', async ev => {
  ev.preventDefault();
  const c = echeancierOuvert();
  const corps = { datePrevue: $c('echeance-date').value || ECHEANCE_COURANTE?.datePrevue, montant: $c('echeance-montant').value, note: $c('echeance-note').value.trim() };
  const promesse = ECHEANCE_COURANTE
    ? socle.api(`/api/echeances/${ECHEANCE_COURANTE.id}`, { method: 'PUT', body: corps })
    : socle.api(`/api/echeanciers/${c.id}/echeances`, { method: 'POST', body: corps });
  if (await action(promesse, 'zone-message-modale-echeance', ECHEANCE_COURANTE ? 'Échéance enregistrée ✓' : 'Échéance ajoutée ✓')) fermerModaleEcheance();
});
$c('bouton-supprimer-echeance').addEventListener('click', async () => {
  if (!await gestion.confirmer('Cette échéance est supprimée du plan.', 'Supprimer cette échéance ?', 'Supprimer l’échéance')) return;
  if (await action(socle.api(`/api/echeances/${ECHEANCE_COURANTE.id}`, { method: 'DELETE' }), 'zone-message-modale-echeance', 'Échéance supprimée ✓')) fermerModaleEcheance();
});
$c('bouton-regler-echeance').addEventListener('click', async () => {
  if (await action(socle.api(`/api/echeances/${ECHEANCE_COURANTE.id}/payer`, { method: 'POST', body: { moyenPaiement: $c('echeance-moyen').value.trim() } }), 'zone-message-modale-echeance', 'Échéance réglée ✓')) fermerModaleEcheance();
});
$c('bouton-annuler-reglement').addEventListener('click', async () => {
  if (!await gestion.confirmer('L’échéance redevient à régler ; si la facture était payée, elle repasse en attente.', 'Annuler ce règlement ?', 'Annuler le règlement', { danger: false })) return;
  if (await action(socle.api(`/api/echeances/${ECHEANCE_COURANTE.id}/payer`, { method: 'DELETE' }), 'zone-message-modale-echeance', 'Règlement annulé ✓')) fermerModaleEcheance();
});

// ---- nouveau montant à partir d'une date ----
function ouvrirAjuster() {
  gestion.message('zone-message-modale-ajuster', '');
  $c('ajuster-date').value = ''; $c('ajuster-montant').value = '';
  $c('modale-ajuster').classList.remove('cache');
  $c('ajuster-date').focus();
}
$c('fermer-modale-ajuster').addEventListener('click', () => $c('modale-ajuster').classList.add('cache'));
$c('formulaire-ajuster').addEventListener('submit', async ev => {
  ev.preventDefault();
  const c = echeancierOuvert();
  if (await action(socle.api(`/api/echeanciers/${c.id}/ajuster`, { method: 'POST', body: { date: $c('ajuster-date').value, montant: $c('ajuster-montant').value } }), 'zone-message-modale-ajuster', 'Montants mis à jour ✓')) $c('modale-ajuster').classList.add('cache');
});

// ---- prolonger un plan libre ----
function ouvrirEtendre() {
  gestion.message('zone-message-modale-etendre', '');
  $c('modale-etendre').classList.remove('cache');
  $c('etendre-nombre').focus();
}
$c('fermer-modale-etendre').addEventListener('click', () => $c('modale-etendre').classList.add('cache'));
$c('formulaire-etendre').addEventListener('submit', async ev => {
  ev.preventDefault();
  const c = echeancierOuvert();
  if (await action(socle.api(`/api/echeanciers/${c.id}/etendre`, { method: 'POST', body: { nombre: $c('etendre-nombre').value, rythme: $c('etendre-rythme').value } }), 'zone-message-modale-etendre', 'Échéances ajoutées ✓')) $c('modale-etendre').classList.add('cache');
});

// ---- nouvel échéancier : libre, ou paiement en plusieurs fois d'une facture (?nouveauPaiement=<id>, depuis Facturation) ----
let FACTURE_PAIEMENT = null;
async function ouvrirNouvelEcheancier(facture) {
  FACTURE_PAIEMENT = facture || null;
  gestion.message('zone-message-modale-echeancier', '');
  $c('formulaire-echeancier').reset();
  $c('modale-echeancier-titre').textContent = facture ? 'Payer en plusieurs fois' : 'Nouvel échéancier';
  $c('champ-echeancier-partenaire').classList.toggle('cache', !!facture);
  $c('champ-echeancier-montant-total').classList.toggle('cache', !!facture);
  const aide = $c('echeancier-facture-aide');
  aide.classList.toggle('cache', !facture);
  if (facture) aide.textContent = `Facture ${facture.numeroFacture || `n° ${facture.id}`} · ${facture.clientNom} · ${formaterMontant(facture.total)} à régler en plusieurs fois. La facture reste le document de référence.`;
  $c('modale-echeancier').classList.remove('cache');
  (facture ? $c('echeancier-premiere') : $c('echeancier-partenaire')).focus();
}
$c('bouton-nouvel-echeancier').addEventListener('click', () => ouvrirNouvelEcheancier(null));
$c('fermer-modale-echeancier').addEventListener('click', () => $c('modale-echeancier').classList.add('cache'));
$c('formulaire-echeancier').addEventListener('submit', async ev => {
  ev.preventDefault();
  const corps = {
    partenaire: $c('echeancier-partenaire').value.trim(), notes: $c('echeancier-notes').value.trim(),
    premiere: $c('echeancier-premiere').value, rythme: $c('echeancier-rythme').value,
    nombre: $c('echeancier-nombre').value, montantTotal: $c('echeancier-montant-total').value,
  };
  if (FACTURE_PAIEMENT) corps.factureId = FACTURE_PAIEMENT.id;
  try {
    const { id } = await socle.api(FACTURE_PAIEMENT ? '/api/echeanciers/paiement' : '/api/echeanciers', { method: 'POST', body: corps });
    $c('modale-echeancier').classList.add('cache');
    gestion.notifier(FACTURE_PAIEMENT ? 'Plan de règlement créé ✓' : 'Échéancier créé ✓');
    await chargerEcheanciers();
    ouvrirTiroir(id);
  } catch (e) { gestion.message('zone-message-modale-echeancier', e.message); }
});

gestion.coque('echeanciers').then(async moi => {
  MOI = moi;
  ameliorerSelect($c('echeancier-rythme'));
  ameliorerSelect($c('etendre-rythme'));
  await chargerEcheanciers();
  const params = new URLSearchParams(location.search);
  history.replaceState(null, '', location.pathname);
  const paiement = Number(params.get('nouveauPaiement'));
  if (paiement && peutGerer()) {
    try {
      const f = (await socle.api('/api/compta/factures')).factures?.find(x => x.id === paiement);
      if (f) ouvrirNouvelEcheancier({ id: f.id, numeroFacture: f.numeroFacture, clientNom: f.clientNom, total: f.total });
      else gestion.message('zone-message-echeanciers', 'Cette facture est introuvable.');
    } catch (e) { gestion.message('zone-message-echeanciers', e.message); }
  }
  const ouvert = Number(params.get('id'));
  if (ouvert && CACHE_ECHEANCIERS.some(e => e.id === ouvert)) ouvrirTiroir(ouvert);
});
