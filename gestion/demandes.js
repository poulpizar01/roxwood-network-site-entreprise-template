/* GESTION — demandes entrantes (module « demandes »), permissions « demandes-voir » / « demandes-gerer ». Boîte unique, filtrée par
   statut ; une ligne ouvre la fiche (tiroir) : détail, salon Discord, notes, changement de statut, conversion en contrat client.
   Droits revérifiés par le serveur (entreprise/routes/demandes.ts) : l'interface ne fait que suivre. */

const $d = id => document.getElementById(id);
let CACHE_DEMANDES = [];
let FILTRE_STATUT = '';
let MOI = null;

const LIBELLES_TYPE = { contact: 'Contact', devis: 'Devis' };
const LIBELLES_STATUT = { nouvelle: 'Nouvelle', en_cours: 'En cours', traitee: 'Traitée', refusee: 'Refusée' };
const PUCE_STATUT_DEMANDE = { nouvelle: 'puce-or', en_cours: 'puce-alerte', traitee: 'puce-ok', refusee: 'puce-off' };
const badgeStatutDemande = s => `<span class="puce ${PUCE_STATUT_DEMANDE[s] || ''}">${echapper(LIBELLES_STATUT[s] || s)}</span>`;
const jourCourtFr = iso => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' });
const dateHeureFr = iso => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function chargerDemandes() {
  gestion.message('zone-message-demandes', '');
  try {
    CACHE_DEMANDES = (await socle.api('/api/demandes')).demandes || [];
    afficherDemandes();
    if (DEMANDE_OUVERTE) gestion.conserverSaisies('tiroir-demande', dessinerTiroir);
  } catch (e) { gestion.message('zone-message-demandes', `Impossible de charger les demandes : ${e.message}. Rechargez la page ; si le problème continue, prévenez la personne qui s’occupe du site.`); }
}

function ligneDemande(d) {
  return `<button type="button" class="ligne-liste" data-ouvrir-demande="${d.id}" aria-label="Ouvrir la demande de ${echapper(d.nom)}">
    <span class="ligne-identite">
      <span class="admin-avatar" aria-hidden="true">${echapper(initiales(d.nom))}</span>
      <span class="ligne-nom"><strong>${echapper(d.nom)}</strong>${d.entrepriseNom ? `<small>${echapper(d.entrepriseNom)}</small>` : ''}</span>
    </span>
    <span class="ligne-cellule" data-libelle="Type">${LIBELLES_TYPE[d.type] || d.type}</span>
    <span class="ligne-cellule" data-libelle="Service">${d.prestation ? echapper(d.prestation) : '—'}</span>
    <span class="ligne-cellule" data-libelle="Suivi par">${d.prisEnChargeParNom ? echapper(d.prisEnChargeParNom) : '—'}</span>
    <span class="ligne-cellule" data-libelle="Statut">${badgeStatutDemande(d.statut)}</span>
    <span class="ligne-cellule" data-libelle="Reçue le" title="${dateHeureFr(d.creeLe)}">${jourCourtFr(d.creeLe)}</span>
    <span class="ligne-chevron" aria-hidden="true">${fleche('droite')}</span>
  </button>`;
}
function afficherDemandes() {
  const terme = $d('recherche-demandes').value.trim().toLowerCase();
  const filtres = CACHE_DEMANDES.filter(d => (!FILTRE_STATUT || d.statut === FILTRE_STATUT)
    && (!terme || d.nom.toLowerCase().includes(terme) || (d.entrepriseNom || '').toLowerCase().includes(terme)));
  const vide = !CACHE_DEMANDES.length ? 'Aucune demande reçue pour le moment. Elles arrivent ici dès qu’un visiteur en envoie une depuis le site.'
    : !filtres.length ? 'Aucune demande ne correspond à ces critères.' : '';
  $d('demandes-liste').innerHTML = filtres.length
    ? `<div class="liste-entete"><span>Demandeur</span><span>Type</span><span>Service</span><span>Suivi par</span><span>Statut</span><span>Reçue le</span><span></span></div>${filtres.map(ligneDemande).join('')}`
    : `<p class="comptes-vide">${vide}</p>`;
}
$d('recherche-demandes').addEventListener('input', afficherDemandes);
gestion.listeEnCartes($d('demandes-liste'), 700);
document.querySelectorAll('[data-statut-demande]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-statut-demande]').forEach(x => { x.classList.toggle('actif', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  FILTRE_STATUT = b.dataset.statutDemande;
  afficherDemandes();
}));
$d('demandes-liste').addEventListener('click', e => {
  const ligne = e.target.closest('[data-ouvrir-demande]');
  if (ligne) ouvrirTiroir(Number(ligne.dataset.ouvrirDemande));
});

