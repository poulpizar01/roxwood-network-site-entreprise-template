/* GESTION (personnalisable) — coque commune des pages de l'espace de gestion : barre latérale (rubriques selon les
   permissions), compte connecté, déconnexion, fenêtre de confirmation, et les outils partagés par les pages (menus
   déroulants habillés, dates et heures à la française, notifications, fenêtres). Chaque page appelle
   gestion.coque('<rubrique>') après socle.js ; le menu est décrit une seule fois ici.
   permission : la rubrique n'apparaît qu'à qui la détient (le serveur applique la même règle : entreprise/index.ts → pages). */
const GESTION_NAV = [
  // « Mon compte » n'est pas une rubrique : on y va par le compte en bas du menu (ou l'avatar de la barre du haut)
  { cle: 'accueil', href: 'accueil.html', label: 'Accueil', icone: 'home' },
  { cle: 'agenda', href: 'agenda.html', label: 'Agenda', icone: 'calendar' },
  { groupe: 'Équipe' },
  { cle: 'quota', href: 'quota.html', label: 'Quotas', icone: 'chart', permission: 'quota' },
  { cle: 'beneficiaires', href: 'beneficiaires.html', label: 'Clients', icone: 'carte', permission: 'contrats-beneficiaires' },
  { groupe: 'Ressources humaines' },
  { cle: 'rh', href: 'rh.html', label: 'Employés', icone: 'users', permission: 'rh-voir' },
  { cle: 'sanctions', href: 'sanctions.html', label: 'Sanctions', icone: 'alerte', permission: 'rh-sanctions-voir' },
  { cle: 'services', href: 'services.html', label: 'Prises de service', icone: 'clock', permission: 'services' },
  { groupe: 'Comptabilité' },
  { cle: 'facturation', href: 'facturation.html', label: 'Facturation', icone: 'receipt', permission: 'factures-voir' },
  { cle: 'echeanciers', href: 'echeanciers.html', label: 'Échéanciers', icone: 'jalons', permission: 'factures-voir' },
  { cle: 'contrats', href: 'contrats.html', label: 'Contrats', icone: 'archive', permission: 'contrats' },
  { cle: 'paie', href: 'paie.html', label: 'Paie', icone: 'coins', permission: 'paie' },
  { cle: 'dot', href: 'dot.html', label: 'DOT', icone: 'calc', permission: 'compta' },
  // réglages, en dernier : on y vient rarement, ils ne passent pas avant le travail de tous les jours
  { groupe: 'Administration' },
  { cle: 'grades', href: 'grades.html', label: 'Grades', icone: 'grade', permission: 'grades' },
  { cle: 'comptes', href: 'comptes.html', label: 'Comptes', icone: 'lock', permission: 'comptes' },
  { cle: 'parametres', href: 'parametres.html', label: 'Paramètres', icone: 'gear', permission: 'parametres' },
  { groupe: 'Site' },
  // le site public (même onglet)
  { cle: 'site', href: '/', label: 'Voir le site', icone: 'globe' },
];

// icônes au trait fin (sprite injecté une fois par page) : <svg class="ico"><use href="#ico-…"></use></svg>
const GESTION_ICONES = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c2 .7 3 2.5 3 5.2"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h2M16 12v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M2 20h20"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>',
  // avertissement (Sanctions) : triangle sur toute la hauteur de la grille, lisible à 18 px
  alerte: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  // carte de membre (Bénéficiaires) : qui est couvert par un contrat
  carte: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 16.5c.6-1.6 2-2.5 3.5-2.5s2.9.9 3.5 2.5M15 10h3M15 13.5h3"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 9h16M4 15h16M10 9v12"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.3M3 12a9 9 0 0 1 15.5-6.3"/><path d="M18 2v4h-4M6 22v-4h4"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.5 5.2A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.5 9.5 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  pencil: '<path d="M5 19h4L19 9l-4-4L5 15v4z"/><path d="M13 7l4 4"/>',   // tracé de 5 à 19 : centré dans le carré de 24
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  // calendrier à échéances (Échéanciers) : trois dates jalonnées, distinct de l'agenda (grille pleine)
  jalons: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="8" cy="15" r="1.3"/><circle cx="12" cy="15" r="1.3"/><circle cx="16" cy="15" r="1.3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  externe: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  fermer: '<path d="M6 6l12 12M18 6L6 18"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M18 5l2 2"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-6c0-1.7-2.7-3-6-3"/>',
  grade: '<path d="M5 16l7-6 7 6"/><path d="M5 10l7-6 7 6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  points: '<circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>',
};
const ico = nom => `<svg class="ico" aria-hidden="true"><use href="#ico-${nom}"></use></svg>`;

