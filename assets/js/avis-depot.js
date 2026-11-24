/* VITRINE (module « avis ») — fenêtre « Donner votre avis », ouverte par tout bouton [data-ouvrir-avis] (accueil et avis.html).
   Déposer exige une connexion Discord (vérification légère du socle, /api/discord/…) : sans elle, la fenêtre propose de se
   connecter ; au retour de Discord (?discord=ok), elle se rouvre d'elle-même sur le formulaire. Note : cinq étoiles (boutons
   radio, donc flèches du clavier). Tout texte arrive par textContent. */
(() => {
  const ouvrants = document.querySelectorAll('[data-ouvrir-avis]');
  if (!ouvrants.length) return;
  const el = (tag, classe, texte) => { const n = document.createElement(tag); if (classe) n.className = classe; if (texte !== undefined) n.textContent = texte; return n; };
  const champ = (id, libelle, controle, facultatif) => {
    const d = el('div', 'champ'); const l = el('label', '', libelle); l.htmlFor = id;
    if (facultatif) l.append(' ', el('small', '', 'facultatif'));
    controle.id = id; d.append(l, controle); return d;
  };
  const NS = 'http://www.w3.org/2000/svg';
  const etoileSvg = () => {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', 'M10 1l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L10 14.9 4.4 18l1.4-6.2L1 7.5l6.4-.6z'); s.append(p); return s;
  };

  // retour de Discord : ?avis=1&discord=ok|erreur (le marqueur « avis » distingue ce retour de celui d'une demande : les deux
  // fenêtres peuvent se trouver sur la même page)
  const params = new URLSearchParams(location.search);
  const retour = params.get('avis') ? params.get('discord') : null;
  if (retour) {   // l'adresse redevient propre ; la fenêtre se rouvre plus bas
    const p = new URLSearchParams(location.search); p.delete('discord'); p.delete('avis');
    history.replaceState(null, '', location.pathname + (p.toString() ? `?${p}` : '') + location.hash);
  }

  const dialogue = el('dialog', 'fiche-service fenetre-avis');
  dialogue.setAttribute('aria-labelledby', 'avis-titre');
  const corps = el('div', 'fiche-service__corps');
  const titre = el('h3', '', 'Donner votre avis'); titre.id = 'avis-titre';

  // étape 1 : connexion Discord
  const bloc = el('div', 'avis-bloc');
  const lien = el('a', 'btn btn--accent', 'Se connecter avec Discord');
  lien.href = `/api/discord/connecter?next=${encodeURIComponent(`${location.pathname}?avis=1`)}`;
  const erreurDiscord = el('p', 'avis-etat', 'La connexion avec Discord a échoué. Réessayez.'); erreurDiscord.setAttribute('role', 'alert'); erreurDiscord.hidden = retour !== 'erreur';
  bloc.append(el('p', '', 'Pour déposer un avis, connectez-vous avec Discord : nous gardons votre pseudo Discord avec votre avis, pour la modération. Il n’est jamais affiché.'), lien, erreurDiscord);

  // étape 2 : formulaire
  const form = el('form', 'avis-form'); form.noValidate = true; form.hidden = true;
  const qui = el('p', 'avis-etat'); const pseudo = el('strong');
  const changer = el('button', 'lien', 'Ce n’est pas vous ?'); changer.type = 'button';
  qui.append('Connecté en tant que ', pseudo, '. ', changer);
  const nom = el('input'); nom.type = 'text'; nom.maxLength = 100; nom.autocomplete = 'name'; nom.required = true;
  const entreprise = el('input'); entreprise.type = 'text'; entreprise.maxLength = 100; entreprise.autocomplete = 'organization';
  const texte = el('textarea'); texte.maxLength = 800; texte.rows = 5; texte.required = true;

  const note = el('fieldset', 'champ avis-note'); note.append(el('legend', '', 'Note'));
  const etoiles = el('div', 'avis-note__etoiles');
  const choix = [];
  for (let n = 1; n <= 5; n++) {
    const l = el('label'); const r = el('input'); r.type = 'radio'; r.name = 'note'; r.value = String(n); if (n === 5) r.checked = true;
    const s = el('span', 'avis-note__etoile'); s.append(etoileSvg()); const t = el('span', 'sr-only', `${n} étoile${n > 1 ? 's' : ''} sur 5`);
    l.append(r, s, t); etoiles.append(l); choix.push({ l, r });
  }
  // étoiles pleines jusqu'à la note choisie ; au survol, jusqu'à l'étoile visée
  const peindre = jusqua => choix.forEach(({ l }, i) => l.classList.toggle('est-pleine', i < jusqua));
  const noteChoisie = () => Number(choix.find(c => c.r.checked)?.r.value || 0);
  choix.forEach(({ l, r }, i) => {
    r.addEventListener('change', () => peindre(noteChoisie()));
    l.addEventListener('mouseenter', () => peindre(i + 1));
  });
  etoiles.addEventListener('mouseleave', () => peindre(noteChoisie()));
  peindre(5);
  const aide = el('p', 'champ-aide', 'Cliquez sur une étoile : de 1 (décevant) à 5 (excellent).');
  note.append(etoiles, aide);

  const message = el('p', 'avis-etat'); message.setAttribute('role', 'alert'); message.hidden = true;
  const envoyer = el('button', 'btn btn--accent', 'Envoyer mon avis'); envoyer.type = 'submit';
  const annuler = el('button', 'btn btn--ligne', 'Annuler'); annuler.type = 'button';
  const boutons = el('div', 'avis-boutons'); boutons.append(envoyer, annuler);
  form.append(qui, champ('av-nom', 'Nom affiché', nom), champ('av-entreprise', 'Entreprise', entreprise, true), note, champ('av-texte', 'Votre avis', texte), message, boutons);

  // étape 3 : merci
  const merci = el('div', 'avis-bloc'); merci.hidden = true;
  const fermer = el('button', 'btn btn--ligne', 'Fermer'); fermer.type = 'button';
  const msgMerci = el('p', '', 'Merci ! Votre avis est enregistré : il sera visible après vérification.'); msgMerci.setAttribute('role', 'status');
  merci.append(msgMerci, fermer);

  corps.append(titre, bloc, form, merci);
  dialogue.append(corps);
  document.body.append(dialogue);

  const afficher = discord => {
    bloc.hidden = !!discord || !merci.hidden; form.hidden = !discord || !merci.hidden;
    if (discord) { pseudo.textContent = discord.pseudo; if (!nom.value) nom.value = discord.pseudo; }
  };
  let declencheur = null;
  async function ouvrir(depuis) {
    declencheur = depuis || declencheur;
    merci.hidden = true;
    try { afficher((await (await fetch('/api/discord/moi', { credentials: 'same-origin' })).json()).discord); } catch { afficher(null); }
    if (!dialogue.open) dialogue.showModal();
    (form.hidden ? lien : nom).focus();
  }
  ouvrants.forEach(b => b.addEventListener('click', () => ouvrir(b)));
  if (retour) ouvrir(ouvrants[0]);
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
    message.hidden = true;
    const dire = (t, cible) => { message.textContent = t; message.hidden = false; cible?.focus(); };
    if (!nom.value.trim()) return dire('Indiquez le nom à afficher.', nom);
    if (!texte.value.trim()) return dire('Écrivez votre avis avant de l’envoyer.', texte);
    envoyer.disabled = true;
    try {
      const r = await fetch('/api/avis', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom: nom.value.trim(), entreprise: entreprise.value.trim(), note: noteChoisie(), texte: texte.value.trim() }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'L’envoi a échoué. Réessayez dans un instant.');
      form.hidden = true; merci.hidden = false; texte.value = ''; fermer.focus();
    } catch (err) { dire(err.message); }
    finally { envoyer.disabled = false; }
  });
})();
