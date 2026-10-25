/* GESTION — Paie (permission « paie ») : salaire de base et primes par palier de quota (run, facture) par grade
   (fiche modale, même principe que la page Grades), et un simulateur (chiffres saisis à la main, ou vraies données
   d'un employé sur une semaine). Serveur : server/src/entreprise/routes/paie.ts. */

const $ = id => document.getElementById(id);
const formaterArgent = n => `${Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;
const carteChiffre = (libelle, valeur, accent) => `<div class="compta-chiffre${accent ? ' accent' : ''}">
  <span class="compta-chiffre-libelle">${libelle}</span><strong>${valeur}</strong></div>`;

// ---- semaine (données réelles) : lundi (AAAA-MM-JJ, calendrier Paris) de la semaine en cours par défaut, navigation
// vers le passé seulement (même recette que Quota et Factures, quota.js/facturation.js) ; numéro ISO affiché en plus
// de la plage de dates, comme demandé pour ce champ précis. ----
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
function numeroSemaineISO(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));   // jeudi de la semaine ISO
  const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - debutAnnee) / 86400000 + 1) / 7);
}
function formaterPlageSemaine(iso) {
  const debut = new Date(`${iso}T00:00:00Z`);
  const fin = new Date(debut); fin.setUTCDate(fin.getUTCDate() + 6);
  const memeMois = debut.getUTCMonth() === fin.getUTCMonth() && debut.getUTCFullYear() === fin.getUTCFullYear();
  const debutTexte = debut.toLocaleDateString('fr-FR', memeMois ? { day: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const finTexte = fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${debutTexte} – ${finTexte}`;
}
const SIM_SEMAINE_COURANTE = lundiDe(jourParisISO(new Date()));
let SIM_SEMAINE = SIM_SEMAINE_COURANTE;

let MOI, GRADES_ORDRE = [], PAIE_GRADES = [], EMPLOYES_SIM = [], EDITION = null, MODE_SIM = 'manuel';
// rang d'un grade (0 = sommet) ; même règle que le serveur (socle/droits.ts) et que la page Grades
const rang = cle => { const i = GRADES_ORDRE.findIndex(g => g.cle === cle); return i < 0 ? GRADES_ORDRE.length : i; };
const gerable = cle => MOI.proprietaire || (!!MOI.grade && rang(cle) > rang(MOI.grade.cle));

// ---------------------------------------------------------------------------
// sous-onglets Grades / Simulateur
// ---------------------------------------------------------------------------
document.querySelectorAll('[data-paie-onglet]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-paie-onglet]').forEach(b => { b.classList.toggle('actif', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
    const nom = btn.dataset.paieOnglet;
    $('paie-panneau-grades').classList.toggle('cache', nom !== 'grades');
    $('paie-panneau-simulateur').classList.toggle('cache', nom !== 'simulateur');
  });
});

// ---------------------------------------------------------------------------
// Grades : une ligne par grade (même liste que la page Grades), fiche modale au clic (salaire de base, paliers)
// ---------------------------------------------------------------------------
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const couleurDe = cle => GRADES_ORDRE.find(g => g.cle === cle)?.couleur || '#8a93b8';

function afficherGrades() {
  $('liste-paie-grades').innerHTML = PAIE_GRADES.length ? PAIE_GRADES.map(g => {
    const peut = gerable(g.cle);
    const tagSalaire = g.salaireActif
      ? `<span class="grades-tag accent">${formaterArgent(g.salaireFixe)} / semaine</span>`
      : `<span class="grades-tag">Pas de salaire de base</span>`;
    const tagRun = g.paliersRun.length
      ? `<span class="grades-tag accent">${pluriel(g.paliersRun.length, 'palier')} run</span>`
      : `<span class="grades-tag">Aucun palier run</span>`;
    const tagFacture = g.paliersFacture.length
      ? `<span class="grades-tag accent">${pluriel(g.paliersFacture.length, 'palier')} facture</span>`
      : `<span class="grades-tag">Aucun palier facture</span>`;
    return `<li class="grades-ligne${peut ? '' : ' verrouille'}" data-cle="${echapper(g.cle)}">
      <button type="button" class="grades-principal" data-ouvrir-paie ${peut ? '' : 'disabled'}>
        <span class="grades-info">
          <span class="pastille-grade" style="background:${echapper(couleurDe(g.cle))}"></span>
          <span class="grades-nom">${echapper(g.libelle)}</span>
          <span class="grades-tags">${tagSalaire}${tagRun}${tagFacture}</span>
        </span>
        <span class="grades-suite" aria-hidden="true">${peut ? fleche('suivant') : 'Au-dessus de vous'}</span>
      </button>
    </li>`;
  }).join('') : '<li class="grades-vide">Aucun grade pour le moment.</li>';
  document.querySelectorAll('[data-ouvrir-paie]').forEach(btn => btn.addEventListener('click', () => ouvrirModalePaie(btn.closest('[data-cle]').dataset.cle)));
}

