/* GESTION — échéanciers : plans de facturation (libres ou liés à un contrat client, dont la fiche porte un aperçu et
   le bouton « Facturer », gestion/contrats.js) et paiements en plusieurs fois d'une facture déjà émise — la facture
   d'origine est alors absorbée (supprimée, ses infos copiées sur l'échéancier) : jamais la facture ET l'échéancier à
   la fois. Une ligne ouvre la fiche (tiroir) : échéances, totaux, actions. Droits revérifiés par le serveur
   (entreprise/routes/echeanciers.ts) : l'interface ne fait que suivre. */

const $c = id => document.getElementById(id);
let CACHE_ECHEANCIERS = [];
let FILTRE_TYPE = '';
let MOI = null;

const formaterMontant = n => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;
const jourFr = (iso, options = { day: 'numeric', month: 'short', year: 'numeric' }) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...options }) : '');
const jourCourt = iso => jourFr(iso, { day: 'numeric', month: 'short' });
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const aujourdhuiParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

const LIBELLES_TYPE = { facturation: 'Facturation', paiement: 'Paiement en plusieurs fois' };
const ETATS_ECHEANCE = {
  'a-venir': ['À venir', 'puce-masquee'],
  'a-facturer': ['À facturer', 'puce-off'],
  'a-regler': ['À régler', 'puce-off'],
  facturee: ['Facturée, en attente de paiement', 'puce-or'],
  payee: ['Payée', 'puce-ok'],
  annulee: ['Annulée (avoir émis)', 'puce-masquee'],
};

async function chargerEcheanciers() {
  gestion.message('zone-message-echeanciers', '');
  try {
    const r = await socle.api('/api/echeanciers');
    CACHE_ECHEANCIERS = r.echeanciers || [];
    afficherListe();
    if (ECHEANCIER_OUVERT) dessinerTiroir();
  } catch (e) { gestion.message('zone-message-echeanciers', `Impossible de charger les échéanciers : ${e.message}.`); }
}

// ---- liste ----
// « paiement » : la facture d'origine reste le document de référence (jamais touchée, echeanciers.ts) — son numéro
// (s'il y en a un) permet de s'y retrouver depuis la liste des échéanciers
function lieA(e) {
  if (e.contrat) return `Contrat avec ${echapper(e.contrat.partenaire)}`;
  if (e.type === 'paiement') return e.facture?.numeroFacture ? `Facture ${echapper(e.facture.numeroFacture)}` : `Facture n° ${e.facture?.id ?? '—'}`;
  return '—';
}
function ligneEcheancier(e) {
  const resteLibelle = e.type === 'paiement' ? 'Reste à régler' : 'Reste à facturer';
  return `<button type="button" class="contrat-ligne" data-ouvrir-echeancier="${e.id}" aria-label="Ouvrir l’échéancier de ${echapper(e.partenaire)}">
    <span class="contrat-ligne-identite">
      <span class="admin-avatar" aria-hidden="true">${echapper(initiales(e.partenaire))}</span>
      <span class="contrat-ligne-nom"><strong>${echapper(e.partenaire)}</strong><span class="echeancier-type${e.type === 'paiement' ? ' echeancier-type--paiement' : ''}">${LIBELLES_TYPE[e.type]}</span></span>
    </span>
    <span class="contrat-ligne-cellule" data-libelle="Lié à">${lieA(e)}</span>
    <span class="contrat-ligne-cellule" data-libelle="Prévu"><span class="contrat-montant">${formaterMontant(e.prevu)}</span></span>
    <span class="contrat-ligne-cellule ${e.aFacturerOuARegler ? 'contrat-facturation--a-faire' : 'contrat-facturation--ok'}" data-libelle="${resteLibelle}">${e.reste > 0 ? formaterMontant(e.reste) : 'Rien'}</span>
    <span class="contrat-ligne-chevron" aria-hidden="true">${fleche('droite')}</span>
  </button>`;
}
function afficherListe() {
  const terme = $c('recherche-echeanciers').value.trim().toLowerCase();
  const filtres = CACHE_ECHEANCIERS.filter(e => (!FILTRE_TYPE || e.type === FILTRE_TYPE) && (!terme || e.partenaire.toLowerCase().includes(terme)));
  const liste = $c('echeanciers-liste');
  const vide = !CACHE_ECHEANCIERS.length
    ? 'Aucun échéancier pour le moment. « Nouvel échéancier » en crée un, ou « Paiement en plusieurs fois » depuis une facture.'
    : 'Aucun échéancier ne correspond à ces critères.';
  liste.innerHTML = filtres.length
    ? `<div class="contrat-entete"><span>Partenaire</span><span>Lié à</span><span>Prévu</span><span>Reste</span><span></span></div>${filtres.map(ligneEcheancier).join('')}`
    : `<p class="comptes-vide">${vide}</p>`;
}
$c('recherche-echeanciers').addEventListener('input', afficherListe);
// cartes plutôt que colonnes quand la place réellement disponible manque (même recette que contrats.js)
new ResizeObserver(([e]) => $c('echeanciers-liste').classList.toggle('contrats-liste-v2--etroite', e.contentRect.width < 700)).observe($c('echeanciers-liste'));
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
let ECHEANCIER_OUVERT = null, OUVREUR_TIROIR = null;
const echeancierOuvert = () => CACHE_ECHEANCIERS.find(e => e.id === ECHEANCIER_OUVERT);
const peutGerer = () => !!MOI && socle.peut(MOI, 'factures');

