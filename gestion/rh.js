/* GESTION — ressources humaines : fiches employés, source de vérité de l'identité, du grade et du statut de chacun.
   Les droits viennent du serveur et y sont revérifiés à chaque appel
   (server/src/entreprise/routes/rh.ts) : l'interface ne fait que masquer ce qui serait de toute façon refusé.
   Les droits RH se règlent par grade dans la page Grades (permissions « RH : … »).
   Sanctions et Services sont des pages à part (sanctions.js, services.js), même catégorie du menu.
   Mise en page : ce qui demande une action en tête (« À traiter »), puis la liste triable par colonne, puis les données
   à rattacher et le recrutement (candidatures du bot, réglages repliés). */

let CACHE_EMPLOYES = [];
let GRADES_EMPLOYES = [];   // [{ cle, libelle }], dans l'ordre de la page Grades (= hiérarchie)
let GRADES_ATTRIBUABLES = [];   // clés des grades qu'on peut donner (sous le sien) : les autres restent grisés
let DROITS_RH = new Set();
let FICHE_OUVERTE = null;   // id de la fiche en cours d'édition ; null = création
let FILTRE_STATUT = 'actif';
const A_FAIRE = { completer: 0, candidatures: 0 };

const aDroitRh = droit => DROITS_RH.has(droit);
const $rh = id => document.getElementById(id);
const dateCourte = iso => { if (!iso) return '—'; const [a, m, j] = String(iso).slice(0, 10).split('-'); return `${j}/${m}/${a}`; };
const dateHeure = d => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '—');
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

async function chargerRh() {
  gestion.message('zone-message-rh', '');
  try {
    const r = await socle.api('/api/rh/employes');
    CACHE_EMPLOYES = r.employes || [];
    GRADES_EMPLOYES = r.grades || [];
    GRADES_ATTRIBUABLES = r.attribuables || [];
    DROITS_RH = new Set(r.droits || []);
    const options = GRADES_EMPLOYES.map(g => `<option value="${echapper(g.cle)}">${echapper(g.libelle)}</option>`).join('');
    $rh('employe-grade').innerHTML = options;
    ameliorerSelect($rh('employe-grade'), cle => GRADES_EMPLOYES.find(g => g.cle === cle)?.couleur || '#8a93b8');   // les grades qu’on ne peut pas donner y restent grisés
    const filtre = $rh('filtre-rh-grade'), valeur = filtre.value;
    filtre.innerHTML = `<option value="">Tous les grades</option>${options}`;
    filtre.value = valeur;
    ameliorerSelect(filtre);
    $rh('bouton-nouvel-employe').classList.toggle('cache', !aDroitRh('creer'));
    $rh('rh-nb-actifs').textContent = r.effectif.actifs;
    $rh('rh-repartition').textContent = r.effectif.parGrade.map(g => `${g.grade} ${g.nombre}`).join(' · ');
    $rh('rh-nb-inactifs-texte').textContent = r.effectif.inactifs ? pluriel(r.effectif.inactifs, 'ancien employé', 'anciens employés') : '';
    A_FAIRE.completer = CACHE_EMPLOYES.filter(e => e.aCompleter && e.statut === 'actif').length;
    afficherEmployes();
    afficherAFaire();
    chargerArriveesBot();
  } catch (e) {
    gestion.message('zone-message-rh', `Impossible de charger les fiches : ${e.message}`);
  }
}

