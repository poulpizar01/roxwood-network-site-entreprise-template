/* GESTION — contrats passés avec d'autres entreprises du serveur : registre interne (pas d'échange avec leur site).
   Montant par période (jour, semaine, mois) ; sans date de fin, reconduit tacitement ; « Mettre fin » pose une date de
   fin (fin de la période en cours, ou aujourd'hui), « Reprendre » la retire. Deux onglets selon la partie : Clients
   et Fournisseurs (types non partagés). Une ligne ouvre la fiche du contrat (tiroir) : échéances, facturation par
   période (clients), bénéficiaires et accès client. Droits revérifiés par le serveur (entreprise/routes/contrats.ts) :
   l'interface ne fait que suivre. */

const $c = id => document.getElementById(id);
let CACHE_CONTRATS = [];
let TYPES_CONTRAT = [];   // [{ id, nom, couleur, partie }], tous confondus ; filtrés par partie à l'affichage
let JOURS_ACCES = [];     // jours où un client peut modifier sa liste (Paramètres → Contrats)
let FILTRE_STATUT = 'actif';
let FILTRE_PARTIE = 'client';
let FILTRE_TYPE = null;   // id du type affiché seul, null : tous
let MOI = null;

const LIBELLES_PARTIE = { client: 'clients', fournisseur: 'fournisseurs' };
const PERIODES = {
  journalier: { par: 'par jour', court: '/ jour', unite: 'jour', unites: 'jours', chaque: 'chaque jour' },
  hebdomadaire: { par: 'par semaine', court: '/ semaine', unite: 'semaine', unites: 'semaines', chaque: 'chaque semaine' },
  mensuel: { par: 'par mois', court: '/ mois', unite: 'mois', unites: 'mois', chaque: 'chaque mois' },
};
const PALETTE_TYPES_CONTRAT = ['#ef7f73', '#a99cf5', '#5fd39a', '#6fb7e8', '#e89a5f', '#d784c4', '#9fb4c7', '#e3cf6f'];
const formaterMontant = n => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;
// jour AAAA-MM-JJ (sans heure) affiché tel quel, sans décalage de fuseau
const jourFr = (iso, options = { day: 'numeric', month: 'short', year: 'numeric' }) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...options }) : '');
const jourCourt = iso => jourFr(iso, { day: 'numeric', month: 'short' });
const typesPour = partie => TYPES_CONTRAT.filter(t => t.partie === partie);
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const peutFacturer = () => !!MOI && socle.peut(MOI, 'factures');

// tri par colonne (en-tête), même composant que RH/Comptes (gestion.creerTri)
const COMPARER_CONTRATS = {
  partenaire: (a, b) => a.partenaire.localeCompare(b.partenaire, 'fr', { sensitivity: 'base' }),
  montant: (a, b) => a.montant - b.montant,
  echeance: (a, b) => (a.dateFin || a.prochaineEcheance || '9999').localeCompare(b.dateFin || b.prochaineEcheance || '9999'),
  facturation: (a, b) => (a.aFacturer?.nombre || 0) - (b.aFacturer?.nombre || 0),
};
const TRI_CONTRATS = gestion.creerTri(COMPARER_CONTRATS);

// ---- onglets : clients / fournisseurs (champ « partie » du contrat) ----
document.querySelectorAll('[data-contrat-partie]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-contrat-partie]').forEach(b => { b.classList.toggle('actif', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
  FILTRE_PARTIE = btn.dataset.contratPartie;
  FILTRE_TYPE = null;
  dessinerLegendeContrat();
  afficherContrats();
}));

// légende : les types de la partie affichée, chacun bouton de filtre (un second clic revient à tous)
function dessinerLegendeContrat() {
  const types = typesPour(FILTRE_PARTIE);
  const legende = $c('contrats-legende');
  legende.classList.toggle('cache', !types.length);
  legende.innerHTML = types.length
    ? '<span class="agenda-legende-titre">Filtrer par type</span>' + types.map(t => `<button type="button" class="filtre-type${FILTRE_TYPE === t.id ? ' actif' : ''}" data-filtre-type="${Number(t.id)}" aria-pressed="${FILTRE_TYPE === t.id}" style="--vis:${echapper(t.couleur)}">${echapper(t.nom)}</button>`).join('')
    : '';
}
$c('contrats-legende').addEventListener('click', e => {
  const b = e.target.closest('[data-filtre-type]');
  if (!b) return;
  const id = Number(b.dataset.filtreType);
  FILTRE_TYPE = FILTRE_TYPE === id ? null : id;
  dessinerLegendeContrat();
  afficherContrats();
  $c('contrats-legende').querySelector(`[data-filtre-type="${id}"]`)?.focus();
});
$c('bouton-types-contrat').addEventListener('click', () => ouvrirTypesContrat());

async function chargerContrats() {
  gestion.message('zone-message-contrats', '');
  try {
    const r = await socle.api('/api/contrats');
    CACHE_CONTRATS = r.contrats || [];
    TYPES_CONTRAT = r.types || [];
    JOURS_ACCES = r.joursAcces || [];
    dessinerLegendeContrat();
    afficherContrats();
    if (CONTRAT_OUVERT) dessinerTiroir();   // fiche ouverte : redessinée avec les nouvelles données
  } catch (e) { gestion.message('zone-message-contrats', `Impossible de charger les contrats : ${e.message}. Rechargez la page ; si le problème continue, prévenez la personne qui s’occupe du site.`); }
}

