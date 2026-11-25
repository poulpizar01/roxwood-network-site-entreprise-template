/* VITRINE — liste déroulante habillée : même composant que l'espace de gestion (ameliorerSelect, gestion/gestion.js), version publique.
   Un <select> natif ne se stylise pas (sa liste reste grise, à la police du système) : ameliorerSelect() l'habille. Le <select> reste dans la
   page (clavier, vraie valeur) ; son ouverture affiche une liste flottante aux couleurs du site. Un seul menu ouvert à la fois. Dans une
   fenêtre <dialog> ouverte (showModal), la liste s'y attache : un dialog modal passe au-dessus de tout, aucun z-index n'y change rien. */
(() => {
  let ouvert = null;   // { select, flottant, enveloppe }
  function fermer() {
    if (ouvert) { ouvert.flottant.hidden = true; ouvert.enveloppe.classList.remove('ouvert'); ouvert = null; }
  }
  document.addEventListener('mousedown', ev => { if (ouvert && !ouvert.flottant.contains(ev.target) && ev.target !== ouvert.select) fermer(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && ouvert) { ev.preventDefault(); ev.stopPropagation(); fermer(); } }, true);
  addEventListener('resize', fermer);
  // en capture pour voir le défilement d'un conteneur (la fenêtre de dépôt défile) ; celui de la liste elle-même ne la ferme pas
  addEventListener('scroll', ev => { if (ouvert && ouvert.flottant.contains(ev.target)) return; fermer(); }, true);

  window.ameliorerSelect = function ameliorerSelect(select) {
    if (!select || select.dataset.ameliore) return;
    select.dataset.ameliore = '1';
    const enveloppe = document.createElement('span');
    enveloppe.className = 'liste-enveloppe';
    select.parentNode.insertBefore(enveloppe, select);
    enveloppe.appendChild(select);
    const flottant = document.createElement('div');
    flottant.className = 'liste-flottante';
    flottant.hidden = true;
    const zone = document.createElement('div');
    zone.className = 'liste-options';
    zone.setAttribute('role', 'listbox');
    flottant.appendChild(zone);

    function rendre() {
      zone.replaceChildren(...Array.from(select.options).map(o => {
        const d = document.createElement('div');
        d.className = `liste-option${o.value === select.value ? ' selectionnee' : ''}${o.disabled ? ' desactivee' : ''}`;
        d.dataset.valeur = o.value;
        d.setAttribute('role', 'option');
        d.setAttribute('aria-selected', String(o.value === select.value));
        d.textContent = o.textContent;
        d.addEventListener('mousedown', ev => {
          ev.preventDefault(); ev.stopPropagation();
          if (o.disabled) return;
          if (select.value !== o.value) { select.value = o.value; select.dispatchEvent(new Event('change', { bubbles: true })); }
          fermer();
        });
        return d;
      }));
    }
    function positionner() {
      const r = select.getBoundingClientRect();
      const hauteur = Math.min(select.options.length * 34 + 12, 260);
      const visible = document.documentElement.clientWidth, largeur = Math.round(r.width);
      let gauche = Math.round(r.left);
      if (gauche + largeur > visible - 8) gauche = Math.round(r.right) - largeur;
      flottant.style.left = Math.max(8, Math.min(gauche, visible - largeur - 8)) + 'px';
      flottant.style.width = largeur + 'px';
      // près du bas de la fenêtre, la liste s'ouvre vers le haut
      flottant.style.top = (r.bottom + hauteur > innerHeight && r.top > hauteur ? Math.round(r.top - hauteur - 6) : Math.round(r.bottom + 6)) + 'px';
    }
    function ouvrir() {
      if (select.disabled) return;
      fermer();
      (select.closest('dialog[open]') || document.body).appendChild(flottant);
      rendre(); positionner();
      flottant.hidden = false;
      enveloppe.classList.add('ouvert');
      ouvert = { select, flottant, enveloppe };
    }
    select.addEventListener('mousedown', ev => {
      ev.preventDefault();
      select.focus();
      if (ouvert && ouvert.select === select) fermer(); else ouvrir();
    });
    select.addEventListener('blur', () => { setTimeout(() => { if (ouvert && ouvert.select === select) fermer(); }, 120); });
    select.addEventListener('keydown', ev => {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(ev.key)) { ev.preventDefault(); if (!(ouvert && ouvert.select === select)) ouvrir(); }
    });
  };
})();