// Actions d'une échéance, regroupées sous un menu « ⋯ » (même composant que la liste Facturation, gestion/facturation.js :
// des boutons côte à côte sur chaque ligne surchargeaient la rangée et ne s'harmonisaient plus une fois l'échéance
// réglée). Une échéance déjà facturée ou réglée n'a plus que le règlement à défaire (paiement) ou rien du tout
// (facturation) : jamais de bouton mort (modifier/supprimer une échéance qui ne peut plus changer).
function actionsEcheance(e, c) {
  if (!peutGerer()) return [];
  if (c.type === 'paiement') {
    if (e.payeeLe) return [
      { action: 'voir-quittance', libelle: 'Aperçu de la quittance', icone: 'sheet' },
      { action: 'demarquer-payee', libelle: 'Annuler le règlement', icone: 'sync' },
    ];
    return [
      { action: 'marquer-payee', libelle: 'Marquer réglée', icone: 'coins' },
      { action: 'modifier-echeance', libelle: 'Modifier', icone: 'pencil' },
      { action: 'supprimer-echeance', libelle: 'Supprimer', icone: 'trash', danger: true },
    ];
  }
  if (e.factureId) return [];   // déjà facturée : plus rien à faire ici (le statut de la facture se change depuis Facturation)
  return [
    { action: 'modifier-echeance', libelle: 'Modifier', icone: 'pencil' },
    { action: 'supprimer-echeance', libelle: 'Supprimer', icone: 'trash', danger: true },
  ];
}
function menuEcheance(e, c) {
  const items = actionsEcheance(e, c);
  if (!items.length) return '';
  return `<div class="comptes-menu">
    <button type="button" class="comptes-menu-bouton" aria-haspopup="menu" aria-expanded="false" aria-label="Actions pour l’échéance du ${jourCourt(e.datePrevue)}">${gestion.ico('points')}</button>
    <div class="comptes-menu-liste cache" role="menu">${items.map(it =>
      `<button type="button" role="menuitem"${it.danger ? ' class="danger"' : ''} data-action-echeance="${it.action}" data-echeance-id="${e.id}">${gestion.ico(it.icone)} ${it.libelle}</button>`
    ).join('')}</div>
  </div>`;
}
function ligneEcheance(e, c) {
  const [libelle, classe] = ETATS_ECHEANCE[e.statut] || ETATS_ECHEANCE['a-venir'];
  const selection = c.type === 'facturation' && !e.factureId && peutGerer()
    ? `<input type="checkbox" data-selection-echeance="${e.id}" aria-label="Sélectionner l’échéance du ${jourCourt(e.datePrevue)}">` : '';
  return `<li class="echeancier-ligne">
    ${selection}
    <span class="echeancier-ligne-date">${jourCourt(e.datePrevue)}</span>
    <span class="puce ${classe}">${libelle}</span>
    ${e.note ? `<span class="echeancier-ligne-note">${echapper(e.note)}</span>` : ''}
    <span class="echeancier-ligne-montant">${formaterMontant(e.montant)}</span>
    ${menuEcheance(e, c)}
  </li>`;
}
function sectionTotaux(c) {
  const dd2 = c.type === 'paiement' ? `<div><dt>Réglé</dt><dd>${formaterMontant(c.montantRegle)}</dd></div>` : `<div><dt>Facturé</dt><dd>${formaterMontant(c.montantFacture)}</dd></div>`;
  return `<dl class="echeancier-stats">
    <div><dt>Prévu</dt><dd>${formaterMontant(c.prevu)}</dd></div>
    ${dd2}
    <div><dt>Reste</dt><dd>${formaterMontant(c.reste)}</dd></div>
  </dl>`;
}
function sectionEcheances(c) {
  if (!c.echeances.length) return '<p class="champ-aide">Aucune échéance pour le moment. Ajoutez-en une, ou utilisez le générateur depuis une nouvelle fiche.</p>';
  return `<ul class="echeancier-liste" aria-label="Échéances, de la plus ancienne à la plus récente">${c.echeances.map(e => ligneEcheance(e, c)).join('')}</ul>`;
}
function dessinerTiroir() {
  const c = echeancierOuvert();
  if (!c) { fermerTiroir(); return; }
  $c('tiroir-echeancier-avatar').textContent = initiales(c.partenaire);
  $c('tiroir-echeancier-titre').textContent = c.partenaire;
  $c('tiroir-echeancier-sous-titre').innerHTML = `<span class="echeancier-type${c.type === 'paiement' ? ' echeancier-type--paiement' : ''}">${LIBELLES_TYPE[c.type]}</span><span>${lieA(c)}</span>`;
  const selectionnables = c.type === 'facturation' && c.echeances.some(e => !e.factureId) && peutGerer();
  $c('tiroir-echeancier-corps').innerHTML = sectionTotaux(c)
    + `<section class="tiroir-section" aria-labelledby="titre-echeances-echeancier"><h3 id="titre-echeances-echeancier">Échéances</h3>${sectionEcheances(c)}</section>`
    + (c.notes ? `<section class="tiroir-section" aria-labelledby="titre-notes-echeancier"><h3 id="titre-notes-echeancier">Notes</h3><p class="contrat-notes">${echapper(c.notes)}</p></section>` : '');
  // pied : seulement « Voir le relevé » (consultation) et, s'il y a lieu, l'action principale dorée ; le reste
  // (ajouter, ajuster, étendre, supprimer l'échéancier) dans une fenêtre « Plus d'actions » — un menu « ⋯ » flottant
  // n'a pas la place de s'ouvrir correctement collé au bord bas de l'écran sur téléphone (contrairement à celui des
  // échéances, dans une zone qui défile) : la fenêtre, déjà réglée pour le plein écran mobile, est fiable partout.
  $c('tiroir-echeancier-pied').innerHTML = `
    <button type="button" class="btn btn-fantome" data-voir-releve>${gestion.ico('sheet')} Voir le relevé</button>
    <span class="tiroir-pied-espace"></span>
    ${selectionnables ? '<button type="button" class="btn btn-or" data-facturer-selection>Facturer la sélection</button>' : ''}
    ${peutGerer() ? `<button type="button" class="btn btn-fantome" data-plus-actions>${gestion.ico('points')} Actions</button>` : ''}`;
}
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