// ---- liste ----
// échéance : ce qui attend le contrat (fin proche, fin passée, reconduction) — couleur seulement, jamais un badge qui
// décalerait la colonne
function echeanceDe(c) {
  if (c.statut === 'termine') return { texte: c.dateFin ? `Terminé le ${jourCourt(c.dateFin)}` : 'Terminé', classe: 'contrat-echeance--terminee' };
  if (c.dateFin) return { texte: `Se termine le ${jourCourt(c.dateFin)}`, classe: c.finProche ? 'contrat-echeance--proche' : '' };
  return { texte: c.prochaineEcheance ? `Reconduit · échéance le ${jourCourt(c.prochaineEcheance)}` : `Reconduit ${PERIODES[c.periodicite].chaque}`, classe: '' };
}
function facturationDe(c) {
  if (c.partie !== 'client') return '';
  if (c.aFacturer) return `<span class="contrat-facturation contrat-facturation--a-faire">${pluriel(c.aFacturer.nombre, `${PERIODES[c.periodicite].unite} à facturer`, `${PERIODES[c.periodicite].unites} à facturer`)}</span>`;
  return c.periodes.some(p => p.etat !== 'a-venir') ? '<span class="contrat-facturation contrat-facturation--ok">À jour</span>' : '<span class="contrat-facturation">Rien à facturer</span>';
}
function ligneContrat(c) {
  const e = echeanceDe(c);
  return `<button type="button" class="contrat-ligne${c.statut === 'termine' ? ' contrat-ligne--terminee' : ''}" data-ouvrir-contrat="${c.id}" aria-label="Ouvrir le contrat avec ${echapper(c.partenaire)}">
    <span class="contrat-ligne-identite">
      <span class="admin-avatar" aria-hidden="true">${echapper(initiales(c.partenaire))}</span>
      <span class="contrat-ligne-nom"><strong>${echapper(c.partenaire)}</strong>${c.type ? `<span class="sanction-type" style="--vis:${echapper(c.type.couleur)}">${echapper(c.type.nom)}</span>` : ''}</span>
    </span>
    <span class="contrat-ligne-cellule" data-libelle="Montant"><span class="contrat-montant">${formaterMontant(c.montant)}</span> <small>${PERIODES[c.periodicite].court}</small></span>
    <span class="contrat-ligne-cellule ${e.classe}" data-libelle="Échéance">${e.texte}</span>
    ${c.partie === 'client' ? `<span class="contrat-ligne-cellule" data-libelle="Facturation">${facturationDe(c)}</span>` : ''}
    <span class="contrat-ligne-chevron" aria-hidden="true">${fleche('droite')}</span>
  </button>`;
}
function afficherStats(contrats) {
  const enCours = contrats.filter(c => c.statut === 'actif');
  const client = FILTRE_PARTIE === 'client';
  $c('stat-en-cours').textContent = String(enCours.length);
  $c('stat-en-cours-libelle').textContent = enCours.length > 1 ? `contrats ${LIBELLES_PARTIE[FILTRE_PARTIE]}` : `contrat ${FILTRE_PARTIE}`;
  $c('carte-stat-facturer').classList.toggle('cache', !client);
  if (client) {
    const aFacturer = contrats.filter(c => c.aFacturer);
    const total = aFacturer.reduce((s, c) => s + c.aFacturer.nombre * c.montant, 0);
    $c('stat-facturer').textContent = formaterMontant(total);
    $c('stat-facturer-libelle').textContent = aFacturer.length ? `sur ${pluriel(aFacturer.length, 'contrat', 'contrats')}, périodes commencées` : 'tout est facturé';
  }
  const fin = enCours.filter(c => c.finProche).length;
  $c('stat-fin').textContent = String(fin);
  $c('stat-fin-libelle').textContent = fin ? 'dans les 7 jours' : 'aucun dans les 7 jours';
}
function afficherContrats() {
  const terme = $c('recherche-contrats').value.trim().toLowerCase();
  const dePartie = CACHE_CONTRATS.filter(c => c.partie === FILTRE_PARTIE);
  ['client', 'fournisseur'].forEach(p => { $c(`compte-${p}`).textContent = String(CACHE_CONTRATS.filter(c => c.partie === p && c.statut === 'actif').length || ''); });
  afficherStats(dePartie);
  const filtres = TRI_CONTRATS.appliquer(dePartie.filter(c => (!FILTRE_STATUT || c.statut === FILTRE_STATUT)
    && (!FILTRE_TYPE || c.type?.id === FILTRE_TYPE)
    && (!terme || c.partenaire.toLowerCase().includes(terme))));
  const client = FILTRE_PARTIE === 'client';
  const colonnes = [['partenaire', 'Partenaire'], ['montant', 'Montant'], ['echeance', 'Échéance'], ...(client ? [['facturation', 'Facturation']] : [])];
  const liste = $c('contrats-liste');
  liste.classList.toggle('contrats-liste-v2--fournisseurs', !client);
  const vide = !dePartie.length
    ? `Aucun contrat ${FILTRE_PARTIE === 'client' ? 'client' : 'fournisseur'} pour le moment. « Nouveau contrat » en crée un.`
    : FILTRE_STATUT === 'actif' && !terme && !FILTRE_TYPE ? 'Aucun contrat en cours. Les contrats terminés restent dans « Terminés ».'
    : 'Aucun contrat ne correspond à ces critères.';
  liste.innerHTML = filtres.length
    ? `<div class="contrat-entete entete-tri">${colonnes.map(([cle, libelle]) => TRI_CONTRATS.bouton(cle, libelle)).join('')}<span></span></div>${filtres.map(ligneContrat).join('')}`
    : `<p class="comptes-vide">${vide}</p>`;
}
$c('recherche-contrats').addEventListener('input', afficherContrats);
// cartes plutôt que colonnes quand la place réellement disponible manque (menu, barre de défilement), pas d'après
// la largeur de l'écran
new ResizeObserver(([e]) => $c('contrats-liste').classList.toggle('contrats-liste-v2--etroite', e.contentRect.width < 700)).observe($c('contrats-liste'));
document.querySelectorAll('[data-statut-contrat]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-statut-contrat]').forEach(x => { x.classList.toggle('actif', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  FILTRE_STATUT = b.dataset.statutContrat;
  afficherContrats();
}));
$c('contrats-liste').addEventListener('click', e => {
  const tri = e.target.closest('[data-tri]');
  if (tri) { TRI_CONTRATS.cycler(tri.dataset.tri); afficherContrats(); document.querySelector(`#contrats-liste [data-tri="${tri.dataset.tri}"]`)?.focus(); return; }
  const ligne = e.target.closest('[data-ouvrir-contrat]');
  if (ligne) ouvrirTiroir(Number(ligne.dataset.ouvrirContrat));
});

