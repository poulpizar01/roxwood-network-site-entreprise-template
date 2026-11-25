/* GESTION — recrutement sur le site (module « recrutement »), permissions « rh-voir » (consulter, voter) et « rh-creer » (convoquer,
   accepter, refuser, annoter). Colonnes par statut ; une carte ouvre la fiche (tiroir). Changer de colonne : glisser la carte ou un
   bouton du pied — mêmes actions, jamais un autre chemin. Droits revérifiés par le serveur (entreprise/routes/candidatures.ts). */

const $r = id => document.getElementById(id);
let CACHE_CANDIDATURES = [], MON_VOTE = null, MOI = null;
let CANDIDATURE_OUVERTE = null, OUVREUR_TIROIR = null;

const COLONNES = [['recue', 'Reçues'], ['entretien', 'Entretien'], ['acceptee', 'Acceptées'], ['refusee', 'Refusées']];
// cible possible depuis cette colonne (une refusée peut être rouverte : le refus était peut-être une erreur) : mêmes transitions
// que les boutons du pied, rien que le serveur n'accepterait pas déjà
const TRANSITIONS = { recue: ['entretien', 'acceptee', 'refusee'], entretien: ['acceptee', 'refusee'], refusee: ['entretien', 'acceptee'] };
const peutGerer = () => !!MOI && socle.peut(MOI, 'rh-creer');
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const dateHeureFr = iso => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function chargerCandidatures() {
  gestion.message('zone-message-candidatures', '');
  try {
    CACHE_CANDIDATURES = (await socle.api('/api/candidatures')).candidatures || [];
    afficherColonnes();
    if (CANDIDATURE_OUVERTE) await dessinerTiroir();
  } catch (e) { gestion.message('zone-message-candidatures', `Impossible de charger les candidatures : ${e.message}. Rechargez la page ; si le problème continue, prévenez la personne qui s’occupe du site.`); }
}

function carte(c) {
  return `<button type="button" class="carte-statut candidature-carte" data-ouvrir-candidature="${c.id}" aria-label="Ouvrir la candidature de ${echapper(c.prenom)} ${echapper(c.nom)}">
    <span class="candidature-carte-nom">${echapper(c.prenom)} ${echapper(c.nom)}</span>
    ${c.poste ? `<span class="candidature-carte-poste">${echapper(c.poste)}</span>` : ''}
    <span class="candidature-carte-votes"><span>Pour <b>${c.votes.pour}</b></span><span>Contre <b>${c.votes.contre}</b></span></span>
  </button>`;
}
function afficherColonnes() {
  $r('candidatures-colonnes').innerHTML = COLONNES.map(([statut, libelle]) => {
    const liste = CACHE_CANDIDATURES.filter(c => c.statut === statut);
    return `<div class="colonne-statut">
      <div class="colonne-statut-titre">${echapper(libelle)}<span class="compte-colonne">${liste.length}</span></div>
      <div class="colonne-statut-cartes" data-statut="${statut}">${liste.length ? liste.map(carte).join('') : '<p class="colonne-statut-vide">Aucune.</p>'}</div>
    </div>`;
  }).join('');
  // glisser-déposer : composant commun (glisserColonnes, gestion.js), partagé avec les avis ; sans droit, aucune transition
  glisserColonnes('#candidatures-colonnes', { carte: '.candidature-carte', transitions: peutGerer() ? TRANSITIONS : {}, surDepot: (item, _de, vers) => deposer(item, vers) });
}
async function deposer(item, vers) {
  const c = CACHE_CANDIDATURES.find(x => x.id === Number(item.dataset.ouvrirCandidature));
  if (c) {
    if (vers === 'entretien') { CANDIDATURE_OUVERTE = c.id; ouvrirModaleEntretien(); }
    else if (vers === 'acceptee') await accepter(c);
    else if (vers === 'refusee') await refuser(c);
  }
  // la carte a déjà bougé (Sortable) : un rechargement la remet dans sa vraie colonne si l'action est annulée ou attend sa saisie
  await chargerCandidatures();
}
$r('candidatures-colonnes').addEventListener('click', e => {
  const c = e.target.closest('[data-ouvrir-candidature]');
  if (c) ouvrirTiroir(Number(c.dataset.ouvrirCandidature));
});

// ---- fiche d'une candidature (tiroir) ----
const candidatureOuverte = () => CACHE_CANDIDATURES.find(c => c.id === CANDIDATURE_OUVERTE);

