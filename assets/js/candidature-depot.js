/* VITRINE (module « recrutement », mode « site ») — fenêtre de candidature, ouverte par tout bouton [data-ouvrir-candidature] (la valeur, si
   elle existe, est le poste visé). Le formulaire se construit d'après /api/candidatures/formulaire : prénom, nom, poste, puis les questions
   réglées par la direction (réponse courte ou longue, dans l'ordre choisi), puis un champ de fichier par pièce jointe demandée. Envoyer exige
   une connexion Discord (vérification légère du socle, /api/discord/…) ; au retour de Discord (?candidature=1&discord=ok), la fenêtre se
   rouvre d'elle-même sur le formulaire. Tout texte arrive par textContent. */
(() => {
  const ouvrants = document.querySelectorAll('[data-ouvrir-candidature]');
  if (!ouvrants.length) return;
  const el = (tag, classe, texte) => { const n = document.createElement(tag); if (classe) n.className = classe; if (texte !== undefined) n.textContent = texte; return n; };
  const champ = (id, libelle, controle, { aide, facultatif } = {}) => {
    const d = el('div', 'champ'); const l = el('label', '', libelle); l.htmlFor = id; controle.id = id;
    if (facultatif) l.append(' ', el('small', '', 'facultatif'));
    d.append(l, controle);
    if (aide) d.append(el('p', 'champ-aide', aide));
    return d;
  };
  const saisie = (max, auto) => { const i = el('input'); i.type = 'text'; i.maxLength = max; if (auto) i.autocomplete = auto; return i; };
  const habiller = s => { if (typeof ameliorerSelect === 'function') ameliorerSelect(s); return s; };   // liste déroulante du site (liste-deroulante.js)

  const params = new URLSearchParams(location.search);
  const retour = params.get('candidature') ? params.get('discord') : null;   // le marqueur distingue ce retour de celui des avis et des demandes
  const posteRetour = params.get('poste') || '';   // le poste choisi voyage dans l'adresse de retour de Discord
  if (retour) {
    params.delete('discord'); params.delete('candidature'); params.delete('poste');
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  }

  const dialogue = el('dialog', 'fiche-service fenetre-demande');
  dialogue.setAttribute('aria-labelledby', 'candidature-titre');
  const corps = el('div', 'fiche-service__corps');
  const titre = el('h3', '', 'Postuler'); titre.id = 'candidature-titre';

  // étape 1 : connexion Discord
  const bloc = el('div', 'avis-bloc');
  const lien = el('a', 'btn btn--accent', 'Se connecter avec Discord');
  const sortie = el('button', 'btn btn--ligne', 'Annuler'); sortie.type = 'button';   // sans compte Discord ni Échap (téléphone), la fenêtre doit pouvoir se fermer
  const erreurDiscord = el('p', 'avis-etat', 'La connexion avec Discord a échoué. Réessayez.'); erreurDiscord.setAttribute('role', 'alert'); erreurDiscord.hidden = retour !== 'erreur';
  bloc.append(el('p', '', 'Pour postuler, connectez-vous avec Discord : nous gardons votre pseudo Discord avec votre candidature, et l’équipe vous répond dans un salon dédié. Il n’est jamais affiché publiquement.'), lien, sortie, erreurDiscord);

  // étape 2 : formulaire (corps reconstruit à chaque ouverture, d'après la configuration)
  const form = el('form', 'avis-form'); form.noValidate = true; form.hidden = true;
  const qui = el('p', 'avis-etat'); const pseudo = el('strong');
  const deconnexion = el('button', 'lien', 'Se déconnecter'); deconnexion.type = 'button';
  qui.append('Connecté en tant que ', pseudo, '. ', deconnexion);
  const zoneChamps = el('div', 'avis-form');
  const erreur = el('p', 'avis-etat'); erreur.setAttribute('role', 'alert'); erreur.hidden = true;
  const envoyer = el('button', 'btn btn--accent', 'Envoyer ma candidature'); envoyer.type = 'submit';
  const annuler = el('button', 'btn btn--ligne', 'Annuler'); annuler.type = 'button';
  const boutons = el('div', 'avis-boutons'); boutons.append(envoyer, annuler);
  form.append(qui, zoneChamps, erreur, boutons);

  // étape 3 : merci
  const merci = el('div', 'avis-bloc'); merci.hidden = true;
  const fermer = el('button', 'btn btn--ligne', 'Fermer'); fermer.type = 'button';
  const msgMerci = el('p', '', 'Merci ! Votre candidature est enregistrée : l’équipe vous répond sur Discord.'); msgMerci.setAttribute('role', 'status');
  merci.append(msgMerci, fermer);

  corps.append(titre, bloc, form, merci);
  dialogue.append(corps);
  document.body.append(dialogue);

  // ---- configuration du formulaire : questions et pièce, réglées dans la gestion ----
  let config = null, postes = null;
  let prenom, nom, poste, champsQuestions = [], champsPieces = [];
  async function charger() {
    config = await (await fetch('/api/candidatures/formulaire')).json();
    try { postes = (await (await fetch('/api/postes/public')).json()).postes || []; } catch { postes = []; }   // module « vitrine » éteint : poste en texte libre
  }
  function construire(visee) {
    zoneChamps.replaceChildren();
    prenom = saisie(60, 'given-name'); nom = saisie(60, 'family-name');
    if (postes.length) {
      poste = el('select');
      poste.append(new Option('Candidature spontanée', ''), ...postes.map(p => new Option(p.nom, p.nom)));
      if (visee && !postes.some(p => p.nom === visee)) poste.append(new Option(visee, visee));
    } else poste = saisie(120);
    poste.value = visee || '';
    zoneChamps.append(champ('cd-prenom', 'Prénom', prenom), champ('cd-nom', 'Nom', nom), champ('cd-poste', 'Poste visé', poste));
    if (poste.tagName === 'SELECT') habiller(poste);
    champsQuestions = config.questions.map(q => {
      let c;
      if (q.type === 'long') { c = el('textarea'); c.maxLength = 2000; c.rows = 5; }
      else c = saisie(300);
      zoneChamps.append(champ(`cd-q${q.id}`, q.libelle, c, { facultatif: !q.obligatoire }));
      return { q, c };
    });
    // une image par pièce demandée (PNG, JPEG, WebP) ; le champ « piece-<id> » dit au serveur laquelle
    champsPieces = config.pieces.map(p => {
      const input = el('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
      const c = champ(`cd-piece-${p.id}`, p.libelle, input, { facultatif: !p.obligatoire,
        aide: `Une image (PNG, JPEG ou WebP, ${config.piecesMaxMo} Mo au plus pour l’ensemble des pièces). Elle n’est vue que de l’équipe de recrutement et effacée 90 jours après réception.` });
      c.append(el('p', 'champ-aide seulement-en-jeu', 'En jeu, si le choix du fichier ne s’ouvre pas, envoyez votre candidature depuis un navigateur.'));   // folkos.js pose html.en-jeu
      zoneChamps.append(c);
      return { p, input };
    });
  }

  let declencheur = null;
  const afficher = discord => {
    bloc.hidden = !!discord || !merci.hidden; form.hidden = !discord || !merci.hidden;
    if (discord) pseudo.textContent = discord.pseudo;
  };
  async function ouvrir(depuis, visee) {
    declencheur = depuis || declencheur;
    lien.href = `/api/discord/connecter?next=${encodeURIComponent(`${location.pathname}?candidature=1&poste=${encodeURIComponent(visee || '')}`)}`;
    merci.hidden = true; erreur.hidden = true;
    try { await charger(); } catch { return; }
    if (!config.ouvert) return;
    construire(visee);
    try { afficher((await (await fetch('/api/discord/moi', { credentials: 'same-origin' })).json()).discord); } catch { afficher(null); }
    if (!dialogue.open) dialogue.showModal();
    (form.hidden ? lien : prenom).focus();
  }
  ouvrants.forEach(b => b.addEventListener('click', () => ouvrir(b, b.dataset.ouvrirCandidature)));
  if (retour) ouvrir(ouvrants[0], posteRetour);
  dialogue.addEventListener('click', e => { if (e.target === dialogue) dialogue.close(); });   // clic sur le fond
  dialogue.addEventListener('close', () => declencheur?.focus());
  annuler.addEventListener('click', () => dialogue.close());
  sortie.addEventListener('click', () => dialogue.close());
  fermer.addEventListener('click', () => dialogue.close());
  // se déconnecter : le site oublie l'identité Discord vérifiée, la fenêtre revient à la connexion (en dev, reconnecter reconnecte aussitôt)
  deconnexion.addEventListener('click', async () => {
    await fetch('/api/discord/oublier', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    afficher(null); lien.focus();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    erreur.hidden = true;
    const dire = (t, cible) => { erreur.textContent = t; erreur.hidden = false; cible?.focus(); };
    if (!prenom.value.trim() || !nom.value.trim()) return dire('Indiquez votre prénom et votre nom.', prenom.value.trim() ? nom : prenom);
    const reponses = {};
    for (const { q, c } of champsQuestions) {
      const v = c.value.trim();
      if (!v && q.obligatoire) return dire(`Répondez à « ${q.libelle} ».`, c);
      if (v) reponses[q.id] = v;
    }
    for (const { p, input } of champsPieces) {
      if (!input.files?.length && p.obligatoire) return dire(`Joignez « ${p.libelle} » (une image).`, input);
    }
    const poids = champsPieces.reduce((t, { input }) => t + (input.files?.[0]?.size || 0), 0);
    if (poids > config.piecesMaxMo * 1048576) return dire(`Vos pièces jointes pèsent plus de ${config.piecesMaxMo} Mo en tout : réduisez-les ou changez d’image.`, champsPieces.find(c => c.input.files?.length)?.input);
    const donnees = new FormData();
    donnees.append('prenom', prenom.value.trim()); donnees.append('nom', nom.value.trim()); donnees.append('poste', poste.value.trim());
    donnees.append('reponses', JSON.stringify(reponses));
    for (const { p, input } of champsPieces) if (input.files?.length) donnees.append(`piece-${p.id}`, input.files[0]);
    envoyer.disabled = true;
    try {
      const r = await fetch('/api/candidatures', { method: 'POST', credentials: 'same-origin', body: donnees });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'L’envoi a échoué. Réessayez dans un instant.');
      form.hidden = true; merci.hidden = false; fermer.focus();
    } catch (err) { dire(err.message); }
    finally { envoyer.disabled = false; }
  });
})();