// ---- fiche d'un contrat (tiroir) : bandeau d'état, résumé, facturation, bénéficiaires, accès client, notes ----
let CONTRAT_OUVERT = null, OUVREUR_TIROIR = null;
const ETATS_PERIODE = {
  payee: ['Payée', 'contrat-periode--payee'],
  facturee: ['Facturée, en attente de paiement', 'contrat-periode--facturee'],
  'a-facturer': ['À facturer', 'contrat-periode--a-facturer'],
  'a-venir': ['À venir', 'contrat-periode--a-venir'],
};
const contratOuvert = () => CACHE_CONTRATS.find(c => c.id === CONTRAT_OUVERT);

function bandeauEtat(c) {
  if (c.statut === 'termine') return `<div class="contrat-bandeau contrat-bandeau--termine" role="note">
    <svg class="ico" aria-hidden="true"><use href="#ico-clock"></use></svg>
    <p><strong>${c.dateFin ? `Terminé le ${jourFr(c.dateFin)}` : 'Contrat terminé'}</strong>${c.partie === 'client' ? 'La liste du client est figée et n’apparaît plus dans Clients.' : ''}</p></div>`;
  if (c.finProche) return `<div class="contrat-bandeau contrat-bandeau--proche" role="note">
    <svg class="ico" aria-hidden="true"><use href="#ico-alerte"></use></svg>
    <p><strong>Se termine le ${jourFr(c.dateFin)}</strong>Pour le prolonger, modifiez sa date de fin ou retirez-la.</p></div>`;
  return '';
}
function sectionResume(c) {
  const p = PERIODES[c.periodicite];
  return `<dl class="contrat-resume">
    <div><dt>Montant</dt><dd><span class="contrat-montant">${formaterMontant(c.montant)}</span> ${p.par}</dd></div>
    <div><dt>Début</dt><dd>${jourFr(c.dateDebut)}</dd></div>
    <div><dt>Fin</dt><dd>${c.dateFin ? jourFr(c.dateFin) : `Reconduit ${p.chaque}`}</dd></div>
    ${c.statut === 'actif' && c.prochaineEcheance ? `<div><dt>Prochaine échéance</dt><dd>${jourFr(c.prochaineEcheance, { weekday: 'long', day: 'numeric', month: 'long' })}</dd></div>` : ''}
  </dl>`;
}
function sectionFacturation(c) {
  if (c.partie !== 'client') return '';
  const p = PERIODES[c.periodicite];
  const frise = c.periodes.map(x => {
    const [libelle, classe] = ETATS_PERIODE[x.etat];
    const dates = x.debut === x.fin ? jourCourt(x.debut) : `${jourCourt(x.debut)} – ${jourCourt(x.fin)}`;
    return `<li class="contrat-periode ${classe}"><span class="contrat-periode-dates">${dates}</span><span class="contrat-periode-etat">${libelle}</span></li>`;
  }).join('');
  const a = c.aFacturer;
  const action = a
    ? peutFacturer()
      ? `<button type="button" class="btn btn-or contrat-facturer" data-facturer>Facturer ${pluriel(a.nombre, p.unite, p.unites)} · ${formaterMontant(a.nombre * c.montant)}</button>
         <p class="champ-aide">Du ${jourFr(a.debut)} au ${jourFr(a.fin)}. Le formulaire de facture s’ouvre pré-rempli : vérifiez puis validez.</p>`
      : `<p class="champ-aide">${pluriel(a.nombre, p.unite, p.unites)} à facturer, du ${jourFr(a.debut)} au ${jourFr(a.fin)}. Demandez-le à une personne qui gère les factures.</p>`
    : `<p class="champ-aide">${c.periodes.length ? 'Toutes les périodes commencées sont facturées.' : 'Le contrat n’a pas encore commencé.'}</p>`;
  return `<section class="tiroir-section" aria-labelledby="titre-facturation-contrat">
    <h3 id="titre-facturation-contrat">Facturation</h3>
    ${c.periodes.length ? `<ol class="contrat-frise" aria-label="Périodes, de la plus ancienne à la prochaine">${frise}</ol>` : ''}
    ${action}
  </section>`;
}
function sectionBeneficiaires(c) {
  if (c.partie !== 'client') return '';
  const n = c.beneficiaires.length;
  const maj = c.beneficiairesMajLe ? `Liste mise à jour le ${new Date(c.beneficiairesMajLe).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' })}.` : '';
  return `<section class="tiroir-section" aria-labelledby="titre-beneficiaires-contrat">
    <h3 id="titre-beneficiaires-contrat">Bénéficiaires <span class="tiroir-compte">${n}</span></h3>
    ${n ? `<ul class="contrat-personnes">${c.beneficiaires.map(b => `<li><span>${echapper(b.nom)}</span>${b.idUnique ? `<small>ID ${echapper(b.idUnique)}</small>` : ''}</li>`).join('')}</ul><p class="champ-aide">${maj} Le client remplit lui-même cette liste avec son lien d’accès.</p>`
      : `<p class="champ-aide">Aucune personne pour le moment. Donnez au client son lien d’accès : il remplira lui-même la liste.</p>`}
  </section>`;
}
function sectionAcces(c) {
  if (c.partie !== 'client') return '';
  const jours = JOURS_ACCES.length ? `Le client peut modifier sa liste le ${JOURS_ACCES.join(', le ')}.` : 'Aucun jour n’est ouvert au client : sa liste ne se modifie jamais (Paramètres → Contrats).';
  const lienParametres = socle.peut(MOI, 'parametres') ? ' <a href="parametres.html">Changer les jours</a>' : '';
  return `<section class="tiroir-section" aria-labelledby="titre-acces-contrat">
    <h3 id="titre-acces-contrat">Accès client</h3>
    ${c.accesActif
      ? `<p class="contrat-acces-etat"><span class="puce puce-ok">Lien actif</span>${c.statut === 'termine' ? ' en lecture seule pour le client' : ''}</p>
         <div class="contrat-acces-actions">
           <button type="button" class="btn btn-fantome" data-copier-acces><svg class="ico" aria-hidden="true"><use href="#ico-copy"></use></svg> Copier le lien</button>
           <button type="button" class="btn btn-fantome grade-supprimer" data-revoquer-acces>Révoquer le lien</button>
         </div>`
      : `<p class="champ-aide">Un lien personnel, sans compte, pour que le client remplisse sa liste de bénéficiaires.</p>
         <div class="contrat-acces-actions">
           <button type="button" class="btn btn-fantome" data-donner-acces><svg class="ico" aria-hidden="true"><use href="#ico-key"></use></svg> Créer et copier le lien</button>
         </div>`}
    <p class="champ-aide">${jours}${lienParametres}</p>
  </section>`;
}
function dessinerTiroir() {
  const c = contratOuvert();
  if (!c) { fermerTiroir(); return; }
  $c('tiroir-contrat-avatar').textContent = initiales(c.partenaire);
  $c('tiroir-contrat-titre').textContent = c.partenaire;
  $c('tiroir-contrat-sous-titre').innerHTML = [
    `<span class="puce ${c.statut === 'termine' ? 'puce-masquee' : 'puce-ok'}">${c.statut === 'termine' ? 'Terminé' : 'En cours'}</span>`,
    c.type ? `<span class="sanction-type" style="--vis:${echapper(c.type.couleur)}">${echapper(c.type.nom)}</span>` : '',
    `<span>${c.partie === 'client' ? 'Client' : 'Fournisseur'}</span>`,
  ].join('');
  $c('tiroir-contrat-corps').innerHTML = bandeauEtat(c) + sectionResume(c) + sectionFacturation(c) + sectionBeneficiaires(c) + sectionAcces(c)
    + (c.notes ? `<section class="tiroir-section" aria-labelledby="titre-notes-contrat"><h3 id="titre-notes-contrat">Notes</h3><p class="contrat-notes">${echapper(c.notes)}</p></section>` : '');
  // l'action destructive à gauche, loin de la bulle flottante ; les autres à droite
  $c('tiroir-contrat-pied').innerHTML = `
    <button type="button" class="btn btn-fantome grade-supprimer" data-supprimer-contrat>Supprimer</button>
    <span class="tiroir-pied-espace"></span>
    ${c.statut === 'termine'
      ? '<button type="button" class="btn btn-fantome" data-reprendre-contrat>Reprendre le contrat</button>'
      : '<button type="button" class="btn btn-fantome" data-terminer-contrat>Mettre fin au contrat</button>'}
    <button type="button" class="btn btn-or" data-modifier-contrat>${gestion.ico('pencil')} Modifier</button>`;
}
function ouvrirTiroir(id) {
  CONTRAT_OUVERT = id;
  OUVREUR_TIROIR = document.activeElement;
  dessinerTiroir();
  $c('tiroir-contrat').classList.remove('cache');
  $c('tiroir-contrat-corps').scrollTop = 0;
  $c('fermer-tiroir-contrat').focus();
}
function fermerTiroir() {
  CONTRAT_OUVERT = null;
  $c('tiroir-contrat').classList.add('cache');
  if (OUVREUR_TIROIR?.isConnected) OUVREUR_TIROIR.focus();
}
$c('fermer-tiroir-contrat').addEventListener('click', fermerTiroir);
$c('tiroir-contrat').addEventListener('click', async e => {
  if (e.target.id === 'tiroir-contrat') { fermerTiroir(); return; }
  const c = contratOuvert();
  if (!c) return;
  if (e.target.closest('[data-modifier-contrat]')) ouvrirModaleContrat(c.id);
  else if (e.target.closest('[data-terminer-contrat]')) ouvrirFinContrat(c);
  else if (e.target.closest('[data-reprendre-contrat]')) reprendreContrat(c);
  else if (e.target.closest('[data-supprimer-contrat]')) supprimerContrat(c);
  else if (e.target.closest('[data-facturer]')) facturerContrat(c);
  else if (e.target.closest('[data-donner-acces], [data-copier-acces]')) copierAcces(c, !c.accesActif);
  else if (e.target.closest('[data-revoquer-acces]')) revoquerAcces(c);
});

