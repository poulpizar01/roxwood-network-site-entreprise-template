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
    if (p) p.hidden = !afficher;
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
  erreurChampFr(input, 'Date invalide : écrivez-la jj/mm/aaaa, par exemple 06/10/2026.');
  ajouterSelecteurDate(input);
}

// ---- sélecteur de date (calendrier flottant) : posé sur un champ texte jj/mm/aaaa (opère sur le texte affiché, pas
// sur .value — fonctionne donc aussi bien avec champDateFr, qui réécrit .value en ISO, qu'avec un champ texte brut
// comme ecriture-dot-date). La saisie au clavier reste possible : le calendrier n'est qu'une aide, jamais obligatoire.
// Même discipline qu'une fenêtre (docs/design.md) : focus dedans à l'ouverture, Tab qui y boucle, Échap qui ferme,
// focus rendu au bouton. Position « fixed », comme ameliorerSelect() : un parent avec overflow:hidden (modale) ne
// la tronquerait pas.
const ICONE_DATE = '<svg class="champ-date-icone" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const ICONE_DATE_NAV = '<svg class="champ-date-icone" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const JOURS_COURTS_DATE = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
let DATE_OUVERTE = null;   // { panneau, bouton, dernierFocus, surClavier }
function fermerDateOuverte() {
  if (!DATE_OUVERTE) return;
  const { panneau, bouton, dernierFocus, surClavier } = DATE_OUVERTE;
  panneau.remove();
  bouton.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', surClavier, true);
  DATE_OUVERTE = null;
  (dernierFocus || bouton).focus({ preventScroll: true });
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
  bouton.innerHTML = ICONE_DATE;
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
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fermerDateOuverte(); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); deplacerFocus(1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); deplacerFocus(-1); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); deplacerFocus(7); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); deplacerFocus(-7); }
    else if (ev.key === 'Tab') {
      ev.stopPropagation();
      const items = Array.from(panneau.querySelectorAll('button'));
      const premier = items[0], dernier = items[items.length - 1];
      if (ev.shiftKey && document.activeElement === premier) { ev.preventDefault(); dernier.focus(); }
      else if (!ev.shiftKey && document.activeElement === dernier) { ev.preventDefault(); premier.focus(); }
    }
  }

  function positionner() {
    const r = input.getBoundingClientRect();
    const visible = document.documentElement.clientWidth;
    const largeur = Math.min(272, visible - 16);
    const gauche = r.left + largeur <= visible - 8 ? r.left : r.right - largeur;
    panneau.style.left = Math.round(Math.max(8, Math.min(gauche, visible - largeur - 8))) + 'px';
    panneau.style.width = largeur + 'px';
    const hauteur = panneau.getBoundingClientRect().height;
    const bas = r.bottom + 6;
    const haut = r.top - hauteur - 6;
    const y = bas + hauteur > innerHeight - 8 && haut >= 8 ? haut : bas;
    panneau.style.top = Math.round(Math.max(8, Math.min(y, innerHeight - hauteur - 8))) + 'px';
  }

  function ouvrir() {
    fermerDateOuverte();
    if (typeof fermerSelectOuvert === 'function') fermerSelectOuvert();
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
        <button type="button" class="champ-date-nav" data-nav="-1" aria-label="Mois précédent">${ICONE_DATE_NAV}</button>
        <span class="champ-date-titre"></span>
        <button type="button" class="champ-date-nav champ-date-nav--apres" data-nav="1" aria-label="Mois suivant">${ICONE_DATE_NAV}</button>
      </div>
      <div class="champ-date-jours" aria-hidden="true">${JOURS_COURTS_DATE.map(j => `<span>${j}</span>`).join('')}</div>
      <div class="champ-date-grille" role="grid"></div>
      <button type="button" class="champ-date-aujourdhui">Aujourd’hui</button>`;
    // un <dialog> ouvert en showModal() passe au-dessus de tout (aucun z-index n'y change rien) : le calendrier s'y attache
    (input.closest('dialog[open]') || document.body).appendChild(panneau);
    construire();
    panneau.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => { moisAffiche.setMonth(moisAffiche.getMonth() + Number(b.dataset.nav)); construire(); }));
    panneau.querySelector('.champ-date-aujourdhui').addEventListener('click', () => { ecrireValeur(new Date()); fermerDateOuverte(); });
    positionner();
    bouton.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', surClavier, true);
    DATE_OUVERTE = { panneau, bouton, dernierFocus, surClavier };
    (panneau.querySelector('.champ-date-case--active, .champ-date-case--aujourdhui') || panneau.querySelector('[data-jour]'))?.focus({ preventScroll: true });
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
