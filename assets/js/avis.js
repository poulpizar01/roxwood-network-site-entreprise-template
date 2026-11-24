/* VITRINE (module « avis ») — page « Tous les avis » : liste paginée (GET /api/avis?page=N, numéro gardé dans l'adresse pour
   rester partageable) et dépôt d'un avis. Déposer exige une connexion Discord (vérification légère du socle,
   /api/discord/…) : sans elle, le formulaire reste caché. Tout texte arrive par textContent. */
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, classe, texte) => { const n = document.createElement(tag); if (classe) n.className = classe; if (texte !== undefined) n.textContent = texte; return n; };
  const NS = 'http://www.w3.org/2000/svg';
  const ETOILE = 'M10 1l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L10 14.9 4.4 18l1.4-6.2L1 7.5l6.4-.6z';
  function etoiles(note) {
    const d = el('div', 'etoiles'); d.setAttribute('role', 'img'); d.setAttribute('aria-label', `${note} sur 5`);
    for (let n = 1; n <= 5; n++) {
      const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', n <= note ? 'est-pleine' : 'est-vide');
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ETOILE); s.append(p); d.append(s);
    }
    return d;
  }
  function carte(a) {
    const c = el('article', `avis-carte${a.epingle ? ' avis-carte--epingle' : ''}`);
    if (a.epingle) c.append(el('p', 'avis-carte__label', 'Avis mis en avant'));
    c.append(etoiles(a.note), el('p', 'avis-carte__texte', `« ${a.texte} »`));
    const auteur = el('p', 'avis-carte__auteur', a.nom);
    auteur.append(el('span', '', `${a.entreprise ? `${a.entreprise} · ` : ''}${new Date(a.creeLe).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`));
    c.append(auteur);
    return c;
  }

  // ---- liste paginée ----
  let page = Math.max(1, Number(new URLSearchParams(location.search).get('page')) || 1);
  async function charger(n) {
    try {
      const r = await (await fetch(`/api/avis?page=${n}`)).json();
      page = r.page;
      $('avis-liste').replaceChildren(...(r.avis.length ? r.avis.map(carte) : [el('p', 'avis-vide', 'Aucun avis publié pour le moment.')]));
      $('avis-compte').textContent = r.total ? `${r.total} avis publié${r.total > 1 ? 's' : ''}, vérifiés avant mise en ligne.` : '';
      $('avis-pagination').hidden = r.totalPages <= 1;
      $('avis-page-texte').textContent = `Page ${r.page} sur ${r.totalPages}`;
      $('avis-precedente').disabled = r.page <= 1;
      $('avis-suivante').disabled = r.page >= r.totalPages;
      history.replaceState(null, '', r.page > 1 ? `?page=${r.page}` : location.pathname);
    } catch { $('avis-liste').replaceChildren(el('p', 'avis-vide', 'Avis indisponibles pour le moment.')); }
  }
  $('avis-precedente').addEventListener('click', () => charger(page - 1));
  $('avis-suivante').addEventListener('click', () => charger(page + 1));
  charger(page);

  // ---- dépôt : connexion Discord, puis formulaire ----
  const retour = new URLSearchParams(location.search).get('discord');
  if (retour) {
    const p = new URLSearchParams(location.search); p.delete('discord');
    history.replaceState(null, '', location.pathname + (p.toString() ? `?${p}` : ''));
  }
  const message = (texte) => { $('avis-message').textContent = texte; $('avis-message').hidden = !texte; };
  function afficherIdentite(discord) {
    $('avis-discord-bloc').hidden = !!discord;
    $('avis-formulaire').hidden = !discord;
    $('avis-erreur-discord').hidden = !!discord || retour !== 'erreur';
    if (discord) { $('avis-pseudo').textContent = discord.pseudo; if (!$('av-nom').value) $('av-nom').value = discord.pseudo; }
  }
  fetch('/api/discord/moi', { credentials: 'same-origin' }).then(r => r.json()).then(r => afficherIdentite(r.discord)).catch(() => afficherIdentite(null));
  if (retour === 'ok') $('donner').scrollIntoView();

  $('avis-changer').addEventListener('click', async () => {
    await fetch('/api/discord/oublier', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.href = $('avis-connecter').href;
  });
  $('avis-formulaire').addEventListener('submit', async e => {
    e.preventDefault();
    message('');
    const corps = {
      nom: $('av-nom').value.trim(), entreprise: $('av-entreprise').value.trim(),
      note: Number(document.querySelector('input[name="note"]:checked')?.value), texte: $('av-texte').value.trim(),
    };
    if (!corps.nom) { message('Indiquez le nom à afficher.'); $('av-nom').focus(); return; }
    if (!corps.texte) { message('Écrivez votre avis avant de l’envoyer.'); $('av-texte').focus(); return; }
    const bouton = e.submitter; if (bouton) bouton.disabled = true;
    try {
      const r = await fetch('/api/avis', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'L’envoi a échoué. Réessayez dans un instant.');
      $('avis-formulaire').hidden = true; $('avis-merci').hidden = false;
    } catch (err) { message(err.message); if (bouton) bouton.disabled = false; }
  });
})();
