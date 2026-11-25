/* SOCLE — aides communes aux pages du site (vitrine et gestion). Mutualisé : ne pas modifier dans un site.
   <script src="/socle/socle.js"></script> puis, dans les scripts de la page : socle.api(), socle.esc(), socle.moi()…
   Aucune mise en forme ici : l'apparence de chaque site est libre (theme.css, gestion/gestion.css). */
(() => {
  // Navigateur du jeu (page dans un cadre) : un POST peut y partir avec « Origin: null », que le serveur n'accepte qu'avec le
  // jeton de la session (server/src/socle/csrf.ts, docs/guide-dev-fbfa.md B7). Toute requête qui modifie quelque chose vers
  // l'API du site le porte, que la page passe par socle.api() ou par fetch() (envoi de fichier). Hors cadre : rien ne change.
  let enCadre = false;
  if (location.ancestorOrigins) enCadre = location.ancestorOrigins.length > 0;   // guide FBFA, B5 ; window.top seulement en repli (Firefox)
  else { try { enCadre = window.self !== window.top; } catch { enCadre = true; } }
  if (enCadre) {
    const fetchNatif = window.fetch.bind(window);
    let jetonP = null;
    const jeton = () => (jetonP ??= fetchNatif('/api/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null)).then(d => d?.csrf || null).catch(() => null));
    window.fetch = async (entree, init = {}) => {
      const requete = entree instanceof Request ? entree : null;
      const methode = String(init.method || requete?.method || 'GET').toUpperCase();
      let url;
      try { url = new URL(requete ? requete.url : entree, location.href); } catch { return fetchNatif(entree, init); }
      if (methode === 'GET' || methode === 'HEAD' || url.origin !== location.origin || !/^\/(api|auth)\//.test(url.pathname) || url.pathname === '/api/csrf') return fetchNatif(entree, init);
      const t = await jeton();
      if (!t) return fetchNatif(entree, init);
      const entetes = new Headers(init.headers || requete?.headers);
      entetes.set('X-CSRF-Token', t);
      return fetchNatif(entree, { ...init, headers: entetes });
    };
  }

  // nom du site (site.json), lu dans la page : <meta name="application-name" content="{{nom}}">.
  // Jamais de {{…}} dans une chaîne JavaScript : une apostrophe dans la valeur casserait le script.
  const nomSite = document.querySelector('meta[name="application-name"]')?.content || '';

  // échappement pour insérer un texte venu de l'API (nom, message…) dans du HTML ; à défaut, préférer textContent
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Appel à l'API du site. Corps : objet → JSON ; FormData → formulaire (envoi d'image). Réponse JSON renvoyée telle
  // quelle ; erreur → exception avec le message du serveur (err.status, err.data). Session perdue (401) ou compte plus
  // validé (403 « attente ») sur une page de gestion : retour à la connexion ou à l'attente.
  async function api(chemin, { method = 'GET', body } = {}) {
    const init = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    let r;
    try { r = await fetch(chemin, init); }
    catch { throw Object.assign(new Error('Le site ne répond pas. Vérifie ta connexion et réessaie.'), { status: 0 }); }
    const data = await r.json().catch(() => null);
    if (r.ok) return data;
    const dansGestion = location.pathname.startsWith('/gestion/');
    if (dansGestion && r.status === 401 && data?.error === 'non-connecte' && !location.pathname.match(/^\/gestion\/(index(\.html)?)?$/)) location.href = '/gestion/';
    if (dansGestion && r.status === 403 && data?.error === 'attente') location.href = '/gestion/attente.html';
    const message = data?.error && !/^[a-z-]+$/.test(data.error) ? data.error
      : r.status === 403 ? 'Tu n’as pas les droits pour cette action.'
      : r.status === 404 ? 'Introuvable.'
      : r.status === 429 ? 'Trop de requêtes, réessaie dans un instant.'
      : 'Une erreur est survenue, réessaie.';
    throw Object.assign(new Error(message), { status: r.status, data });
  }

  // compte connecté (une seule lecture par page) : { id, nom, pseudo, avatar, statut, proprietaire, grade, permissions }
  let moiP = null;
  const moi = (recharger = false) => (moiP && !recharger ? moiP : (moiP = api('/api/moi')));
  // le compte a-t-il cette permission ? (le serveur vérifie de son côté : ceci ne sert qu'à l'affichage)
  const peut = (compte, permission) => !!compte && (compte.proprietaire || compte.permissions?.includes(permission));

  async function deconnexion() {
    try { await api('/auth/logout', { method: 'POST' }); } finally { location.href = '/gestion/'; }
  }

  // dates lisibles, heure de Paris (celle du serveur RP)
  const date = (d, avecHeure = false) => new Date(d).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric', ...(avecHeure && { hour: '2-digit', minute: '2-digit' }),
  });

  // Liens réglés dans la gestion (Paramètres, déclarés « public » : GET /api/liens). Tout élément <a data-lien="cle">
  // de la page reçoit son adresse au chargement ; un lien non réglé masque l'élément (l'écrire avec l'attribut hidden
  // pour qu'il n'apparaisse pas avant). Contenu ajouté plus tard : socle.appliquerLiens(conteneur).
  let liensP = null;
  const liens = () => (liensP ??= fetch('/api/liens', { headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : {})).catch(() => ({})));
  async function appliquerLiens(racine = document) {
    const elements = racine.querySelectorAll('[data-lien]');
    if (!elements.length) return;
    const l = await liens();
    for (const el of elements) {
      const url = l[el.dataset.lien];
      if (typeof url === 'string' && url.startsWith('https://')) { el.href = url; el.hidden = false; }
      else el.hidden = true;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => appliquerLiens());
  else appliquerLiens();

  window.socle = Object.freeze({ nomSite, esc, api, moi, peut, deconnexion, date, liens, appliquerLiens });
})();
