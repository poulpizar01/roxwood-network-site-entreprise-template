/* GESTION — Webhooks (permission « webhooks ») : abonnements du bot Discord par type d'événement (onglet
   Abonnements, clé chiffrée en base — serveur : socle/routes/webhooks-abonnements.ts) et journal des événements
   reçus (onglet Événements reçus, inchangé — socle/routes/webhooks-journal.ts). */
const PARIS = { timeZone: 'Europe/Paris' };
const dateHeure = d => new Date(d).toLocaleString('fr-FR', { ...PARIS, dateStyle: 'short', timeStyle: 'medium' });

let moi = null;

// ---- onglets (même recette que Comptabilité → DOT, gestion/dot.js) ----
document.querySelectorAll('[data-webhooks-onglet]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-webhooks-onglet]').forEach(b => { b.classList.toggle('actif', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
    const nom = btn.dataset.webhooksOnglet;
    document.getElementById('panneau-abonnements').classList.toggle('cache', nom !== 'abonnements');
    document.getElementById('panneau-journal').classList.toggle('cache', nom !== 'journal');
    if (nom === 'journal') chargerJournal();
  });
});
// filtres posés avant de basculer l'onglet : son clic déclenche chargerJournal(), qui les lit tels quels
function allerAuJournal(type, traite) {
  if (type) { remplirSelect('filtre-type', [{ valeur: type, libelle: type }], { placeholder: 'Tous les types' }); document.getElementById('filtre-type').value = type; }
  if (traite) document.getElementById('filtre-traite').value = traite;
  document.getElementById('onglet-journal').click();
}

// ---- adresse à donner au bot ----
async function copierTexte(texte) {
  try { await navigator.clipboard.writeText(texte); gestion.notifier('Adresse copiée.'); }
  catch { gestion.message('zone-message', 'Impossible de copier : copie-la à la main.'); }
}
document.getElementById('bouton-copier-adresse').addEventListener('click', () => copierTexte(document.getElementById('adresse-bot').textContent));

// ---------------------------------------------------------------------------
// Onglet Abonnements
// ---------------------------------------------------------------------------
let ABONNEMENTS = [];
const ETAT_ABONNEMENT = {
  actif: ['puce-ok', 'Actif'],
  en_attente: ['puce-alerte', 'En attente'],
  en_echec: ['puce-off', 'En échec'],
  non_configure: ['puce-masquee', 'Non configuré'],
};

function menuAbonnement(a) {
  const items = [
    `<button type="button" role="menuitem" data-action="remplacer">${gestion.ico('key')} Remplacer la clé</button>`,
    `<button type="button" role="menuitem" data-action="historique">${gestion.ico('clock')} Historique de la clé</button>`,
    `<button type="button" role="menuitem" data-action="voir-evenements">${gestion.ico('sync')} Voir les événements reçus</button>`,
    `<button type="button" role="menuitem" class="danger" data-action="retirer">${gestion.ico('trash')} Retirer l’abonnement</button>`,
  ].join('');
  return `<div class="comptes-menu">
    <button type="button" class="comptes-menu-bouton" aria-haspopup="menu" aria-expanded="false" aria-label="Actions pour ${echapper(a.libelle)}">${gestion.ico('points')}</button>
    <div class="comptes-menu-liste cache" role="menu">${items}</div>
  </div>`;
}
function ligneAbonnement(a) {
  const [classe, libelleEtat] = ETAT_ABONNEMENT[a.etat];
  const dernier = a.dernierRecuLe ? dateHeure(a.dernierRecuLe) : 'Aucun pour l’instant';
  const echecs = a.echecs > 0 ? `<button type="button" data-voir-echecs>${a.echecs} échec${a.echecs > 1 ? 's' : ''} à regarder</button>` : '';
  const action = a.etat === 'non_configure'
    ? `<button type="button" class="btn btn-or btn-petit" data-configurer>Configurer</button>`
    : menuAbonnement(a);
  return `<div class="comptes-ligne" data-type="${echapper(a.type)}">
    <div class="comptes-identite"><div><div class="comptes-nom"><strong>${echapper(a.libelle)}</strong></div>
      <span class="webhooks-role">${echapper(a.description)}</span><span class="webhooks-code">${echapper(a.type)}</span></div></div>
    <span class="puce ${classe}">${libelleEtat}</span>
    <span class="webhooks-dernier">${echapper(dernier)}${echecs}</span>
    ${action}
  </div>`;
}
function afficherAbonnements() {
  document.getElementById('liste-abonnements').innerHTML = ABONNEMENTS.length
    ? ABONNEMENTS.map(ligneAbonnement).join('')
    : '<p class="comptes-vide">Aucun type de webhook déclaré par le site.</p>';
}
async function chargerAbonnements() {
  try { ABONNEMENTS = (await socle.api('/api/webhooks/abonnements')).abonnements || []; afficherAbonnements(); }
  catch (e) { gestion.message('zone-message', `Impossible de charger les abonnements : ${e.message}`); }
}