// facture : formulaire de Facturation pré-rempli avec les périodes à facturer (le serveur les revérifie)
function facturerContrat(c) {
  const a = c.aFacturer, p = PERIODES[c.periodicite];
  if (!a) return;
  const params = new URLSearchParams({ depuisContrat: String(c.id), client: c.partenaire, montant: String(c.montant), nombre: String(a.nombre), unite: p.unite, debut: a.debut, fin: a.fin });
  location.href = `facturation.html?${params}`;
}

async function copierAcces(c, nouveau) {
  try {
    const { lien } = await socle.api(`/api/contrats/${c.id}/acces`, { method: 'POST' });
    const copie = await copierTexte(lien);
    gestion.notifier(copie ? (nouveau ? 'Lien créé et copié ✓' : 'Lien copié ✓') : 'Lien créé, mais la copie a échoué : réessayez « Copier le lien ».');
    if (nouveau) chargerContrats();
  } catch (e) { gestion.message('zone-message-contrats', `Impossible de créer le lien : ${e.message}`); }
}
async function revoquerAcces(c) {
  if (!await gestion.confirmer('Le lien actuel ne fonctionnera plus. Vous pourrez en créer un nouveau, à transmettre au client.', 'Révoquer le lien du client ?', 'Révoquer le lien', { danger: true })) return;
  try {
    await socle.api(`/api/contrats/${c.id}/acces`, { method: 'DELETE' });
    gestion.notifier('Lien révoqué ✓');
    chargerContrats();
  } catch (e) { gestion.message('zone-message-contrats', e.message); }
}
async function reprendreContrat(c) {
  const p = PERIODES[c.periodicite];
  if (!await gestion.confirmer(`Le contrat repart sans date de fin, reconduit ${p.chaque}.${c.partie === 'client' ? ' Le client pourra de nouveau modifier sa liste.' : ''}`, `Reprendre le contrat avec ${c.partenaire} ?`, 'Reprendre le contrat', { danger: false })) return;
  try {
    await socle.api(`/api/contrats/${c.id}/reprendre`, { method: 'POST', body: {} });
    gestion.notifier('Contrat repris ✓');
    chargerContrats();
  } catch (e) { gestion.message('zone-message-contrats', e.message); }
}
async function supprimerContrat(c) {
  if (!await gestion.confirmer(`Le contrat, sa liste de bénéficiaires et le lien du client sont effacés. Les factures déjà émises restent dans Facturation. Pour simplement l’arrêter, utilisez « Mettre fin au contrat ».`, `Supprimer le contrat avec ${c.partenaire} ?`, 'Supprimer le contrat', { danger: true })) return;
  try {
    await socle.api(`/api/contrats/${c.id}`, { method: 'DELETE' });
    fermerTiroir();
    gestion.notifier('Contrat supprimé ✓');
    chargerContrats();
  } catch (err) { gestion.message('zone-message-contrats', err.message); }
}