// ---- « À traiter » : des raccourcis vers ce qui demande une action, rien quand tout est en ordre ----
function afficherAFaire() {
  const items = [
    A_FAIRE.completer && `<button type="button" class="rh-a-faire-item" data-aller="completer"><strong>${A_FAIRE.completer}</strong> ${A_FAIRE.completer > 1 ? 'fiches à compléter' : 'fiche à compléter'}<small>ID provisoire ou nom manquant</small></button>`,
    A_FAIRE.candidatures && `<button type="button" class="rh-a-faire-item" data-aller="rh-bot"><strong>${A_FAIRE.candidatures}</strong> ${A_FAIRE.candidatures > 1 ? 'candidatures à traiter' : 'candidature à traiter'}<small>Réponses du formulaire illisibles</small></button>`,
  ].filter(Boolean);
  $rh('rh-a-faire').classList.toggle('cache', !items.length);
  $rh('rh-a-faire-liste').innerHTML = items.join('');
  const filtreCompleter = document.querySelector('[data-statut="a-completer"]');
  filtreCompleter.classList.toggle('cache', !A_FAIRE.completer && FILTRE_STATUT !== 'a-completer');
}
$rh('rh-a-faire-liste').addEventListener('click', e => {
  const b = e.target.closest('[data-aller]');
  if (!b) return;
  if (b.dataset.aller === 'completer') { choisirStatut('a-completer'); $rh('titre-employes').scrollIntoView({ block: 'start' }); return; }
  $rh(b.dataset.aller).scrollIntoView({ block: 'start' });
});

// ---- liste des employés : filtres, recherche, tri par colonne ----
const rangGrade = cle => { const i = GRADES_EMPLOYES.findIndex(g => g.cle === cle); return i < 0 ? GRADES_EMPLOYES.length : i; };
const COMPARER = {
  nom: (a, b) => a.nomComplet.localeCompare(b.nomComplet, 'fr', { sensitivity: 'base' }),
  grade: (a, b) => rangGrade(a.grade) - rangGrade(b.grade) || COMPARER.nom(a, b),
  discord: (a, b) => String(a.discordPseudo || '~').localeCompare(String(b.discordPseudo || '~'), 'fr', { sensitivity: 'base' }),
  arrivee: (a, b) => String(a.dateArrivee || '9999').localeCompare(String(b.dateArrivee || '9999')),
};
const COLONNES = [['nom', 'Employé'], ['grade', 'Grade'], ['discord', 'Discord'], ['arrivee', 'Arrivée']];
const TRI = gestion.creerTri(COMPARER, { cle: 'grade', sens: 1 });   // trié par grade avant tout clic

function choisirStatut(statut) {
  FILTRE_STATUT = statut;
  document.querySelectorAll('[data-statut]').forEach(b => { const actif = b.dataset.statut === statut; b.classList.toggle('actif', actif); b.setAttribute('aria-pressed', String(actif)); });
  afficherAFaire();
  afficherEmployes();
}