function lirePaliers(domaine) {
  return Array.from($(`paie-paliers-${domaine}`).querySelectorAll('.palier-ligne')).map(ligne => ({
    seuil: Math.round(Number(ligne.querySelector('.palier-seuil').value)) || 0,
    prime: Math.round(Number(ligne.querySelector('.palier-prime').value)) || 0,
  }));
}

// aperçu vivant, trié par seuil (l'ordre des lignes saisies n'a pas besoin de l'être) : montre tout de suite la forme
// de l'échelle en train de se construire, avant même d'enregistrer
function apercuPaliers(domaine) {
  const paliers = lirePaliers(domaine).filter(p => p.seuil > 0 || p.prime > 0).sort((a, b) => a.seuil - b.seuil);
  const seuilTexte = p => domaine === 'facture' ? formaterArgent(p.seuil) : pluriel(p.seuil, 'unité');
  $(`paie-apercu-${domaine}`).innerHTML = paliers.length
    ? `<div class="palier-apercu-chips">${paliers.map(p => `<span class="palier-apercu-chip">${seuilTexte(p)} ${fleche('droite')} <strong>+${formaterArgent(p.prime)}</strong></span>`).join('')}</div>`
    : '<p class="palier-apercu-vide">Aucun palier réglé : pas de prime pour ce domaine.</p>';
}

function ajouterLignePalier(domaine, seuil = 0, prime = 0) {
  const ligne = $('paie-palier-modele').content.firstElementChild.cloneNode(true);
  ligne.querySelector('.palier-seuil').value = seuil;
  ligne.querySelector('.palier-prime').value = prime;
  $(`paie-paliers-${domaine}`).appendChild(ligne);
  apercuPaliers(domaine);
}
document.querySelectorAll('[data-ajouter-palier]').forEach(btn => btn.addEventListener('click', () => ajouterLignePalier(btn.dataset.ajouterPalier)));
$('formulaire-paie-grade').addEventListener('click', ev => {
  const bouton = ev.target.closest('.facture-article-retirer');
  if (!bouton) return;
  const domaine = bouton.closest('[id^="paie-paliers-"]').id.replace('paie-paliers-', '');
  bouton.closest('.palier-ligne').remove();
  apercuPaliers(domaine);
});
$('formulaire-paie-grade').addEventListener('input', ev => {
  const domaine = ev.target.closest('[id^="paie-paliers-"]')?.id.replace('paie-paliers-', '');
  if (domaine) apercuPaliers(domaine);
});

function ouvrirModalePaie(cle) {
  const g = PAIE_GRADES.find(x => x.cle === cle);
  if (!g || !gerable(cle)) return;
  EDITION = cle;
  $('paie-pastille-titre').style.background = couleurDe(cle);
  $('paie-titre-texte').textContent = `Paie — ${g.libelle}`;
  $('paie-salaire-actif').checked = g.salaireActif;
  $('paie-salaire-fixe').value = g.salaireFixe ?? 0;
  $('paie-salaire-fixe').disabled = !g.salaireActif;
  $('paie-paliers-run').innerHTML = '';
  $('paie-paliers-facture').innerHTML = '';
  g.paliersRun.forEach(p => ajouterLignePalier('run', p.seuil, p.prime));
  g.paliersFacture.forEach(p => ajouterLignePalier('facture', p.seuil, p.prime));
  apercuPaliers('run');
  apercuPaliers('facture');
  gestion.message('zone-message-modale-paie', '');
  $('modale-paie-grade').classList.remove('cache');
}
const fermerModalePaie = () => $('modale-paie-grade').classList.add('cache');
$('paie-salaire-actif').addEventListener('change', () => { $('paie-salaire-fixe').disabled = !$('paie-salaire-actif').checked; });
$('fermer-modale-paie').addEventListener('click', fermerModalePaie);
$('modale-paie-grade').addEventListener('click', ev => { if (ev.target.id === 'modale-paie-grade') fermerModalePaie(); });

