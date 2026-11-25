/* VITRINE (module « demandes ») — fenêtre d'envoi d'une demande, ouverte par tout bouton [data-ouvrir-demande="contact|devis"].
   Envoyer exige une connexion Discord (vérification légère du socle, /api/discord/…) : sans elle, la fenêtre propose de se
   connecter ; au retour de Discord (?discord=ok&demande=<type>), elle se rouvre d'elle-même sur le formulaire. Un devis choisit
   un service de la vitrine (module « vitrine ») ; sans eux, le service se saisit en texte. Tout texte arrive par textContent. */
(() => {
  const ouvrants = document.querySelectorAll('[data-ouvrir-demande]');
  if (!ouvrants.length) return;
  const el = (tag, classe, texte) => { const n = document.createElement(tag); if (classe) n.className = classe; if (texte !== undefined) n.textContent = texte; return n; };
  const champ = (id, libelle, controle, facultatif) => {
    const d = el('div', 'champ'); const l = el('label', '', libelle); l.htmlFor = id;
    if (facultatif) l.append(' ', el('small', '', 'facultatif'));
    controle.id = id; d.append(l, controle); return d;
  };
  const saisie = (type = 'text', max = 200, auto) => { const i = el('input'); i.type = type; i.maxLength = max; if (auto) i.autocomplete = auto; return i; };

  const params = new URLSearchParams(location.search);
  const typeRetour = params.get('demande'), retour = typeRetour ? params.get('discord') : null;   // le marqueur « demande » distingue ce retour de celui des avis
  if (retour) {   // l'adresse redevient propre ; la fenêtre se rouvre plus bas
    params.delete('discord'); params.delete('demande');
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  }

  const dialogue = el('dialog', 'fiche-service fenetre-demande');
  dialogue.setAttribute('aria-labelledby', 'demande-titre');
  const corps = el('div', 'fiche-service__corps');
  const titre = el('h3'); titre.id = 'demande-titre';

  // étape 1 : connexion Discord
  const bloc = el('div', 'avis-bloc');
  const lien = el('a', 'btn btn--accent', 'Se connecter avec Discord');
  lien.setAttribute('data-hors-jeu', '');
  const sortie = el('button', 'btn btn--ligne', 'Annuler'); sortie.type = 'button';   // sans compte Discord ni Échap (téléphone), la fenêtre doit pouvoir se fermer
  const erreurDiscord = el('p', 'avis-etat', 'La connexion avec Discord a échoué. Réessayez.'); erreurDiscord.setAttribute('role', 'alert'); erreurDiscord.hidden = retour !== 'erreur';
  bloc.append(el('p', '', 'Pour nous écrire, connectez-vous avec Discord : nous gardons votre pseudo Discord avec votre demande, et l’équipe vous répond dans un salon dédié. Il n’est jamais affiché publiquement.'), lien, el('p', 'champ-aide seulement-en-jeu', 'La connexion Discord ne fonctionne pas dans l’ordinateur du jeu : ouvrez ce site dans un navigateur pour l’envoyer.'), sortie, erreurDiscord);

  // étape 2 : formulaire
  const form = el('form', 'avis-form'); form.noValidate = true; form.hidden = true;
  const qui = el('p', 'avis-etat'); const pseudo = el('strong');
  const changer = el('button', 'lien', 'Se déconnecter'); changer.type = 'button';
  qui.append('Connecté en tant que ', pseudo, '. ', changer);
  const nom = saisie('text', 100, 'name'); nom.required = true;
  const entreprise = saisie('text', 100, 'organization');
  const blocDevis = el('div', 'avis-form'); blocDevis.hidden = true;
  const dateSouhaitee = saisie('text', 10);   // champDateFr (champs-date.js) en fait un champ jj/mm/aaaa avec calendrier ; .value reste AAAA-MM-JJ
  const budget = saisie('text', 60);
  const zoneService = el('div', 'champ');   // select si la vitrine a des services, sinon texte libre
  let service = saisie('text', 120);
  const message = el('textarea'); message.maxLength = 2000; message.rows = 5; message.required = true;
  const erreur = el('p', 'avis-etat'); erreur.setAttribute('role', 'alert'); erreur.hidden = true;
  const envoyer = el('button', 'btn btn--accent', 'Envoyer ma demande'); envoyer.type = 'submit';
  const annuler = el('button', 'btn btn--ligne', 'Annuler'); annuler.type = 'button';
  const boutons = el('div', 'avis-boutons'); boutons.append(envoyer, annuler);
  const libelleService = el('label', '', 'Service souhaité'); libelleService.htmlFor = 'dm-service'; service.id = 'dm-service';
  zoneService.append(libelleService, service);
  blocDevis.append(zoneService, champ('dm-date', 'Date souhaitée', dateSouhaitee, true), champ('dm-budget', 'Budget', budget, true));
  if (typeof champDateFr === 'function') champDateFr(dateSouhaitee);
  form.append(qui, champ('dm-nom', 'Nom', nom), champ('dm-entreprise', 'Entreprise', entreprise, true), blocDevis, champ('dm-message', 'Votre message', message), erreur, boutons);

  // étape 3 : merci
  const merci = el('div', 'avis-bloc'); merci.hidden = true;
  const fermer = el('button', 'btn btn--ligne', 'Fermer'); fermer.type = 'button';
  const msgMerci = el('p', '', 'Merci ! Votre demande est enregistrée : l’équipe vous répond sur Discord.'); msgMerci.setAttribute('role', 'status');
  merci.append(msgMerci, fermer);

  corps.append(titre, bloc, form, merci);
  dialogue.append(corps);
  document.body.append(dialogue);

  // services de la vitrine : un select quand il y en a (module « vitrine » allumé), sinon le champ texte reste
  let servicesCharges = false;
  async function chargerServices() {
    if (servicesCharges) return;
    servicesCharges = true;
    try {
      const { services } = await (await fetch('/api/services/public')).json();
      if (!services?.length) return;
      const s = el('select');
      s.append(new Option('Je ne sais pas encore', ''), ...services.map(x => new Option(x.nom, x.nom)));
      s.id = 'dm-service'; service.replaceWith(s); service = s;
      if (typeof ameliorerSelect === 'function') ameliorerSelect(s);
    } catch { /* module « vitrine » éteint : le champ texte suffit */ }
  }

  let type = 'contact', declencheur = null;
  const afficher = discord => {
    bloc.hidden = !!discord || !merci.hidden; form.hidden = !discord || !merci.hidden;
    if (discord) { pseudo.textContent = discord.pseudo; if (!nom.value) nom.value = discord.pseudo; }
  };
  async function ouvrir(depuis, t) {
    declencheur = depuis || declencheur; type = t === 'devis' ? 'devis' : 'contact';
    titre.textContent = type === 'devis' ? 'Demander un devis' : 'Nous écrire';
    blocDevis.hidden = type !== 'devis';
    lien.href = `/api/discord/connecter?next=${encodeURIComponent(`${location.pathname}?demande=${type}`)}`;
    merci.hidden = true; erreur.hidden = true;
    if (type === 'devis') await chargerServices();
    try { afficher((await (await fetch('/api/discord/moi', { credentials: 'same-origin' })).json()).discord); } catch { afficher(null); }
    if (!dialogue.open) dialogue.showModal();
    (form.hidden ? lien : nom).focus();
  }
  ouvrants.forEach(b => b.addEventListener('click', () => ouvrir(b, b.dataset.ouvrirDemande)));
  if (retour) ouvrir(document.querySelector(`[data-ouvrir-demande="${typeRetour}"]`) || ouvrants[0], typeRetour);
  dialogue.addEventListener('click', e => { if (e.target === dialogue) dialogue.close(); });   // clic sur le fond
  dialogue.addEventListener('close', () => declencheur?.focus());
  dialogue.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); dialogue.close(); } });   // preventDefault : sinon le SDK du jeu ferme aussi la tablette (guide FBFA, B5)
  annuler.addEventListener('click', () => dialogue.close());
  sortie.addEventListener('click', () => dialogue.close());
  fermer.addEventListener('click', () => dialogue.close());
  changer.addEventListener('click', async () => {
    await fetch('/api/discord/oublier', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    afficher(null); lien.focus();   // la fenêtre revient à la connexion (en dev, reconnecter reconnecte aussitôt)
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    erreur.hidden = true;
    const dire = (t, cible) => { erreur.textContent = t; erreur.hidden = false; cible?.focus(); };
    if (!nom.value.trim()) return dire('Indiquez votre nom.', nom);
    if (!message.value.trim()) return dire('Écrivez votre message avant de l’envoyer.', message);
    envoyer.disabled = true;
    try {
      const r = await fetch('/api/demandes', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        type, nom: nom.value.trim(), entrepriseNom: entreprise.value.trim(), prestation: service.value.trim(), dateSouhaitee: dateSouhaitee.value.trim(), budget: budget.value.trim(), message: message.value.trim() }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'L’envoi a échoué. Réessayez dans un instant.');
      form.hidden = true; merci.hidden = false; message.value = ''; fermer.focus();
    } catch (err) { dire(err.message); }
    finally { envoyer.disabled = false; }
  });
})();