function sectionDetail(c) {
  return `<dl class="contrat-resume">
    ${c.poste ? `<div><dt>Poste</dt><dd>${echapper(c.poste)}</dd></div>` : ''}
    <div><dt>Discord</dt><dd>${echapper(c.pseudoDiscord)} <small>vérifié</small></dd></div>
    <div><dt>Reçue le</dt><dd>${dateHeureFr(c.creeLe)}</dd></div>
    ${c.entretienLe ? `<div><dt>Entretien</dt><dd>${dateHeureFr(c.entretienLe)}</dd></div>` : ''}
  </dl>
  <section class="tiroir-section" aria-labelledby="titre-piece-candidature">
    <h3 id="titre-piece-candidature">Pièce d’identité</h3>
    ${c.pieceIdentiteUrlMini
      ? `<button type="button" class="candidature-identite-apercu" data-agrandir-piece="${echapper(c.pieceIdentiteUrl)}" aria-label="Agrandir la pièce d’identité de ${echapper(c.prenom)} ${echapper(c.nom)}"><img src="${echapper(c.pieceIdentiteUrlMini)}" alt="" loading="lazy"></button>
         <p class="champ-aide" style="margin:8px 0 0;">Effacée 90 jours après réception ; à l’acceptation, elle passe sur la fiche de l’employé.</p>`
      : `<p class="champ-aide">${c.statut === 'acceptee' ? 'Sur la fiche de l’employé.' : 'Réservée à qui peut voir les pièces d’identité, ou effacée (conservée 90 jours après réception).'}</p>`}
  </section>
  <section class="tiroir-section" aria-labelledby="titre-motivation-candidature"><h3 id="titre-motivation-candidature">Motivation</h3><p class="contrat-notes">${echapper(c.motivation)}</p></section>`;
}
// une pastille par votant (photo Discord, ou initiales) : qui a voté quoi, pas seulement combien ; le nom complet au survol et pour les lecteurs d'écran
function pastille(v) {
  return v.avatar
    ? `<img class="vote-votant" src="${echapper(v.avatar)}" alt="" title="${echapper(v.nom)}" loading="lazy">`
    : `<span class="vote-votant vote-votant--lettres" title="${echapper(v.nom)}" aria-hidden="true">${echapper(initiales(v.nom))}</span>`;
}
function sectionVote(c) {
  const options = [['pour', 'Pour', 'check'], ['contre', 'Contre', 'fermer'], ['abstention', 'Abstention', 'points']];
  return `<section class="tiroir-section" aria-labelledby="titre-vote-candidature">
    <h3 id="titre-vote-candidature">Vote de l’équipe</h3>
    <p class="champ-aide" style="margin:0 0 12px;">Chacun vote pour soi ; la décision (convoquer, accepter, refuser) reste à qui en a le droit.</p>
    <div class="contrat-choix-options contrat-choix-options--trois vote-options" role="radiogroup" aria-label="Mon vote">
      ${options.map(([v, l, icone]) => {
        const votants = (c.votants && c.votants[v]) || [], actif = MON_VOTE === v;
        return `<label class="contrat-option vote-option vote-option--${v}${actif ? ' vote-option--actif' : ''}">
          <input type="radio" name="vote-candidature" value="${v}" ${actif ? 'checked' : ''}>
          ${gestion.ico(icone)}
          <span><strong>${l}</strong><small>${pluriel(votants.length, 'vote', 'votes')}</small>
            ${votants.length ? `<span class="vote-votants" aria-hidden="true">${votants.map(pastille).join('')}</span><span class="visuellement-cache">${votants.map(vt => echapper(vt.nom)).join(', ')}</span>` : ''}
          </span>
        </label>`;
      }).join('')}
    </div>
  </section>`;
}
// salon et notes : un seul « Enregistrer » dans le pied (comme Demandes)
function sectionSalon(c) {
  return `<section class="tiroir-section" aria-labelledby="titre-salon-candidature">
    <h3 id="titre-salon-candidature">Salon Discord</h3>
    <div class="champ" style="margin-bottom:0;"><input type="text" id="candidature-salon" inputmode="numeric" placeholder="Identifiant du salon" value="${echapper(c.salonDiscordId || '')}" ${peutGerer() ? '' : 'readonly'} aria-label="Identifiant du salon Discord"></div>
    ${c.salonDiscordId ? '' : '<p class="champ-aide">Aucun salon : le bot n’était pas relié à l’envoi, ou la catégorie n’était pas réglée (Paramètres → Discord).</p>'}
    ${peutGerer() && !c.salonDiscordId ? '<div class="modale-boutons" style="margin-top:8px;"><button type="button" class="btn btn-fantome" data-creer-salon>Créer le salon</button></div>' : ''}
  </section>`;
}
function sectionNotes(c) {
  return `<section class="tiroir-section" aria-labelledby="titre-notes-candidature">
    <h3 id="titre-notes-candidature">Notes internes</h3>
    <p class="champ-aide" style="margin:0 0 10px;">Partagées par toute l’équipe RH, à part du vote de chacun ci-dessus.</p>
    <div class="champ" style="margin-bottom:0;"><textarea id="candidature-notes" maxlength="2000" rows="3" aria-label="Notes internes" ${peutGerer() ? '' : 'readonly'}>${echapper(c.notes)}</textarea></div>
  </section>`;
}
const ACTIONS = { entretien: ['sync', 'Convoquer à l’entretien'], acceptee: ['check', 'Accepter'], refusee: ['fermer', 'Refuser'] };
async function dessinerTiroir() {
  const c = candidatureOuverte();
  if (!c) { fermerTiroir(); return; }
  MON_VOTE = await socle.api(`/api/candidatures/${c.id}/mon-vote`).then(r => r.vote).catch(() => null);
  $r('tiroir-candidature-avatar').textContent = initiales(`${c.prenom} ${c.nom}`);
  $r('tiroir-candidature-titre').textContent = `${c.prenom} ${c.nom}`;
  $r('tiroir-candidature-sous-titre').textContent = c.poste || '';
  $r('tiroir-candidature-sous-titre').classList.toggle('cache', !c.poste);
  gestion.conserverSaisies('tiroir-candidature', () => { $r('tiroir-candidature-corps').innerHTML = sectionDetail(c) + sectionVote(c) + sectionSalon(c) + sectionNotes(c); });
  // pied comme celui d'une demande : actions (changer de colonne) au-dessus, puis Supprimer et un seul Enregistrer, en bas à gauche
  const actions = peutGerer() ? (TRANSITIONS[c.statut] || []).map(vers => `<button type="button" class="btn btn-fantome" data-vers="${vers}">${gestion.ico(ACTIONS[vers][0])} ${ACTIONS[vers][1]}</button>`) : [];
  const fin = peutGerer() ? [`<button type="button" class="btn btn-danger" data-supprimer>${gestion.ico('trash')} Supprimer</button>`, '<button type="button" class="btn btn-or" data-enregistrer>Enregistrer</button>'] : [];
  $r('tiroir-candidature-pied').innerHTML = `<div class="tiroir-pied-actions">${actions.join('')}</div><div class="tiroir-pied-fin">${fin.join('')}</div>`;
  $r('tiroir-candidature-pied').classList.toggle('cache', !actions.length && !fin.length);
}
function ouvrirTiroir(id) {
  CANDIDATURE_OUVERTE = id;
  OUVREUR_TIROIR = document.activeElement;
  dessinerTiroir();
  $r('tiroir-candidature').classList.remove('cache');
  $r('tiroir-candidature-corps').scrollTop = 0;
  $r('fermer-tiroir-candidature').focus();
}
function fermerTiroir() {
  CANDIDATURE_OUVERTE = null;
  $r('tiroir-candidature').classList.add('cache');
  if (OUVREUR_TIROIR?.isConnected) OUVREUR_TIROIR.focus();
}
$r('fermer-tiroir-candidature').addEventListener('click', fermerTiroir);
$r('tiroir-candidature').addEventListener('click', async e => {
  if (e.target.id === 'tiroir-candidature') { fermerTiroir(); return; }
  const c = candidatureOuverte();
  if (!c) return;
  const vers = e.target.closest('[data-vers]')?.dataset.vers;
  if (vers === 'entretien') { ouvrirModaleEntretien(); return; }
  if (vers === 'acceptee') { await accepter(c); await chargerCandidatures(); return; }
  if (vers === 'refusee') { await refuser(c); await chargerCandidatures(); return; }
  if (e.target.closest('[data-enregistrer]')) { await agir(() => socle.api(`/api/candidatures/${c.id}`, { method: 'PATCH', body: { notes: $r('candidature-notes').value, salonDiscordId: $r('candidature-salon').value.trim() || null } }), 'Candidature enregistrée ✓'); return; }
  if (e.target.closest('[data-creer-salon]')) { await agir(() => socle.api(`/api/candidatures/${c.id}/salon`, { method: 'POST', body: {} }), 'Salon créé ✓'); return; }
  if (e.target.closest('[data-supprimer]')) { await supprimer(c); return; }
  const piece = e.target.closest('[data-agrandir-piece]');
  if (piece) ouvrirImage(piece.dataset.agrandirPiece, `Pièce d’identité de ${c.prenom} ${c.nom}`);
});
$r('tiroir-candidature').addEventListener('change', async e => {
  const radio = e.target.closest('[name="vote-candidature"]');
  const c = candidatureOuverte();
  if (!radio || !c) return;
  await agir(() => socle.api(`/api/candidatures/${c.id}/vote`, { method: 'PUT', body: { valeur: radio.value } }), 'Vote enregistré ✓');
});
async function agir(requete, succes) {
  try { await requete(); if (succes) gestion.notifier(succes); }
  catch (e) { gestion.message('zone-message-candidatures', e.message); }
  await chargerCandidatures();   // aussi après un refus du serveur : la fiche montre l'état réel
}