$('formulaire-paie-grade').addEventListener('submit', async ev => {
  ev.preventDefault();
  gestion.message('zone-message-modale-paie', '');
  try {
    await socle.api(`/api/paie/grades/${encodeURIComponent(EDITION)}/salaire`, {
      method: 'PUT', body: { salaireActif: $('paie-salaire-actif').checked, salaireFixe: Number($('paie-salaire-fixe').value) || 0 },
    });
    await socle.api(`/api/paie/grades/${encodeURIComponent(EDITION)}/paliers/run`, { method: 'PUT', body: { paliers: lirePaliers('run') } });
    await socle.api(`/api/paie/grades/${encodeURIComponent(EDITION)}/paliers/facture`, { method: 'PUT', body: { paliers: lirePaliers('facture') } });
    fermerModalePaie();
    gestion.notifier('Paie enregistrée ✓');
    await chargerPaieGrades();
  } catch (e) { gestion.message('zone-message-modale-paie', e.message); }
});

// ---------------------------------------------------------------------------
// Simulateur : chiffres saisis à la main, ou vraies données d'un employé (run/facture) sur une semaine
// ---------------------------------------------------------------------------
document.querySelectorAll('[data-simulateur-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-simulateur-mode]').forEach(b => { b.classList.toggle('actif', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    MODE_SIM = btn.dataset.simulateurMode;
    $('simulateur-groupe-manuel').classList.toggle('cache', MODE_SIM !== 'manuel');
    $('simulateur-groupe-reel').classList.toggle('cache', MODE_SIM !== 'reel');
    $('simulateur-resultat').classList.add('cache');
    $('bouton-copier-simulateur').classList.add('cache');
    $('simulateur-vide').classList.remove('cache');
  });
});
// sélecteur de semaine (données réelles) : numéro ISO + plage de dates, navigation vers le passé seulement (une
// semaine future n'existe pas encore à simuler ; le serveur ramènerait de toute façon à la semaine en cours)
function majNavSemaineSimulateur() {
  const courante = SIM_SEMAINE === SIM_SEMAINE_COURANTE;
  $('simulateur-semaine-numero').innerHTML = `Semaine ${numeroSemaineISO(SIM_SEMAINE)}${courante ? ' <span class="semaine-actuelle-tag">· actuelle</span>' : ''}`;
  $('simulateur-semaine-plage').textContent = formaterPlageSemaine(SIM_SEMAINE);
  $('simulateur-semaine-aujourdhui').setAttribute('aria-label', courante ? 'Semaine actuelle' : `${formaterPlageSemaine(SIM_SEMAINE)} : revenir à cette semaine`);
  $('simulateur-semaine-suivante').disabled = courante;
}
function allerSemaineSimulateur(iso) {
  SIM_SEMAINE = iso > SIM_SEMAINE_COURANTE ? SIM_SEMAINE_COURANTE : iso;
  majNavSemaineSimulateur();
}
$('simulateur-semaine-precedente').addEventListener('click', () => allerSemaineSimulateur(decalerSemaine(SIM_SEMAINE, -1)));
$('simulateur-semaine-suivante').addEventListener('click', () => allerSemaineSimulateur(decalerSemaine(SIM_SEMAINE, 1)));
$('simulateur-semaine-aujourdhui').addEventListener('click', () => allerSemaineSimulateur(SIM_SEMAINE_COURANTE));
majNavSemaineSimulateur();

function formaterJourFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// échelle d'un domaine (run ou facture) : repères des paliers réglés, allumés en or dès que la valeur les atteint ;
// rien si aucun palier n'est réglé pour ce grade (une échelle vide n'apprendrait rien)
function echelle(titre, valeur, unite, paliers) {
  if (!paliers.length) return '';
  const echelleMax = Math.max(valeur, ...paliers.map(p => p.seuil)) * 1.12 || 1;
  const pct = v => Math.min(100, (v / echelleMax) * 100);
  const valeurTexte = unite === '$' ? formaterArgent(valeur) : pluriel(valeur, 'unité');
  return `<div class="palier-echelle">
    <div class="palier-echelle-entete"><span>${echapper(titre)}</span><strong>${valeurTexte}</strong></div>
    <div class="palier-echelle-piste"><div class="palier-echelle-remplie" style="width:${pct(valeur)}%"></div></div>
    <div class="palier-echelle-reperes">${paliers.map(p => `<span class="palier-echelle-repere${valeur >= p.seuil ? ' atteint' : ''}" style="left:${pct(p.seuil)}%"></span>`).join('')}</div>
    <div class="palier-echelle-etiquettes">${paliers.map(p => `<span class="palier-echelle-etiquette${valeur >= p.seuil ? ' atteint' : ''}" style="left:${pct(p.seuil)}%"><strong>+${formaterArgent(p.prime)}</strong>${unite === '$' ? formaterArgent(p.seuil) : pluriel(p.seuil, 'u.')}</span>`).join('')}</div>
  </div>`;
}