// ---- fiche d'une demande (tiroir) ----
let DEMANDE_OUVERTE = null, OUVREUR_TIROIR = null;
const demandeOuverte = () => CACHE_DEMANDES.find(d => d.id === DEMANDE_OUVERTE);
const peutGerer = () => !!MOI && socle.peut(MOI, 'demandes-gerer');
const peutConvertir = () => peutGerer() && socle.peut(MOI, 'contrats');

function sectionDetail(d) {
  return `<dl class="contrat-resume">
    ${d.entrepriseNom ? `<div><dt>Entreprise</dt><dd>${echapper(d.entrepriseNom)}</dd></div>` : ''}
    ${d.prestation ? `<div><dt>Service</dt><dd>${echapper(d.prestation)}</dd></div>` : ''}
    ${d.dateSouhaitee ? `<div><dt>Date souhaitée</dt><dd>${echapper(d.dateSouhaitee.split('-').reverse().join('/'))}</dd></div>` : ''}
    ${d.budget ? `<div><dt>Budget</dt><dd>${echapper(d.budget)}</dd></div>` : ''}
    <div><dt>Discord</dt><dd>${echapper(d.pseudoDiscord)} <small>vérifié</small></dd></div>
    <div><dt>Reçue le</dt><dd>${dateHeureFr(d.creeLe)}</dd></div>
    ${d.prisEnChargeParNom ? `<div><dt>Suivi par</dt><dd>${echapper(d.prisEnChargeParNom)}</dd></div>` : ''}
  </dl>
  <section class="tiroir-section" aria-labelledby="titre-message-demande"><h3 id="titre-message-demande">Message</h3><p class="contrat-notes">${echapper(d.message)}</p></section>
  ${d.contratPartenaire ? `<section class="tiroir-section" aria-labelledby="titre-suite-demande"><h3 id="titre-suite-demande">Suite donnée</h3><div class="modale-boutons"><a class="btn btn-fantome" href="/gestion/contrats.html?contrat=${d.contratId}">Voir le contrat avec ${echapper(d.contratPartenaire)}</a></div></section>` : ''}`;
}
function sectionNotes(d) {
  return `<section class="tiroir-section" aria-labelledby="titre-notes-demande">
    <h3 id="titre-notes-demande">Notes internes</h3>
    <div class="champ" style="margin-bottom:0;">
      <textarea id="demande-notes" maxlength="2000" rows="3" aria-label="Notes internes" ${peutGerer() ? '' : 'readonly'}>${echapper(d.notes)}</textarea>
    </div>
  </section>`;
}
// salon Discord du dossier : ouvert automatiquement à l'envoi (catégorie réglée dans Paramètres), recréable ou modifiable à la main ;
// la conversion en contrat le reprend comme salon du contrat
function sectionSalon(d) {
  return `<section class="tiroir-section" aria-labelledby="titre-salon-demande">
    <h3 id="titre-salon-demande">Salon Discord</h3>
    <div class="champ" style="margin-bottom:0;">
      <input type="text" id="demande-salon" inputmode="numeric" placeholder="Identifiant du salon" value="${echapper(d.salonDiscordId || '')}" ${peutGerer() ? '' : 'readonly'} aria-label="Identifiant du salon Discord">
    </div>
    ${d.salonDiscordId ? '' : '<p class="champ-aide">Aucun salon : le bot n’était pas relié à l’envoi, ou la catégorie n’était pas réglée (Paramètres → Discord).</p>'}
    ${peutGerer() && !d.salonDiscordId ? '<div class="modale-boutons" style="margin-top:8px;"><button type="button" class="btn btn-fantome" data-creer-salon>Créer le salon</button></div>' : ''}
  </section>`;
}
function dessinerTiroir() {
  const d = demandeOuverte();
  if (!d) { fermerTiroir(); return; }
  $d('tiroir-demande-avatar').textContent = initiales(d.nom);
  $d('tiroir-demande-titre').textContent = d.nom;
  $d('tiroir-demande-sous-titre').innerHTML = `${badgeStatutDemande(d.statut)}<span>${LIBELLES_TYPE[d.type]}</span>`;
  $d('tiroir-demande-corps').innerHTML = sectionDetail(d) + sectionSalon(d) + sectionNotes(d);
  // pied comme celui d'une facture : actions à gauche (icône + libellé), Supprimer puis Enregistrer à droite — un seul bouton
  // d'enregistrement pour le salon et les notes (pas d'Annuler : le ✕ ferme)
  const actions = [];
  const action = (attribut, icone, libelle) => `<button type="button" class="btn btn-fantome" ${attribut}>${gestion.ico(icone)} ${libelle}</button>`;
  if (peutGerer()) {
    if (d.statut === 'nouvelle') actions.push(action('data-statut="en_cours"', 'check', 'Prendre en charge'), action('data-statut="refusee"', 'fermer', 'Refuser'));
    else if (d.statut === 'en_cours') {
      actions.push(action('data-statut="refusee"', 'fermer', 'Refuser'));
      // suivie par quelqu'un d'autre (absent, parti…) : on peut la reprendre, avec confirmation
      if (d.prisEnChargeParId !== MOI.id) actions.push(action('data-reprendre', 'sync', 'Reprendre le suivi'));
      actions.push(action('data-statut="traitee"', 'check', 'Marquer traitée'));
      if (peutConvertir()) actions.push(action('data-convertir-contrat', 'archive', 'Convertir en contrat'));
    }
    else if (d.statut === 'refusee') actions.push(action('data-statut="en_cours"', 'sync', 'Rouvrir'));
  }
  const fin = peutGerer() ? [`<button type="button" class="btn btn-danger" data-supprimer>${gestion.ico('trash')} Supprimer</button>`, '<button type="button" class="btn btn-or" data-enregistrer>Enregistrer</button>'] : [];
  // les actions d'abord (elles se replient entre elles), puis Supprimer et Enregistrer groupés à gauche, sur la dernière ligne
  $d('tiroir-demande-pied').innerHTML = `<div class="tiroir-pied-actions">${gestion.actionsPied(actions)}</div><div class="tiroir-pied-fin">${fin.join('')}</div>`;
}
function ouvrirTiroir(id) {
  DEMANDE_OUVERTE = id;
  OUVREUR_TIROIR = document.activeElement;
  dessinerTiroir();
  $d('tiroir-demande').classList.remove('cache');
  $d('tiroir-demande-corps').scrollTop = 0;
  $d('fermer-tiroir-demande').focus();
}
function fermerTiroir() {
  DEMANDE_OUVERTE = null;
  $d('tiroir-demande').classList.add('cache');
  if (OUVREUR_TIROIR?.isConnected) OUVREUR_TIROIR.focus();
}
$d('fermer-tiroir-demande').addEventListener('click', fermerTiroir);
$d('tiroir-demande').addEventListener('click', async e => {
  if (e.target.id === 'tiroir-demande') { fermerTiroir(); return; }
  const d = demandeOuverte();
  if (!d) return;
  const boutonStatut = e.target.closest('[data-statut]');
  if (boutonStatut) { await changerStatut(d, boutonStatut.dataset.statut); return; }
  if (e.target.closest('[data-enregistrer]')) { await enregistrer(d); return; }
  if (e.target.closest('[data-supprimer]')) { await supprimer(d); return; }
  if (e.target.closest('[data-creer-salon]')) { await creerSalon(d); return; }
  if (e.target.closest('[data-reprendre]')) { await reprendreSuivi(d); return; }
  if (e.target.closest('[data-convertir-contrat]')) { ouvrirModaleContrat(d); return; }
});
async function agir(requete, succes) {
  try { await requete(); if (succes) gestion.notifier(succes); }
  catch (e) { gestion.message('zone-message-demandes', e.message); }
  await chargerDemandes();   // aussi après un refus du serveur : la fiche montre l'état réel (prise en charge entre-temps…)
}
async function changerStatut(d, statut) {
  if (statut === 'refusee' && !await gestion.confirmer('La demande reste visible dans « Refusées » et peut être rouverte plus tard.', `Refuser la demande de ${d.nom} ?`, 'Refuser la demande', { danger: true })) return;
  await agir(() => socle.api(`/api/demandes/${d.id}`, { method: 'PATCH', body: { statut } }),
    statut === 'refusee' ? 'Demande refusée ✓' : statut === 'en_cours' ? (d.statut === 'refusee' ? 'Demande rouverte ✓' : 'Prise en charge ✓') : 'Demande marquée traitée ✓');
}
async function reprendreSuivi(d) {
  const texte = d.prisEnChargeParNom ? `Elle est suivie par ${d.prisEnChargeParNom}. Vous en deviendrez le responsable.` : 'Vous en deviendrez le responsable.';
  if (!await gestion.confirmer(texte, `Reprendre le suivi de la demande de ${d.nom} ?`, 'Reprendre le suivi', { danger: false })) return;
  await agir(() => socle.api(`/api/demandes/${d.id}/reprendre`, { method: 'POST', body: {} }), 'Suivi repris ✓');
}
// un seul « Enregistrer » pour ce qui se saisit dans la fiche : salon et notes
const enregistrer = d => agir(() => socle.api(`/api/demandes/${d.id}`, { method: 'PATCH', body: { notes: $d('demande-notes').value, salonDiscordId: $d('demande-salon').value.trim() || null } }), 'Demande enregistrée ✓');
async function supprimer(d) {
  if (!await gestion.confirmer('La demande disparaît définitivement. Le salon Discord et le contrat éventuel ne sont pas touchés.', `Supprimer la demande de ${d.nom} ?`, 'Supprimer la demande', { danger: true })) return;
  try { await socle.api(`/api/demandes/${d.id}`, { method: 'DELETE' }); fermerTiroir(); gestion.notifier('Demande supprimée ✓'); }
  catch (e) { gestion.message('zone-message-demandes', e.message); }
  await chargerDemandes();
}
const creerSalon = d => agir(() => socle.api(`/api/demandes/${d.id}/salon`, { method: 'POST', body: {} }), 'Salon créé ✓');