// Une personne en service : même ligne dans le panneau du menu et sur l'Accueil (nom, depuis quand, durée) ;
// la sienne en tête, repérée par « vous » (moi : renvoyé par /api/services/en-cours).
const heureParis = d => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const dureeDepuis = d => { const m = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
const ordreEnService = liste => [...liste.filter(p => p.moi), ...liste.filter(p => !p.moi)];
const ligneEnService = p => `<li${p.moi ? ' class="admin-service-moi"' : ''}>
  <span class="admin-service-nom">${socle.esc(p.nom)}${p.moi ? ' <span class="admin-service-vous">vous</span>' : ''}</span>
  <span class="admin-service-detail">depuis ${socle.esc(heureParis(p.depuis))} · ${dureeDepuis(p.depuis)}</span></li>`;

// Ce que le menu affiche du compte (nom, avatar, grade, permissions), gardé pour l'onglet : la page suivante dessine
// son menu sans attendre le serveur. Affichage seulement ; effacé à la déconnexion, et dès que le serveur ne
// reconnaît plus la session.
const memoCoque = {
  cle: 'gestion.coque',
  // mémo d'une autre forme (laissé par une version précédente de la coque) : ignoré, sinon le menu plantait avant d'être posé
  lire() { try { const m = JSON.parse(sessionStorage.getItem(this.cle)); return m?.moi ? m : null; } catch { return null; } },
  ecrire(moi) {
    const m = { moi: { nom: moi.nom, pseudo: moi.pseudo, avatar: moi.avatar, proprietaire: moi.proprietaire, grade: moi.grade ? { libelle: moi.grade.libelle } : null, permissions: moi.permissions } };
    try { sessionStorage.setItem(this.cle, JSON.stringify(m)); } catch { /* stockage refusé : menu dessiné à la réponse */ }
    return m;
  },
  effacer() {
    // tout ce que l'onglet garde du compte, conversations de la messagerie comprises : sur un ordinateur partagé, le
    // compte suivant ne doit rien en revoir
    try { sessionStorage.removeItem(this.cle); sessionStorage.removeItem('gestion.service'); } catch { /* rien à effacer */ }
  },
};

// « En service » : un indicateur (bas du menu sur écran large, barre du haut sur téléphone) qui ouvre la liste dans un
// panneau. Pas dans le menu lui-même : une liste qui bouge seule n'a rien à faire dans la navigation (et l'Accueil a
// la sienne). Relu chaque minute, seulement dans un onglet visible ; une erreur passagère garde le dernier affichage.
// Sans lecture automatique (aria-live) : elle reviendrait sur toutes les pages, à chaque relecture.
function enService(barre, haut) {
  const declencheurs = [...barre.querySelectorAll('[data-service-indic]'), ...haut.querySelectorAll('[data-service-indic]')];
  const panneau = document.createElement('div');
  panneau.className = 'admin-service-panneau';
  panneau.id = 'menu-en-service';
  panneau.hidden = true;
  panneau.setAttribute('role', 'dialog');
  panneau.setAttribute('aria-labelledby', 'menu-en-service-titre');
  panneau.innerHTML = `<div class="admin-service-panneau-tete">
      <span class="pastille-service" aria-hidden="true"></span><h2 id="menu-en-service-titre">En service</h2>
      <span class="admin-en-service-nombre" data-service-nombre></span>
      <button type="button" class="admin-icone-bouton" data-service-fermer aria-label="Fermer la liste">${ico('fermer')}</button></div>
    <ul class="admin-service-liste" data-service-liste></ul>`;
  document.body.append(panneau);
  let personnes = [], origine = null;

  const dessiner = () => {
    const n = personnes.length, libelle = `${n} personne${n > 1 ? 's' : ''} en service`;
    for (const d of declencheurs) {
      d.querySelector('[data-service-texte]').textContent = d.dataset.serviceIndic === 'court' ? String(n) : `${n} en service`;
      d.setAttribute('aria-label', `${libelle} : afficher la liste`);
    }
    panneau.querySelector('[data-service-nombre]').textContent = n;
    panneau.querySelector('[data-service-liste]').innerHTML = n
      ? ordreEnService(personnes).map(ligneEnService).join('')
      : '<li class="admin-service-vide">Personne n’est en service pour le moment.</li>';
  };
  // écran large : à droite du menu, aligné sur le bas de l'indicateur ; téléphone : sous la barre du haut
  const placer = () => {
    if (!origine) return;
    const r = origine.getBoundingClientRect();
    Object.assign(panneau.style, matchMedia('(max-width: 900px)').matches
      ? { top: `${r.bottom + 8}px`, right: '16px', left: 'auto', bottom: 'auto' }
      : { left: `${barre.getBoundingClientRect().right + 8}px`, bottom: `${Math.max(16, innerHeight - r.bottom)}px`, top: 'auto', right: 'auto' });
  };
  const ouvrir = d => {
    origine = d;
    dessiner();
    panneau.hidden = false;
    placer();
    declencheurs.forEach(x => x.setAttribute('aria-expanded', String(x === d)));
    panneau.querySelector('[data-service-fermer]').focus();
  };
  const fermer = (rendreFocus = true) => {
    if (panneau.hidden) return;
    panneau.hidden = true;
    declencheurs.forEach(x => x.setAttribute('aria-expanded', 'false'));
    if (rendreFocus) origine?.focus();
    origine = null;
  };
  for (const d of declencheurs) d.addEventListener('click', () => (origine === d ? fermer() : ouvrir(d)));
  panneau.querySelector('[data-service-fermer]').addEventListener('click', () => fermer());
  panneau.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); fermer(); }
    else if (e.key === 'Tab') {   // le focus reste dans le panneau tant qu'il est ouvert
      const f = [...panneau.querySelectorAll('button, a[href]')];
      if (e.shiftKey ? document.activeElement === f[0] : document.activeElement === f.at(-1)) { e.preventDefault(); (e.shiftKey ? f.at(-1) : f[0]).focus(); }
    }
  });
  document.addEventListener('pointerdown', e => { if (!panneau.hidden && !panneau.contains(e.target) && !declencheurs.some(d => d.contains(e.target))) fermer(false); });
  addEventListener('resize', placer);

  // dernier état connu, gardé pour l'onglet : l'indicateur s'affiche dès l'arrivée sur une page, puis se met à jour
  // (il apparaissait à chaque page après la réponse du serveur)
  const appliquer = r => {
    declencheurs.forEach(d => d.classList.toggle('cache', !r.regle));
    if (!r.regle) { fermer(false); return; }
    personnes = r.enService;
    dessiner();
  };
  try { const memo = JSON.parse(sessionStorage.getItem('gestion.service')); if (memo) appliquer(memo); } catch { /* pas de mémo */ }
  const charger = async () => {
    if (document.hidden) return;
    try {
      const r = await socle.api('/api/services/en-cours');
      appliquer(r);
      try { sessionStorage.setItem('gestion.service', JSON.stringify(r)); } catch { /* stockage refusé */ }
    } catch { /* erreur passagère : dernier affichage gardé */ }
  };
  charger();
  setInterval(charger, 60_000);
  document.addEventListener('visibilitychange', charger);
}

// Menu : une seule zone qui défile (la navigation), et seulement quand l'écran est trop bas. Un fondu en haut ou en bas
// signale ce qui est caché (la barre de défilement n'apparaît qu'au survol) ; la rubrique en cours est amenée en vue.
function indiceDefilement(nav) {
  const maj = () => {
    nav.classList.toggle('suite-haut', nav.scrollTop > 2);
    nav.classList.toggle('suite-bas', nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2);
  };
  const actif = nav.querySelector('.actif');
  if (actif && actif.offsetTop + actif.offsetHeight > nav.clientHeight) nav.scrollTop = actif.offsetTop - nav.clientHeight / 2;
  maj();
  nav.addEventListener('scroll', maj, { passive: true });
  addEventListener('resize', maj);
  new MutationObserver(maj).observe(nav, { childList: true });
}

