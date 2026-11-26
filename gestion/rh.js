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

let NOTES_VISIBLES = false;   // la fiche ouverte montre-t-elle les notes internes ?
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
    await chargerArriveesBot();   // le décompte des candidatures fait partie du bloc « À traiter » : on montre l'onglet quand il est complet
  } catch (e) {
    gestion.message('zone-message-rh', `Impossible de charger les fiches : ${e.message}`);
  } finally {
    $rh('rh-panneau-effectif').classList.remove('rh-attente');
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
  ouvrirPanneauRh('candidatures');
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
    return `<button type="button" class="ligne-liste${e.statut === 'inactif' ? ' ligne-liste--terminee' : ''}" data-rh-fiche="${e.id}" aria-label="Ouvrir la fiche de ${echapper(e.nomComplet)}">
      <span class="ligne-identite">
        <span class="admin-avatar" aria-hidden="true">${echapper(initiales(e.nomComplet))}</span>
        <span class="ligne-nom"><strong>${echapper(e.nomComplet)}</strong><span class="comptes-pseudo">${echapper(e.idUnique)}${e.idProvisoire ? ' · provisoire' : ''}</span>${etiquettes}</span>
      </span>
      <span class="ligne-cellule" data-libelle="Grade"><span><span class="pastille-grade" style="background:${echapper(e.gradeCouleur || '#8a93b8')}"></span>${echapper(e.gradeLibelle)}</span></span>
      <span class="ligne-cellule" data-libelle="Discord"><span>${e.discordPseudo ? `${echapper(e.discordPseudo)}` : '<span class="comptes-discret">—</span>'}${e.discordId ? `<span class="rh-id-discord">${echapper(e.discordId)}</span>` : ''}</span></span>
      <span class="ligne-cellule" data-libelle="Arrivée">${dateCourte(e.dateArrivee)}</span>
      <span class="ligne-chevron" aria-hidden="true">${gestion.fleche('droite')}</span>
    </button>`;
  }).join('');

  $rh('rh-liste').innerHTML = liste.length
    ? `<div class="liste-entete entete-tri">${entete}<span></span></div>${lignes}`
    : `<p class="comptes-vide">${CACHE_EMPLOYES.length ? 'Aucun employé ne correspond à ces critères.' : 'Aucune fiche pour le moment. Ajoutez un membre pour commencer.'}</p>`;
}
$rh('recherche-employes').addEventListener('input', afficherEmployes);
$rh('filtre-rh-grade').addEventListener('change', afficherEmployes);
document.querySelectorAll('[data-statut]').forEach(b => b.addEventListener('click', () => choisirStatut(b.dataset.statut)));
// cartes plutôt que colonnes quand la place réellement disponible manque (menu, barre de défilement)
gestion.listeEnCartes($rh('rh-liste'), 720);

