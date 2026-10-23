/* GESTION — Quota : run (unités vendues en jeu) et factures (montant facturé depuis le site), cumulés depuis lundi
   (heure de Paris), comparés à l'objectif de chacun (réglé dans la fiche de son grade, page Grades) et à l'objectif
   de toute l'équipe (Paramètres → Quota). Trois onglets : Quota run et Quota facture (tout le monde, recherche par
   nom ou prénom — une entreprise peut compter une centaine d'employés, d'où un tableau dense plutôt que des cartes
   aérées) et Classements (top 5 de la semaine, run et factures côte à côte). Droits revérifiés par le serveur
   (entreprise/routes/run.ts, entreprise/routes/compta.ts) : l'interface ne fait que masquer ce qui serait de toute
   façon refusé. */

const $run = id => document.getElementById(id);
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const formaterMontant = n => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;
let EMPLOYES_RUN = [], EMPLOYES_FACTURE = [], MOI_ID_RUN = null;

// ---- tri des deux tableaux (Personne, Grade, Progression = part du quota déjà atteinte) ----
const comparerNomRun = (a, b) => a.nomComplet.localeCompare(b.nomComplet, 'fr', { sensitivity: 'base' });
const creerTriQuota = valeurDe => gestion.creerTri({
  nom: comparerNomRun,
  grade: (a, b) => a.gradeLibelle.localeCompare(b.gradeLibelle, 'fr', { sensitivity: 'base' }) || comparerNomRun(a, b),
  progression: (a, b) => {
    const r = e => (e.quota > 0 ? valeurDe(e) / e.quota : -1);
    return r(a) - r(b) || comparerNomRun(a, b);
  },
});
const TRI_RUN = creerTriQuota(e => e.unites);
const TRI_FACTURE = creerTriQuota(e => e.montant);
function majEnteteQuota(triId, tri) {
  $run(triId).innerHTML = `<th data-titre>${tri.bouton('nom', 'Personne')}</th><th>${tri.bouton('grade', 'Grade')}</th><th>${tri.bouton('progression', 'Progression')}</th>`;
}
function brancherTriQuota(tableId, tri, triId, redessiner) {
  $run(tableId).addEventListener('click', e => {
    const bouton = e.target.closest('[data-tri]');
    if (!bouton) return;
    tri.cycler(bouton.dataset.tri);
    redessiner();
    majEnteteQuota(triId, tri);
    document.querySelector(`#${triId} [data-tri="${tri.etat?.cle ?? bouton.dataset.tri}"]`)?.focus();
  });
}

// ---- semaine affichée : lundi (AAAA-MM-JJ, calendrier Paris) de la semaine en cours par défaut ; navigation vers le
// passé seulement (le serveur ramène toute semaine future à la semaine en cours, classementRuns/classementFactures). ----
const jourParisISO = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
function lundiDe(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function decalerSemaine(iso, sens) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * sens);
  return d.toISOString().slice(0, 10);
}
const SEMAINE_COURANTE = lundiDe(jourParisISO(new Date()));
let RUN_SEMAINE = SEMAINE_COURANTE;

function majNavSemaine() {
  const courante = RUN_SEMAINE === SEMAINE_COURANTE;
  const debut = new Date(`${RUN_SEMAINE}T00:00:00Z`);
  const fin = new Date(debut); fin.setUTCDate(fin.getUTCDate() + 6);
  const options = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  const bouton = $run('run-aujourdhui');
  bouton.textContent = courante ? 'Cette semaine' : `Sem. du ${debut.toLocaleDateString('fr-FR', options)}`;
  bouton.classList.toggle('sur-semaine-courante', courante);
  bouton.setAttribute('aria-label', courante ? 'Cette semaine' : `${bouton.textContent} : revenir à cette semaine`);
  bouton.title = courante ? 'Raccourci : touche T' : 'Revenir à cette semaine (touche T)';
  $run('run-semaine-suivante').disabled = courante;
  $run('run-periode').textContent = `Run et facturation du ${debut.toLocaleDateString('fr-FR', options)} au ${fin.toLocaleDateString('fr-FR', options)}`;   // pas de point : « oct. » en porte déjà un
}