let DERNIER_RESULTAT = null;

$('formulaire-simulateur').addEventListener('submit', async ev => {
  ev.preventDefault();
  gestion.message('zone-message-simulateur', '');
  try {
    const params = new URLSearchParams();
    if (MODE_SIM === 'reel') {
      const employeId = $('simulateur-employe').value;
      if (!employeId) throw new Error('Choisissez un employé.');
      params.set('employeId', employeId);
      params.set('semaine', SIM_SEMAINE);
    } else {
      if (!$('simulateur-grade').value) throw new Error('Choisissez un grade.');
      params.set('grade', $('simulateur-grade').value);
      params.set('runs', Number($('simulateur-runs').value) || 0);
      params.set('factures', Number($('simulateur-factures').value) || 0);
    }
    const r = await socle.api(`/api/paie/simuler?${params.toString()}`);
    const config = PAIE_GRADES.find(g => g.cle === r.grade);
    DERNIER_RESULTAT = r;
    $('simulateur-vide').classList.add('cache');
    $('simulateur-resultat').classList.remove('cache');
    $('bouton-copier-simulateur').classList.remove('cache');
    // primes agrégées (run + facture) en un seul chiffre : le détail des deux domaines reste visible dans les échelles
    $('simulateur-chiffres').innerHTML = [
      carteChiffre('Salaire de base', formaterArgent(r.salaireBase)),
      carteChiffre('Primes', formaterArgent(r.primeRun + r.primeFacture)),
      carteChiffre('Total', formaterArgent(r.total), true),
    ].join('');
    $('simulateur-echelles').innerHTML = echelle('Run', r.runs, 'u', config?.paliersRun || []) + echelle('Factures', r.factures, '$', config?.paliersFacture || []);
    const base = `${echapper(r.gradeLibelle)} — ${pluriel(r.runs, 'unité')} de run, ${formaterArgent(r.factures)} facturés`;
    $('simulateur-detail').textContent = r.source === 'reel'
      ? `${base}, semaine du ${formaterJourFr(r.debutSemaine)} (données réelles).`
      : `${base} (données fictives).`;
  } catch (e) { gestion.message('zone-message-simulateur', e.message); }
});

// copie seulement le salaire de base et les primes (nombres bruts, pas « 900 $ »), séparés par une tabulation : collés
// dans Google Sheets, chacun tombe dans sa propre cellule, l'un à côté de l'autre — jamais les deux dans la même
$('bouton-copier-simulateur').addEventListener('click', async () => {
  const r = DERNIER_RESULTAT;
  if (!r) return;
  const ok = await copierTexte([r.salaireBase, r.primeRun + r.primeFacture].join('\t'));
  gestion.notifier(ok ? 'Paie copiée ✓ (prête à coller dans un tableur)' : 'Copie impossible : sélectionnez le texte à la main puis Ctrl+C.', ok ? 'succes' : 'erreur');
});

// ---------------------------------------------------------------------------
async function chargerPaieGrades() {
  const r = await socle.api('/api/paie/grades');
  PAIE_GRADES = r.grades;
  afficherGrades();
  $('simulateur-grade').innerHTML = PAIE_GRADES.map(g => `<option value="${echapper(g.cle)}">${echapper(g.libelle)}</option>`).join('');
  ameliorerSelect($('simulateur-grade'), couleurDe);
}

async function charger() {
  try {
    const [grades, employes] = await Promise.all([socle.api('/api/grades'), socle.api('/api/paie/employes')]);
    GRADES_ORDRE = grades;
    EMPLOYES_SIM = employes.employes;
    $('simulateur-employe').innerHTML = '<option value="">— Choisir —</option>' + EMPLOYES_SIM.map(e => `<option value="${e.id}">${echapper(e.nomComplet)}</option>`).join('');
    ameliorerSelect($('simulateur-employe'), null, null, true);
    await chargerPaieGrades();
  } catch (e) { gestion.message('zone-message-paie', e.message); }
}

gestion.coque('paie').then(m => { MOI = m; return charger(); }).catch(e => gestion.message('zone-message-paie', e.message));