function afficherEmployes() {
  const recherche = $rh('recherche-employes').value.trim().toLowerCase();
  const grade = $rh('filtre-rh-grade').value;
  const correspond = e => FILTRE_STATUT === 'a-completer' ? e.aCompleter && e.statut === 'actif' : !FILTRE_STATUT || e.statut === FILTRE_STATUT;
  for (const b of document.querySelectorAll('[data-nb-statut]')) {
    const s = b.dataset.nbStatut;
    b.textContent = CACHE_EMPLOYES.filter(e => s === 'a-completer' ? e.aCompleter && e.statut === 'actif' : !s || e.statut === s).length;
  }
  const liste = TRI.appliquer(CACHE_EMPLOYES.filter(e => correspond(e) && (!grade || e.grade === grade)
    && (!recherche || [e.nomComplet, e.idUnique, e.discordPseudo, e.discordId].some(v => String(v || '').toLowerCase().includes(recherche)))));

  const entete = COLONNES.map(([cle, libelle]) => TRI.bouton(cle, libelle)).join('');

  const lignes = liste.map(e => {
    const etiquettes = [
      e.aCompleter ? '<span class="puce puce-or">À compléter</span>' : '',
      e.statut === 'inactif' ? `<span class="puce puce-masquee">Parti${e.dateDepart ? ` le ${dateCourte(e.dateDepart)}` : ''}</span>` : '',
    ].join('');
    const actions = [
      `<button type="button" role="menuitem" data-rh-fiche="${e.id}">${gestion.ico('user')} Ouvrir la fiche</button>`,
      e.enService && aDroitRh('modifier') ? `<button type="button" role="menuitem" data-rh-terminer-service="${e.id}">${gestion.ico('clock')} Terminer son service</button>` : '',
      e.statut === 'actif' && aDroitRh('desactiver') ? `<button type="button" role="menuitem" data-rh-desactiver="${e.id}">${gestion.ico('lock')} Désactiver (départ)</button>` : '',
      e.statut !== 'actif' && aDroitRh('reactiver') ? `<button type="button" role="menuitem" data-rh-reactiver="${e.id}">${gestion.ico('sync')} Réactiver</button>` : '',
    ].join('');
    return `<div class="comptes-ligne rh-ligne${e.statut === 'inactif' ? ' refuse' : ''}">
      <button type="button" class="rh-employe" data-rh-fiche="${e.id}">
        <span class="admin-avatar" aria-hidden="true">${echapper(initiales(e.nomComplet))}</span>
        <span class="rh-employe-texte"><span class="comptes-nom"><strong>${echapper(e.nomComplet)}</strong>${etiquettes}</span>
          <span class="comptes-pseudo">${echapper(e.idUnique)}${e.idProvisoire ? ' · provisoire' : ''}</span></span>
      </button>
      <span class="rh-cellule" data-libelle="Grade"><span class="pastille-grade" style="background:${echapper(e.gradeCouleur || '#8a93b8')}"></span>${echapper(e.gradeLibelle)}</span>
      <span class="rh-cellule" data-libelle="Discord">${e.discordPseudo ? `${echapper(e.discordPseudo)}` : '<span class="comptes-discret">—</span>'}${e.discordId ? `<span class="rh-id-discord">${echapper(e.discordId)}</span>` : ''}</span>
      <span class="rh-cellule" data-libelle="Arrivée">${dateCourte(e.dateArrivee)}</span>
      <div class="comptes-menu">
        <button type="button" class="comptes-menu-bouton" aria-haspopup="menu" aria-expanded="false" aria-label="Actions pour ${echapper(e.nomComplet)}">${gestion.ico('points')}</button>
        <div class="comptes-menu-liste cache" role="menu">${actions}</div>
      </div>
    </div>`;
  }).join('');

  $rh('rh-liste').innerHTML = liste.length
    ? `<div class="comptes-entete entete-tri">${entete}<span></span></div>${lignes}`
    : `<p class="comptes-vide">${CACHE_EMPLOYES.length ? 'Aucun employé ne correspond à ces critères.' : 'Aucune fiche pour le moment. Ajoutez un membre pour commencer.'}</p>`;
}
$rh('recherche-employes').addEventListener('input', afficherEmployes);
$rh('filtre-rh-grade').addEventListener('change', afficherEmployes);
document.querySelectorAll('[data-statut]').forEach(b => b.addEventListener('click', () => choisirStatut(b.dataset.statut)));

