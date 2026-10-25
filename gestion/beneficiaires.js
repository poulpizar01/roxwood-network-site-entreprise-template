/* GESTION — bénéficiaires des contrats clients en cours (lecture seule) : un champ pour vérifier une personne (nom,
   prénom ou ID unique, sans tenir compte des accents ni des majuscules), puis une carte par entreprise cliente. Le
   serveur ne renvoie que ce qu'il faut pour vérifier (entreprise/contrats.ts, beneficiairesEnCours). */

const $b = id => document.getElementById(id);
let CONTRATS_BENEF = [];
// même comparaison que le serveur (contrats-beneficiaires.ts, cleNom) : « élodie-martin » trouve « Élodie Martin »
const cle = v => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-\s]+/g, ' ');
const jourMaj = d => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' });
const pastille = t => (t ? `<span class="sanction-type" style="--vis:${echapper(t.couleur)}">${echapper(t.nom)}</span>` : '');
// une personne correspond si son ID est celui cherché, ou si tous les mots cherchés sont dans son nom
function correspond(b, terme) {
  if (/^\d+$/.test(terme)) return b.idUnique === terme;
  const nom = cle(b.nom);
  return terme.split(' ').every(m => nom.includes(m));
}

function carteContrat(c, terme) {
  const personnes = c.beneficiaires.map(b => {
    const ok = terme && correspond(b, terme);
    return `<li${ok ? ' class="beneficiaire-trouve"' : ''}><span>${echapper(b.nom)}</span>${b.idUnique ? `<small>ID ${echapper(b.idUnique)}</small>` : ''}</li>`;
  }).join('');
  return `<article class="beneficiaires-carte">
    <header class="beneficiaires-carte-entete">
      <span class="admin-avatar" aria-hidden="true">${echapper(initiales(c.partenaire))}</span>
      <div class="beneficiaires-carte-titre">
        <h2>${echapper(c.partenaire)}</h2>
        <p>${pastille(c.type)}<span>${c.beneficiaires.length} ${c.beneficiaires.length > 1 ? 'personnes' : 'personne'}</span>${c.majLe ? `<span>Mise à jour le ${jourMaj(c.majLe)}</span>` : ''}</p>
      </div>
    </header>
    ${c.beneficiaires.length ? `<ul class="contrat-personnes">${personnes}</ul>` : '<p class="champ-aide">Le client n’a pas encore rempli sa liste.</p>'}
  </article>`;
}

function afficher() {
  const brut = $b('verif-recherche').value.trim(), terme = cle(brut);
  const grille = $b('beneficiaires-grille'), resultat = $b('verif-resultat');
  if (!CONTRATS_BENEF.length) {
    resultat.innerHTML = '';
    grille.innerHTML = '<p class="comptes-vide">Aucun contrat client en cours. Les listes apparaîtront ici dès qu’un client aura rempli la sienne.</p>';
    return;
  }
  // moins de 2 caractères (hors ID) : pas de vérification, toutes les cartes
  if (!terme || (terme.length < 2 && !/^\d+$/.test(terme))) {
    resultat.innerHTML = '';
    grille.innerHTML = CONTRATS_BENEF.map(c => carteContrat(c, '')).join('');
    return;
  }
  const trouves = [];
  for (const c of CONTRATS_BENEF) for (const b of c.beneficiaires) if (correspond(b, terme)) trouves.push({ b, c });
  resultat.innerHTML = trouves.length
    ? `<div class="verif-oui"><svg class="ico" aria-hidden="true"><use href="#ico-carte"></use></svg><div>
        <p><strong>${trouves.length > 1 ? `${trouves.length} personnes trouvées sous contrat en cours` : 'Sous contrat en cours'}</strong></p>
        <ul>${trouves.slice(0, 8).map(({ b, c }) =>
          `<li>${echapper(b.nom)}${b.idUnique ? ` <small>ID ${echapper(b.idUnique)}</small>` : ''} : contrat avec <strong>${echapper(c.partenaire)}</strong>${c.type ? ` (${echapper(c.type.nom)})` : ''}</li>`).join('')}</ul>
        ${trouves.length > 8 ? `<p>Et ${trouves.length - 8} autres : précisez la recherche.</p>` : ''}</div></div>`
    : `<div class="verif-non"><svg class="ico" aria-hidden="true"><use href="#ico-alerte"></use></svg><p><strong>Aucun contrat en cours ne couvre « ${echapper(brut)} ».</strong> Vérifiez l’orthographe ou l’ID, ou demandez à la personne pour quelle entreprise elle travaille.</p></div>`;
  // seules les entreprises où la personne figure restent affichées, la personne surlignée
  const avec = CONTRATS_BENEF.filter(c => c.beneficiaires.some(b => correspond(b, terme)));
  grille.innerHTML = avec.map(c => carteContrat(c, terme)).join('');
}
$b('verif-recherche').addEventListener('input', afficher);

async function charger() {
  gestion.message('zone-message-beneficiaires', '');
  try {
    CONTRATS_BENEF = (await socle.api('/api/beneficiaires')).contrats;
    afficher();
  } catch (e) {
    $b('beneficiaires-grille').innerHTML = '';
    gestion.message('zone-message-beneficiaires', `Impossible de charger les bénéficiaires : ${e.message}. Rechargez la page ; si le problème continue, prévenez la personne qui s’occupe du site.`);
  }
}

gestion.coque('beneficiaires').then(() => { charger(); $b('verif-recherche').focus(); });