// gris : pas d'objectif pour ce grade (quelle que soit l'évolution) ; rouge : pas commencé ; orange : en cours ; vert : atteint
function etatQuota(valeur, quota) {
  if (quota <= 0) return 'gris';
  if (valeur <= 0) return 'rouge';
  return valeur < quota ? 'orange' : 'vert';
}

// à 0 (rouge), la barre reste vide : pleine, elle se lirait « 100 % ». Le fond teinté rouge et le texte signalent l'état.
function etatEtLargeur(valeur, quota) {
  const etat = etatQuota(valeur, quota);
  const pourcentage = quota > 0 ? Math.min(100, Math.round((valeur / quota) * 100)) : 0;
  return { etat, pourcentage, largeur: pourcentage };
}

function ligneQuota(e, moiId, valeur, quota, formatValeur, formatSeuil) {
  const { etat, pourcentage, largeur } = etatEtLargeur(valeur, quota);
  const progression = quota > 0
    ? `<div class="run-barre run-etat-${etat}" role="progressbar" aria-valuenow="${pourcentage}" aria-valuemin="0" aria-valuemax="100" aria-label="Objectif de ${echapper(e.nomComplet)}"><div class="run-barre-remplie run-etat-${etat}" style="width:${largeur}%"></div></div><span class="run-progression-texte">${formatValeur(valeur)} sur ${formatSeuil(quota)}</span>`
    : `<span class="run-progression-texte run-sans-objectif">${formatValeur(valeur)} · pas d’objectif pour ce grade</span>`;
  return `<tr data-etat="${etat}">
    <td><span class="run-personne">
      <span class="admin-avatar" aria-hidden="true">${echapper(initiales(e.nomComplet))}</span>
      <span class="run-nom">${echapper(e.nomComplet)}${e.id === moiId ? '<span class="admin-service-vous">vous</span>' : ''}</span>
    </span></td>
    <td>${echapper(e.gradeLibelle)}</td>
    <td class="run-cellule-progression">${progression}</td>
  </tr>`;
}

// filtre « Tous » / « Quota non atteint » (même recette que le filtre Actifs/Anciens/Tous de RH, gestion/rh.js) : deux
// pastilles, jamais une seule qu'il faudrait repousser pour revenir en arrière — on voit toujours quel choix est actif.
// « Quota non atteint » ne garde que ceux qui ont un objectif pour leur grade ET ne l'ont pas atteint : un grade sans
// objectif n'a rien à « ne pas atteindre », il reste exclu même avec ce filtre.
function afficherTableauQuota(corpsId, rechercheId, groupeFiltreId, tri, liste, moiId, valeurDe, formatValeur, formatSeuil, videTexte) {
  const recherche = $run(rechercheId).value.trim().toLowerCase();
  const filtreActif = document.querySelector(`[data-run-filtre-groupe="${groupeFiltreId}"] .actif`).dataset.runFiltre === 'non-atteint';
  const filtree = tri.appliquer(liste
    .filter(e => !recherche || e.nomComplet.toLowerCase().includes(recherche))
    .filter(e => !filtreActif || (e.quota > 0 && valeurDe(e) < e.quota)));
  const corps = $run(corpsId);
  const videMessage = !liste.length ? videTexte
    : recherche ? 'Personne ne correspond à cette recherche.'
    : 'Tout le monde a atteint son quota (ou n’en a pas).';
  corps.innerHTML = filtree.length
    ? filtree.map(e => ligneQuota(e, moiId, valeurDe(e), e.quota, formatValeur, formatSeuil)).join('')
    : `<tr><td colspan="3" class="run-vide">${videMessage}</td></tr>`;
}

const afficherQuotaRun = moiId => afficherTableauQuota('run-quota-corps', 'run-recherche', 'run', TRI_RUN, EMPLOYES_RUN, moiId,
  e => e.unites, n => pluriel(n, 'unité'), String, 'Aucun employé actif pour le moment.');