window.gestion = {
  ico,
  ligneEnService,
  ordreEnService,

  // rubriques visibles du menu pour un filtre de permission donné (coque, et l'aperçu d'un grade dans grades.html) :
  // regroupées sous leur titre, un groupe sans aucune rubrique visible n'apparaît pas.
  rubriques(peutFn) {
    const visibles = GESTION_NAV.filter(l => l.groupe || !l.permission || peutFn(l.permission));
    return visibles.filter((l, i) => !l.groupe || (visibles[i + 1] && !visibles[i + 1].groupe));
  },

  // Tri de colonne pour un tableau ou une liste en grille, réinitialisable sans recharger la page : un premier clic
  // sur une colonne trie en croissant, un second en décroissant, un troisième revient à l'ordre d'origine (aucun
  // tri). defaut (facultatif) ne sert qu'au premier affichage, avant tout clic ; il n'intervient plus ensuite — y
  // revenir au 3e clic semblait pratique, mais bloquait le cycle en boucle sur sa propre colonne quand defaut
  // trie en décroissant (l'état « déjà au point de départ » se confondait avec l'état « à réinitialiser »).
  // comparateurs : { cle: (a, b) => nombre }.
  creerTri(comparateurs, defaut = null) {
    let etat = defaut ? { ...defaut } : null;
    return {
      get etat() { return etat; },
      cycler(cle) {
        etat = !etat || etat.cle !== cle ? { cle, sens: 1 } : etat.sens > 0 ? { cle, sens: -1 } : null;
      },
      appliquer(liste) {
        return etat ? [...liste].sort((a, b) => comparateurs[etat.cle](a, b) * etat.sens) : liste;
      },
      // bouton d'en-tête triable à poser dans un <th> (ou une cellule de grille) ; le clic (data-tri) appelle cycler()
      bouton(cle, libelle) {
        const actif = etat?.cle === cle;
        const sens = actif ? etat.sens : 0;
        return `<button type="button" class="tri-colonne${actif ? ' actif' : ''}" data-tri="${cle}" aria-sort="${actif ? (sens > 0 ? 'ascending' : 'descending') : 'none'}"
          aria-label="Trier par ${libelle.toLowerCase()}${actif ? (sens > 0 ? ', ordre croissant' : ', ordre décroissant') : ''}">${echapper(libelle)}<span class="tri-colonne-fleche">${fleche(actif ? (sens > 0 ? 'haut' : 'bas') : 'hautbas')}</span></button>`;
      },
    };
  },

  // construit la coque autour de <main class="admin-contenu"> et renvoie le compte connecté
  async coque(rubrique) {
    const sprite = document.createElement('div');
    sprite.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${Object.entries(GESTION_ICONES).map(([n, d]) => `<symbol id="ico-${n}" viewBox="0 0 24 24">${d}</symbol>`).join('')}</svg>`;
    document.body.prepend(sprite.firstChild);

    // La coque est posée tout de suite, avant toute réponse du serveur : sinon chaque page s'affichait d'abord sans
    // menu, puis tout sautait de la largeur du menu. Le menu est dessiné d'après le compte gardé pour cet onglet
    // (memoCoque : simple affichage, le serveur contrôle chaque page et chaque requête), puis redessiné si la réponse
    // diffère. Sans mémo (premier passage), sa place est réservée, vide.
    const memo = memoCoque.lire();
    const marque = `<img src="/assets/logo.png" alt="" width="32" height="32"><span>${socle.esc(socle.nomSite)}</span>`;
    const barre = document.createElement('aside');
    barre.className = 'admin-barre-laterale';
    barre.id = 'admin-menu';
    barre.innerHTML = `
      <a href="accueil.html" class="logo admin-marque">${marque}</a>
      <nav class="admin-nav" aria-label="Rubriques"></nav>
      <div class="admin-bas">
        <button type="button" class="admin-service-indic cache" data-service-indic aria-haspopup="dialog" aria-expanded="false" aria-controls="menu-en-service">
          <span class="pastille-service" aria-hidden="true"></span><span data-service-texte>En service</span>${ico('chevron')}</button>
        <div class="admin-compte" data-compte></div>
      </div>`;
    // téléphone et tablette : barre du haut, la barre latérale entière s'ouvre en tiroir (compte et déconnexion compris)
    const haut = document.createElement('header');
    haut.className = 'admin-barre-haut';
    haut.innerHTML = `<button type="button" class="admin-burger" aria-controls="admin-menu" aria-expanded="false" aria-label="Ouvrir le menu">
        <svg class="ico" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
      <a href="accueil.html" class="admin-barre-haut-logo admin-marque">${marque}</a>
      <button type="button" class="admin-service-indic admin-service-indic--haut cache" data-service-indic="court" aria-haspopup="dialog" aria-expanded="false" aria-controls="menu-en-service">
        <span class="pastille-service" aria-hidden="true"></span><span data-service-texte></span></button>
      <a href="compte.html" class="admin-barre-haut-compte" data-avatar aria-label="Mon compte"></a>`;
    const dessiner = (moi) => {
      barre.querySelector('.admin-nav').innerHTML = gestion.rubriques(cle => socle.peut(moi, cle)).map(l => l.groupe
        ? `<p class="admin-nav-groupe">${socle.esc(l.groupe)}</p>`
        : `<a class="lien-onglet${l.cle === rubrique ? ' actif' : ''}" href="${socle.esc(l.href)}"${l.cle === rubrique ? ' aria-current="page"' : ''}${l.externe ? ' target="_blank" rel="noopener"' : ''}>${ico(l.icone)}<span>${socle.esc(l.label)}</span></a>`).join('');
      const nom = moi.nom || moi.pseudo;
      const grade = moi.grade?.libelle || (moi.proprietaire ? 'Propriétaire' : 'Sans grade');
      const avatar = moi.avatar ? `<img class="admin-avatar" src="${socle.esc(moi.avatar)}" alt="">` : `<span class="admin-avatar" aria-hidden="true">${socle.esc(initiales(nom))}</span>`;
      const ici = rubrique === 'compte';
      barre.querySelector('[data-compte]').innerHTML = `<a class="admin-compte-lien${ici ? ' actif' : ''}" href="compte.html"${ici ? ' aria-current="page"' : ''} aria-label="Mon compte : ${socle.esc(nom)}">${avatar}
        <div class="admin-compte-texte"><strong>${socle.esc(nom)}</strong><span class="admin-compte-grade">${socle.esc(grade)}</span></div></a>
        <button type="button" class="admin-icone-bouton" data-deconnexion title="Se déconnecter" aria-label="Se déconnecter">${ico('logout')}</button>`;
      haut.querySelector('[data-avatar]').innerHTML = avatar;
    };
    if (memo) dessiner(memo.moi);
    barre.addEventListener('click', e => {
      if (!e.target.closest('[data-deconnexion]')) return;
      memoCoque.effacer();
      socle.deconnexion();
    });

    const voile = document.createElement('div');
    voile.className = 'admin-voile';
    const burger = haut.querySelector('.admin-burger');
    const ouvrir = ouvert => {
      document.body.classList.toggle('admin-menu-ouvert', ouvert);
      burger.setAttribute('aria-expanded', String(ouvert));
      burger.setAttribute('aria-label', ouvert ? 'Fermer le menu' : 'Ouvrir le menu');
      if (ouvert) (barre.querySelector('a.lien-onglet.actif') || barre.querySelector('a.lien-onglet'))?.focus();
    };
    burger.addEventListener('click', () => ouvrir(!document.body.classList.contains('admin-menu-ouvert')));
    voile.addEventListener('click', () => ouvrir(false));
    document.addEventListener('keydown', e => {
      if (!document.body.classList.contains('admin-menu-ouvert')) return;
      if (e.key === 'Escape') { ouvrir(false); burger.focus(); return; }
      // tiroir ouvert (téléphone) : Tab boucle entre le bouton du menu et les liens, jamais sur la page sous le voile
      if (e.key !== 'Tab') return;
      const liste = [burger, ...[...barre.querySelectorAll('a[href], button')].filter(el => !el.disabled && (el.offsetWidth || el.offsetHeight))];
      // le bouton du menu et les liens ne se suivent pas dans la page : on avance soi-même dans cette liste
      e.preventDefault();
      const i = liste.indexOf(document.activeElement);
      liste[i === -1 ? 0 : (i + (e.shiftKey ? -1 : 1) + liste.length) % liste.length].focus();
    });
    const main = document.querySelector('main.admin-contenu');
    const coque = document.createElement('div');
    coque.className = 'admin-shell';
    main.id ||= 'contenu';
    main.tabIndex = -1;
    main.replaceWith(coque);
    coque.append(haut, voile, barre, main);
    // lien d'évitement : au clavier, le premier Tab propose de sauter le menu
    const evitement = document.createElement('a');
    evitement.className = 'evitement';
    evitement.href = `#${main.id}`;
    evitement.textContent = 'Aller au contenu';
    document.body.prepend(evitement);
    document.body.classList.add('page-agents', 'admin-connecte');

    let moi;
    try { moi = await socle.moi(); }
    catch (e) { memoCoque.effacer(); erreurDeChargement(main, e); throw e; }
    if (JSON.stringify(memoCoque.ecrire(moi)) !== JSON.stringify(memo)) dessiner(moi);
    enService(barre, haut);
    indiceDefilement(barre.querySelector('.admin-nav'));
    tablesAdaptatives(main);
    return moi;
  },

  // Notification en bas de l'écran, visible quel que soit le défilement (une confirmation affichée en haut de page
  // passait inaperçue quand on avait cliqué en bas) ; lue par les lecteurs d'écran ; s'efface après quelques secondes.
  notifier(texte, type = 'succes') { notifier(texte, type); },

  // message dans une zone de la page (texte seulement, jamais de HTML) ; type : 'succes' ou 'erreur'
  message(zone, texte, type = 'erreur') {
    const el = typeof zone === 'string' ? document.getElementById(zone) : zone;
    if (!el) return;
    el.textContent = '';
    if (!texte) return;
    const div = document.createElement('div');
    div.className = `message message-${type === 'succes' ? 'succes' : 'erreur'}`;
    div.textContent = texte;
    el.append(div);
  },

  // Confirmation dans la page (aucune boîte de dialogue du navigateur : l'ordinateur en jeu ne les affiche pas).
  // libelle : le bouton dit l'action (« Supprimer le grade »), jamais « Confirmer » ; danger = false pour une action
  // qui ne détruit rien (bouton plein). Le focus reste dans la fenêtre, Échap annule, puis le focus revient où il était.
  confirmer(texte, titre = 'Confirmer', libelle = 'Confirmer', { danger = true } = {}) {
    return new Promise(resolve => {
      const avant = document.activeElement;
      const fond = document.createElement('div');
      fond.className = 'modale-fond modale-compacte';
      fond.innerHTML = `<div class="modale modale-compacte" style="max-width:420px;" role="alertdialog" aria-modal="true" aria-labelledby="confirmer-titre" aria-describedby="confirmer-texte">
        <div class="modale-entete"><h2 class="modale-titre" id="confirmer-titre"></h2></div>
        <p style="margin-bottom:26px;" id="confirmer-texte"></p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <button type="button" class="btn btn-fantome" style="flex:1;" data-non>Annuler</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-or'}" style="flex:1;" data-oui></button>
        </div></div>`;
      fond.querySelector('h2').textContent = titre;
      fond.querySelector('p').textContent = texte;
      fond.querySelector('[data-oui]').textContent = libelle;
      const boutons = [...fond.querySelectorAll('button')];
      const fin = ok => { document.removeEventListener('keydown', clavier, true); fond.remove(); avant?.focus?.(); resolve(ok); };
      const clavier = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fin(false); }
        else if (e.key === 'Tab') {   // le focus boucle entre les deux boutons : la page derrière reste hors d'atteinte
          e.preventDefault();
          const i = boutons.indexOf(document.activeElement);
          boutons[(i + (e.shiftKey ? -1 : 1) + boutons.length) % boutons.length].focus();
        }
      };
      fond.querySelector('[data-oui]').addEventListener('click', () => fin(true));
      fond.querySelector('[data-non]').addEventListener('click', () => fin(false));
      fond.addEventListener('click', e => { if (e.target === fond) fin(false); });
      document.addEventListener('keydown', clavier, true);
      document.body.append(fond);
      verrouillerDefilement(true);
      boutons[0].focus();
    }).finally(() => verrouillerDefilement(false));
  },
};

