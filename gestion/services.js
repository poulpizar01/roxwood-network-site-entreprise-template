/* GESTION — ressources humaines : anomalies de service à traiter (corriger l'heure de fin, ou ignorer la ligne).
   Droits revérifiés par le serveur (server/src/entreprise/routes/services.ts) : l'interface ne fait que masquer ce
   qui serait de toute façon refusé. */

const $v = id => document.getElementById(id);
const dateHeure = d => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '—');

let PEUT_CORRIGER_SERVICES = false;
const LIBELLES_ANOMALIE = { fin_sans_debut: 'Fin sans prise de service', debut_en_double: 'Nouvelle prise sans fin', cloture_auto: 'Clôturé automatiquement' };
async function chargerAnomaliesServices() {
  gestion.message('zone-message-services', '');
  try {
    const { anomalies, peutCorriger } = await socle.api('/api/services/anomalies');
    PEUT_CORRIGER_SERVICES = peutCorriger;
    $v('rh-services-liste').innerHTML = anomalies.length
      ? anomalies.map(a => `<li><span><strong>${echapper(a.employeNom)}</strong> — ${echapper(LIBELLES_ANOMALIE[a.anomalie] || a.anomalie)}, ${dateHeure(a.debut)}${a.fin ? ` → ${dateHeure(a.fin)}` : ''}${a.causeFin ? ` (${echapper(a.causeFin)})` : ''}</span>${PEUT_CORRIGER_SERVICES ? `<button type="button" class="btn btn-fantome" data-corriger-service="${a.id}" data-debut-service="${a.debut}" data-fin-service="${a.fin || a.debut}">Corriger</button><button type="button" class="rh-historique-retirer" data-ignorer-service="${a.id}">Ignorer</button>` : ''}</li>`).join('')
      : '<li><span>Aucune anomalie à traiter.</span></li>';
  } catch (e) { gestion.message('zone-message-services', `Impossible de charger les anomalies : ${e.message}`); }
}
$v('rh-services-liste').addEventListener('click', async e => {
  const corriger = e.target.closest('[data-corriger-service]');
  if (corriger) { ouvrirModaleService(corriger.dataset.corrigerService, corriger.dataset.debutService, corriger.dataset.finService); return; }
  const ignorer = e.target.closest('[data-ignorer-service]');
  if (!ignorer) return;
  if (!await gestion.confirmer('Ses heures resteront exclues de la paie à l’heure de la DOT.', 'Ignorer cette anomalie ?', 'Ignorer')) return;
  try {
    await socle.api(`/api/services/${ignorer.dataset.ignorerService}/ignorer`, { method: 'POST', body: {} });
    gestion.notifier('Anomalie ignorée ✓');
    chargerAnomaliesServices();
  } catch (err) { gestion.message('zone-message-services', err.message); }
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
$v('service-annuler').addEventListener('click', fermerModaleService);
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