// ---- mettre fin : à la fin de la période en cours (préavis habituel) ou aujourd'hui ----
let OUVREUR_FIN = null;
function ouvrirFinContrat(c) {
  gestion.message('zone-message-fin-contrat', '');
  $c('modale-fin-contrat-titre').textContent = `Mettre fin au contrat avec ${c.partenaire}`;
  $c('fin-contrat-periode-titre').textContent = `À la fin de la période en cours, le ${jourFr(c.finPeriodeEnCours, { day: 'numeric', month: 'long' })}`;
  $c('fin-contrat-periode-aide').textContent = `Le contrat court jusqu’à cette date incluse${c.partie === 'client' ? ' ; le client est prévenu sur sa page' : ''}.`;
  document.querySelector('[name="fin-contrat"][value="fin-periode"]').checked = true;
  OUVREUR_FIN = document.activeElement;
  $c('modale-fin-contrat').classList.remove('cache');
  document.querySelector('[name="fin-contrat"][value="fin-periode"]').focus();
}
const fermerFinContrat = () => { $c('modale-fin-contrat').classList.add('cache'); if (OUVREUR_FIN?.isConnected) OUVREUR_FIN.focus(); };
$c('fermer-modale-fin-contrat').addEventListener('click', fermerFinContrat);
$c('modale-fin-contrat').addEventListener('click', e => { if (e.target.id === 'modale-fin-contrat') fermerFinContrat(); });
$c('formulaire-fin-contrat').addEventListener('submit', async e => {
  e.preventDefault();
  const c = contratOuvert();
  if (!c) return;
  const quand = document.querySelector('[name="fin-contrat"]:checked').value;
  try {
    await socle.api(`/api/contrats/${c.id}/terminer`, { method: 'POST', body: { quand } });
    fermerFinContrat();
    gestion.notifier(quand === 'maintenant' ? 'Contrat terminé ✓' : `Fin du contrat fixée au ${jourCourt(c.finPeriodeEnCours)} ✓`);
    chargerContrats();
  } catch (err) { gestion.message('zone-message-fin-contrat', err.message); }
});

