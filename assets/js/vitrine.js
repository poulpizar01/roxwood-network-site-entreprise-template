/* VITRINE — fiche « Découvrir » d'un service. Les cartes et les postes ouverts sont déjà dans le HTML (rendus par le serveur,
   server/src/entreprise/routes/vitrine.ts) : ce script n'ajoute rien à la page, il n'ouvre que la fiche. Tout texte
   arrive par textContent. */
(() => {
  const donnees = document.getElementById('vitrine-services');
  if (!donnees) return;
  let services;
  try { services = JSON.parse(donnees.textContent); } catch { return; }
  const el = (tag, classe, texte) => { const n = document.createElement(tag); if (classe) n.className = classe; if (texte !== undefined) n.textContent = texte; return n; };

  // couleur d'une étiquette : posée par script (un attribut style en ligne est refusé par la CSP) ; seul le point de couleur change
  document.querySelectorAll('.etiquette[data-couleur]').forEach(n => n.style.setProperty('--etiquette', n.dataset.couleur));
  const etiquettes = liste => {
    const p = el('p', 'etiquettes');
    liste.forEach(t => { const n = el('span', 'etiquette', t.nom); if (/^#[0-9a-f]{6}$/i.test(t.couleur)) n.style.setProperty('--etiquette', t.couleur); p.append(n); });
    return p;
  };

  // fiche : <dialog> natif (focus piégé, Échap, fond inerte) ; le focus revient au bouton qui l'a ouverte
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
  document.querySelectorAll('[data-service]').forEach(b => b.addEventListener('click', () => ouvrir(services[Number(b.dataset.service)], b)));
})();