// menus « ⋯ » du tiroir (une échéance, ou le pied « Plus d'actions ») : un seul ouvert à la fois, même comportement
// que celui de Facturation (gestion/facturation.js) — Échap et clic extérieur le ferment, les flèches déplacent le
// focus entre ses actions, il s'ouvre vers le haut s'il déborderait en bas.
let MENU_ECHEANCIER_OUVERT = null;
function fermerMenuEcheancier(rendreFocus) {
  if (!MENU_ECHEANCIER_OUVERT) return;
  MENU_ECHEANCIER_OUVERT.querySelector('.comptes-menu-liste').classList.add('cache');
  const b = MENU_ECHEANCIER_OUVERT.querySelector('.comptes-menu-bouton');
  b.setAttribute('aria-expanded', 'false');
  if (rendreFocus) b.focus();
  MENU_ECHEANCIER_OUVERT = null;
}
$c('tiroir-echeancier').addEventListener('click', async e => {
  if (e.target.id === 'tiroir-echeancier') { fermerTiroir(); return; }
  const c = echeancierOuvert();
  if (!c) return;
  const ouvreur = e.target.closest('.comptes-menu-bouton');
  if (ouvreur) {
    const menu = ouvreur.closest('.comptes-menu');
    if (MENU_ECHEANCIER_OUVERT === menu) { fermerMenuEcheancier(true); return; }
    fermerMenuEcheancier(false);
    const liste = menu.querySelector('.comptes-menu-liste');
    liste.classList.remove('cache');
    liste.classList.toggle('vers-le-haut', ouvreur.getBoundingClientRect().bottom + liste.offsetHeight + 16 > innerHeight);
    ouvreur.setAttribute('aria-expanded', 'true');
    liste.querySelector('[role=menuitem]').focus();
    MENU_ECHEANCIER_OUVERT = menu;
    return;
  }
  const actionEcheance = e.target.closest('[data-action-echeance]');
  if (actionEcheance) {
    fermerMenuEcheancier(false);
    const id = Number(actionEcheance.dataset.echeanceId);
    const action = actionEcheance.dataset.actionEcheance;
    if (action === 'modifier-echeance') ouvrirModaleEcheance(c.id, id);
    else if (action === 'supprimer-echeance') supprimerEcheance(c, id);
    else if (action === 'marquer-payee') marquerPayee(c, id);
    else if (action === 'demarquer-payee') demarquerPayee(c, id);
    else if (action === 'voir-quittance') ouvrirQuittance(c, c.echeances.find(x => x.id === id));
    return;
  }
  fermerMenuEcheancier(false);
  if (e.target.closest('[data-facturer-selection]')) facturerSelection(c);
  else if (e.target.closest('[data-voir-releve]')) ouvrirReleve(c);
  else if (e.target.closest('[data-plus-actions]')) ouvrirPlusActions(c);
});
document.addEventListener('click', e => { if (MENU_ECHEANCIER_OUVERT && !MENU_ECHEANCIER_OUVERT.contains(e.target)) fermerMenuEcheancier(false); });
document.addEventListener('keydown', e => {
  if (!MENU_ECHEANCIER_OUVERT) return;
  if (e.key === 'Escape') { e.preventDefault(); fermerMenuEcheancier(true); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = [...MENU_ECHEANCIER_OUVERT.querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
});

// ---- relevé : document à l'écran, jamais un fichier téléchargé ni print() (gèlerait le navigateur embarqué de
// l'ordinateur en jeu, docs/design.md §10) — la personne le montre, la capture, ou la copie en image (ci-dessous).
// Pour un paiement en plusieurs fois, reprend le détail de la facture d'origine (absorbée à la création,
// echeanciers.ts) : articles, sous-total, livraison, réduction ; pour un échéancier de facturation, seulement la
// liste des échéances. Même modale que l'aperçu de facture (mêmes identifiants : #apercu-facture-boite/-corps…),
// pour profiter de son défilement, son plein écran et sa copie en image déjà réglés dans gestion.css/facturation.js. ----
let HTML2CANVAS_PROMISE = null;
function chargerHtml2Canvas() {
  if (!HTML2CANVAS_PROMISE) HTML2CANVAS_PROMISE = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/gestion/vendor/html2canvas.min.js';
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error('bibliothèque de capture introuvable'));
    document.head.appendChild(s);
  });
  return HTML2CANVAS_PROMISE;
}
async function imageDuReleve(noeud) {
  const html2canvas = await chargerHtml2Canvas();
  const dpr = Math.min(devicePixelRatio || 1, 2);   // net sans générer une image inutilement lourde
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = await html2canvas(noeud, {
    scale: dpr, backgroundColor: getComputedStyle(noeud).backgroundColor,
    onclone: doc => { const carte = doc.querySelector('.facture-doc'); if (carte) carte.style.boxShadow = 'none'; },
  });
  return await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('export de l’image impossible'))), 'image/png'));
}
// bouton affiché seulement si le navigateur sait copier une image (pas l'ancien navigateur embarqué de l'ordinateur
// en jeu) : « Plein écran » + capture manuelle restent la solution de repli.
if (window.ClipboardItem && navigator.clipboard?.write) $c('bouton-apercu-copier').classList.remove('cache');
$c('bouton-apercu-copier').addEventListener('click', async ev => {
  const bouton = ev.currentTarget;
  bouton.disabled = true;
  try {
    const blob = await imageDuReleve(document.querySelector('#apercu-facture-corps .facture-doc'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    gestion.notifier('Image copiée dans le presse-papiers ✓');
  } catch (e) { gestion.notifier('Impossible de copier l’image : ' + (e?.message || 'erreur inconnue'), 'erreur'); }
  finally { bouton.disabled = false; }
});
const formaterDateLongue = iso => (iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' }) : '');
function rendreReleveEcheancier(c) {
  const estPaiement = c.type === 'paiement';
  const f = c.facture;
  const articles = Array.isArray(f?.details?.articles) ? f.details.articles : [];
  const lignesEcheances = c.echeances.map(e => {
    const [libelle] = ETATS_ECHEANCE[e.statut] || ETATS_ECHEANCE['a-venir'];
    return `<tr><td>${jourFr(e.datePrevue, { day: 'numeric', month: 'long', year: 'numeric' })}</td><td>${libelle}</td><td style="text-align:right;">${formaterMontant(e.montant)}</td></tr>`;
  }).join('');
  return `<div class="facture-doc">
    <header class="facture-doc-entete">
      <div class="facture-doc-marque"><img src="/assets/logo.png" alt="" class="facture-doc-logo"><strong>${echapper(socle.nomSite)}</strong></div>
      <div class="facture-doc-ref">
        <span class="facture-doc-ref-libelle">${estPaiement ? 'Plan de règlement' : 'Échéancier de facturation'}</span>
        <strong>${estPaiement ? (f?.numeroFacture ? echapper(f.numeroFacture) : `Facture n° ${f?.id ?? c.id}`) : `N° ${c.id}`}</strong>
        ${f?.dateFacture ? `<span class="facture-doc-date">${formaterDateLongue(f.dateFacture)}</span>` : ''}
      </div>
    </header>
    <div class="facture-doc-bandeau" aria-hidden="true"></div>
    <div class="facture-doc-infos">
      <div><span class="facture-doc-petit">Client</span><strong>${echapper(c.partenaire)}</strong></div>
      <div><span class="facture-doc-petit">Reste à ${estPaiement ? 'régler' : 'facturer'}</span><strong>${formaterMontant(c.reste)}</strong></div>
    </div>
    ${articles.length ? `<table class="facture-doc-table"><thead><tr><th>Article</th><th>Qté</th><th>Prix unitaire</th><th>Montant</th></tr></thead><tbody>${
      articles.map(a => `<tr><td>${echapper(a.name)}</td><td>${echapper(a.quantity)}</td><td>${formaterMontant(a.unitPrice)}</td><td>${formaterMontant(a.quantity * a.unitPrice)}</td></tr>`).join('')
    }</tbody></table>` : ''}
    ${estPaiement && f?.sousTotal != null ? `<div class="facture-doc-totaux">
      <div><span>Sous-total</span><span>${formaterMontant(f.sousTotal)}</span></div>
      <div><span>Livraison</span><span>${formaterMontant(f.livraison || 0)}</span></div>
      ${f.reduction ? `<div><span>Réduction</span><span>${formaterMontant(-f.reduction)}</span></div>` : ''}
    </div>` : ''}
    <table class="facture-doc-table" style="margin-top:16px;"><thead><tr><th>Échéance</th><th>Statut</th><th style="text-align:right;">Montant</th></tr></thead><tbody>${lignesEcheances}</tbody></table>
    <div class="facture-doc-totaux">
      <div><span>Prévu</span><span>${formaterMontant(c.prevu)}</span></div>
      <div class="facture-doc-total"><span>${estPaiement ? 'Reste à régler' : 'Reste à facturer'}</span><span>${formaterMontant(c.reste)}</span></div>
    </div>
  </div>`;
}
function ouvrirReleve(c) {
  $c('titre-modale-apercu-facture').textContent = `${c.type === 'paiement' ? 'Plan de règlement' : 'Relevé'} — ${c.partenaire}`;
  $c('apercu-facture-corps').innerHTML = rendreReleveEcheancier(c);
  $c('modale-apercu-facture').classList.remove('cache');
  $c('fermer-modale-apercu-facture').focus();
}
// quittance d'un versement réglé : document léger calculé à l'affichage (pas de facture séparée en base, standard du
// secteur — une facture, plusieurs encaissements, echeanciers.ts) : référence la facture d'origine, jamais un
// document à part entière
function rendreQuittance(c, e) {
  const f = c.facture;
  return `<div class="facture-doc">
    <header class="facture-doc-entete">
      <div class="facture-doc-marque"><img src="/assets/logo.png" alt="" class="facture-doc-logo"><strong>${echapper(socle.nomSite)}</strong></div>
      <div class="facture-doc-ref">
        <span class="facture-doc-ref-libelle">Quittance</span>
        <strong>${f?.numeroFacture ? echapper(f.numeroFacture) : `N° ${f?.id ?? '—'}`}</strong>
        <span class="facture-doc-date">Réglée le ${echapper(formaterDateLongue(e.payeeLe))}</span>
      </div>
    </header>
    <div class="facture-doc-bandeau" aria-hidden="true"></div>
    <div class="facture-doc-infos">
      <div><span class="facture-doc-petit">Client</span><strong>${echapper(c.partenaire)}</strong></div>
      <div><span class="facture-doc-petit">Montant réglé</span><strong>${formaterMontant(e.montant)}</strong></div>
    </div>
    <div class="facture-doc-totaux">
      <div><span>Échéance du</span><span>${echapper(jourFr(e.datePrevue, { day: 'numeric', month: 'long', year: 'numeric' }))}</span></div>
      ${e.moyenPaiement ? `<div><span>Moyen de paiement</span><span>${echapper(e.moyenPaiement)}</span></div>` : ''}
      <div class="facture-doc-total"><span>Reste à régler</span><span>${formaterMontant(c.reste)}</span></div>
    </div>
  </div>`;
}
function ouvrirQuittance(c, e) {
  if (!e) return;
  $c('titre-modale-apercu-facture').textContent = `Quittance — ${c.partenaire}`;
  $c('apercu-facture-corps').innerHTML = rendreQuittance(c, e);
  $c('modale-apercu-facture').classList.remove('cache');
  $c('fermer-modale-apercu-facture').focus();
}
$c('fermer-modale-apercu-facture').addEventListener('click', () => $c('modale-apercu-facture').classList.add('cache'));
$c('modale-apercu-facture').addEventListener('click', e => { if (e.target.id === 'modale-apercu-facture') $c('modale-apercu-facture').classList.add('cache'); });
pleinEcran($c('bouton-apercu-plein-ecran'), $c('apercu-facture-boite'));

// ---- « Plus d'actions » : fenêtre plutôt qu'un menu flottant (voir le commentaire de dessinerTiroir) ----
let OUVREUR_PLUS_ACTIONS = null;
function ouvrirPlusActions(c) {
  $c('plus-echeancier-corps').innerHTML = `
    <button type="button" class="btn btn-fantome" data-ajouter-echeance>${gestion.ico('plus')} Ajouter une échéance</button>
    ${c.type === 'facturation' ? `<button type="button" class="btn btn-fantome" data-ajuster-montant>${gestion.ico('coins')} Nouveau montant…</button>` : ''}
    <button type="button" class="btn btn-fantome" data-etendre>${gestion.ico('calendar')} Ajouter des échéances…</button>
    <button type="button" class="btn btn-fantome grade-supprimer" data-supprimer-echeancier>${gestion.ico('trash')} Supprimer l’échéancier</button>`;
  OUVREUR_PLUS_ACTIONS = document.activeElement;
  $c('modale-plus-echeancier').classList.remove('cache');
  $c('plus-echeancier-corps').querySelector('.btn').focus();
}
function fermerPlusActions() {
  $c('modale-plus-echeancier').classList.add('cache');
  if (OUVREUR_PLUS_ACTIONS?.isConnected) OUVREUR_PLUS_ACTIONS.focus();
}
$c('fermer-modale-plus-echeancier').addEventListener('click', fermerPlusActions);
$c('modale-plus-echeancier').addEventListener('click', e => {
  if (e.target.id === 'modale-plus-echeancier') { fermerPlusActions(); return; }
  const c = echeancierOuvert();
  if (!c) return;
  if (e.target.closest('[data-ajouter-echeance]')) { fermerPlusActions(); ouvrirModaleEcheance(c.id, null); }
  else if (e.target.closest('[data-ajuster-montant]')) { fermerPlusActions(); ouvrirAjuster(c); }
  else if (e.target.closest('[data-etendre]')) { fermerPlusActions(); ouvrirEtendre(c); }
  else if (e.target.closest('[data-supprimer-echeancier]')) { fermerPlusActions(); supprimerEcheancier(c); }
});

async function supprimerEcheancier(c) {
  if (!await gestion.confirmer('Les échéances déjà facturées ou réglées restent dans leur facture, détachées. Cette action est définitive.', `Supprimer l’échéancier de ${c.partenaire} ?`, 'Supprimer l’échéancier', { danger: true })) return;
  try {
    await socle.api(`/api/echeanciers/${c.id}`, { method: 'DELETE' });
    fermerTiroir();
    gestion.notifier('Échéancier supprimé ✓');
    chargerEcheanciers();
  } catch (e) { gestion.message('zone-message-echeanciers', e.message); }
}
async function supprimerEcheance(c, id) {
  if (!await gestion.confirmer('Cette échéance est retirée de l’échéancier.', 'Supprimer cette échéance ?', 'Supprimer l’échéance', { danger: true })) return;
  try {
    await socle.api(`/api/echeances/${id}`, { method: 'DELETE' });
    gestion.notifier('Échéance supprimée ✓');
    chargerEcheanciers();
  } catch (e) { gestion.message('zone-message-echeanciers', e.message); }
}
async function marquerPayee(c, id) {
  try {
    await socle.api(`/api/echeances/${id}/payer`, { method: 'POST', body: {} });
    gestion.notifier('Échéance marquée réglée ✓');
    chargerEcheanciers();
  } catch (e) { gestion.message('zone-message-echeanciers', e.message); }
}
async function demarquerPayee(c, id) {
  if (!await gestion.confirmer('L’échéance redevient « à régler ».', 'Annuler ce règlement ?', 'Annuler le règlement', { danger: false })) return;
  try {
    await socle.api(`/api/echeances/${id}/payer`, { method: 'DELETE' });
    gestion.notifier('Règlement annulé ✓');
    chargerEcheanciers();
  } catch (e) { gestion.message('zone-message-echeanciers', e.message); }
}
async function facturerSelection(c) {
  const ids = [...document.querySelectorAll('[data-selection-echeance]:checked')].map(i => Number(i.dataset.selectionEcheance));
  if (!ids.length) { gestion.notifier('Sélectionnez au moins une échéance.'); return; }
  const montant = c.echeances.filter(e => ids.includes(e.id)).reduce((s, e) => s + e.montant, 0);
  if (!await gestion.confirmer(`${pluriel(ids.length, 'Une facture', `${ids.length} factures`)} ${ids.length > 1 ? 'seront créées' : 'sera créée'}, pour un total de ${formaterMontant(montant)}.`, `Facturer ${c.partenaire} ?`, `Facturer ${pluriel(ids.length, 'l’échéance', 'les échéances')}`, { danger: false })) return;
  try {
    await socle.api(`/api/echeanciers/${c.id}/facturer`, { method: 'POST', body: { ids } });
    gestion.notifier(`${pluriel(ids.length, 'Facture créée', 'Factures créées')} ✓`);
    chargerEcheanciers();
  } catch (e) { gestion.message('zone-message-echeanciers', e.message); }
}

// ---- modale : ajouter ou modifier une échéance ----
let ECHEANCIER_POUR_ECHEANCE = null, ECHEANCE_EN_EDITION = null, OUVREUR_MODALE_ECHEANCE = null;
champDateFr($c('echeance-date'));
function ouvrirModaleEcheance(echeancierId, echeanceId) {
  gestion.message('zone-message-modale-echeance', '');
  ECHEANCIER_POUR_ECHEANCE = echeancierId;
  ECHEANCE_EN_EDITION = echeanceId;
  const c = CACHE_ECHEANCIERS.find(e => e.id === echeancierId);
  const ex = echeanceId ? c?.echeances.find(e => e.id === echeanceId) : null;
  $c('modale-echeance-titre').textContent = ex ? 'Modifier l’échéance' : 'Ajouter une échéance';
  $c('bouton-enregistrer-echeance').textContent = ex ? 'Enregistrer' : 'Ajouter';
  $c('echeance-date').value = ex ? ex.datePrevue : aujourdhuiParis();
  $c('echeance-montant').value = ex ? ex.montant : '';
  $c('echeance-note').value = ex ? ex.note : '';
  OUVREUR_MODALE_ECHEANCE = document.activeElement;
  $c('modale-echeance').classList.remove('cache');
  $c('echeance-date').focus();
}
const fermerModaleEcheance = () => { $c('modale-echeance').classList.add('cache'); if (OUVREUR_MODALE_ECHEANCE?.isConnected) OUVREUR_MODALE_ECHEANCE.focus(); };
$c('fermer-modale-echeance').addEventListener('click', fermerModaleEcheance);
$c('modale-echeance').addEventListener('click', e => { if (e.target.id === 'modale-echeance') fermerModaleEcheance(); });
$c('formulaire-echeance').addEventListener('submit', async e => {
  e.preventDefault();
  const corps = { datePrevue: $c('echeance-date').value, montant: Number($c('echeance-montant').value), note: $c('echeance-note').value.trim() };
  if (!corps.datePrevue) { gestion.message('zone-message-modale-echeance', 'Indiquez la date (jj/mm/aaaa).'); $c('echeance-date').focus(); return; }
  if (!(corps.montant > 0)) { gestion.message('zone-message-modale-echeance', 'Indiquez un montant supérieur à 0 $.'); $c('echeance-montant').focus(); return; }
  try {
    if (ECHEANCE_EN_EDITION) await socle.api(`/api/echeances/${ECHEANCE_EN_EDITION}`, { method: 'PUT', body: corps });
    else await socle.api(`/api/echeanciers/${ECHEANCIER_POUR_ECHEANCE}/echeances`, { method: 'POST', body: corps });
    fermerModaleEcheance();
    gestion.notifier(ECHEANCE_EN_EDITION ? 'Échéance enregistrée ✓' : 'Échéance ajoutée ✓');
    chargerEcheanciers();
  } catch (err) { gestion.message('zone-message-modale-echeance', err.message); }
});

// ---- modale : nouveau montant à partir d'une date ----
let ECHEANCIER_POUR_AJUSTER = null, OUVREUR_AJUSTER = null;
champDateFr($c('ajuster-date'));
function ouvrirAjuster(c) {
  gestion.message('zone-message-modale-ajuster', '');
  ECHEANCIER_POUR_AJUSTER = c.id;
  $c('ajuster-date').value = aujourdhuiParis();
  $c('ajuster-montant').value = '';
  OUVREUR_AJUSTER = document.activeElement;
  $c('modale-ajuster').classList.remove('cache');
  $c('ajuster-date').focus();
}
const fermerAjuster = () => { $c('modale-ajuster').classList.add('cache'); if (OUVREUR_AJUSTER?.isConnected) OUVREUR_AJUSTER.focus(); };
$c('fermer-modale-ajuster').addEventListener('click', fermerAjuster);
$c('modale-ajuster').addEventListener('click', e => { if (e.target.id === 'modale-ajuster') fermerAjuster(); });
$c('formulaire-ajuster').addEventListener('submit', async e => {
  e.preventDefault();
  const date = $c('ajuster-date').value, montant = Number($c('ajuster-montant').value);
  if (!date) { gestion.message('zone-message-modale-ajuster', 'Indiquez la date (jj/mm/aaaa).'); return; }
  if (!(montant > 0)) { gestion.message('zone-message-modale-ajuster', 'Indiquez un montant supérieur à 0 $.'); return; }
  try {
    await socle.api(`/api/echeanciers/${ECHEANCIER_POUR_AJUSTER}/ajuster`, { method: 'POST', body: { date, montant } });
    fermerAjuster();
    gestion.notifier('Nouveau montant appliqué ✓');
    chargerEcheanciers();
  } catch (err) { gestion.message('zone-message-modale-ajuster', err.message); }
});

// ---- modale : étendre (ajouter des échéances après la dernière) ----
let ECHEANCIER_POUR_ETENDRE = null, OUVREUR_ETENDRE = null;
ameliorerSelect($c('etendre-rythme'));
function ouvrirEtendre(c) {
  gestion.message('zone-message-modale-etendre', '');
  ECHEANCIER_POUR_ETENDRE = c.id;
  OUVREUR_ETENDRE = document.activeElement;
  $c('modale-etendre').classList.remove('cache');
  $c('etendre-nombre').focus();
}
const fermerEtendre = () => { $c('modale-etendre').classList.add('cache'); if (OUVREUR_ETENDRE?.isConnected) OUVREUR_ETENDRE.focus(); };
$c('fermer-modale-etendre').addEventListener('click', fermerEtendre);
$c('modale-etendre').addEventListener('click', e => { if (e.target.id === 'modale-etendre') fermerEtendre(); });
$c('formulaire-etendre').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await socle.api(`/api/echeanciers/${ECHEANCIER_POUR_ETENDRE}/etendre`, { method: 'POST', body: { nombre: Number($c('etendre-nombre').value), rythme: $c('etendre-rythme').value } });
    fermerEtendre();
    gestion.notifier('Échéances ajoutées ✓');
    chargerEcheanciers();
  } catch (err) { gestion.message('zone-message-modale-etendre', err.message); }
});