// ---- fenêtre : nouveau contrat ou modification ----
let CONTRAT_EN_EDITION = null, OUVREUR_MODALE_CONTRAT = null;
const valeurRadio = nom => document.querySelector(`[name="${nom}"]:checked`)?.value || '';
const choisirRadio = (nom, v) => document.querySelectorAll(`[name="${nom}"]`).forEach(r => { r.checked = r.value === v; });
// le type dépend de la partie choisie dans le formulaire (pas de l'onglet) : les deux listes ne se recouvrent pas
function rafraichirTypesFormulaire(typeIdActuel) {
  const partie = valeurRadio('contrat-partie');
  $c('contrat-type').innerHTML = '<option value="">Aucun type</option>' + typesPour(partie).map(t => `<option value="${t.id}">${echapper(t.nom)}</option>`).join('');
  $c('contrat-type').value = typeIdActuel && typesPour(partie).some(t => t.id === typeIdActuel) ? String(typeIdActuel) : '';
  ameliorerSelect($c('contrat-type'), v => TYPES_CONTRAT.find(t => String(t.id) === v)?.couleur || '#9fb4c7');
}
// libellés qui suivent le rythme choisi : « Montant par semaine », « reconduit chaque semaine »
function majLibellesPeriodicite() {
  const p = PERIODES[valeurRadio('contrat-periodicite')] || PERIODES.hebdomadaire;
  $c('contrat-montant-libelle').textContent = `Montant ${p.par}`;
  $c('contrat-fin-aide').textContent = `Sans date de fin, le contrat est reconduit ${p.chaque} jusqu’à ce que vous y mettiez fin.`;
}
$c('contrat-partie').addEventListener('change', () => rafraichirTypesFormulaire(null));
$c('contrat-periodicite').addEventListener('change', majLibellesPeriodicite);
champDateFr($c('contrat-debut'));
champDateFr($c('contrat-fin'));
const aujourdhuiParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