// clics de la liste : tri, fiche, menu « ⋯ » et ses actions (un seul écouteur : la liste est redessinée à chaque fois)
let MENU_OUVERT = null;
function fermerMenuRh(rendreFocus) {
  if (!MENU_OUVERT) return;
  MENU_OUVERT.querySelector('.comptes-menu-liste').classList.add('cache');
  const b = MENU_OUVERT.querySelector('.comptes-menu-bouton');
  b.setAttribute('aria-expanded', 'false');
  if (rendreFocus) b.focus();
  MENU_OUVERT = null;
}
$rh('rh-liste').addEventListener('click', e => {
  const tri = e.target.closest('[data-tri]');
  if (tri) {
    TRI.cycler(tri.dataset.tri);
    afficherEmployes();
    document.querySelector(`[data-tri="${TRI.etat?.cle ?? tri.dataset.tri}"]`)?.focus();
    return;
  }
  const ouvreur = e.target.closest('.comptes-menu-bouton');
  if (ouvreur) {
    const menu = ouvreur.closest('.comptes-menu');
    if (MENU_OUVERT === menu) return fermerMenuRh(true);
    fermerMenuRh(false);
    const liste = menu.querySelector('.comptes-menu-liste');
    liste.classList.remove('cache');
    liste.classList.toggle('vers-le-haut', ouvreur.getBoundingClientRect().bottom + liste.offsetHeight + 16 > innerHeight);
    ouvreur.setAttribute('aria-expanded', 'true');
    liste.querySelector('[role=menuitem]').focus();
    MENU_OUVERT = menu;
    return;
  }
  const b = e.target.closest('[data-rh-fiche], [data-rh-terminer-service], [data-rh-desactiver], [data-rh-reactiver]');
  if (!b) return;
  fermerMenuRh(false);
  if (b.dataset.rhFiche) ouvrirFicheEmploye(Number(b.dataset.rhFiche));
  else if (b.dataset.rhTerminerService) terminerServiceEmploye(Number(b.dataset.rhTerminerService));
  else if (b.dataset.rhDesactiver) changerStatutEmploye(Number(b.dataset.rhDesactiver), 'desactiver');
  else changerStatutEmploye(Number(b.dataset.rhReactiver), 'reactiver');
});
document.addEventListener('click', e => { if (MENU_OUVERT && !MENU_OUVERT.contains(e.target)) fermerMenuRh(false); });
document.addEventListener('keydown', e => {
  if (!MENU_OUVERT) return;
  if (e.key === 'Escape') { e.preventDefault(); fermerMenuRh(true); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...MENU_OUVERT.querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
});

// ---- fiche : consultation, modification, ou création (id absent, avec un pré-remplissage éventuel) ----
let OUVREUR_FICHE = null;
async function ouvrirFicheEmploye(id, preremplissage) {
  gestion.message('zone-message-modale-employe', '');
  let f = { grade: GRADES_EMPLOYES.at(-1)?.cle || '', ...(preremplissage || {}) };
  if (id) {
    try { f = await socle.api(`/api/rh/employes/${id}`); }
    catch (e) { gestion.message('zone-message-rh', e.message); return; }
  }
  OUVREUR_FICHE = document.activeElement;
  FICHE_OUVERTE = id || null;
  // fiche d'un grade égal ou supérieur, ou sa propre fiche : en lecture seule (le serveur le refuserait)
  const peutEcrire = id ? aDroitRh('modifier') && f.modifiable !== false : aDroitRh('creer');
  $rh('modale-employe-titre').textContent = id ? f.nomComplet : 'Ajouter un membre';
  const champs = {
    'employe-prenom': f.prenom, 'employe-nom': f.nom, 'employe-id-unique': f.idUnique,
    'employe-discord-id': f.discordId, 'employe-discord-pseudo': f.discordPseudo,
    'employe-telephone': f.telephone, 'employe-rib': f.rib,
    'employe-arrivee': f.dateArrivee, 'employe-depart': f.dateDepart,
  };
  for (const [idChamp, valeur] of Object.entries(champs)) { const c = $rh(idChamp); c.value = valeur || ''; c.disabled = !peutEcrire; }
  $rh('erreur-employe-id-unique').classList.add('cache');
  $rh('aide-employe-id-unique').classList.remove('cache');
  $rh('employe-id-unique').classList.remove('champ-invalide');
  const grade = $rh('employe-grade');
  for (const o of grade.options) o.disabled = !GRADES_ATTRIBUABLES.includes(o.value) && o.value !== f.grade;
  grade.value = GRADES_EMPLOYES.some(g => g.cle === f.grade) ? f.grade : (GRADES_EMPLOYES.at(-1)?.cle || '');
  grade.disabled = !peutEcrire;
  // date d'arrivée exigée à la création ; une fiche reprise de l'existant peut ne pas en avoir encore
  $rh('employe-arrivee').required = !id;
  // téléphone et RIB : le serveur ne les envoie qu'avec rh-sensible
  $rh('employe-bloc-sensible').classList.toggle('cache', !aDroitRh('sensible'));
  const bouton = $rh('employe-enregistrer');
  bouton.classList.toggle('cache', !peutEcrire);
  $rh('fiche-rh-pied').classList.toggle('cache', !peutEcrire);
  bouton.textContent = id ? 'Enregistrer' : 'Ajouter';
  $rh('employe-statut').textContent = id
    ? `${f.statut === 'actif' ? 'Employé actif' : 'Ancien employé'}${f.idProvisoire ? '. ID Unique provisoire : remplacez-le par le vrai.' : '.'}${peutEcrire ? '' : ' Fiche en lecture seule (grade égal ou supérieur au vôtre).'}`
    : '';
  $rh('employe-historique').innerHTML = id ? `<ul class="rh-historique">
    <li><span>Compte du site</span><strong>${f.compteDuSite ? `${echapper(f.compteDuSite.nom)}${f.compteDuSite.grade ? ` (${echapper(f.compteDuSite.grade)})` : ''}` : 'Aucun (même ID Discord)'}</strong></li>
  </ul>` : '';
  const enService = id && f.enServiceDepuis;
  $rh('employe-service').classList.toggle('cache', !enService);
  if (enService) $rh('employe-service').textContent = `En service depuis le ${new Date(f.enServiceDepuis).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' })}.`;
  $rh('modale-employe').classList.remove('cache');
  (peutEcrire ? $rh('employe-prenom') : $rh('fermer-modale-employe')).focus();
}
const fermerModaleEmploye = () => { $rh('modale-employe').classList.add('cache'); if (OUVREUR_FICHE?.isConnected) OUVREUR_FICHE.focus(); };
async function terminerServiceEmploye(id) {
  if (!await gestion.confirmer('Son service s’arrête à l’instant, même s’il ou elle est toujours en jeu.', 'Terminer ce service ?', 'Terminer le service')) return;
  try {
    await socle.api(`/api/rh/employes/${id}/service/terminer`, { method: 'POST', body: {} });
    gestion.notifier('Service terminé ✓');
    chargerRh();
    if (FICHE_OUVERTE === id) ouvrirFicheEmploye(id);
  } catch (e) { gestion.message('zone-message-rh', e.message); }
}
$rh('bouton-nouvel-employe').addEventListener('click', () => ouvrirFicheEmploye(null));
$rh('fermer-modale-employe').addEventListener('click', fermerModaleEmploye);
$rh('modale-employe').addEventListener('click', e => { if (e.target.id === 'modale-employe') fermerModaleEmploye(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$rh('modale-employe').classList.contains('cache') && !document.querySelector('[role="alertdialog"]')) fermerModaleEmploye(); });

$rh('formulaire-employe').addEventListener('submit', async e => {
  e.preventDefault();
  gestion.message('zone-message-modale-employe', '');
  const val = id => $rh(id).value.trim();
  const corps = {
    prenom: val('employe-prenom'), nom: val('employe-nom'), idUnique: val('employe-id-unique'), grade: $rh('employe-grade').value,
    discordId: val('employe-discord-id'), discordPseudo: val('employe-discord-pseudo'),
    dateArrivee: val('employe-arrivee'), dateDepart: val('employe-depart'),
  };
  if (aDroitRh('sensible')) { corps.telephone = val('employe-telephone'); corps.rib = val('employe-rib'); }
  // l’ID Unique est un numéro ; un ID provisoire (PROV-…) reste accepté tant qu’on ne l’a pas remplacé
  const idValide = /^\d{1,12}$/.test(corps.idUnique) || /^PROV-/.test(corps.idUnique);
  $rh('erreur-employe-id-unique').classList.toggle('cache', idValide);
  $rh('aide-employe-id-unique').classList.toggle('cache', !idValide);   // l’erreur dit déjà la règle
  $rh('employe-id-unique').classList.toggle('champ-invalide', !idValide);
  if (!idValide) { $rh('employe-id-unique').focus(); return; }
  const creation = !FICHE_OUVERTE;
  try {
    if (creation) await socle.api('/api/rh/employes', { method: 'POST', body: corps });
    else await socle.api(`/api/rh/employes/${FICHE_OUVERTE}`, { method: 'PATCH', body: corps });
    fermerModaleEmploye();
    gestion.message('zone-message-rh', ''), gestion.notifier(creation ? 'Membre ajouté ✓' : 'Fiche enregistrée ✓');
    chargerRh();
  } catch (err) {
    gestion.message('zone-message-modale-employe', err.message);
  }
});

async function changerStatutEmploye(id, action) {
  const e = CACHE_EMPLOYES.find(x => x.id === id), nom = e ? e.nomComplet : 'Cet employé';
  const ok = action === 'desactiver'
    ? await gestion.confirmer(`${nom} quittera l'effectif actif, avec la date d'aujourd'hui comme date de départ. Sa fiche et tout son historique sont conservés, et il pourra être réactivé.`, 'Désactiver cet employé ?', 'Désactiver', { danger: false })
    : await gestion.confirmer(`${nom} réintègre l'effectif actif ; sa date de départ est effacée.`, 'Réactiver cet employé ?', 'Réactiver', { danger: false });
  if (!ok) return;
  try {
    await socle.api(`/api/rh/employes/${id}/${action}`, { method: 'POST', body: {} });
    gestion.message('zone-message-rh', ''), gestion.notifier(action === 'desactiver' ? `${nom} a quitté l’effectif actif ✓` : `${nom} a réintégré l’effectif ✓`);
    chargerRh();
  } catch (err) { gestion.message('zone-message-rh', err.message); }
}

// ---- recrutement : candidatures acceptées reçues du bot Discord, et réglages de leur lecture ----
const ETATS_ARRIVEE = {
  creee: { classe: 'ok', libelle: 'Fiche créée' },
  existante: { classe: 'neutre', libelle: 'Avait déjà une fiche' },
  refusee: { classe: 'alerte', libelle: 'À traiter' },
  ecartee: { classe: 'neutre', libelle: 'Écartée' },
  ecartee_rh: { classe: 'neutre', libelle: 'Écartée' },   // écartée dans RH : un renvoi du bot ne la recrée pas
};
const CHAMPS_REGLAGES_BOT = {
  questionIdentite: 'rh-bot-q-identite', questionIdUnique: 'rh-bot-q-id-unique', questionPrenom: 'rh-bot-q-prenom',
  questionNom: 'rh-bot-q-nom', questionTelephone: 'rh-bot-q-telephone', questionRib: 'rh-bot-q-rib',
};

// Correspondance « information → question du formulaire » : un menu des questions déjà reçues plutôt qu'un libellé à
// recopier (une faute de frappe envoyait la candidature en « à traiter ») ; « Autre libellé » ouvre la saisie libre,
// pour une question pas encore reçue. Le champ texte (caché sauf pour « Autre ») reste ce que lit l'enregistrement.
const AUTRE_LIBELLE = '__autre-libelle__';   // valeur réservée (un caractère nul était remplacé par le navigateur)
function brancherQuestion(input, questions) {
  let choix = $rh(`${input.id}-choix`);
  if (!choix) {
    choix = document.createElement('select');
    choix.id = `${input.id}-choix`;
    input.before(choix);
    choix.addEventListener('change', () => {
      const autre = choix.value === AUTRE_LIBELLE;
      input.classList.toggle('cache', !autre);
      if (autre) { input.value = ''; input.focus(); } else input.value = choix.value;
    });
  }
  const valeur = input.value.trim();
  const connue = !valeur || questions.includes(valeur);
  choix.innerHTML = `<option value="">${echapper(input.dataset.vide || 'Pas demandé')}</option>`
    + questions.map(q => `<option value="${echapper(q)}">« ${echapper(q)} »</option>`).join('')
    + `<option value="${AUTRE_LIBELLE}">Autre libellé…</option>`;
  choix.value = connue ? valeur : AUTRE_LIBELLE;
  input.classList.toggle('cache', connue);
  ameliorerSelect(choix);
}

async function chargerArriveesBot() {
  const bloc = $rh('rh-bot');
  try {
    const r = await socle.api('/api/rh/bot');
    const reglable = aDroitRh('parametrer');
    bloc.classList.toggle('cache', !r.arrivees.length && !reglable);
    // arrivée depuis l'Accueil (« À traiter » → rh.html#rh-bot) : la section n'existait pas encore au chargement
    if (location.hash === '#rh-bot' && !bloc.classList.contains('cache')) requestAnimationFrame(() => bloc.scrollIntoView({ block: 'start' }));
    $rh('rh-bot-details').classList.toggle('cache', !reglable);
    $rh('rh-bot-etat').textContent = 'Les candidatures acceptées sur Discord arrivent ici d’elles-mêmes, envoyées par le bot de l’entreprise. Si rien n’arrive, demandez à la personne qui s’occupe du site de vérifier l’abonnement « Candidatures » du bot.';
    if (reglable) {
      const select = $rh('rh-bot-grade');
      select.innerHTML = '<option value="">À choisir</option>' + r.grades.map(g => `<option value="${echapper(g.cle)}">${echapper(g.libelle)}</option>`).join('');
      select.value = r.reglages.gradeArrivee || '';
      ameliorerSelect(select);
      for (const [champ, id] of Object.entries(CHAMPS_REGLAGES_BOT)) $rh(id).value = r.reglages[champ] || '';
      // prénom et nom en une seule question (réglage « identité ») : la même question dans les deux menus
      if (r.reglages.questionIdentite) { $rh('rh-bot-q-prenom').value = r.reglages.questionIdentite; $rh('rh-bot-q-nom').value = r.reglages.questionIdentite; }
      for (const id of Object.values(CHAMPS_REGLAGES_BOT)) if (id !== 'rh-bot-q-identite') brancherQuestion($rh(id), r.questionsVues);
      majMemeQuestion();
      // un réglage manquant bloque les candidatures : on ouvre les réglages d'office
      if (!r.reglages.gradeArrivee || (!r.reglages.questionIdentite && !(r.reglages.questionPrenom && r.reglages.questionNom))) $rh('rh-bot-details').open = true;
    }
    A_FAIRE.candidatures = r.arrivees.filter(a => a.resultat === 'refusee').length;
    afficherAFaire();
    const peutCreer = aDroitRh('creer');
    // les candidatures à traiter d'abord, puis les plus récentes
    const arrivees = [...r.arrivees].sort((a, b) => (a.resultat === 'refusee' ? 0 : 1) - (b.resultat === 'refusee' ? 0 : 1) || new Date(b.recuLe) - new Date(a.recuLe));
    $rh('rh-bot-contenu').innerHTML = arrivees.length
      ? `<div class="rh-candidatures">${arrivees.map(a => {
          const etat = ETATS_ARRIVEE[a.resultat] || { classe: 'neutre', libelle: 'En attente' };
          const nom = a.nomRecu || (a.discordId ? `Compte Discord ${a.discordId}` : 'Candidat inconnu');
          const actions = a.employe
            ? `<button type="button" class="btn btn-fantome btn-petit" data-rh-bot-fiche="${a.employe.id}">Ouvrir la fiche ${echapper(a.employe.idUnique)}</button>`
            : peutCreer && (a.traitable || a.ecartable)
              ? (a.traitable ? `<button type="button" class="btn btn-or btn-petit" data-rh-bot-action="traiter" data-rh-bot-id="${a.id}">Retraiter</button>` : '')
                + `<button type="button" class="btn btn-fantome btn-petit" data-rh-bot-action="ecarter" data-rh-bot-id="${a.id}">Écarter</button>`
              : '';
          return `<article class="rh-candidature rh-etat-${etat.classe}">
            <div class="rh-candidature-tete"><strong>${echapper(nom)}</strong><span class="rh-etat">${etat.libelle}</span></div>
            <p class="rh-candidature-date">Reçue le ${dateHeure(a.recuLe)}${a.employe?.statut === 'inactif' ? ' · fiche inactive' : ''}</p>
            ${a.motif ? `<p class="rh-candidature-motif">${echapper(a.motif)}</p>` : ''}
            ${actions ? `<div class="rh-candidature-actions">${actions}</div>` : ''}
          </article>`;
        }).join('')}</div>`
      : '<p class="comptes-vide rh-vide-bot">Aucune candidature reçue pour le moment.</p>';
    document.querySelectorAll('[data-rh-bot-fiche]').forEach(b => b.addEventListener('click', () => ouvrirFicheEmploye(Number(b.dataset.rhBotFiche))));
    document.querySelectorAll('[data-rh-bot-action]').forEach(b => b.addEventListener('click', async () => {
      const ecarterLigne = b.dataset.rhBotAction === 'ecarter';
      if (ecarterLigne && !await gestion.confirmer('Aucune fiche ne sera créée, et ses réponses seront effacées.', 'Écarter cette candidature ?', 'Écarter')) return;
      b.disabled = true;
      try {
        const res = await socle.api(`/api/rh/bot/arrivees/${b.dataset.rhBotId}/${b.dataset.rhBotAction}`, { method: 'POST', body: {} });
        if (ecarterLigne) gestion.message('zone-message-rh-bot', ''), gestion.notifier('Candidature écartée ✓');
        else if (res.resultat === 'creee') gestion.message('zone-message-rh-bot', ''), gestion.notifier('Fiche créée ✓');
        else gestion.message('zone-message-rh-bot', res.motif || 'Toujours à traiter.', res.ok ? 'succes' : 'erreur');
        chargerRh();
      } catch (e) { gestion.message('zone-message-rh-bot', e.message); b.disabled = false; }
    }));
  } catch { bloc.classList.add('cache'); }
}

// Prénom et nom : une question chacun. Si le formulaire les demande ensemble, on choisit la même dans les deux menus et
// le site coupe la réponse (réglage « identité » côté serveur : premier mot = prénom, le reste = nom).
const memeQuestionNom = () => { const p = $rh('rh-bot-q-prenom').value.trim(); return p && p === $rh('rh-bot-q-nom').value.trim(); };
function majMemeQuestion() { $rh('rh-nom-meme-question').classList.toggle('cache', !memeQuestionNom()); }
$rh('rh-bot-reglages').addEventListener('change', majMemeQuestion);
$rh('rh-bot-reglages').addEventListener('input', majMemeQuestion);

$rh('rh-bot-reglages').addEventListener('submit', async e => {
  e.preventDefault();
  const corps = { gradeArrivee: $rh('rh-bot-grade').value };
  for (const [champ, id] of Object.entries(CHAMPS_REGLAGES_BOT)) corps[champ] = $rh(id).value.trim();
  if (memeQuestionNom()) { corps.questionIdentite = corps.questionPrenom; corps.questionPrenom = ''; corps.questionNom = ''; }
  else corps.questionIdentite = '';
  try {
    await socle.api('/api/rh/bot/reglages', { method: 'PUT', body: corps });
    gestion.message('zone-message-rh-bot', ''), gestion.notifier('Réglages enregistrés ✓ Les candidatures « à traiter » peuvent être retraitées.');
    chargerArriveesBot();
  } catch (err) { gestion.message('zone-message-rh-bot', err.message); }
});

gestion.coque('rh').then(chargerRh);

// dates à la française (le champ natif suivait la langue du navigateur : mm/jj/aaaa en anglais)
champDateFr($rh('employe-arrivee'));
champDateFr($rh('employe-depart'));