async function accepter(c) {
  if (!await gestion.confirmer(`${c.prenom} ${c.nom} rejoint l’effectif : une fiche est créée dans Employés (avec sa pièce d’identité) et un message lui est envoyé dans son salon.`, `Accepter la candidature de ${c.prenom} ${c.nom} ?`, 'Accepter la candidature', { danger: false })) return;
  try { await socle.api(`/api/candidatures/${c.id}/accepter`, { method: 'POST', body: {} }); gestion.notifier('Candidature acceptée, fiche créée ✓'); }
  catch (e) { gestion.message('zone-message-candidatures', e.message); }
}
async function refuser(c) {
  if (!await gestion.confirmer('Un message est envoyé au candidat dans son salon. La candidature reste visible dans « Refusées » et peut être rouverte.', `Refuser la candidature de ${c.prenom} ${c.nom} ?`, 'Refuser la candidature', { danger: true })) return;
  try { await socle.api(`/api/candidatures/${c.id}/refuser`, { method: 'POST', body: {} }); gestion.notifier('Candidature refusée ✓'); }
  catch (e) { gestion.message('zone-message-candidatures', e.message); }
}
async function supprimer(c) {
  if (!await gestion.confirmer('La candidature et sa pièce d’identité disparaissent définitivement. Le salon Discord n’est pas touché.', `Supprimer la candidature de ${c.prenom} ${c.nom} ?`, 'Supprimer la candidature', { danger: true })) return;
  try { await socle.api(`/api/candidatures/${c.id}`, { method: 'DELETE' }); fermerTiroir(); gestion.notifier('Candidature supprimée ✓'); }
  catch (e) { gestion.message('zone-message-candidatures', e.message); }
  await chargerCandidatures();
}