function ouvrirModaleContrat(id) {
  gestion.message('zone-message-modale-contrat', '');
  CONTRAT_EN_EDITION = id || null;
  const c = id ? CACHE_CONTRATS.find(x => x.id === id) : null;
  $c('modale-contrat-titre').textContent = c ? `Modifier le contrat avec ${c.partenaire}` : 'Nouveau contrat';
  $c('bouton-enregistrer-contrat').textContent = c ? 'Enregistrer les modifications' : 'Créer le contrat';
  choisirRadio('contrat-partie', c ? c.partie : FILTRE_PARTIE);
  choisirRadio('contrat-periodicite', c ? c.periodicite : 'hebdomadaire');
  $c('contrat-partenaire').value = c ? c.partenaire : '';
  $c('contrat-montant').value = c ? c.montant : '';
  $c('contrat-debut').value = c ? c.dateDebut : aujourdhuiParis();
  $c('contrat-fin').value = c?.dateFin || '';
  $c('contrat-notes').value = c ? c.notes : '';
  // déjà facturé : rythme et date de début verrouillés (les périodes facturées se calent dessus) ; partie aussi
  const verrou = !!c?.factures;
  document.querySelectorAll('[name="contrat-periodicite"], [name="contrat-partie"]').forEach(r => { r.disabled = verrou; });
  $c('contrat-debut').disabled = verrou;
  $c('contrat-periodicite-verrou').classList.toggle('cache', !verrou);
  rafraichirTypesFormulaire(c?.type?.id ?? null);
  majLibellesPeriodicite();
  OUVREUR_MODALE_CONTRAT = document.activeElement;
  $c('modale-contrat').classList.remove('cache');
  (c ? $c('contrat-partenaire') : document.querySelector('[name="contrat-partie"]:checked')).focus();
}
const fermerModaleContrat = () => { $c('modale-contrat').classList.add('cache'); if (OUVREUR_MODALE_CONTRAT?.isConnected) OUVREUR_MODALE_CONTRAT.focus(); };
$c('bouton-nouveau-contrat').addEventListener('click', () => ouvrirModaleContrat(null));
$c('fermer-modale-contrat').addEventListener('click', fermerModaleContrat);
$c('modale-contrat').addEventListener('click', e => { if (e.target.id === 'modale-contrat') fermerModaleContrat(); });
$c('formulaire-contrat').addEventListener('submit', async e => {
  e.preventDefault();
  gestion.message('zone-message-modale-contrat', '');
  const corps = {
    partenaire: $c('contrat-partenaire').value.trim(),
    partie: valeurRadio('contrat-partie'), periodicite: valeurRadio('contrat-periodicite'),
    montant: Number($c('contrat-montant').value),
    dateDebut: $c('contrat-debut').value, dateFin: $c('contrat-fin').value || null,
    typeId: $c('contrat-type').value ? Number($c('contrat-type').value) : null,
    notes: $c('contrat-notes').value.trim(),
  };
  if (!corps.partenaire) { gestion.message('zone-message-modale-contrat', 'Indiquez le nom de l’autre entreprise.'); $c('contrat-partenaire').focus(); return; }
  if (!(corps.montant > 0)) { gestion.message('zone-message-modale-contrat', 'Indiquez un montant supérieur à 0 $.'); $c('contrat-montant').focus(); return; }
  if (!corps.dateDebut) { gestion.message('zone-message-modale-contrat', 'Indiquez la date de début (jj/mm/aaaa).'); $c('contrat-debut').focus(); return; }
  try {
    if (CONTRAT_EN_EDITION) await socle.api(`/api/contrats/${CONTRAT_EN_EDITION}`, { method: 'PUT', body: corps });
    else {
      const { id } = await socle.api('/api/contrats', { method: 'POST', body: corps });
      CONTRAT_OUVERT = id;   // la fiche du nouveau contrat s'ouvre une fois la liste rechargée
    }
    const nouveau = !CONTRAT_EN_EDITION;
    fermerModaleContrat();
    gestion.notifier(nouveau ? 'Contrat créé ✓' : 'Contrat enregistré ✓');
    if (corps.partie !== FILTRE_PARTIE) document.querySelector(`[data-contrat-partie="${corps.partie}"]`).click();
    await chargerContrats();
    if (nouveau && CONTRAT_OUVERT) ouvrirTiroir(CONTRAT_OUVERT);
  } catch (err) { gestion.message('zone-message-modale-contrat', err.message); }
});