// Défilement de la page bloqué tant qu'une fenêtre reste ouverte (confirmation comprise) : sans ça, la page derrière
// une fenêtre position:fixed continue de défiler sous le doigt sur mobile — l'overlay ne suffit pas à l'empêcher.
// Compteur : plusieurs fenêtres peuvent s'empiler (une confirmation par-dessus un formulaire).
let FENETRES_OUVERTES = 0;
function verrouillerDefilement(ouvre) {
  FENETRES_OUVERTES = Math.max(0, FENETRES_OUVERTES + (ouvre ? 1 : -1));
  document.documentElement.classList.toggle('defilement-bloque', FENETRES_OUVERTES > 0);
}

// Tableaux adaptatifs : un tableau (.table-admin) qui ne tient plus dans sa largeur devient une grille de cartes
// (classe en-cartes, styles dans gestion.css) au lieu de défiler de côté. Chaque cellule reçoit l'intitulé de sa
// colonne (data-libelle, tiré de l'en-tête) ; la colonne titre (th[data-titre], sinon la première nommée) ouvre la
// carte, sans intitulé ; une colonne sans nom (actions, vignette) prend toute la largeur. Recalculé quand la largeur
// change ou que le tableau est redessiné. Un tableau sous [data-tableau-fixe] n'est pas touché.
const SANS_LIBELLE = /^(actions?)?$/i;
function tablesAdaptatives(racine) {
  const etiqueter = table => {
    const ths = [...(table.tHead?.rows[0]?.cells || [])];
    const noms = ths.map(th => (SANS_LIBELLE.test(th.textContent.trim()) ? '' : th.textContent.trim()));
    let titre = ths.findIndex(th => th.hasAttribute('data-titre'));
    if (titre < 0) titre = noms.findIndex(Boolean);
    for (const tbody of table.tBodies) for (const tr of tbody.rows) {
      if (tr.cells.length !== ths.length) continue;   // ligne d'état (« Aucun… », colspan) : pleine largeur telle quelle
      [...tr.cells].forEach((td, i) => {
        if (i === titre) td.classList.add('cellule-titre');
        else if (noms[i] && !td.hasAttribute('data-libelle')) td.dataset.libelle = noms[i];
      });
    }
  };
  // mesure en mode tableau (synchrone : rien n'est affiché entre les deux), cartes si la largeur dépasse
  const ajuster = table => {
    if (!table.parentElement || !table.isConnected) return;   // tableau retiré de la page entre-temps (redessiné)
    table.classList.remove('en-cartes');
    table.parentElement.classList.remove('contient-cartes');
    const trop = table.offsetWidth > table.parentElement.clientWidth + 1;
    table.classList.toggle('en-cartes', trop);
    table.parentElement.classList.toggle('contient-cartes', trop);   // la carte qui l'entoure s'efface derrière les cartes
  };
  const suivies = new WeakSet();
  const suivre = table => {
    if (suivies.has(table) || table.closest('[data-tableau-fixe]')) return;
    suivies.add(table);
    etiqueter(table);
    ajuster(table);
    let largeur = table.parentElement.clientWidth;
    new ResizeObserver(() => {
      if (!table.isConnected) return;
      const l = table.parentElement.clientWidth;
      if (l !== largeur) { largeur = l; ajuster(table); }   // la hauteur change avec les cartes : seule la largeur compte
    }).observe(table.parentElement);
    new MutationObserver(() => { etiqueter(table); ajuster(table); }).observe(table, { childList: true, subtree: true });
  };
  racine.querySelectorAll('table.table-admin').forEach(suivre);
  // tableaux ajoutés plus tard par les scripts de la page (onglets, fenêtres)
  new MutationObserver(() => racine.querySelectorAll('table.table-admin').forEach(suivre)).observe(racine, { childList: true, subtree: true });
}