// menus « ⋯ » : un seul ouvert à la fois (même recette que gestion/comptes.html)
let menuOuvert = null;
function fermerMenu(rendreFocus) {
  if (!menuOuvert) return;
  menuOuvert.querySelector('.comptes-menu-liste').classList.add('cache');
  const bouton = menuOuvert.querySelector('.comptes-menu-bouton');
  bouton.setAttribute('aria-expanded', 'false');
  if (rendreFocus) bouton.focus();
  menuOuvert = null;
}
function ouvrirMenu(conteneur) {
  fermerMenu(false);
  const liste = conteneur.querySelector('.comptes-menu-liste'), bouton = conteneur.querySelector('.comptes-menu-bouton');
  liste.classList.remove('cache');
  liste.classList.toggle('vers-le-haut', bouton.getBoundingClientRect().bottom + liste.offsetHeight + 16 > innerHeight);
  bouton.setAttribute('aria-expanded', 'true');
  liste.querySelector('[role=menuitem]').focus();
  menuOuvert = conteneur;
}
document.addEventListener('click', e => { if (menuOuvert && !menuOuvert.contains(e.target)) fermerMenu(false); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && menuOuvert) { e.preventDefault(); fermerMenu(true); }
  if (menuOuvert && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const items = [...menuOuvert.querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
});

// ---- tiroir Configurer / Remplacer / Historique ----
let OUVREUR_TIROIR_AB = null;
const $t = id => document.getElementById(id);
function ouvrirTiroirAbonnement() {
  $t('tiroir-abonnement').classList.remove('cache');
  $t('tiroir-abonnement-corps').scrollTop = 0;
  $t('fermer-tiroir-abonnement').focus();
}
const fermerTiroirAbonnement = () => {
  $t('tiroir-abonnement').classList.add('cache');
  if (OUVREUR_TIROIR_AB?.isConnected) OUVREUR_TIROIR_AB.focus();
};
$t('fermer-tiroir-abonnement').addEventListener('click', fermerTiroirAbonnement);
document.getElementById('tiroir-abonnement').addEventListener('click', e => { if (e.target.id === 'tiroir-abonnement') fermerTiroirAbonnement(); });

function rendreFormulaireCle(a) {
  const existant = a.etat !== 'non_configure';
  return `<ol class="webhooks-etapes">
      <li><div><strong>Créez l’abonnement dans le bot</strong>
        <p>Panneau Discord « Monitoring » du bot → Ajouter un webhook, type <span class="webhooks-type">${echapper(a.type)}</span>.</p></div></li>
      <li><div><strong>Donnez-lui l’adresse du site</strong>
        <div class="webhooks-adresse"><span>Adresse</span><code>${echapper(document.getElementById('adresse-bot').textContent)}</code>
          <button type="button" class="btn btn-fantome btn-petit" data-copier-adresse-tiroir>
            <svg class="ico" aria-hidden="true"><use href="#ico-copy"></use></svg> Copier</button></div>
      </div></li>
      <li><div><strong>Collez la clé secrète affichée par le bot</strong>
        <div class="champ webhooks-cle" style="margin-bottom:0;">
          <input type="password" id="abonnement-cle" autocomplete="off" maxlength="64" aria-describedby="abonnement-cle-aide" aria-label="Clé secrète">
          <button type="button" id="bouton-voir-cle" aria-label="Afficher la clé">
            <svg class="ico" aria-hidden="true"><use href="#ico-eye"></use></svg></button>
        </div>
        <p class="champ-aide" id="abonnement-cle-aide">64 caractères hexadécimaux.</p>
      </div></li>
    </ol>
    ${existant ? `<fieldset class="contrat-choix">
      <legend>Que devient l’ancienne clé ?</legend>
      <div class="contrat-choix-options contrat-choix-options--colonne">
        <label class="contrat-option"><input type="radio" name="expiration-ancienne" value="24h" checked><span><strong>Encore valable 24 h</strong><small>Changement prévu : le temps de retirer l’ancien abonnement dans le bot.</small></span></label>
        <label class="contrat-option"><input type="radio" name="expiration-ancienne" value="immediate"><span><strong>Coupée tout de suite</strong><small>La clé a pu être vue par quelqu’un d’autre.</small></span></label>
      </div>
    </fieldset>` : ''}
    <p class="champ-aide">Discord vous demandera de confirmer votre identité avant l’enregistrement.</p>
    <div id="zone-message-tiroir-abonnement"></div>`;
}
function ouvrirTiroirConfigurer(type) {
  const a = ABONNEMENTS.find(x => x.type === type);
  if (!a) return;
  OUVREUR_TIROIR_AB = document.activeElement;
  $t('tiroir-abonnement-titre').textContent = a.etat === 'non_configure' ? `Configurer : ${a.libelle}` : `Remplacer la clé : ${a.libelle}`;
  $t('tiroir-abonnement-sous-titre').textContent = a.type;
  $t('tiroir-abonnement-corps').innerHTML = rendreFormulaireCle(a);
  $t('tiroir-abonnement-pied').innerHTML = `<button type="button" class="btn btn-danger" id="annuler-abonnement">Annuler</button>
    <span class="tiroir-pied-espace"></span>
    <button type="button" class="btn btn-or" id="enregistrer-abonnement" data-type="${echapper(a.type)}">${a.etat === 'non_configure' ? 'Enregistrer' : 'Remplacer la clé'}</button>`;
  $t('bouton-voir-cle').addEventListener('click', () => {
    const champ = $t('abonnement-cle'), masque = champ.type === 'password';
    champ.type = masque ? 'text' : 'password';
    $t('bouton-voir-cle').innerHTML = `<svg class="ico" aria-hidden="true"><use href="#ico-${masque ? 'eyeoff' : 'eye'}"></use></svg>`;
    $t('bouton-voir-cle').setAttribute('aria-label', masque ? 'Masquer la clé' : 'Afficher la clé');
  });
  $t('annuler-abonnement').addEventListener('click', fermerTiroirAbonnement);
  document.querySelector('[data-copier-adresse-tiroir]').addEventListener('click', () => copierTexte(document.getElementById('adresse-bot').textContent));
  $t('enregistrer-abonnement').addEventListener('click', () => enregistrerCle(a.type));
  ouvrirTiroirAbonnement();
  $t('abonnement-cle').focus();
}
function libelleHistorique(h) {
  const base = h.action === 'retrait' ? `Abonnement retiré par ${echapper(h.acteurNom)}`
    : `Clé ${h.action === 'creation' ? 'enregistrée' : 'remplacée'} par ${echapper(h.acteurNom)}`;
  return h.empreinte ? `${base} · empreinte <span class="webhooks-type">${echapper(h.empreinte)}</span>` : base;
}
async function ouvrirTiroirHistorique(type) {
  const a = ABONNEMENTS.find(x => x.type === type);
  if (!a) return;
  OUVREUR_TIROIR_AB = document.activeElement;
  $t('tiroir-abonnement-titre').textContent = `Historique : ${a.libelle}`;
  $t('tiroir-abonnement-sous-titre').textContent = a.type;
  $t('tiroir-abonnement-corps').innerHTML = '<p class="comptes-vide">Chargement…</p>';
  $t('tiroir-abonnement-pied').innerHTML = '';
  ouvrirTiroirAbonnement();
  try {
    const { historique } = await socle.api(`/api/webhooks/abonnements/${encodeURIComponent(type)}/historique`);
    $t('tiroir-abonnement-corps').innerHTML = historique.length
      ? `<ul class="webhooks-historique">${historique.map(h => `<li><time>${dateHeure(h.horodateLe)}</time>${libelleHistorique(h)}</li>`).join('')}</ul>`
      : '<p class="comptes-vide">Aucun historique pour cet abonnement.</p>';
  } catch (e) { gestion.message($t('tiroir-abonnement-corps'), e.message); }
}
async function enregistrerCle(type) {
  const champ = $t('abonnement-cle'), cle = champ.value.trim();
  if (!/^[0-9a-f]{64}$/i.test(cle)) { gestion.message('zone-message-tiroir-abonnement', 'Clé invalide : collez les 64 caractères hexadécimaux affichés par le bot.'); champ.focus(); return; }
  const radio = document.querySelector('input[name="expiration-ancienne"]:checked');
  try {
    await socle.api(`/api/webhooks/abonnements/${encodeURIComponent(type)}/cle`, { method: 'POST', body: { cle, expirationAncienne: radio ? radio.value : '24h' } });
    fermerTiroirAbonnement();
    gestion.notifier('Clé enregistrée.');
    await chargerAbonnements();
  } catch (e) {
    if (e.data?.error === 'discord-recent') {
      if (document.documentElement.classList.contains('en-jeu')) { gestion.message('zone-message-tiroir-abonnement', 'Une connexion Discord récente est nécessaire, et elle ne fonctionne pas dans l’ordinateur du jeu : reconnectez-vous avec Discord depuis un navigateur.'); return; }
      location.href = `/auth/discord?next=${encodeURIComponent(location.pathname)}`;
      return;
    }
    gestion.message('zone-message-tiroir-abonnement', e.message);
  }
}

document.getElementById('liste-abonnements').addEventListener('click', async e => {
  const ligne = e.target.closest('[data-type]');
  if (!ligne) return;
  const type = ligne.dataset.type;
  const ouvreurMenu = e.target.closest('.comptes-menu-bouton');
  if (ouvreurMenu) { const m = ouvreurMenu.closest('.comptes-menu'); return menuOuvert === m ? fermerMenu(true) : ouvrirMenu(m); }
  if (e.target.closest('[data-configurer]')) { ouvrirTiroirConfigurer(type); return; }
  if (e.target.closest('[data-voir-echecs]')) { allerAuJournal(type, 'non'); return; }
  const action = e.target.closest('[data-action]');
  if (!action) return;
  fermerMenu(false);
  const a = ABONNEMENTS.find(x => x.type === type);
  if (action.dataset.action === 'remplacer') ouvrirTiroirConfigurer(type);
  else if (action.dataset.action === 'historique') ouvrirTiroirHistorique(type);
  else if (action.dataset.action === 'voir-evenements') allerAuJournal(type);
  else if (action.dataset.action === 'retirer') {
    if (!await gestion.confirmer(`La clé de « ${a.type} » sera supprimée : le site refusera ces événements, et il faudra la recoller depuis Discord pour les reprendre. Retirez aussi l’abonnement côté bot (panneau Monitoring), sinon il réessaiera pendant quelques heures.`, 'Supprimer la clé ?', 'Supprimer la clé')) return;
    try { await socle.api(`/api/webhooks/abonnements/${encodeURIComponent(type)}`, { method: 'DELETE' }); gestion.notifier('Abonnement retiré.'); await chargerAbonnements(); }
    catch (err) {
      if (err.data?.error === 'discord-recent') {
        if (document.documentElement.classList.contains('en-jeu')) { gestion.message('zone-message', 'Une connexion Discord récente est nécessaire, et elle ne fonctionne pas dans l’ordinateur du jeu : reconnectez-vous avec Discord depuis un navigateur.'); return; }
        location.href = `/auth/discord?next=${encodeURIComponent(location.pathname)}`; return; }   // comme l'enregistrement d'une clé
      gestion.message('zone-message', err.message);
    }
  }
});

// ---------------------------------------------------------------------------
// Onglet Événements reçus (inchangé)
// ---------------------------------------------------------------------------
let WEBHOOKS = [];

const TRI_WEBHOOKS = gestion.tableauTriable('table-webhooks', {
  type: (a, b) => a.type.localeCompare(b.type, 'fr', { sensitivity: 'base' }),
  recuLe: (a, b) => new Date(a.recuLe) - new Date(b.recuLe),
  traite: (a, b) => Number(a.traite) - Number(b.traite),
}, () => { majEnteteJournal(); afficherJournal(); }, { cle: 'recuLe', sens: -1 });
function majEnteteJournal() {
  document.getElementById('entete-webhooks').innerHTML =
    `<th>${TRI_WEBHOOKS.bouton('type', 'Type')}</th><th>${TRI_WEBHOOKS.bouton('recuLe', 'Date')}</th><th>${TRI_WEBHOOKS.bouton('traite', 'État')}</th>`;
}
majEnteteJournal();

function ligneWebhook(w) {
  return `<tr>
    <td class="cellule-titre"><button type="button" class="table-lien" data-ouvrir-webhook="${w.id}">${echapper(w.type)}</button></td>
    <td>${dateHeure(w.recuLe)}</td>
    <td><span class="puce ${w.traite ? 'puce-ok' : 'puce-off'}">${w.traite ? 'Traité' : 'En échec'}</span></td>
  </tr>`;
}
function afficherJournal() {
  const triees = TRI_WEBHOOKS.appliquer(WEBHOOKS);
  document.getElementById('corps-table-webhooks').innerHTML = triees.length
    ? triees.map(ligneWebhook).join('')
    : '<tr><td colspan="3"><p class="comptes-vide">Aucun webhook pour ces critères.</p></td></tr>';
}
async function chargerJournal() {
  document.getElementById('zone-message').textContent = '';
  try {
    const params = new URLSearchParams();
    const type = document.getElementById('filtre-type').value;
    const traite = document.getElementById('filtre-traite').value;
    if (type) params.set('type', type);
    if (traite) params.set('traite', traite);
    const r = await socle.api(`/api/webhooks${params.toString() ? `?${params}` : ''}`);
    WEBHOOKS = r.webhooks || [];
    // types vus, pour peupler le filtre sans dépendre de ce que le bot envoie en ce moment
    const types = [...new Set(WEBHOOKS.map(w => w.type))].sort();
    remplirSelect('filtre-type', types.map(t => ({ valeur: t, libelle: t })), { placeholder: 'Tous les types' });
    majEnteteJournal();
    afficherJournal();
  } catch (e) { gestion.message('zone-message', `Impossible de charger les webhooks : ${e.message}`); }
}
remplirSelect('filtre-type', [], { placeholder: 'Tous les types' });   // reconstruit avec les vrais types au premier chargement
remplirSelect('filtre-traite', [
  { valeur: 'non', libelle: 'En échec (non traités)' },
  { valeur: 'oui', libelle: 'Traités' },
], { placeholder: 'Tous' });
document.getElementById('filtre-type').addEventListener('change', chargerJournal);
document.getElementById('filtre-traite').addEventListener('change', chargerJournal);

// ---- détail d'un événement (tiroir, inchangé) ----
let OUVREUR_TIROIR = null;
document.getElementById('corps-table-webhooks').addEventListener('click', async e => {
  const b = e.target.closest('[data-ouvrir-webhook]');
  if (!b) return;
  const w = WEBHOOKS.find(x => x.id === Number(b.dataset.ouvrirWebhook));
  if (!w) return;
  OUVREUR_TIROIR = document.activeElement;
  document.getElementById('tiroir-webhook-titre').textContent = w.type;
  document.getElementById('tiroir-webhook-sous-titre').innerHTML = `<span>${dateHeure(w.recuLe)}</span><span class="puce ${w.traite ? 'puce-ok' : 'puce-off'}">${w.traite ? 'Traité' : 'En échec'}</span>`;
  // le contenu n'est pas dans la liste (jusqu'à 64 Ko par événement en échec) : il se lit à l'ouverture
  document.getElementById('tiroir-webhook-corps').innerHTML = '<p>Chargement…</p>';
  document.getElementById('tiroir-webhook').classList.remove('cache');
  let contenu;
  try {
    const d = (await socle.api(`/api/webhooks/${w.id}`)).webhook;
    contenu = d.contenu && Object.keys(d.contenu).length ? JSON.stringify(d.contenu, null, 2) : 'Contenu effacé (événement traité avec succès).';
  } catch (err) { contenu = `Impossible de lire cet événement : ${err.message}`; }
  document.getElementById('tiroir-webhook-corps').innerHTML = `<pre class="webhook-contenu">${echapper(contenu)}</pre>`;
  document.getElementById('tiroir-webhook-corps').scrollTop = 0;
  document.getElementById('fermer-tiroir-webhook').focus();
});
const fermerTiroir = () => {
  document.getElementById('tiroir-webhook').classList.add('cache');
  if (OUVREUR_TIROIR?.isConnected) OUVREUR_TIROIR.focus();
};
document.getElementById('fermer-tiroir-webhook').addEventListener('click', fermerTiroir);
document.getElementById('tiroir-webhook').addEventListener('click', e => { if (e.target.id === 'tiroir-webhook') fermerTiroir(); });

gestion.coque('webhooks').then(m => { moi = m; return chargerAbonnements(); });
