/* VITRINE — services et postes ouverts de la page d'accueil, lus dans la base (gestion → Vitrine). Module « vitrine » de
   site.json : éteint, rien n'est demandé et les sections restent cachées. Tout texte arrive par textContent. */
(() => {
  const modules = (document.querySelector('meta[name="modules"]')?.content || '').split(' ');
  if (!modules.includes('vitrine')) return;
  const el = (tag, classe, texte) => { const n = document.createElement(tag); if (classe) n.className = classe; if (texte !== undefined) n.textContent = texte; return n; };
  const montrer = attribut => document.querySelectorAll(`[${attribut}]`).forEach(n => { n.hidden = false; });
  const lire = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));

  function etiquette(t) {
    const n = el('span', 'etiquette', t.nom);
    if (/^#[0-9a-f]{6}$/i.test(t.couleur)) n.style.setProperty('--etiquette', t.couleur);
    return n;
  }
  const etiquettes = liste => { const p = el('p', 'etiquettes'); liste.forEach(t => p.append(etiquette(t))); return p; };

  // fiche d'un service : <dialog> natif (focus piégé, Échap, fond inerte) ; le focus revient au bouton qui l'a ouverte
  const dialogue = el('dialog', 'fiche-service');
  dialogue.setAttribute('aria-labelledby', 'fiche-service-titre');
  document.body.append(dialogue);
  dialogue.addEventListener('click', e => { if (e.target === dialogue) dialogue.close(); });   // clic sur le fond
  function ouvrir(s, declencheur) {
    dialogue.replaceChildren();
    if (s.urlPhoto) { const img = el('img', 'fiche-service__photo'); img.src = s.urlPhoto; img.alt = ''; dialogue.append(img); }
    const corps = el('div', 'fiche-service__corps');
    const titre = el('h3', '', s.nom); titre.id = 'fiche-service-titre';
    corps.append(titre);
    if (s.etiquettes.length) corps.append(etiquettes(s.etiquettes));
    if (s.description) corps.append(el('p', '', s.description));
    if (s.inclus.length) { const ul = el('ul', 'fiche-service__inclus'); s.inclus.forEach(p => ul.append(el('li', '', p))); corps.append(ul); }
    const fermer = el('button', 'btn btn--ligne', 'Fermer'); fermer.type = 'button'; fermer.addEventListener('click', () => dialogue.close());
    corps.append(fermer);
    dialogue.append(corps);
    dialogue.addEventListener('close', () => declencheur.focus(), { once: true });
    dialogue.showModal();
  }

  lire('/api/services/public').then(({ services }) => {
    if (!services.length) return;
    const liste = document.getElementById('services-liste');
    for (const s of services) {
      const carte = el('article', 'carte carte--service');
      if (s.urlPhoto) { const img = el('img', 'carte__photo'); img.src = s.urlPhoto; img.alt = ''; img.loading = 'lazy'; img.width = 340; img.height = 191; carte.append(img); }
      carte.append(el('h3', '', s.nom));
      if (s.resume) carte.append(el('p', '', s.resume));
      if (s.etiquettes.length) carte.append(etiquettes(s.etiquettes));
      if (s.description || s.inclus.length) {
        const b = el('button', 'btn btn--ligne', 'Découvrir'); b.type = 'button';
        b.setAttribute('aria-label', `Découvrir : ${s.nom}`);
        b.addEventListener('click', () => ouvrir(s, b));
        carte.append(b);
      }
      liste.append(carte);
    }
    montrer('data-si-services');
  }).catch(() => {});

  lire('/api/postes/public').then(({ postes }) => {
    if (!postes.length) return;
    const ul = document.getElementById('postes-liste');
    for (const p of postes) { const li = el('li', 'poste'); li.append(el('strong', '', p.nom), el('span', 'poste__places', `${p.nombre} place${p.nombre > 1 ? 's' : ''}`)); ul.append(li); }
    montrer('data-si-postes');
  }).catch(() => {});
})();