const afficherQuotaFacture = moiId => afficherTableauQuota('facture-quota-corps', 'facture-recherche', 'facture', TRI_FACTURE, EMPLOYES_FACTURE, moiId,
  e => e.montant, formaterMontant, formaterMontant, 'Aucun employé actif pour le moment.');
$run('run-recherche').addEventListener('input', () => afficherQuotaRun(MOI_ID_RUN));
$run('facture-recherche').addEventListener('input', () => afficherQuotaFacture(MOI_ID_RUN));
majEnteteQuota('run-entete', TRI_RUN);
majEnteteQuota('facture-entete', TRI_FACTURE);
brancherTriQuota('run-table', TRI_RUN, 'run-entete', () => afficherQuotaRun(MOI_ID_RUN));
brancherTriQuota('facture-table', TRI_FACTURE, 'facture-entete', () => afficherQuotaFacture(MOI_ID_RUN));

document.querySelectorAll('[data-run-filtre-groupe]').forEach(groupe => {
  const actualiser = groupe.dataset.runFiltreGroupe === 'run' ? afficherQuotaRun : afficherQuotaFacture;
  groupe.querySelectorAll('[data-run-filtre]').forEach(btn => btn.addEventListener('click', () => {
    groupe.querySelectorAll('[data-run-filtre]').forEach(b => { b.classList.toggle('actif', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    actualiser(MOI_ID_RUN);
  }));
});

// une marche du podium (rang 1 à 3) : vide si personne n'occupe ce rang cette semaine.
function marcheHTML(l, rang, moiId, valeurTexteDe) {
  if (!l) return '';
  return `<div class="podium-marche podium-marche--${rang}" data-rang="${rang}">
    <span class="podium-marche-rang" aria-hidden="true">${rang}</span>
    <span class="admin-avatar" aria-hidden="true">${echapper(initiales(l.nomComplet))}</span>
    <span class="podium-marche-nom">${rang === 1 ? '<svg class="ico podium-marche-couronne" aria-hidden="true"><use href="#ico-star"></use></svg>' : ''}${echapper(l.nomComplet)}${l.id === moiId ? '<span class="admin-service-vous">vous</span>' : ''}</span>
    <span class="podium-marche-grade">${echapper(l.gradeLibelle)}</span>
    <span class="podium-marche-montant">${valeurTexteDe(l)}</span>
  </div>`;
}

// les trois premiers en podium (la forme qui dit « classement » d'un coup d'œil), la 4e et la 5e place en liste
// compacte dessous — le podium ne tient que trois marches, inutile de l'étirer pour si peu de monde en plus.
function afficherPodium(marchesId, listeId, classement, moiId, valeurTexteDe) {
  const marches = $run(marchesId), liste = $run(listeId);
  if (!classement.length) {
    marches.innerHTML = '';
    marches.classList.add('cache');
    liste.innerHTML = '<li class="run-vide">Rien à classer cette semaine pour le moment.</li>';
    return;
  }
  const [p1, p2, p3, ...reste] = classement;
  marches.classList.remove('cache');
  marches.innerHTML = [1, 2, 3].map(rang => marcheHTML([p1, p2, p3][rang - 1], rang, moiId, valeurTexteDe)).join('');
  liste.innerHTML = reste.map((l, i) => `<li data-rang="${i + 4}">
      <span class="run-rang">${i + 4}</span>
      <span class="admin-avatar" aria-hidden="true">${echapper(initiales(l.nomComplet))}</span>
      <span class="run-podium-texte"><strong>${echapper(l.nomComplet)}${l.id === moiId ? '<span class="admin-service-vous">vous</span>' : ''}</strong><small>${echapper(l.gradeLibelle)}</small></span>
      <span class="run-podium-montant">${valeurTexteDe(l)}</span>
    </li>`).join('');
}

// barre de progression de toute l'équipe (chiffres clés en tête de page) : même code couleur que chaque ligne de
// tableau, mais sur le total de la semaine comparé à l'objectif réglé dans Paramètres → Quota. Sans objectif réglé
// (0), rien à montrer : la barre reste masquée plutôt que vide ou à 0 %, ce qui laisserait croire à un objectif raté.
function majBarreEquipe(barreId, valeur, quota) {
  const barre = $run(barreId);
  if (quota <= 0) { barre.className = 'run-barre cache'; return; }
  const { etat, largeur } = etatEtLargeur(valeur, quota);
  barre.className = `run-barre run-etat-${etat}`;
  const remplie = barre.firstElementChild;
  remplie.className = `run-barre-remplie run-etat-${etat}`;
  remplie.style.width = `${largeur}%`;
}

async function chargerRun() {
  gestion.message('zone-message-run', '');
  try {
    const [run, factures] = await Promise.all([
      socle.api(`/api/run?semaine=${RUN_SEMAINE}`),
      socle.api(`/api/compta/factures/classement?semaine=${RUN_SEMAINE}`),
    ]);
    RUN_SEMAINE = run.debutSemaine; // le serveur ramène une semaine future demandée à la semaine en cours
    majNavSemaine();
    MOI_ID_RUN = run.moiId;
    EMPLOYES_RUN = run.employes || [];
    EMPLOYES_FACTURE = factures.employes || [];
    $run('run-stat-total').textContent = String(run.uniteSemaine);
    $run('run-stat-libelle').textContent = run.objectifEquipe > 0
      ? `/ ${run.objectifEquipe} unités visées cette semaine`
      : 'unités vendues cette semaine';
    $run('facture-stat-total').textContent = formaterMontant(factures.montantSemaine);
    $run('facture-stat-libelle').textContent = factures.objectifEquipe > 0
      ? `/ ${formaterMontant(factures.objectifEquipe)} visés cette semaine`
      : 'facturés cette semaine';
    majBarreEquipe('run-barre-equipe', run.uniteSemaine, run.objectifEquipe);
    majBarreEquipe('facture-barre-equipe', factures.montantSemaine, factures.objectifEquipe);
    afficherQuotaRun(MOI_ID_RUN);
    afficherQuotaFacture(MOI_ID_RUN);
    afficherPodium('run-marches', 'run-podium', run.classement, MOI_ID_RUN, l => pluriel(l.unites, 'unité'));
    afficherPodium('facture-marches', 'facture-podium', factures.classement, MOI_ID_RUN, l => formaterMontant(l.montant));
  } catch (e) {
    gestion.message('zone-message-run', `Impossible de charger le suivi des quotas : ${e.message}`);
  }
}

function allerSemaine(iso) {
  RUN_SEMAINE = iso > SEMAINE_COURANTE ? SEMAINE_COURANTE : iso;
  majNavSemaine();
  chargerRun();
}
$run('run-semaine-precedente').addEventListener('click', () => allerSemaine(decalerSemaine(RUN_SEMAINE, -1)));
$run('run-semaine-suivante').addEventListener('click', () => allerSemaine(decalerSemaine(RUN_SEMAINE, 1)));
$run('run-aujourdhui').addEventListener('click', () => allerSemaine(SEMAINE_COURANTE));

// raccourci clavier « T » (même logique que l'agenda) : revient à la semaine en cours, sauf champ de saisie ou fenêtre ouverte
document.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1 || e.key.toLowerCase() !== 't') return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.modale-fond:not(.cache), [role=alertdialog]')) return;
  const bouton = $run('run-aujourdhui');
  bouton.click();
  bouton.classList.remove('raccourci');
  void bouton.offsetWidth;
  bouton.classList.add('raccourci');
});

document.querySelectorAll('.run-onglet').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.run-onglet').forEach(b => { b.classList.toggle('actif', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
    const nom = btn.dataset.runOnglet;
    $run('run-panneau-quota').classList.toggle('cache', nom !== 'quota-run');
    $run('facture-panneau-quota').classList.toggle('cache', nom !== 'quota-facture');
    $run('run-panneau-classement').classList.toggle('cache', nom !== 'classement');
  });
});

majNavSemaine();
gestion.coque('quota').then(chargerRun);
