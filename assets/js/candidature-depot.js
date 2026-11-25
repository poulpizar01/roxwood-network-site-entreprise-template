/* VITRINE (module « recrutement ») — fenêtre de candidature, ouverte par tout bouton [data-ouvrir-candidature] (la valeur, si elle
   existe, est le poste visé). Envoyer exige une connexion Discord (vérification légère du socle, /api/discord/…) ; au retour de
   Discord (?candidature=1&discord=ok), la fenêtre se rouvre d'elle-même sur le formulaire. La pièce d'identité RP est une image
   obligatoire, envoyée avec le formulaire (multipart). Tout texte arrive par textContent. */
(() => {
  const ouvrants = document.querySelectorAll('[data-ouvrir-candidature]');
  if (!ouvrants.length) return;
  const el = (tag, classe, texte) => { const n = document.createElement(tag); if (classe) n.className = classe; if (texte !== undefined) n.textContent = texte; return n; };
  const champ = (id, libelle, controle, aide) => {
    const d = el('div', 'champ'); const l = el('label', '', libelle); l.htmlFor = id; controle.id = id; d.append(l, controle);
    if (aide) d.append(el('p', 'champ-aide', aide));
    return d;
  };
  const saisie = (max, auto) => { const i = el('input'); i.type = 'text'; i.maxLength = max; if (auto) i.autocomplete = auto; return i; };

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
  const erreurDiscord = el('p', 'avis-etat', 'La connexion avec Discord a échoué. Réessayez.'); erreurDiscord.setAttribute('role', 'alert'); erreurDiscord.hidden = retour !== 'erreur';
  bloc.append(el('p', '', 'Pour postuler, connectez-vous avec Discord : nous gardons votre pseudo Discord avec votre candidature, et l’équipe vous répond dans un salon dédié. Il n’est jamais affiché publiquement.'), lien, erreurDiscord);

  // étape 2 : formulaire
  const form = el('form', 'avis-form'); form.noValidate = true; form.hidden = true;
  const qui = el('p', 'avis-etat'); const pseudo = el('strong');
  const changer = el('button', 'lien', 'Ce n’est pas vous ?'); changer.type = 'button';
  qui.append('Connecté en tant que ', pseudo, '. ', changer);
  const prenom = saisie(60, 'given-name'), nom = saisie(60, 'family-name');
  const zonePoste = el('div', 'champ');   // select si des postes sont ouverts, sinon texte libre
  let poste = saisie(120);
  const libellePoste = el('label', '', 'Poste visé'); libellePoste.htmlFor = 'cd-poste'; poste.id = 'cd-poste'; zonePoste.append(libellePoste, poste);
  const motivation = el('textarea'); motivation.maxLength = 2000; motivation.rows = 6;
  const piece = el('input'); piece.type = 'file'; piece.accept = 'image/png,image/jpeg,image/webp';
  const erreur = el('p', 'avis-etat'); erreur.setAttribute('role', 'alert'); erreur.hidden = true;
  const envoyer = el('button', 'btn btn--accent', 'Envoyer ma candidature'); envoyer.type = 'submit';
  const annuler = el('button', 'btn btn--ligne', 'Annuler'); annuler.type = 'button';
  const boutons = el('div', 'avis-boutons'); boutons.append(envoyer, annuler);
  form.append(qui, champ('cd-prenom', 'Prénom', prenom), champ('cd-nom', 'Nom', nom), zonePoste, champ('cd-motivation', 'Votre motivation', motivation),
    champ('cd-piece', 'Pièce d’identité', piece, 'Une image (PNG, JPEG ou WebP) de votre pièce d’identité en jeu. Elle n’est vue que de l’équipe de recrutement et effacée 90 jours après réception.'), erreur, boutons);

  // étape 3 : merci
  const merci = el('div', 'avis-bloc'); merci.hidden = true;
  const fermer = el('button', 'btn btn--ligne', 'Fermer'); fermer.type = 'button';
  const msgMerci = el('p', '', 'Merci ! Votre candidature est enregistrée : l’équipe vous répond sur Discord.'); msgMerci.setAttribute('role', 'status');
  merci.append(msgMerci, fermer);

  corps.append(titre, bloc, form, merci);
  dialogue.append(corps);
  document.body.append(dialogue);

  // postes ouverts (module « vitrine ») : un select, avec « Candidature spontanée » ; sans eux, le champ texte reste
  let postes = null;
  async function chargerPostes() {
    if (postes) return;
    try {
      postes = (await (await fetch('/api/postes/public')).json()).postes || [];
      if (!postes.length) return;
      const s = el('select');
      s.append(new Option('Candidature spontanée', ''), ...postes.map(p => new Option(p.nom, p.nom)));
      s.id = 'cd-poste'; poste.replaceWith(s); poste = s;
    } catch { postes = []; }
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
    await chargerPostes();
    if (visee && poste.tagName === 'SELECT' && ![...poste.options].some(o => o.value === visee)) poste.append(new Option(visee, visee));
    if (visee !== undefined) poste.value = visee;
    try { afficher((await (await fetch('/api/discord/moi', { credentials: 'same-origin' })).json()).discord); } catch { afficher(null); }
    if (!dialogue.open) dialogue.showModal();
    (form.hidden ? lien : prenom).focus();
  }
  ouvrants.forEach(b => b.addEventListener('click', () => ouvrir(b, b.dataset.ouvrirCandidature)));
  if (retour) ouvrir(ouvrants[0], posteRetour);
  dialogue.addEventListener('click', e => { if (e.target === dialogue) dialogue.close(); });   // clic sur le fond
  dialogue.addEventListener('close', () => declencheur?.focus());
  annuler.addEventListener('click', () => dialogue.close());
  fermer.addEventListener('click', () => dialogue.close());
  changer.addEventListener('click', async () => {
    await fetch('/api/discord/oublier', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.href = lien.href;
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    erreur.hidden = true;
    const dire = (t, cible) => { erreur.textContent = t; erreur.hidden = false; cible?.focus(); };
    if (!prenom.value.trim() || !nom.value.trim()) return dire('Indiquez votre prénom et votre nom.', prenom.value.trim() ? nom : prenom);
    if (!motivation.value.trim()) return dire('Écrivez votre motivation avant d’envoyer.', motivation);
    if (!piece.files?.length) return dire('Joignez votre pièce d’identité (une image).', piece);
    const donnees = new FormData();
    donnees.append('prenom', prenom.value.trim()); donnees.append('nom', nom.value.trim()); donnees.append('poste', poste.value.trim());
    donnees.append('motivation', motivation.value.trim()); donnees.append('image', piece.files[0]);
    envoyer.disabled = true;
    try {
      const r = await fetch('/api/candidatures', { method: 'POST', credentials: 'same-origin', body: donnees });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'L’envoi a échoué. Réessayez dans un instant.');
      form.hidden = true; merci.hidden = false; motivation.value = ''; piece.value = ''; fermer.focus();
    } catch (err) { dire(err.message); }
    finally { envoyer.disabled = false; }
  });
})();