// ---- modale : nouvel échéancier (libre) ou paiement en plusieurs fois (depuis le menu « ⋯ » d'une facture,
// gestion/facturation.js, ?nouveauPaiement=) ----
let FACTURE_POUR_PAIEMENT = null, OUVREUR_MODALE_ECHEANCIER = null;
champDateFr($c('echeancier-premiere'));
ameliorerSelect($c('echeancier-rythme'));
function ouvrirModaleEcheancier(factureId) {
  gestion.message('zone-message-modale-echeancier', '');
  FACTURE_POUR_PAIEMENT = factureId || null;
  $c('modale-echeancier-titre').textContent = factureId ? 'Paiement en plusieurs fois' : 'Nouvel échéancier';
  $c('champ-echeancier-partenaire').classList.toggle('cache', !!factureId);
  $c('champ-echeancier-montant-total').classList.toggle('cache', !!factureId);
  $c('echeancier-facture-aide').classList.toggle('cache', !factureId);
  $c('echeancier-facture-aide').textContent = factureId ? `Le montant total est repris de la facture n° ${factureId} et réparti entre les échéances.` : '';
  $c('echeancier-partenaire').value = '';
  $c('echeancier-premiere').value = aujourdhuiParis();
  $c('echeancier-rythme').value = 'hebdomadaire';
  $c('echeancier-nombre').value = factureId ? '3' : '';
  $c('echeancier-montant-total').value = '';
  $c('echeancier-notes').value = '';
  // sans facture : la première échéance et son montant sont obligatoires seulement si un générateur est utilisé ; le
  // nombre et le montant total deviennent requis ensemble pour éviter un échéancier à moitié généré
  OUVREUR_MODALE_ECHEANCIER = document.activeElement;
  $c('modale-echeancier').classList.remove('cache');
  (factureId ? $c('echeancier-premiere') : $c('echeancier-partenaire')).focus();
}
const fermerModaleEcheancier = () => { $c('modale-echeancier').classList.add('cache'); if (OUVREUR_MODALE_ECHEANCIER?.isConnected) OUVREUR_MODALE_ECHEANCIER.focus(); };
$c('bouton-nouvel-echeancier').addEventListener('click', () => ouvrirModaleEcheancier(null));
$c('fermer-modale-echeancier').addEventListener('click', fermerModaleEcheancier);
$c('modale-echeancier').addEventListener('click', e => { if (e.target.id === 'modale-echeancier') fermerModaleEcheancier(); });
$c('formulaire-echeancier').addEventListener('submit', async e => {
  e.preventDefault();
  gestion.message('zone-message-modale-echeancier', '');
  const premiere = $c('echeancier-premiere').value, nombre = Number($c('echeancier-nombre').value);
  const genere = premiere || nombre ? { premiere, rythme: $c('echeancier-rythme').value, nombre } : {};
  try {
    if (FACTURE_POUR_PAIEMENT) {
      if (!premiere || !nombre) { gestion.message('zone-message-modale-echeancier', 'Indiquez la première échéance et leur nombre.'); return; }
      await socle.api('/api/echeanciers/paiement', { method: 'POST', body: { factureId: FACTURE_POUR_PAIEMENT, ...genere, notes: $c('echeancier-notes').value.trim() } });
    } else {
      const partenaire = $c('echeancier-partenaire').value.trim();
      if (!partenaire) { gestion.message('zone-message-modale-echeancier', 'Indiquez le nom du client ou du fournisseur.'); $c('echeancier-partenaire').focus(); return; }
      await socle.api('/api/echeanciers', { method: 'POST', body: { partenaire, ...genere, montantTotal: Number($c('echeancier-montant-total').value) || undefined, notes: $c('echeancier-notes').value.trim() } });
    }
    fermerModaleEcheancier();
    gestion.notifier('Échéancier créé ✓');
    chargerEcheanciers();
  } catch (err) { gestion.message('zone-message-modale-echeancier', err.message); }
});

// depuis le menu « ⋯ » d'une facture (gestion/facturation.js, « Paiement en plusieurs fois ») : ouvre directement la modale
const PARAMS = new URLSearchParams(location.search);
const NOUVEAU_PAIEMENT = Number(PARAMS.get('nouveauPaiement'));
const ID_OUVERTURE = Number(PARAMS.get('id'));
if (NOUVEAU_PAIEMENT || ID_OUVERTURE) history.replaceState(null, '', location.pathname);

gestion.coque('echeanciers').then(moi => {
  MOI = moi;
  chargerEcheanciers().then(() => {
    if (NOUVEAU_PAIEMENT) ouvrirModaleEcheancier(NOUVEAU_PAIEMENT);
    else if (ID_OUVERTURE && CACHE_ECHEANCIERS.some(e => e.id === ID_OUVERTURE)) ouvrirTiroir(ID_OUVERTURE);
  });
});
