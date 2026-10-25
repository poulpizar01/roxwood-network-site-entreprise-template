/* GESTION — ressources humaines : anomalies de service à traiter (corriger l'heure de fin, ou ignorer la ligne).
   Droits revérifiés par le serveur (server/src/entreprise/routes/services.ts) : l'interface ne fait que masquer ce
   qui serait de toute façon refusé. */

const $v = id => document.getElementById(id);
const dateHeure = d => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '—');

// tri par colonne (en-tête), même composant que RH/Comptes/Contrats (gestion.creerTri)
const COMPARER_SERVICES = {
  employe: (a, b) => a.employeNom.localeCompare(b.employeNom, 'fr', { sensitivity: 'base' }),
  debut: (a, b) => new Date(a.debut) - new Date(b.debut),
  fin: (a, b) => new Date(a.fin || a.debut) - new Date(b.fin || b.debut),
  cause: (a, b) => (a.causeFin || '').localeCompare(b.causeFin || '', 'fr', { sensitivity: 'base' }),
};
const COLONNES_SERVICES = [['employe', 'Employé'], ['debut', 'Début'], ['fin', 'Fin'], ['cause', 'Cause']];
const TRI_SERVICES = gestion.creerTri(COMPARER_SERVICES);

let PEUT_CORRIGER_SERVICES = false;
let CACHE_ANOMALIES = [];
const LIBELLES_ANOMALIE = { fin_sans_debut: 'Fin sans prise de service', debut_en_double: 'Nouvelle prise sans fin', cloture_auto: 'Clôturé automatiquement' };
// ligne de la liste (même composant que Contrats/RH : identité, cellules nommées, menu « ⋯ »)
function ligneAnomalie(a) {
  const actions = PEUT_CORRIGER_SERVICES ? [
    `<button type="button" role="menuitem" data-corriger-service="${a.id}" data-debut-service="${a.debut}" data-fin-service="${a.fin || a.debut}">${gestion.ico('pencil')} Corriger</button>`,
    `<button type="button" role="menuitem" class="danger" data-ignorer-service="${a.id}">${gestion.ico('trash')} Ignorer</button>`,
  ].join('') : '';
  return `<div class="comptes-ligne">
    <span class="comptes-identite"><span class="admin-avatar" aria-hidden="true">${echapper(initiales(a.employeNom))}</span>
      <span class="comptes-nom"><strong>${echapper(a.employeNom)}</strong> <span class="puce puce-off">${echapper(LIBELLES_ANOMALIE[a.anomalie] || a.anomalie)}</span></span></span>
    <span class="rh-cellule" data-libelle="Début">${dateHeure(a.debut)}</span>
    <span class="rh-cellule" data-libelle="Fin">${a.fin ? dateHeure(a.fin) : '—'}</span>
    <span class="rh-cellule" data-libelle="Cause">${a.causeFin ? echapper(a.causeFin) : '—'}</span>
    <div class="comptes-menu">
      <button type="button" class="comptes-menu-bouton" aria-haspopup="menu" aria-expanded="false" aria-label="Actions pour ${echapper(a.employeNom)}">${gestion.ico('points')}</button>
      <div class="comptes-menu-liste cache" role="menu">${actions || '<span class="champ-aide" style="padding:8px 12px;display:block;">Aucune action.</span>'}</div>
    </div>
  </div>`;
}
function afficherAnomaliesServices() {
  const f = $v('recherche-services').value.trim().toLowerCase();
  const filtrees = TRI_SERVICES.appliquer(f ? CACHE_ANOMALIES.filter(a => a.employeNom.toLowerCase().includes(f)) : CACHE_ANOMALIES);
  const entete = COLONNES_SERVICES.map(([cle, libelle]) => TRI_SERVICES.bouton(cle, libelle)).join('');
  $v('rh-services-liste').innerHTML = filtrees.length
    ? `<div class="comptes-entete entete-tri">${entete}<span></span></div>${filtrees.map(ligneAnomalie).join('')}`
    : `<p class="comptes-vide">${f ? 'Aucune anomalie pour cette recherche.' : 'Aucune anomalie à traiter.'}</p>`;
}
$v('recherche-services').addEventListener('input', afficherAnomaliesServices);
async function chargerAnomaliesServices() {
  gestion.message('zone-message-services', '');
  try {
    const { anomalies, peutCorriger } = await socle.api('/api/services/anomalies');
    PEUT_CORRIGER_SERVICES = peutCorriger;
    CACHE_ANOMALIES = anomalies;
    afficherAnomaliesServices();
  } catch (e) { gestion.message('zone-message-services', `Impossible de charger les anomalies : ${e.message}`); }
}