// clics de la liste : tri, ou ouverture de la fiche (un seul écouteur : la liste est redessinée à chaque fois). Les actions
// (terminer le service, départ, réintégration) sont dans le pied de la fiche, pas sur la ligne.
$rh('rh-liste').addEventListener('click', e => {
  const tri = e.target.closest('[data-tri]');
  if (tri) {
    TRI.cycler(tri.dataset.tri);
    afficherEmployes();
    document.querySelector(`[data-tri="${TRI.etat?.cle ?? tri.dataset.tri}"]`)?.focus();
    return;
  }
  const b = e.target.closest('[data-rh-fiche]');
  if (b) ouvrirFicheEmploye(Number(b.dataset.rhFiche));
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
  if ($rh('modale-employe').classList.contains('cache')) OUVREUR_FICHE = document.activeElement;
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
  // téléphone et RIB : le serveur ne les envoie qu'avec rh-sensible-voir ; sans rh-sensible, ils se lisent sans se modifier
  // notes internes : le serveur ne les envoie qu'à qui peut les lire ; à la création, il faut le droit
  NOTES_VISIBLES = id ? f.notes !== undefined : aDroitRh('notes-voir');
  $rh('employe-notes').closest('.champ').classList.toggle('cache', !NOTES_VISIBLES);
  $rh('employe-notes').value = f.notes || ''; $rh('employe-notes').disabled = !peutEcrire;
  $rh('employe-bloc-sensible').classList.toggle('cache', !aDroitRh('sensible-voir'));
  for (const champ of ['employe-telephone', 'employe-rib']) $rh(champ).readOnly = !aDroitRh('sensible');
  dessinerPiedFiche(id ? f : null, peutEcrire);
  // création : une seule rubrique ; fiche existante : Profil et Activité (l'historique n'existe qu'une fois la fiche créée)
  $rh('employe-onglets').classList.toggle('cache', !id);
  choisirOngletFiche('profil');
  dessinerPiece(id ? f : null);
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
// pied de la fiche : actions à gauche (terminer le service, départ ou réintégration, selon les droits et l'état), Enregistrer
// à droite ; sans rien à y mettre, le pied disparaît
function dessinerPiedFiche(f, peutEcrire) {
  // comme Demandes et Candidatures : les actions variables sur leur ligne, puis Supprimer et Enregistrer groupés à gauche sur la dernière ligne (même place quel que soit le nombre d'actions)
  const actions = [], fin = [];
  if (f && f.modifiable !== false) {
    if (f.enServiceDepuis && aDroitRh('modifier')) actions.push(`<button type="button" class="btn btn-fantome" data-pied-service>${gestion.ico('clock')} Terminer son service</button>`);
    if (f.statut === 'actif' && aDroitRh('desactiver')) actions.push(`<button type="button" class="btn btn-fantome" data-pied-statut="desactiver">${gestion.ico('lock')} Désactiver (départ)</button>`);
    if (f.statut !== 'actif' && aDroitRh('reactiver')) actions.push(`<button type="button" class="btn btn-fantome" data-pied-statut="reactiver">${gestion.ico('sync')} Réactiver</button>`);
    if (aDroitRh('supprimer')) fin.push(`<button type="button" class="btn btn-danger" data-pied-supprimer>${gestion.ico('trash')} Supprimer</button>`);
  }
  if (peutEcrire) fin.push(`<button type="submit" class="btn btn-or" id="employe-enregistrer">${f ? 'Enregistrer' : 'Ajouter'}</button>`);
  $rh('fiche-rh-pied').innerHTML = `${actions.length ? `<div class="tiroir-pied-actions">${gestion.actionsPied(actions)}</div>` : ''}<div class="tiroir-pied-fin">${fin.join('')}</div>`;
  $rh('fiche-rh-pied').classList.toggle('cache', !actions.length && !fin.length);
}
$rh('fiche-rh-pied').addEventListener('click', e => {
  const b = e.target.closest('button[data-pied-service], button[data-pied-statut], button[data-pied-supprimer]');
  if (!b || !FICHE_OUVERTE) return;
  if (b.dataset.piedSupprimer !== undefined) supprimerEmploye(FICHE_OUVERTE);
  else if (b.dataset.piedService !== undefined) terminerServiceEmploye(FICHE_OUVERTE);
  else changerStatutEmploye(FICHE_OUVERTE, b.dataset.piedStatut);
});

// ---- onglets de la fiche : Profil (modifiable) et Activité (compte du site, service, historique écrit par le serveur) ----
function choisirOngletFiche(nom) {
  document.querySelectorAll('[data-fiche-onglet]').forEach(b => { const actif = b.dataset.ficheOnglet === nom; b.classList.toggle('actif', actif); b.setAttribute('aria-selected', String(actif)); b.tabIndex = actif ? 0 : -1; });
  $rh('employe-panneau-profil').classList.toggle('cache', nom !== 'profil');
  $rh('employe-panneau-activite').classList.toggle('cache', nom !== 'activite');
  $rh('employe-enregistrer')?.classList.toggle('cache', nom !== 'profil');   // l'enregistrement ne concerne que le profil
  if (nom === 'activite') chargerJournal();
}
async function chargerJournal() {
  const id = FICHE_OUVERTE, liste = $rh('employe-journal');
  liste.innerHTML = '<li><span>Chargement…</span></li>';
  try {
    const { historique } = await socle.api(`/api/rh/employes/${id}/historique`);
    if (id !== FICHE_OUVERTE) return;   // une autre fiche s'est ouverte pendant la requête
    liste.innerHTML = historique.length
      ? historique.map(h => `<li><span>${echapper(new Date(h.creeLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }))}</span><strong>${echapper(h.texte)}</strong>${h.auteur ? `<small>par ${echapper(h.auteur)}</small>` : ''}</li>`).join('')
      : '<li><span>Rien d’enregistré pour l’instant : l’historique s’écrit à chaque changement de la fiche.</span></li>';
  } catch (e) { if (id === FICHE_OUVERTE) liste.innerHTML = `<li><span>${echapper(e.message)}</span></li>`; }
}
document.querySelectorAll('[data-fiche-onglet]').forEach(b => {
  b.addEventListener('click', () => choisirOngletFiche(b.dataset.ficheOnglet));
  b.addEventListener('keydown', e => {   // flèches : on passe d'une rubrique à l'autre
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const autre = document.querySelector(`[data-fiche-onglet]:not([data-fiche-onglet="${b.dataset.ficheOnglet}"])`);
    choisirOngletFiche(autre.dataset.ficheOnglet); autre.focus();
  });
});

// ---- pièce d'identité (rh-piece-voir pour la voir, rh-piece pour la poser) : une image envoyée, effacée 90 jours après le départ ----
function dessinerPiece(f) {
  const zone = $rh('employe-piece');
  zone.classList.toggle('cache', !f || !aDroitRh('piece-voir'));
  if (!f || !aDroitRh('piece-voir')) return;
  const gerer = aDroitRh('piece') && f.modifiable !== false;
  zone.innerHTML = `<h3 id="titre-employe-piece">Pièce d’identité <span class="rh-donnees-sensibles">${gestion.ico('lock')} données sensibles</span></h3>
    ${f.pieceIdentiteUrlMini
      ? `<button type="button" class="piece-apercu" data-agrandir-piece aria-label="Agrandir la pièce d’identité"><img src="${echapper(f.pieceIdentiteUrlMini)}" alt=""></button>`
      : '<p class="comptes-discret">Aucune pièce d’identité.</p>'}
    ${gerer ? `<div class="piece-actions">
        <button type="button" class="btn btn-fantome" data-piece-choisir>${f.pieceIdentiteUrl ? 'Remplacer la pièce' : 'Ajouter une pièce'}</button>
        ${f.pieceIdentiteUrl ? '<button type="button" class="btn btn-fantome grade-supprimer" data-piece-retirer>Retirer</button>' : ''}
        <input type="file" id="piece-fichier" accept="image/png,image/jpeg,image/webp" class="cache" aria-label="Choisir l’image de la pièce d’identité">
      </div>
      <p class="champ-aide seulement-en-jeu">En jeu, si le choix du fichier ne s’ouvre pas, ajoutez l’image depuis un navigateur, avec le même compte.</p>` : ''}
    <p class="champ-aide">Effacée automatiquement 90 jours après le départ de l’employé.</p>`;
  const grande = zone.querySelector('[data-agrandir-piece]');
  if (grande) grande.addEventListener('click', () => { $rh('image-piece').src = f.pieceIdentiteUrl; $rh('modale-piece').classList.remove('cache'); $rh('fermer-modale-piece').focus(); });
  zone.querySelector('[data-piece-choisir]')?.addEventListener('click', () => $rh('piece-fichier').click());
  $rh('piece-fichier')?.addEventListener('change', async e => {
    const fichier = e.target.files[0];
    if (!fichier) return;
    const corps = new FormData(); corps.append('image', fichier);
    gestion.notifier('Envoi de la pièce d’identité…');
    try { await socle.api(`/api/rh/employes/${FICHE_OUVERTE}/piece-identite`, { method: 'POST', body: corps }); gestion.notifier('Pièce d’identité enregistrée ✓'); rafraichirPiece(); }
    catch (err) { gestion.message('zone-message-modale-employe', err.message); e.target.value = ''; }
  });
  zone.querySelector('[data-piece-retirer]')?.addEventListener('click', async () => {
    if (!await gestion.confirmer('La pièce d’identité de cette fiche sera définitivement retirée.', 'Retirer la pièce d’identité ?', 'Retirer la pièce')) return;
    try { await socle.api(`/api/rh/employes/${FICHE_OUVERTE}/piece-identite`, { method: 'DELETE' }); gestion.notifier('Pièce d’identité retirée ✓'); rafraichirPiece(); }
    catch (err) { gestion.message('zone-message-modale-employe', err.message); }
  });
}
// après un envoi ou un retrait : seule la pièce est redessinée, la saisie en cours dans le profil reste intacte
async function rafraichirPiece() {
  const id = FICHE_OUVERTE;
  try { const f = await socle.api(`/api/rh/employes/${id}`); if (id === FICHE_OUVERTE) dessinerPiece(f); }
  catch (e) { gestion.message('zone-message-modale-employe', e.message); }
}
$rh('fermer-modale-piece').addEventListener('click', () => $rh('modale-piece').classList.add('cache'));
$rh('modale-piece').addEventListener('click', e => { if (e.target.id === 'modale-piece') $rh('modale-piece').classList.add('cache'); });

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

$rh('formulaire-employe').addEventListener('submit', async e => {
  e.preventDefault();
  gestion.message('zone-message-modale-employe', '');
  const val = id => $rh(id).value.trim();
  const corps = {
    prenom: val('employe-prenom'), nom: val('employe-nom'), idUnique: val('employe-id-unique'), grade: $rh('employe-grade').value,
    discordId: val('employe-discord-id'), discordPseudo: val('employe-discord-pseudo'),
    dateArrivee: val('employe-arrivee'), dateDepart: val('employe-depart'), ...(NOTES_VISIBLES && { notes: val('employe-notes') }),
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

async function supprimerEmploye(id) {
  const nom = CACHE_EMPLOYES.find(x => x.id === id)?.nomComplet ?? 'Cet employé';
  if (!await gestion.confirmer(`La fiche de ${nom} est effacée définitivement, avec son historique et ses sanctions. Ses primes sont effacées sur toutes les semaines. Sur les semaines déjà verrouillées, ses factures, ventes et services le sont aussi ; sur les semaines en cours, chiffre d’affaires, quotas et services ne bougent pas (ils perdent seulement son nom). Pour un simple départ, utilisez « Désactiver ».`, 'Supprimer cette fiche ?', 'Supprimer la fiche')) return;
  try {
    await socle.api(`/api/rh/employes/${id}`, { method: 'DELETE' });
    gestion.notifier(`La fiche de ${nom} est supprimée ✓`);
    fermerModaleEmploye();
    FICHE_OUVERTE = null;
    chargerRh();
  } catch (err) { gestion.message('zone-message-modale-employe', err.message); }
}

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
    if (FICHE_OUVERTE === id) ouvrirFicheEmploye(id);
  } catch (err) { gestion.message(FICHE_OUVERTE === id ? 'zone-message-modale-employe' : 'zone-message-rh', err.message); }
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
    // le recrutement par le bot n'existe que dans ce mode : en mode « site », ses événements sont ignorés et sa section masquée
    bloc.classList.toggle('cache', MODE_SITE);
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

// ---- onglets de la page, à plat : Effectif · Candidatures · Réglages du recrutement ----
// Candidatures : celles du bot Discord OU du site (la direction choisit l'un, jamais les deux). Sans le module « recrutement » (site.json), ses
// routes n'existent pas (404) : il ne reste que le bot, et les Réglages ne montrent que la fiche du bot.
let MODE_SITE = false;   // le recrutement passe par le site (module « recrutement » + réglage), sinon par le bot Discord
const PANNEAUX_RH = ['effectif', 'candidatures', 'reglages'];
function ouvrirPanneauRh(nom) {
  document.querySelectorAll('[data-rh-panneau]').forEach(b => { const actif = b.dataset.rhPanneau === nom; b.classList.toggle('actif', actif); b.setAttribute('aria-selected', String(actif)); b.tabIndex = actif ? 0 : -1; });
  for (const p of PANNEAUX_RH) $rh(`rh-panneau-${p}`).classList.toggle('cache', p !== nom);
  // « Ajouter un membre » n'a de sens que sur l'effectif
  $rh('bouton-nouvel-employe').classList.toggle('cache', nom !== 'effectif' || !aDroitRh('creer'));
  history.replaceState(null, '', nom === 'effectif' ? location.pathname : `#${nom}`);
}
document.querySelectorAll('[data-rh-panneau]').forEach(b => b.addEventListener('click', () => ouvrirPanneauRh(b.dataset.rhPanneau)));

async function preparerRecrutement(moi) {
  let reglages = null;
  try { reglages = await socle.api('/api/candidatures/reglages'); } catch { /* module éteint : recrutement par le bot seulement */ }
  MODE_SITE = reglages?.mode === 'site';
  $rh('rh-site').classList.toggle('cache', !MODE_SITE);
  if (!socle.peut(moi, 'rh-parametrer')) return;
  $rh('onglet-rh-reglages').classList.remove('cache');
  const grades = (await socle.api('/api/rh/bot').catch(() => ({ grades: [] }))).grades;
  window.recrutementReglages.init(grades, reglages);
}

gestion.coque('rh').then(async moi => {
  await preparerRecrutement(moi);   // avant chargerRh : la section du bot suit le mode
  await chargerRh();
  if (MODE_SITE) await window.recrutementSite.init(moi);
  const depart = location.hash.slice(1);
  if (depart === 'rh-bot' || depart === 'recrutement') ouvrirPanneauRh('candidatures');
  else if (PANNEAUX_RH.includes(depart)) ouvrirPanneauRh(depart);
});

// dates à la française (le champ natif suivait la langue du navigateur : mm/jj/aaaa en anglais)
champDateFr($rh('employe-arrivee'));
champDateFr($rh('employe-depart'));