// Compte illisible (serveur arrêté, trop de requêtes, coupure) : la page dit pourquoi et propose de réessayer, au lieu
// de rester vide. Une session expirée est déjà renvoyée vers la connexion par socle.api().
function erreurDeChargement(main, e) {
  if (!main) return;
  const boite = document.createElement('div');
  boite.className = 'etat-vide';
  const texte = document.createElement('p');
  texte.textContent = `La page n’a pas pu se charger : ${e.message}`;
  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'btn btn-or';
  bouton.textContent = 'Réessayer';
  bouton.addEventListener('click', () => location.reload());
  boite.append(texte, bouton);
  main.replaceChildren(boite);
}

function initiales(nom) {
  const mots = String(nom || '').trim().split(/\s+/).filter(Boolean);
  return mots.length ? mots.slice(0, 2).map(m => m[0].toUpperCase()).join('') : '?';
}

// ---------------------------------------------------------------------------------------------------------------------
// Outils partagés par les pages (règles et erreurs déjà commises : docs/design.md)
// ---------------------------------------------------------------------------------------------------------------------

// Échappe aussi les guillemets : le résultat est souvent inséré dans un attribut (value="…"), où un " non échappé
// fermerait l'attribut.
function echapper(texte) {
  return (texte == null ? '' : String(texte))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// copie dans le presse-papiers ; repli pour un navigateur sans accès (ordinateur en jeu, page non sécurisée)
async function copierTexte(texte) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(texte); return true; } catch { /* on tente le repli */ }
  }
  const zone = document.createElement('textarea');
  zone.value = texte;
  zone.setAttribute('readonly', '');
  zone.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(zone);
  zone.focus(); zone.select(); zone.setSelectionRange(0, texte.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(zone);
  return ok;
}

// Flèche dessinée, centrée sur le texte : un caractère (« ← », « › », « ⌄ ») se pose sur la ligne de base et paraît
// trop bas. Dans une page statique, écrire le même SVG.
const FLECHES = {
  gauche: 'M19 12H5M11 6l-6 6 6 6', droite: 'M5 12h14M13 6l6 6-6 6', sortie: 'M7 17L17 7M9 7h8v8',
  precedent: 'M15 6l-6 6 6 6', suivant: 'M9 6l6 6-6 6', haut: 'M12 19V5M6 11l6-6 6 6', bas: 'M12 5v14M6 13l6 6 6-6',
  deplier: 'M6 9l6 6 6-6', hautbas: 'M8 9l4-4 4 4M8 15l4 4 4-4',
};
const fleche = sens => `<svg class="fleche" viewBox="0 0 24 24" aria-hidden="true"><path d="${FLECHES[sens]}"/></svg>`;

// Plein écran d'un contenu intégré (carte, présentation), sur place : le contenu principal ne s'ouvre jamais dans un
// autre onglet. Bouton masqué si le navigateur ne le permet pas (certains navigateurs en jeu).
function pleinEcran(bouton, boite) {
  if (!bouton || !boite || !document.fullscreenEnabled) return;
  bouton.classList.remove('cache');
  bouton.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : boite.requestFullscreen()).catch(() => {}));
  document.addEventListener('fullscreenchange', () => { bouton.textContent = document.fullscreenElement === boite ? 'Quitter le plein écran' : 'Plein écran'; });
}

// Notification d'une action, en bas de l'écran ; une seule à la fois (empilées, elles masquaient la page)
function notifier(texte, type = 'succes') {
  let zone = document.getElementById('notifications');
  if (!zone) {
    zone = document.createElement('div');
    zone.id = 'notifications';
    zone.className = 'notifications';
    zone.setAttribute('role', 'status');
    zone.setAttribute('aria-live', 'polite');
    document.body.append(zone);
  }
  zone.replaceChildren();
  const n = document.createElement('div');
  n.className = `notification notification-${type === 'erreur' ? 'erreur' : 'succes'}`;
  n.textContent = texte;
  zone.append(n);
  setTimeout(() => { n.classList.add('sortie'); setTimeout(() => n.remove(), 300); }, type === 'erreur' ? 6000 : 3200);
}

// ---- menu déroulant habillé ----
// Un <select> natif ne se stylise pas (sa liste reste grise, à la police du système). ameliorerSelect() l'habille : il
// reste dans la page (utilisable au clavier, porteur de la vraie valeur), mais son ouverture affiche une liste flottante
// aux couleurs du site. Un seul menu ouvert à la fois. pastille (facultatif) : couleur d'une puce devant chaque option ;
// portee (facultatif) : marque la liste flottante, pour la retirer quand le <select> est recréé (nettoyerSelectsPortee).
let SELECT_OUVERT = null;   // { select, flottant, enveloppe }
function fermerSelectOuvert() {
  if (SELECT_OUVERT) {
    SELECT_OUVERT.flottant.classList.add('cache');
    SELECT_OUVERT.enveloppe.classList.remove('ouvert');
    SELECT_OUVERT = null;
  }
  // aucune liste flottante ne reste affichée sans être « le menu ouvert » (sinon elle reste plantée dans la page)
  document.querySelectorAll('.d8-select-flottant:not(.cache)').forEach(el => el.classList.add('cache'));
  document.querySelectorAll('.d8-select-enveloppe.ouvert').forEach(el => el.classList.remove('ouvert'));
}
document.addEventListener('mousedown', ev => {
  if (SELECT_OUVERT && !SELECT_OUVERT.flottant.contains(ev.target) && ev.target !== SELECT_OUVERT.select) fermerSelectOuvert();
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && SELECT_OUVERT) { ev.preventDefault(); fermerSelectOuvert(); } });
addEventListener('resize', fermerSelectOuvert);
// en capture pour voir le défilement d'un conteneur ; celui de la liste elle-même ne la ferme pas
addEventListener('scroll', ev => { if (SELECT_OUVERT && SELECT_OUVERT.flottant.contains(ev.target)) return; fermerSelectOuvert(); }, true);

