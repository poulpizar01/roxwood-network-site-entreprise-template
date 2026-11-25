/* GESTION — modération des avis publics (lot 9) : colonnes par statut (attente/publié/refusé), actions directement
   sur la fiche (pas de tiroir : tout l'avis tient déjà sur la carte). Droits revérifiés par le serveur
   (entreprise/routes/avis.ts). */
const $a = id => document.getElementById(id);
let CACHE_AVIS = [];
let PEUT_GERER = false;   // décider (publier, refuser, épingler, supprimer) : permission « avis », à part de la lecture « avis-voir » qui ouvre la page

const COLONNES = [['attente', 'En attente'], ['publie', 'Publiés'], ['refuse', 'Refusés']];
const ETOILE = '<path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L12 17.3 6.4 20.2l1.4-6.2L3 9.6l6.2-.9z"/>';
const dateFr = iso => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric' });

function etoiles(note) {
  return `<div class="avis-fiche-etoiles" aria-label="${note} sur 5" role="img">${[1, 2, 3, 4, 5].map(n =>
    `<svg viewBox="0 0 24 24" class="${n <= note ? 'pleine' : 'vide'}" aria-hidden="true">${ETOILE}</svg>`).join('')}</div>`;
}

async function chargerAvis() {
  gestion.message('zone-message-avis', '');
  try {
    CACHE_AVIS = (await socle.api('/api/avis/gestion')).avis || [];
    afficherColonnes();
  } catch (e) { gestion.message('zone-message-avis', `Impossible de charger les avis : ${e.message}. Rechargez la page ; si le problème continue, prévenez la personne qui s’occupe du site.`); }
}

function ficheAvis(a) {
  const actions = [];
  // changer de statut : des boutons (le glisser-déposer est aléatoire dans le navigateur du jeu, guide FBFA B7) en plus du glissé
  const vers = (statut, libelle, classe = 'btn-fantome') => `<button type="button" class="btn ${classe} btn-petit" data-vers="${statut}">${libelle}</button>`;
  if (!PEUT_GERER) { /* lecture seule : pas de bouton, pas de glissé (installerGlisserAvis) */ }
  else if (a.statut === 'attente') {
    actions.push(vers('publie', 'Publier', 'btn-or'), vers('refuse', 'Refuser'));
  } else if (a.statut === 'publie') {
    actions.push(a.epingle
      ? '<button type="button" class="btn btn-fantome btn-petit" data-desepingler-avis>Désépingler</button>'
      : '<button type="button" class="btn btn-fantome btn-petit" data-epingler-avis>Épingler</button>',
    vers('refuse', 'Refuser'), vers('attente', 'Remettre en attente'));
  } else if (a.statut === 'refuse') {
    actions.push(vers('publie', 'Publier', 'btn-or'), vers('attente', 'Remettre en attente'),
      '<button type="button" class="btn btn-danger btn-petit" data-supprimer-avis>Supprimer</button>');
  }
  return `<article class="carte-statut avis-fiche${a.epingle ? ' avis-fiche--epingle' : ''}" data-id="${a.id}">
    ${etoiles(a.note)}
    <p class="avis-fiche-texte">« ${echapper(a.texte)} »</p>
    <p class="avis-fiche-auteur">${echapper(a.nom)}<span>${a.entreprise ? `${echapper(a.entreprise)} · ` : ''}${dateFr(a.creeLe)}</span><span>Discord : ${echapper(a.pseudoDiscord)}</span></p>
    ${actions.length ? `<div class="avis-fiche-actions">${actions.join('')}</div>` : ''}
  </article>`;
}

function afficherColonnes() {
  $a('avis-colonnes').innerHTML = COLONNES.map(([statut, libelle]) => {
    const liste = CACHE_AVIS.filter(a => a.statut === statut);
    return `<div class="colonne-statut">
      <div class="colonne-statut-titre">${echapper(libelle)}<span class="compte-colonne">${liste.length}</span></div>
      <div class="colonne-statut-cartes" data-statut="${statut}">${liste.length ? liste.map(ficheAvis).join('') : '<p class="colonne-statut-vide">Aucun.</p>'}</div>
    </div>`;
  }).join('');
  installerGlisserAvis();
}

// changer de colonne : par les boutons de la carte, ou en glissant-déposant la carte vers une autre colonne (composant commun
// glisserColonnes(), gestion.js, partagé avec les candidatures RH). Les boutons de la carte ne lancent pas de glissé (filtreDepart).
const TRANSITIONS_GLISSER_AVIS = { attente: ['publie', 'refuse'], publie: ['attente', 'refuse'], refuse: ['attente', 'publie'] };
const DEPOTS_AVIS = { attente: ['/attente', 'Avis remis en attente ✓'], publie: ['/publier', 'Avis publié ✓'], refuse: ['/refuser', 'Avis refusé ✓'] };
function installerGlisserAvis() {
  glisserColonnes('#avis-colonnes', {
    carte: '.avis-fiche', filtreDepart: '.avis-fiche-actions button', transitions: PEUT_GERER ? TRANSITIONS_GLISSER_AVIS : {},
    surDepot: (item, _de, vers) => action(Number(item.dataset.id), ...DEPOTS_AVIS[vers]),
  });
}

async function action(id, chemin, succes, { methode = 'POST' } = {}) {
  try {
    await socle.api(`/api/avis/${id}${chemin}`, { method: methode });
    gestion.notifier(succes);
    await chargerAvis();
  } catch (e) {
    await chargerAvis();   // une carte déposée puis refusée par le serveur revient à sa vraie colonne
    gestion.message('zone-message-avis', e.message);
  }
}

$a('avis-colonnes').addEventListener('click', async e => {
  const fiche = e.target.closest('[data-id]');
  if (!fiche) return;
  const id = Number(fiche.dataset.id);
  const vers = e.target.closest('[data-vers]');
  if (vers) await action(id, ...DEPOTS_AVIS[vers.dataset.vers]);
  else if (e.target.closest('[data-epingler-avis]')) await action(id, '/epingler', 'Avis épinglé ✓');
  else if (e.target.closest('[data-desepingler-avis]')) await action(id, '/desepingler', 'Avis désépinglé ✓');
  else if (e.target.closest('[data-supprimer-avis]')) {
    if (!await gestion.confirmer('L’avis disparaît définitivement.', 'Supprimer cet avis ?', 'Supprimer')) return;
    await action(id, '', 'Avis supprimé ✓', { methode: 'DELETE' });
  }
});

gestion.coque('avis').then(moi => { PEUT_GERER = socle.peut(moi, 'avis'); return chargerAvis(); });