// ---- pièce d'identité en grand : jamais dans un nouvel onglet ----
let OUVREUR_IMAGE = null;
function ouvrirImage(url, titre) {
  $r('modale-image-candidature-img').src = url;
  $r('modale-image-candidature-img').alt = titre;
  $r('modale-image-candidature-titre').textContent = titre;
  OUVREUR_IMAGE = document.activeElement;
  $r('modale-image-candidature').classList.remove('cache');
  $r('fermer-modale-image-candidature').focus();
}
const fermerImage = () => { $r('modale-image-candidature').classList.add('cache'); $r('modale-image-candidature-img').src = ''; if (OUVREUR_IMAGE?.isConnected) OUVREUR_IMAGE.focus(); };
$r('fermer-modale-image-candidature').addEventListener('click', fermerImage);
$r('modale-image-candidature').addEventListener('click', e => { if (e.target.id === 'modale-image-candidature') fermerImage(); });

// ---- convoquer à l'entretien ----
champDateFr($r('entretien-jour'));
champHeureFr($r('entretien-heure'));
let OUVREUR_ENTRETIEN = null;
function ouvrirModaleEntretien() {
  gestion.message('zone-message-modale-entretien', '');
  $r('entretien-jour').value = '';
  $r('entretien-heure').value = '';
  OUVREUR_ENTRETIEN = document.activeElement;
  $r('modale-entretien').classList.remove('cache');
  $r('entretien-jour').focus();
}
const fermerModaleEntretien = () => { $r('modale-entretien').classList.add('cache'); if (OUVREUR_ENTRETIEN?.isConnected) OUVREUR_ENTRETIEN.focus(); };
$r('fermer-modale-entretien').addEventListener('click', fermerModaleEntretien);
$r('annuler-modale-entretien').addEventListener('click', fermerModaleEntretien);
$r('modale-entretien').addEventListener('click', e => { if (e.target.id === 'modale-entretien') fermerModaleEntretien(); });
$r('formulaire-entretien').addEventListener('submit', async e => {
  e.preventDefault();
  const c = candidatureOuverte();
  if (!c) return;
  const jour = $r('entretien-jour').value, heure = $r('entretien-heure').value;
  if (!jour) { gestion.message('zone-message-modale-entretien', 'Indiquez le jour (jj/mm/aaaa).'); $r('entretien-jour').focus(); return; }
  if (!heure) { gestion.message('zone-message-modale-entretien', 'Indiquez l’heure (hh:mm).'); $r('entretien-heure').focus(); return; }
  try {
    await socle.api(`/api/candidatures/${c.id}/entretien`, { method: 'POST', body: { jour, heure } });
    fermerModaleEntretien();
    gestion.notifier('Entretien programmé ✓');
    await chargerCandidatures();
  } catch (err) { gestion.message('zone-message-modale-entretien', err.message); }
});

// l'un après l'autre : le glisser-déposer lit les droits du compte (MOI), qui doivent être connus au premier affichage
gestion.coque('recrutement').then(async m => { MOI = m; await chargerCandidatures(); });