// ---- menu « ⋯ » par ligne (même recette que Contrats/RH/Comptes) ----
let MENU_SERVICE_OUVERT = null;
function fermerMenuService(rendreFocus) {
  if (!MENU_SERVICE_OUVERT) return;
  MENU_SERVICE_OUVERT.querySelector('.comptes-menu-liste').classList.add('cache');
  const b = MENU_SERVICE_OUVERT.querySelector('.comptes-menu-bouton');
  b.setAttribute('aria-expanded', 'false');
  if (rendreFocus) b.focus();
  MENU_SERVICE_OUVERT = null;
}
$v('rh-services-liste').addEventListener('click', async e => {
  const tri = e.target.closest('[data-tri]');
  if (tri) { TRI_SERVICES.cycler(tri.dataset.tri); afficherAnomaliesServices(); document.querySelector(`#rh-services-liste [data-tri="${TRI_SERVICES.etat?.cle ?? tri.dataset.tri}"]`)?.focus(); return; }
  const ouvreur = e.target.closest('.comptes-menu-bouton');
  if (ouvreur) {
    const menu = ouvreur.closest('.comptes-menu');
    if (MENU_SERVICE_OUVERT === menu) return fermerMenuService(true);
    fermerMenuService(false);
    const liste = menu.querySelector('.comptes-menu-liste');
    liste.classList.remove('cache');
    liste.classList.toggle('vers-le-haut', ouvreur.getBoundingClientRect().bottom + liste.offsetHeight + 16 > innerHeight);
    ouvreur.setAttribute('aria-expanded', 'true');
    liste.querySelector('[role=menuitem]')?.focus();
    MENU_SERVICE_OUVERT = menu;
    return;
  }
  const corriger = e.target.closest('[data-corriger-service]');
  if (corriger) { fermerMenuService(false); ouvrirModaleService(corriger.dataset.corrigerService, corriger.dataset.debutService, corriger.dataset.finService); return; }
  const ignorer = e.target.closest('[data-ignorer-service]');
  if (!ignorer) return;
  fermerMenuService(false);
  if (!await gestion.confirmer('Ses heures resteront exclues de la paie à l’heure de la DOT.', 'Ignorer cette anomalie ?', 'Ignorer')) return;
  try {
    await socle.api(`/api/services/${ignorer.dataset.ignorerService}/ignorer`, { method: 'POST', body: {} });
    gestion.notifier('Anomalie ignorée ✓');
    chargerAnomaliesServices();
  } catch (err) { gestion.message('zone-message-services', err.message); }
});
document.addEventListener('click', e => { if (MENU_SERVICE_OUVERT && !MENU_SERVICE_OUVERT.contains(e.target)) fermerMenuService(false); });
document.addEventListener('keydown', e => {
  if (!MENU_SERVICE_OUVERT) return;
  if (e.key === 'Escape') { e.preventDefault(); fermerMenuService(true); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...MENU_SERVICE_OUVERT.querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
});

let SERVICE_EN_EDITION = null, OUVREUR_MODALE_SERVICE = null;
// heure de Paris (celle du serveur RP), pas celle de l'ordinateur de qui corrige
const JOUR_PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });
const HEURE_PARIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function ouvrirModaleService(id, debutIso, finIso) {
  SERVICE_EN_EDITION = id;
  gestion.message('zone-message-modale-service', '');
  const d = new Date(debutIso), f = new Date(finIso);
  $v('service-jour').value = JOUR_PARIS.format(d);
  $v('service-heure-debut').value = HEURE_PARIS.format(d);
  $v('service-heure-fin').value = HEURE_PARIS.format(f);
  OUVREUR_MODALE_SERVICE = document.activeElement;
  $v('modale-service').classList.remove('cache');
  $v('service-jour').focus();
}
const fermerModaleService = () => { $v('modale-service').classList.add('cache'); if (OUVREUR_MODALE_SERVICE?.isConnected) OUVREUR_MODALE_SERVICE.focus(); };
$v('fermer-modale-service').addEventListener('click', fermerModaleService);
$v('modale-service').addEventListener('click', e => { if (e.target.id === 'modale-service') fermerModaleService(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$v('modale-service').classList.contains('cache') && !document.querySelector('[role="alertdialog"]')) fermerModaleService(); });
$v('formulaire-service').addEventListener('submit', async e => {
  e.preventDefault();
  gestion.message('zone-message-modale-service', '');
  const jour = $v('service-jour').value, hDebut = $v('service-heure-debut').value, hFin = $v('service-heure-fin').value;
  if (!jour || !hDebut || !hFin) { gestion.message('zone-message-modale-service', 'Jour et heures obligatoires.'); return; }
  try {
    await socle.api(`/api/services/${SERVICE_EN_EDITION}`, { method: 'PUT', body: { jour, heure_debut: hDebut, heure_fin: hFin } });
    fermerModaleService();
    gestion.notifier('Service corrigé ✓');
    chargerAnomaliesServices();
  } catch (err) { gestion.message('zone-message-modale-service', err.message); }
});
champDateFr($v('service-jour'));
champHeureFr($v('service-heure-debut'));
champHeureFr($v('service-heure-fin'));

gestion.coque('services').then(chargerAnomaliesServices);