// rechercher (facultatif) : ajoute un champ de recherche en tête de la liste flottante (sélection longue — ex. la
// centaine d'employés d'une grosse entreprise) ; filtre le texte des options, sans toucher au <select> lui-même.
function ameliorerSelect(select, pastille, portee, rechercher) {
  if (!select || select.dataset.ameliore) return;
  select.dataset.ameliore = '1';
  const enveloppe = document.createElement('span');
  enveloppe.className = 'd8-select-enveloppe';
  select.parentNode.insertBefore(enveloppe, select);
  enveloppe.appendChild(select);
  let pastilleCourante = null;
  if (pastille) {
    enveloppe.classList.add('avec-pastille');
    pastilleCourante = document.createElement('span');
    pastilleCourante.className = 'd8-select-pastille-courante';
    pastilleCourante.setAttribute('aria-hidden', 'true');
    enveloppe.appendChild(pastilleCourante);
    const majPastille = () => { pastilleCourante.style.background = pastille(select.value); };
    majPastille();
    select.addEventListener('change', majPastille);
  }
  const flottant = document.createElement('div');
  flottant.className = 'd8-select-flottant cache';
  if (portee) flottant.dataset.portee = portee;
  document.body.appendChild(flottant);

  // zone des options (chemin commun recherche/pas recherche) : seule elle se redessine à la frappe, pour que le champ
  // de recherche garde le focus et le curseur (un flottant.innerHTML entier l'aurait redétruit à chaque lettre)
  const zoneOptions = document.createElement('div');
  zoneOptions.className = 'd8-select-options';
  let champRecherche = null;
  if (rechercher) {
    champRecherche = document.createElement('input');
    champRecherche.type = 'text';
    champRecherche.className = 'd8-select-recherche-champ';
    champRecherche.placeholder = 'Rechercher…';
    champRecherche.setAttribute('aria-label', 'Rechercher dans la liste');
    const enveloppeRecherche = document.createElement('div');
    enveloppeRecherche.className = 'd8-select-recherche';
    enveloppeRecherche.appendChild(champRecherche);
    flottant.append(enveloppeRecherche, zoneOptions);
  } else {
    flottant.appendChild(zoneOptions);
  }

  function rendreOptions(filtre = '') {
    const f = filtre.trim().toLowerCase();
    const options = Array.from(select.options).filter(o => !f || o.textContent.toLowerCase().includes(f));
    zoneOptions.innerHTML = options.length ? options.map(o => `
      <div class="d8-select-option ${o.value === select.value ? 'selectionnee' : ''}${o.disabled ? ' desactivee' : ''}" data-valeur="${echapper(o.value)}"${o.disabled ? ' aria-disabled="true"' : ''}>
        ${pastille ? `<span class="d8-select-pastille" style="background:${pastille(o.value)};"></span>` : ''}
        <span>${echapper(o.textContent)}</span>
      </div>`).join('') : '<p class="d8-select-vide">Aucun résultat.</p>';
    zoneOptions.querySelectorAll('[data-valeur]').forEach(el => {
      el.addEventListener('mousedown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (el.classList.contains('desactivee')) return;   // option désactivée (ex. un grade qu'on ne peut pas donner)
        if (select.value !== el.dataset.valeur) {
          select.value = el.dataset.valeur;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        fermerSelectOuvert();
      });
    });
  }
  if (champRecherche) {
    champRecherche.addEventListener('input', () => rendreOptions(champRecherche.value));
    champRecherche.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      zoneOptions.querySelector('[data-valeur]:not(.desactivee)')?.dispatchEvent(new MouseEvent('mousedown'));
    });
  }
  function positionner() {
    const r = select.getBoundingClientRect();
    const hauteurEstimee = Math.min(select.options.length * 30 + 12 + (rechercher ? 50 : 0), 260);
    // toujours la largeur exacte du champ : jamais plus large (la liste débordait visiblement de son déclencheur
    // sur un select resserré, ex. « Partie » dans une grille à deux colonnes)
    const largeur = Math.round(r.width);
    // jamais de débordement à droite : sinon la liste s'aligne sur le bord droit du champ (largeur sans la barre de
    // défilement : innerWidth la compte, et la liste passait dessous)
    const visible = document.documentElement.clientWidth;
    let gauche = Math.round(r.left);
    if (gauche + largeur > visible - 8) gauche = Math.round(r.right) - largeur;
    flottant.style.left = Math.max(8, Math.min(gauche, visible - largeur - 8)) + 'px';
    flottant.style.width = largeur + 'px';
    // près du bas de la fenêtre, la liste s'ouvre vers le haut
    flottant.style.top = (r.bottom + hauteurEstimee > innerHeight && r.top > hauteurEstimee ? Math.round(r.top - hauteurEstimee - 6) : Math.round(r.bottom + 6)) + 'px';
  }
  function ouvrir() {
    if (select.disabled) return;
    fermerSelectOuvert();
    if (champRecherche) champRecherche.value = '';
    rendreOptions();
    positionner();
    flottant.classList.remove('cache');
    enveloppe.classList.add('ouvert');
    SELECT_OUVERT = { select, flottant, enveloppe };
    if (champRecherche) champRecherche.focus();
  }
  select.addEventListener('mousedown', ev => {
    ev.preventDefault();
    select.focus();
    if (SELECT_OUVERT && SELECT_OUVERT.select === select) fermerSelectOuvert(); else ouvrir();
  });
  select.addEventListener('blur', () => {
    if (!SELECT_OUVERT || SELECT_OUVERT.select !== select) return;
    // le focus peut partir vers le champ de recherche du même menu (flottant) : la liste ne se ferme pas pour ça
    setTimeout(() => { if (SELECT_OUVERT && SELECT_OUVERT.select === select && !flottant.contains(document.activeElement)) fermerSelectOuvert(); }, 120);
  });
  select.addEventListener('keydown', ev => {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(ev.key)) {
      ev.preventDefault();
      if (!(SELECT_OUVERT && SELECT_OUVERT.select === select)) ouvrir();
    }
  });
}
// à appeler avant de recréer des <select> habillés : retire les listes flottantes de l'affichage précédent
function nettoyerSelectsPortee(portee) {
  document.querySelectorAll(`.d8-select-flottant[data-portee="${portee}"]`).forEach(el => el.remove());
}

