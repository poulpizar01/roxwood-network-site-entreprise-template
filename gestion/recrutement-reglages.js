/* GESTION — Réglages du recrutement (Employés → Réglages du recrutement), permission « rh-parametrer » : d'où viennent les candidatures
   (le bot Discord OU le site, jamais les deux) ; en mode bot, la fiche créée à l'acceptation (tableau du bot, rh.js) ; en mode site : 1. la
   fiche (grade, champs demandés au candidat), 2. les pièces jointes demandées, 3. le formulaire dans l'ordre — toutes les questions, celles de la
   fiche comprises, réordonnées au glisser-déposer. Un seul « Enregistrer » pour 1 et 2 ; l'ordre et les autres questions s'enregistrent d'eux-mêmes.
   Serveur : entreprise/routes/candidatures.ts. rh.js l'appelle : window.recrutementReglages.init(grades, reglages). */
(() => {
  const $q = id => document.getElementById(id);
  let R = null;            // réglages reçus du serveur (null : module « recrutement » éteint, seul le bot existe)
  let MODE = 'bot';        // mode enregistré
  let MODE_CHOISI = 'bot'; // mode choisi à l'écran (pas encore enregistré)
  let QUESTIONS = [], PIECES = [];
  const TYPES = { court: 'réponse courte', long: 'réponse longue' };
  const MODES_CHAMP = [['aucun', 'Pas demandé'], ['facultatif', 'Demandé, facultatif'], ['obligatoire', 'Demandé, obligatoire']];
  const POIGNEE = '<svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.6"/><circle cx="9" cy="3" r="1.6"/><circle cx="3" cy="9" r="1.6"/><circle cx="9" cy="9" r="1.6"/><circle cx="3" cy="15" r="1.6"/><circle cx="9" cy="15" r="1.6"/></svg>';

  // ---- mode : ce qui s'affiche suit le choix (le formulaire du site et le tableau du bot ne se montrent jamais ensemble) ----
  function afficherMode() {
    document.querySelectorAll('[data-recrutement-mode]').forEach(b => { const actif = b.dataset.recrutementMode === MODE_CHOISI; b.classList.toggle('actif', actif); b.setAttribute('aria-checked', String(actif)); b.tabIndex = actif ? 0 : -1; });
    $q('rh-bot-details').classList.toggle('cache', MODE_CHOISI !== 'bot');
    $q('formulaire-recrutement-reglages').classList.toggle('cache', MODE_CHOISI !== 'site');
  }
  document.querySelectorAll('[data-recrutement-mode]').forEach(b => b.addEventListener('click', () => { MODE_CHOISI = b.dataset.recrutementMode; afficherMode(); }));

  // ---- 3. le formulaire dans l'ordre ----
  const ligneFixe = (texte, detail) => `<div class="question-ligne question-ligne--fixe"><span class="question-poignee question-poignee--verrou" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span><span class="question-texte">${texte} <small>${detail}</small></span></div>`;
  function dessinerQuestions() {
    $q('recrutement-questions-haut').innerHTML = ligneFixe('Prénom, Nom, Poste visé', 'toujours en tête');
    $q('recrutement-questions-bas').innerHTML = ligneFixe(PIECES.length ? `Pièces jointes (${PIECES.map(p => echapper(p.libelle || 'sans nom')).join(', ')})` : 'Pièces jointes', PIECES.length ? 'toujours à la fin' : 'aucune demandée');
    // aperçu : les listes de l'étape 1 se lisent ici tout de suite, sans enregistrer (une ligne « à enregistrer » n'est pas encore déplaçable)
    const choisi = c => document.querySelector(`[data-champ-fiche="${c}"]`)?.value;
    const lignes = QUESTIONS.map(q => {
      const m = q.champFiche ? choisi(q.champFiche) : null;
      if (!['aucun', 'facultatif', 'obligatoire'].includes(m)) return { q, etat: '' };
      if (m === 'aucun') return { q, etat: 'retiree' };
      return { q: { ...q, obligatoire: m === 'obligatoire' }, etat: (m === 'obligatoire') !== q.obligatoire ? 'modifiee' : '' };
    });
    const nouvelles = [['telephone', 'Téléphone'], ['rib', 'RIB'], ['idUnique', 'ID Unique']]
      .filter(([c]) => ['facultatif', 'obligatoire'].includes(choisi(c)) && !QUESTIONS.some(q => q.champFiche === c))
      .map(([c, libelle]) => ({ q: { id: null, libelle, type: 'court', champFiche: c, obligatoire: choisi(c) === 'obligatoire' }, etat: 'nouvelle' }));
    const ETATS = { retiree: 'Sera retirée à l’enregistrement', modifiee: 'Modifiée, à enregistrer', nouvelle: 'Ajoutée, à enregistrer' };
    const ligne = ({ q, etat }) => `<li class="question-ligne${etat ? ` question-ligne--${etat}` : ''}"${q.id ? ` data-id="${q.id}"` : ''}>
      ${q.id ? `<button type="button" class="question-poignee" data-poignee aria-label="Déplacer « ${echapper(q.libelle)} » (flèches haut et bas)">${POIGNEE}</button>` : '<span class="question-poignee question-poignee--verrou" aria-hidden="true"></span>'}
      <span class="question-texte"><strong>${echapper(q.libelle)}</strong> <small>${q.champFiche ? 'champ de la fiche' : TYPES[q.type]} · ${q.obligatoire ? 'obligatoire' : 'facultative'}</small></span>
      ${etat ? `<span class="puce puce-or">${ETATS[etat]}</span>` : q.champFiche ? '<span class="puce puce-or">Champ de la fiche</span><small class="question-regle">Réglée à l’étape 1</small>' : `<button type="button" class="btn btn-fantome btn-petit" data-modifier="${q.id}">Modifier</button>`}
    </li>`;
    const toutes = [...lignes, ...nouvelles];
    $q('recrutement-questions').innerHTML = toutes.length ? toutes.map(ligne).join('') : '<li class="comptes-vide">Aucune question : le candidat ne renseigne que son prénom, son nom et le poste. Ajoutez-en une, ou demandez un champ de la fiche à l’étape 1.</li>';
  }
  document.querySelectorAll('[data-champ-fiche]').forEach(s => s.addEventListener('change', dessinerQuestions));
  let ordreEnAttente = null;
  function ordreActuel() { return [...$q('recrutement-questions').querySelectorAll('[data-id]')].map(li => Number(li.dataset.id)); }
  function enregistrerOrdre() {   // un déplacement s'enregistre seul (légèrement différé : plusieurs flèches de suite = un seul envoi)
    clearTimeout(ordreEnAttente);
    ordreEnAttente = setTimeout(async () => {
      try { QUESTIONS = (await socle.api('/api/candidatures/questions/ordre', { method: 'PUT', body: { ids: ordreActuel() } })).questions; }
      catch (e) { gestion.message('zone-message-recrutement-reglages', e.message); await recharger(); }
    }, 350);
  }
  function brancherOrdre() {
    if (typeof Sortable !== 'undefined') Sortable.create($q('recrutement-questions'), { handle: '[data-poignee]', draggable: '[data-id]', animation: 150, ghostClass: 'question-ligne--fantome', onEnd: enregistrerOrdre });
    // au clavier : la poignée prend le focus, les flèches haut et bas déplacent la ligne (annoncé aux lecteurs d'écran)
    $q('recrutement-questions').addEventListener('keydown', e => {
      const poignee = e.target.closest('[data-poignee]');
      if (!poignee || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const li = poignee.closest('[data-id]'), voisin = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
      if (!voisin?.dataset.id) return;
      if (e.key === 'ArrowUp') voisin.before(li); else voisin.after(li);
      poignee.focus();
      const ids = ordreActuel();
      $q('annonce-ordre-questions').textContent = `« ${li.querySelector('strong').textContent} » : position ${ids.indexOf(Number(li.dataset.id)) + 1} sur ${ids.length}.`;
      enregistrerOrdre();
    });
  }

  // ---- 2. pièces jointes demandées ----
  function dessinerPieces() {
    $q('recrutement-pieces-compte').textContent = `· ${PIECES.length} sur ${R.piecesMax}`;
    $q('bouton-ajouter-piece').disabled = PIECES.length >= R.piecesMax;
    $q('recrutement-pieces').innerHTML = PIECES.length ? `<div class="piece-ligne piece-ligne--entete"><span>Libellé</span><span>Demandée</span><span>Sur la fiche</span><span></span></div>`
      + PIECES.map((p, i) => `<div class="piece-ligne" data-piece="${i}">
        <input type="text" maxlength="80" value="${echapper(p.libelle)}" aria-label="Libellé de la pièce ${i + 1}" data-piece-libelle>
        <select aria-label="Pièce ${i + 1} demandée" data-piece-obligatoire><option value="oui"${p.obligatoire ? ' selected' : ''}>Obligatoire</option><option value="non"${p.obligatoire ? '' : ' selected'}>Facultative</option></select>
        <label class="piece-fiche"><input type="radio" name="piece-fiche" ${p.versFiche ? 'checked' : ''} data-piece-fiche> Va sur la fiche</label>
        <button type="button" class="actions-icone" data-piece-retirer aria-label="Retirer la pièce ${echapper(p.libelle || String(i + 1))}">${gestion.ico('trash')}</button>
      </div>`).join('') : '<p class="comptes-vide">Aucune pièce jointe demandée : le candidat n’envoie aucun fichier.</p>';
    nettoyerSelectsPortee('pieces');   // les listes flottantes de l'affichage précédent
    $q('recrutement-pieces').querySelectorAll('select').forEach(sel => ameliorerSelect(sel, null, 'pieces'));
    dessinerQuestions();   // la ligne « pièces jointes » du formulaire suit
  }
  // saisie directe : on garde le tableau PIECES à jour sans tout redessiner (le curseur resterait en place)
  $q('recrutement-pieces').addEventListener('input', e => { const l = e.target.closest('[data-piece]'); if (l && e.target.matches('[data-piece-libelle]')) { PIECES[Number(l.dataset.piece)].libelle = e.target.value; dessinerQuestions(); } });
  $q('recrutement-pieces').addEventListener('change', e => {
    const l = e.target.closest('[data-piece]'); if (!l) return;
    const i = Number(l.dataset.piece);
    if (e.target.matches('[data-piece-obligatoire]')) PIECES[i].obligatoire = e.target.value === 'oui';
    if (e.target.matches('[data-piece-fiche]')) PIECES.forEach((p, k) => { p.versFiche = k === i; });
  });
  $q('recrutement-pieces').addEventListener('click', e => {
    const retirer = e.target.closest('[data-piece-retirer]');
    if (!retirer) return;
    PIECES.splice(Number(retirer.closest('[data-piece]').dataset.piece), 1);
    dessinerPieces();
  });
  $q('bouton-ajouter-piece').addEventListener('click', () => {
    if (PIECES.length >= R.piecesMax) return;
    PIECES.push({ libelle: '', obligatoire: true, versFiche: !PIECES.some(p => p.versFiche) && PIECES.length === 0 });
    dessinerPieces();
    $q('recrutement-pieces').querySelector('[data-piece]:last-child [data-piece-libelle]').focus();
  });

  // ---- éditeur d'une « autre question » (fenêtre) ----
  let EN_EDITION = null, OUVREUR = null;
  function ouvrirQuestion(q) {
    EN_EDITION = q || null;
    gestion.message('zone-message-modale-question', '');
    $q('modale-question-titre').textContent = q ? 'Modifier la question' : 'Nouvelle question';
    $q('question-libelle').value = q?.libelle || '';
    $q('question-type').value = q?.type || 'court';
    $q('question-obligatoire').checked = q ? q.obligatoire : true;
    $q('question-enregistrer').textContent = q ? 'Enregistrer' : 'Ajouter';
    $q('question-supprimer').classList.toggle('cache', !q);
    OUVREUR = document.activeElement;
    $q('modale-question').classList.remove('cache');
    $q('question-libelle').focus();
  }
  const fermerQuestion = () => { $q('modale-question').classList.add('cache'); if (OUVREUR?.isConnected) OUVREUR.focus(); };
  $q('bouton-ajouter-question').addEventListener('click', () => ouvrirQuestion(null));
  $q('recrutement-questions').addEventListener('click', e => { const m = e.target.closest('[data-modifier]'); if (m) ouvrirQuestion(QUESTIONS.find(q => q.id === Number(m.dataset.modifier))); });
  $q('fermer-modale-question').addEventListener('click', fermerQuestion);
  $q('modale-question').addEventListener('click', e => { if (e.target.id === 'modale-question') fermerQuestion(); });
  $q('formulaire-question').addEventListener('submit', async e => {
    e.preventDefault();
    const corps = { libelle: $q('question-libelle').value.trim(), type: $q('question-type').value, obligatoire: $q('question-obligatoire').checked };
    try {
      EN_EDITION
        ? await socle.api(`/api/candidatures/questions/${EN_EDITION.id}`, { method: 'PUT', body: corps })
        : await socle.api('/api/candidatures/questions', { method: 'POST', body: corps });
      fermerQuestion(); gestion.notifier(EN_EDITION ? 'Question enregistrée ✓' : 'Question ajoutée ✓');
      await recharger();
    } catch (err) { gestion.message('zone-message-modale-question', err.message); }
  });
  $q('question-supprimer').addEventListener('click', async () => {
    if (!EN_EDITION) return;
    if (!await gestion.confirmer('Les candidatures déjà reçues gardent leur réponse à cette question.', `Supprimer la question « ${EN_EDITION.libelle} » ?`, 'Supprimer la question', { danger: true })) return;
    try { await socle.api(`/api/candidatures/questions/${EN_EDITION.id}`, { method: 'DELETE' }); fermerQuestion(); gestion.notifier('Question supprimée ✓'); await recharger(); }
    catch (err) { gestion.message('zone-message-modale-question', err.message); }
  });

  // ---- enregistrer : le mode, puis (mode site) le grade, les champs de la fiche et les pièces ----
  $q('formulaire-recrutement-reglages').addEventListener('submit', async e => {
    e.preventDefault();
    gestion.message('zone-message-recrutement-reglages', '');
    if (MODE_CHOISI !== MODE && !await gestion.confirmer(
      MODE_CHOISI === 'site' ? 'Le formulaire du site s’ouvre, et les candidatures acceptées sur Discord ne créent plus de fiche.' : 'Le formulaire du site se ferme, et les candidatures acceptées sur Discord créent de nouveau une fiche. Les candidatures déjà reçues du site restent consultables jusqu’à leur effacement.',
      MODE_CHOISI === 'site' ? 'Passer le recrutement sur le site ?' : 'Repasser le recrutement sur le bot Discord ?', 'Changer', { danger: false })) return;
    const champsFiche = Object.fromEntries([...document.querySelectorAll('[data-champ-fiche]')].map(s => [s.dataset.champFiche, s.value]));
    const corps = { gradeArrivee: $q('recrutement-grade').value, champsFiche, pieces: PIECES, mode: MODE_CHOISI };
    try {
      await socle.api('/api/candidatures/reglages', { method: 'PUT', body: corps });
      if (MODE_CHOISI !== MODE) { location.hash = 'reglages'; location.reload(); return; }
      gestion.notifier('Réglages enregistrés ✓');
      await recharger();
    } catch (err) { gestion.message('zone-message-recrutement-reglages', err.message); }
  });

  function appliquer(reglages) {
    R = reglages; MODE = reglages.mode; PIECES = reglages.pieces.map(p => ({ ...p })); QUESTIONS = reglages.questions;
    $q('recrutement-grade').value = reglages.gradeArrivee || '';
    document.querySelectorAll('[data-champ-fiche]').forEach(s => { s.value = reglages.champsFiche[s.dataset.champFiche]; s.dispatchEvent(new Event('change')); });
    dessinerPieces(); dessinerQuestions();
  }
  async function recharger() { appliquer(await socle.api('/api/candidatures/reglages')); }

  // rh.js : init(grades, reglages) une fois la coque dessinée ; reglages nul = module éteint (le bot seul)
  window.recrutementReglages = {
    init(grades, reglages) {
      if (!reglages) { $q('rh-bot-details').classList.remove('cache'); return; }
      $q('recrutement-origine').classList.remove('cache');
      $q('recrutement-grade').innerHTML = '<option value="">— À choisir —</option>' + grades.map(g => `<option value="${echapper(g.cle)}">${echapper(g.libelle)}</option>`).join('');
      document.querySelectorAll('[data-champ-fiche]').forEach(s => { s.innerHTML = MODES_CHAMP.map(([v, l]) => `<option value="${v}">${l}</option>`).join(''); });
      for (const s of [$q('recrutement-grade'), $q('question-type'), ...document.querySelectorAll('[data-champ-fiche]')]) ameliorerSelect(s);
      MODE_CHOISI = reglages.mode;
      appliquer(reglages); brancherOrdre(); afficherMode();
    },
  };
  // module éteint : rh.js appelle init(grades, null) ; le tableau du bot s'affiche alors seul
})();