// ---- types de contrat (modale « Gérer les types ») : classement libre par partie (client ou fournisseur), comme
// les types d'agenda ou de sanction. La modale s'ouvre toujours pour la partie de l'onglet actif. ----
let OUVREUR_TYPES_CONTRAT = null;
let TYPE_CONTRAT_EN_EDITION = null;
function dessinerTypesContrat() {
  const partie = FILTRE_PARTIE;
  const types = typesPour(partie);
  $c('titre-modale-types-contrat').textContent = `Types de contrat — ${LIBELLES_PARTIE[partie]}`;
  $c('types-contrat-intro').textContent = `Les types servent à classer les contrats ${LIBELLES_PARTIE[partie]} et à les repérer par couleur. Ils ne sont pas partagés avec l’autre onglet.`;
  const ul = $c('types-contrat-liste');
  $c('types-contrat-compte').textContent = `${types.length} ${types.length === 1 ? 'type' : 'types'}`;
  ul.innerHTML = types.length ? types.map(t => `
    <li class="types-ligne${TYPE_CONTRAT_EN_EDITION === t.id ? ' en-edition' : ''}" data-type="${Number(t.id)}">
      ${TYPE_CONTRAT_EN_EDITION === t.id ? `
        <div class="types-edition-champs">
          <div class="champ"><label for="type-contrat-nom-${Number(t.id)}">Nom du type</label><input type="text" id="type-contrat-nom-${Number(t.id)}" value="${echapper(t.nom)}" maxlength="40" data-champ="nom"></div>
          <div class="champ types-couleur"><label for="type-contrat-couleur-${Number(t.id)}">Couleur</label><input type="color" id="type-contrat-couleur-${Number(t.id)}" value="${echapper(t.couleur)}" data-champ="couleur"></div>
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
    </li>`).join('') : '<li class="types-vide">Aucun type créé. Ajoutez-en un ci-dessous.</li>';
  const libres = PALETTE_TYPES_CONTRAT.filter(c => !types.some(t => t.couleur === c));
  $c('type-contrat-couleur').value = libres[0] || PALETTE_TYPES_CONTRAT[types.length % PALETTE_TYPES_CONTRAT.length];
}
async function typesContratModifies(promesse, notification) {
  try {
    TYPES_CONTRAT = (await promesse).types || [];
    gestion.message('zone-message-types-contrat', '');
    if (notification) gestion.notifier(notification);
    dessinerTypesContrat();
    dessinerLegendeContrat();
    afficherContrats();
    return true;
  } catch (e) { gestion.message('zone-message-types-contrat', e.message); }
  return false;
}
function ouvrirTypesContrat() {
  OUVREUR_TYPES_CONTRAT = document.activeElement;
  TYPE_CONTRAT_EN_EDITION = null;
  dessinerTypesContrat();
  gestion.message('zone-message-types-contrat', '');
  $c('modale-types-contrat').classList.remove('cache');
  $c('type-contrat-nom').focus();
}
function fermerTypesContrat() {
  $c('modale-types-contrat').classList.add('cache');
  // retour au bouton qui l'a ouverte (« Types de contrat », en tête de page)
  (OUVREUR_TYPES_CONTRAT?.isConnected ? OUVREUR_TYPES_CONTRAT : $c('bouton-types-contrat')).focus();
}
$c('fermer-modale-types-contrat').addEventListener('click', fermerTypesContrat);
$c('modale-types-contrat').addEventListener('click', e => { if (e.target.id === 'modale-types-contrat') fermerTypesContrat(); });
// fenêtre des types : Échap ferme, Tab reste dedans (sinon le clavier agit sur la page cachée derrière)
document.addEventListener('keydown', e => {
  const ouverte = document.querySelector('#modale-types-contrat:not(.cache)');
  if (!ouverte || document.querySelector('[role=alertdialog]')) return;
  if (e.key === 'Escape') { e.preventDefault(); fermerTypesContrat(); return; }
  if (e.key !== 'Tab') return;
  const focusables = [...ouverte.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const premier = focusables[0], dernier = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
  else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
});
$c('form-type-contrat').addEventListener('submit', e => {
  e.preventDefault();
  const nom = $c('type-contrat-nom').value.trim();
  if (!nom) { gestion.message('zone-message-types-contrat', 'Donnez un nom au type avant de l’ajouter.'); $c('type-contrat-nom').focus(); return; }
  const partie = FILTRE_PARTIE;
  typesContratModifies(socle.api('/api/contrats/types', { method: 'POST', body: { nom, couleur: $c('type-contrat-couleur').value, partie } }), `Type « ${nom} » ajouté ✓`)
    .then(ok => { if (ok) { $c('type-contrat-nom').value = ''; $c('type-contrat-nom').focus(); } });
});
$c('types-contrat-liste').addEventListener('click', async e => {
  const ligne = e.target.closest('[data-type]');
  if (!ligne) return;
  const typeId = Number(ligne.dataset.type);
  if (e.target.closest('[data-modifier-type]')) {
    TYPE_CONTRAT_EN_EDITION = typeId;
    dessinerTypesContrat();
    $c(`type-contrat-nom-${typeId}`).focus();
    return;
  }
  if (e.target.closest('[data-annuler-edition]')) {
    TYPE_CONTRAT_EN_EDITION = null;
    dessinerTypesContrat();
    document.querySelector(`[data-type="${typeId}"] [data-modifier-type]`)?.focus();
    return;
  }
  if (e.target.closest('[data-enregistrer-type]')) {
    const nom = ligne.querySelector('[data-champ="nom"]').value.trim();
    const couleur = ligne.querySelector('[data-champ="couleur"]').value;
    if (!nom) { gestion.message('zone-message-types-contrat', 'Donnez un nom au type.'); ligne.querySelector('[data-champ="nom"]').focus(); return; }
    const partie = TYPES_CONTRAT.find(t => t.id === typeId)?.partie || FILTRE_PARTIE;
    const ok = await typesContratModifies(socle.api(`/api/contrats/types/${typeId}`, { method: 'PUT', body: { nom, couleur, partie } }), `Type « ${nom} » enregistré ✓`);
    if (ok) { TYPE_CONTRAT_EN_EDITION = null; dessinerTypesContrat(); document.querySelector(`[data-type="${typeId}"] [data-modifier-type]`)?.focus(); }
    return;
  }
  const b = e.target.closest('[data-supprimer]');
  if (!b) return;
  const t = TYPES_CONTRAT.find(x => x.id === typeId);
  if (!t || !await gestion.confirmer('Les contrats qui l’utilisent resteront, sans type.', `Supprimer le type « ${t.nom} » ?`, 'Supprimer le type', { danger: true })) return;
  const ok = await typesContratModifies(socle.api(`/api/contrats/types/${t.id}`, { method: 'DELETE' }), `Type « ${t.nom} » supprimé ✓`);
  if (ok) $c('type-contrat-nom').focus();
});

// depuis l'Accueil (« contrats à facturer ») : clients en cours, ceux qui ont le plus à facturer en tête
if (new URLSearchParams(location.search).has('a-facturer')) {
  TRI_CONTRATS.cycler('facturation');
  TRI_CONTRATS.cycler('facturation');
  history.replaceState(null, '', location.pathname);
}
gestion.coque('contrats').then(moi => { MOI = moi; chargerContrats(); });