// ---- dates et heures à la française ----
// Un <input type="date|time"> suit la langue du navigateur (mm/dd/yyyy, « 02:00 PM ») : ces aides en font des champs
// texte jj/mm/aaaa et 24 h, mais .value garde le format des scripts et du serveur (« 2026-10-06 », « 14:30 »). Une saisie
// invalide est signalée et bloque l'envoi du formulaire (sinon la valeur partait vide sans rien dire).
const VALEUR_INPUT = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
function erreurChampFr(input, message) {
  const invalide = () => VALEUR_INPUT.get.call(input).trim() !== '' && input.value === '';
  let p = null;
  const montrer = afficher => {
    if (afficher && !p) {
      p = Object.assign(document.createElement('p'), { className: 'champ-erreur', id: `${input.id || 'champ'}-erreur-format`, textContent: message });
      input.insertAdjacentElement('afterend', p);
      input.setAttribute('aria-describedby', p.id);
    }
    if (p) p.classList.toggle('cache', !afficher);
    input.toggleAttribute('aria-invalid', afficher);
    input.classList.toggle('champ-invalide', afficher);
  };
  // en quittant le champ, seul le contour signale l'erreur : un message ajouté à ce moment pousserait le bouton qu'on est
  // en train de cliquer, et le clic tomberait à côté. Le message vient à l'envoi.
  input.addEventListener('blur', () => { const i = invalide(); input.toggleAttribute('aria-invalid', i); input.classList.toggle('champ-invalide', i); });
  input.addEventListener('input', () => { if (!invalide()) montrer(false); });
  input.form?.addEventListener('submit', ev => {
    if (!invalide()) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    montrer(true);
    input.focus();
  }, true);
  // une valeur remise par le script (ouverture d'une fiche) efface l'erreur précédente
  input.effacerErreurFr = () => montrer(false);
}
function champDateFr(input) {
  if (!input || input.dataset.fr) return;
  input.dataset.fr = '1';
  erreurChampFr(input, 'Date invalide : écrivez-la jj/mm/aaaa, par exemple 06/10/2026.');
  input.type = 'text';
  Object.assign(input, { inputMode: 'numeric', placeholder: 'jj/mm/aaaa', maxLength: 10, autocomplete: 'off' });
  input.pattern = '\\d{2}/\\d{2}/\\d{4}';
  input.title = 'Date au format jj/mm/aaaa';
  const versIso = t => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(t).trim());
    if (!m) return '';
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    return d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[1] ? '' : `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;   // 31/02 refusé
  };
  const versFr = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  Object.defineProperty(input, 'value', { configurable: true, get() { return versIso(VALEUR_INPUT.get.call(this)); }, set(v) { VALEUR_INPUT.set.call(this, versFr(v)); this.effacerErreurFr?.(); } });
  input.addEventListener('input', ev => {   // « 06102026 » devient « 06/10/2026 »
    if (ev.inputType && !ev.inputType.startsWith('insert')) return;
    const c = VALEUR_INPUT.get.call(input).replace(/\D/g, '').slice(0, 8);
    VALEUR_INPUT.set.call(input, [c.slice(0, 2), c.slice(2, 4), c.slice(4)].filter(Boolean).join('/'));
  });
  ajouterSelecteurDate(input);
}

// ---- sélecteur de date (calendrier flottant) : posé sur un champ texte jj/mm/aaaa (opère sur le texte affiché, pas
// sur .value — fonctionne donc aussi bien avec champDateFr, qui réécrit .value en ISO, qu'avec un champ texte brut
// comme ecriture-dot-date). La saisie au clavier reste possible : le calendrier n'est qu'une aide, jamais obligatoire.
// Même discipline qu'une fenêtre (docs/design.md) : focus dedans à l'ouverture, Tab qui y boucle, Échap qui ferme,
// focus rendu au bouton. Position « fixed », comme ameliorerSelect() : un parent avec overflow:hidden (modale) ne
// la tronquerait pas.
const JOURS_COURTS_DATE = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
let DATE_OUVERTE = null;   // { panneau, bouton, dernierFocus, surClavier }
function fermerDateOuverte() {
  if (!DATE_OUVERTE) return;
  const { panneau, bouton, dernierFocus, surClavier } = DATE_OUVERTE;
  panneau.remove();
  bouton.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', surClavier, true);
  DATE_OUVERTE = null;
  (dernierFocus || bouton).focus();
}
document.addEventListener('mousedown', ev => { if (DATE_OUVERTE && !DATE_OUVERTE.panneau.contains(ev.target) && ev.target !== DATE_OUVERTE.bouton) fermerDateOuverte(); });
addEventListener('resize', fermerDateOuverte);
addEventListener('scroll', ev => { if (DATE_OUVERTE && DATE_OUVERTE.panneau.contains(ev.target)) return; fermerDateOuverte(); }, true);

function ajouterSelecteurDate(input) {
  if (!input || input.dataset.selecteurDate) return;
  input.dataset.selecteurDate = '1';
  const enveloppe = document.createElement('span');
  enveloppe.className = 'champ-date-enveloppe';
  input.insertAdjacentElement('beforebegin', enveloppe);
  enveloppe.appendChild(input);
  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'champ-date-bouton';
  bouton.setAttribute('aria-label', 'Ouvrir le calendrier');
  bouton.setAttribute('aria-haspopup', 'dialog');
  bouton.setAttribute('aria-expanded', 'false');
  bouton.innerHTML = ico('calendar');
  enveloppe.appendChild(bouton);

  const lireValeur = () => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(VALEUR_INPUT.get.call(input).trim());
    if (!m) return null;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    return d.getMonth() === +m[2] - 1 && d.getDate() === +m[1] ? d : null;
  };
  const ecrireValeur = d => {
    VALEUR_INPUT.set.call(input, `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.effacerErreurFr?.();
  };

  let panneau = null, moisAffiche = null;

  function construire() {
    const an = moisAffiche.getFullYear(), mois = moisAffiche.getMonth();
    const decalage = (new Date(an, mois, 1).getDay() + 6) % 7;   // lundi en premier
    const nbJours = new Date(an, mois + 1, 0).getDate();
    const selection = lireValeur();
    const aujourdhui = new Date();
    const cases = [];
    for (let i = 0; i < decalage; i++) cases.push('<span class="champ-date-case champ-date-case--vide" aria-hidden="true"></span>');
    for (let j = 1; j <= nbJours; j++) {
      const estSelection = !!selection && selection.getFullYear() === an && selection.getMonth() === mois && selection.getDate() === j;
      const estAujourdhui = aujourdhui.getFullYear() === an && aujourdhui.getMonth() === mois && aujourdhui.getDate() === j;
      cases.push(`<button type="button" class="champ-date-case${estAujourdhui ? ' champ-date-case--aujourdhui' : ''}${estSelection ? ' champ-date-case--active' : ''}" data-jour="${j}" role="gridcell" aria-selected="${estSelection}">${j}</button>`);
    }
    panneau.querySelector('.champ-date-titre').textContent = moisAffiche.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    panneau.querySelector('.champ-date-grille').innerHTML = cases.join('');
    panneau.querySelectorAll('[data-jour]').forEach(b => b.addEventListener('click', () => { ecrireValeur(new Date(an, mois, Number(b.dataset.jour))); fermerDateOuverte(); }));
  }

  // flèches : déplace le focus dans le mois affiché seulement (shortcut : pas de saut de mois sur un bord de grille,
  // peu gênant — Page précédente/suivante restent accessibles à la souris et au Tab)
  function deplacerFocus(decalageJours) {
    const actif = document.activeElement;
    if (!actif || !actif.dataset.jour) return;
    panneau.querySelector(`[data-jour="${Number(actif.dataset.jour) + decalageJours}"]`)?.focus();
  }
  function surClavier(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); fermerDateOuverte(); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); deplacerFocus(1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); deplacerFocus(-1); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); deplacerFocus(7); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); deplacerFocus(-7); }
    else if (ev.key === 'Tab') {
      const items = Array.from(panneau.querySelectorAll('button'));
      const premier = items[0], dernier = items[items.length - 1];
      if (ev.shiftKey && document.activeElement === premier) { ev.preventDefault(); dernier.focus(); }
      else if (!ev.shiftKey && document.activeElement === dernier) { ev.preventDefault(); premier.focus(); }
    }
  }

  function positionner() {
    const r = enveloppe.getBoundingClientRect();
    const largeur = Math.min(272, document.documentElement.clientWidth - 16);
    const visible = document.documentElement.clientWidth;
    let gauche = Math.round(r.left);
    if (gauche + largeur > visible - 8) gauche = Math.round(r.right) - largeur;
    panneau.style.left = Math.max(8, Math.min(gauche, visible - largeur - 8)) + 'px';
    panneau.style.width = largeur + 'px';
    const hauteurEstimee = 320;
    panneau.style.top = (r.bottom + hauteurEstimee > innerHeight && r.top > hauteurEstimee ? Math.round(r.top - hauteurEstimee - 6) : Math.round(r.bottom + 6)) + 'px';
  }

  function ouvrir() {
    fermerDateOuverte();
    fermerSelectOuvert();
    const dernierFocus = document.activeElement;
    input.blur();   // ferme le clavier virtuel sur mobile : il masquerait le calendrier ou se battrait avec lui
    moisAffiche = lireValeur() || new Date();
    moisAffiche = new Date(moisAffiche.getFullYear(), moisAffiche.getMonth(), 1);
    panneau = document.createElement('div');
    panneau.className = 'champ-date-panneau';
    panneau.setAttribute('role', 'dialog');
    panneau.setAttribute('aria-label', 'Choisir une date');
    panneau.innerHTML = `
      <div class="champ-date-entete">
        <button type="button" class="champ-date-nav" data-nav="-1" aria-label="Mois précédent"><svg class="ico" aria-hidden="true"><use href="#ico-chevron"></use></svg></button>
        <span class="champ-date-titre"></span>
        <button type="button" class="champ-date-nav champ-date-nav--apres" data-nav="1" aria-label="Mois suivant"><svg class="ico" aria-hidden="true"><use href="#ico-chevron"></use></svg></button>
      </div>
      <div class="champ-date-jours" aria-hidden="true">${JOURS_COURTS_DATE.map(j => `<span>${j}</span>`).join('')}</div>
      <div class="champ-date-grille" role="grid"></div>
      <button type="button" class="champ-date-aujourdhui">Aujourd’hui</button>`;
    document.body.appendChild(panneau);
    construire();
    panneau.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => { moisAffiche.setMonth(moisAffiche.getMonth() + Number(b.dataset.nav)); construire(); }));
    panneau.querySelector('.champ-date-aujourdhui').addEventListener('click', () => { ecrireValeur(new Date()); fermerDateOuverte(); });
    positionner();
    bouton.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', surClavier, true);
    DATE_OUVERTE = { panneau, bouton, dernierFocus, surClavier };
    (panneau.querySelector('.champ-date-case--active, .champ-date-case--aujourdhui') || panneau.querySelector('[data-jour]'))?.focus();
  }

  bouton.addEventListener('click', () => { if (DATE_OUVERTE && DATE_OUVERTE.bouton === bouton) fermerDateOuverte(); else ouvrir(); });
}
function champHeureFr(input, pasMinutes = 15) {
  if (!input || input.dataset.fr) return;
  input.dataset.fr = '1';
  input.type = 'text';
  Object.assign(input, { inputMode: 'numeric', placeholder: 'hh:mm', maxLength: 5, autocomplete: 'off' });
  input.pattern = '\\d{2}:\\d{2}';
  input.title = 'Heure au format 24 h, par exemple 14:30';
  erreurChampFr(input, 'Heure invalide : écrivez-la sur 24 h, par exemple 14:30.');
  const normaliser = t => { const m = /^(\d{1,2})[:hH]?(\d{2})?$/.exec(String(t).trim()); return !m || +m[1] > 23 || +(m[2] || 0) > 59 ? '' : `${m[1].padStart(2, '0')}:${m[2] || '00'}`; };
  Object.defineProperty(input, 'value', { configurable: true, get() { return normaliser(VALEUR_INPUT.get.call(this)); }, set(v) { VALEUR_INPUT.set.call(this, normaliser(v) || ''); this.effacerErreurFr?.(); } });
  input.addEventListener('input', ev => {   // « 1430 » devient « 14:30 »
    if (ev.inputType && !ev.inputType.startsWith('insert')) return;
    const c = VALEUR_INPUT.get.call(input).replace(/\D/g, '').slice(0, 4);
    VALEUR_INPUT.set.call(input, c.length > 2 ? `${c.slice(0, 2)}:${c.slice(2)}` : c);
  });
  input.addEventListener('blur', () => { const n = normaliser(VALEUR_INPUT.get.call(input)); if (n) VALEUR_INPUT.set.call(input, n); });
  // flèches haut / bas : un pas de 15 minutes, comme dans les agendas courants
  input.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault();
    const [h, m] = (input.value || '09:00').split(':').map(Number);
    let total = h * 60 + m + (ev.key === 'ArrowUp' ? pasMinutes : -pasMinutes);
    total = ((Math.round(total / pasMinutes) * pasMinutes) % 1440 + 1440) % 1440;
    input.value = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ---- fenêtres : règle commune, sans rien à faire dans chaque page ----
// Une fenêtre ouverte (« .modale-fond » visible) garde le clavier : focus placé dedans à l'ouverture, Tab qui y boucle,
// focus rendu à l'élément qui l'a ouverte à la fermeture ; Échap la ferme quand elle porte data-echap. Sans cela, Tab
// continuait sur la page cachée derrière. La confirmation (role="alertdialog") a sa propre règle.
const FOCUSABLES = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
const fenetreOuverte = () => {
  if (document.querySelector('[role="alertdialog"]')) return null;
  return [...document.querySelectorAll('.modale-fond:not(.cache)')].filter(f => f.offsetParent !== null || getComputedStyle(f).position === 'fixed').at(-1) || null;
};
const focusablesDe = f => [...f.querySelectorAll(FOCUSABLES)].filter(el => !el.disabled && !el.closest('.cache') && (el.offsetWidth || el.offsetHeight));
document.addEventListener('keydown', ev => {
  const f = fenetreOuverte();
  if (!f) return;
  if (ev.key === 'Escape' && f.hasAttribute('data-echap')) {
    const croix = f.querySelector('[aria-label="Fermer"]');
    if (croix) { ev.preventDefault(); croix.click(); }
    return;
  }
  if (ev.key !== 'Tab') return;
  const liste = focusablesDe(f);
  if (!liste.length) return;
  const premier = liste[0], dernier = liste[liste.length - 1];
  if (!f.contains(document.activeElement)) { ev.preventDefault(); premier.focus(); }
  else if (ev.shiftKey && document.activeElement === premier) { ev.preventDefault(); dernier.focus(); }
  else if (!ev.shiftKey && document.activeElement === dernier) { ev.preventDefault(); premier.focus(); }
});
(function suivreFenetres() {
  const ouvreurs = new WeakMap();
  // dernier élément qui avait le focus hors de toute fenêtre : la page place souvent le focus dans la fenêtre avant que
  // l'ouverture soit vue ici
  let focusHorsFenetre = null;
  document.addEventListener('focusin', e => { if (!e.target.closest?.('.modale-fond')) focusHorsFenetre = e.target; });
  const ouverte = f => {
    if (f.querySelector('[role="alertdialog"]')) return;
    const boite = f.querySelector('.modale');
    if (boite && !boite.hasAttribute('role')) {
      boite.setAttribute('role', 'dialog'); boite.setAttribute('aria-modal', 'true');
      const titre = boite.querySelector('.modale-entete h1, .modale-entete h2, .modale-entete h3');
      if (titre?.id && !boite.hasAttribute('aria-labelledby')) boite.setAttribute('aria-labelledby', titre.id);
    }
    const avant = document.activeElement && !f.contains(document.activeElement) && document.activeElement !== document.body ? document.activeElement : focusHorsFenetre;
    if (avant) ouvreurs.set(f, avant);
    setTimeout(() => { if (!f.contains(document.activeElement)) focusablesDe(f)[0]?.focus(); }, 0);
  };
  const fermee = f => {
    const ouvreur = ouvreurs.get(f);
    ouvreurs.delete(f);
    const perdu = !document.activeElement || document.activeElement === document.body || f.contains(document.activeElement);
    if (perdu && ouvreur?.isConnected && (ouvreur.offsetWidth || ouvreur.offsetHeight)) ouvreur.focus();
  };
  new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type !== 'attributes' || !m.target.classList?.contains('modale-fond')) continue;
      const visible = !m.target.classList.contains('cache'), avant = !String(m.oldValue || '').split(/\s+/).includes('cache');
      if (visible && !avant) { verrouillerDefilement(true); ouverte(m.target); }
      else if (!visible && avant) { verrouillerDefilement(false); fermee(m.target); }
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
})();