// ---- convertir en contrat ----
champDateFr($d('contrat-demande-debut'));
champDateFr($d('contrat-demande-fin'));
let OUVREUR_MODALE_CONTRAT = null;
// le libellé du montant suit la périodicité cochée : sinon un montant mensuel se saisirait comme hebdomadaire
const LIBELLES_MONTANT = { journalier: 'Montant par jour', hebdomadaire: 'Montant par semaine', mensuel: 'Montant par mois' };
$d('contrat-demande-periodicite').addEventListener('change', e => {
  if (e.target.name === 'contrat-demande-periodicite') $d('contrat-demande-montant-libelle').textContent = LIBELLES_MONTANT[e.target.value] || LIBELLES_MONTANT.hebdomadaire;
});
function ouvrirModaleContrat(d) {
  gestion.message('zone-message-modale-contrat-demande', '');
  $d('contrat-demande-partenaire').value = d.entrepriseNom || d.nom;
  $d('contrat-demande-montant').value = '';
  $d('contrat-demande-montant-libelle').textContent = LIBELLES_MONTANT.hebdomadaire;   // la périodicité cochée par défaut
  document.querySelector('[name="contrat-demande-periodicite"][value="hebdomadaire"]').checked = true;
  $d('contrat-demande-debut').value = '';
  $d('contrat-demande-fin').value = '';
  OUVREUR_MODALE_CONTRAT = document.activeElement;
  $d('modale-contrat-demande').classList.remove('cache');
  $d('contrat-demande-partenaire').focus();
}
const fermerModaleContrat = () => { $d('modale-contrat-demande').classList.add('cache'); if (OUVREUR_MODALE_CONTRAT?.isConnected) OUVREUR_MODALE_CONTRAT.focus(); };
$d('fermer-modale-contrat-demande').addEventListener('click', fermerModaleContrat);
$d('annuler-modale-contrat-demande').addEventListener('click', fermerModaleContrat);
$d('modale-contrat-demande').addEventListener('click', e => { if (e.target.id === 'modale-contrat-demande') fermerModaleContrat(); });
$d('formulaire-contrat-demande').addEventListener('submit', async e => {
  e.preventDefault();
  const d = demandeOuverte();
  if (!d) return;
  const corps = {
    partenaire: $d('contrat-demande-partenaire').value.trim(),
    periodicite: document.querySelector('[name="contrat-demande-periodicite"]:checked').value,
    montant: Number($d('contrat-demande-montant').value),
    dateDebut: $d('contrat-demande-debut').value, dateFin: $d('contrat-demande-fin').value || null,
  };
  if (!corps.partenaire) { gestion.message('zone-message-modale-contrat-demande', 'Indiquez le nom de l’entreprise.'); $d('contrat-demande-partenaire').focus(); return; }
  if (!(corps.montant > 0)) { gestion.message('zone-message-modale-contrat-demande', 'Indiquez un montant supérieur à 0 $.'); $d('contrat-demande-montant').focus(); return; }
  if (!corps.dateDebut) { gestion.message('zone-message-modale-contrat-demande', 'Indiquez la date de début (jj/mm/aaaa).'); $d('contrat-demande-debut').focus(); return; }
  try {
    await socle.api(`/api/demandes/${d.id}/contrat`, { method: 'POST', body: corps });
    fermerModaleContrat();
    gestion.notifier('Contrat créé ✓ Complétez-le si besoin depuis la page Contrats.');
    await chargerDemandes();
  } catch (err) { gestion.message('zone-message-modale-contrat-demande', err.message); }
});

gestion.coque('demandes').then(async moi => { MOI = moi; await chargerDemandes(); });
