/* GESTION — réglages du recrutement (Employés → Recrutement → Réglages), permission « rh-parametrer » : d'où viennent les candidatures
   (le bot Discord OU le site, jamais les deux), grade donné aux arrivées, pièce d'identité du candidat, et questions du formulaire du
   site — chacune peut pré-remplir un champ de la fiche employé à l'acceptation. Serveur : entreprise/routes/candidatures.ts. rh.js
   l'appelle : window.recrutementReglages.init(grades). */
(() => {
  const $q = id => document.getElementById(id);
  let QUESTIONS = [], MODE = 'bot';
  const TYPES = { court: 'Réponse courte', long: 'Réponse longue', choix: 'À choix' };
  const FICHE = { telephone: 'Téléphone', rib: 'RIB', idUnique: 'ID Unique' };
  const modeCoche = () => document.querySelector('[name="recrutement-mode"]:checked')?.value || 'bot';

  function montrerSite() {
    const site = modeCoche() === 'site';
    $q('recrutement-reglages-site').classList.toggle('cache', !site);
    $q('recrutement-questions-bloc').classList.toggle('cache', !(site && MODE === 'site'));   // les questions se réglent une fois le site choisi et enregistré
  }

  // ---- liste des questions ----
  function dessinerQuestions() {
    const liste = $q('recrutement-questions');
    liste.innerHTML = QUESTIONS.length ? QUESTIONS.map((q, i) => `<li class="question-ligne">
      <button type="button" class="question-ouvrir" data-question="${q.id}" aria-label="Modifier la question « ${echapper(q.libelle)} »">
        <strong>${echapper(q.libelle)}</strong>
        <small>${TYPES[q.type]}${q.obligatoire ? ' · obligatoire' : ' · facultative'}${q.champFiche ? ` · remplit « ${FICHE[q.champFiche]} » de la fiche` : ''}</small>
      </button>
      <span class="question-ordre">
        <button type="button" class="actions-icone" data-monter="${q.id}" aria-label="Monter « ${echapper(q.libelle)} »" ${i === 0 ? 'disabled' : ''}>${gestion.ico('chevron')}</button>
        <button type="button" class="actions-icone question-descendre" data-descendre="${q.id}" aria-label="Descendre « ${echapper(q.libelle)} »" ${i === QUESTIONS.length - 1 ? 'disabled' : ''}>${gestion.ico('chevron')}</button>
      </span></li>`).join('')
      : '<li class="comptes-vide">Aucune question : le candidat ne renseigne que son prénom, son nom et le poste. Ajoutez-en une pour commencer.</li>';
  }
  async function appeler(requete, succes) {
    try { const r = await requete(); if (r?.questions) { QUESTIONS = r.questions; dessinerQuestions(); } if (succes) gestion.notifier(succes); return true; }
    catch (e) { gestion.message('zone-message-recrutement-reglages', e.message); return false; }
  }
  $q('recrutement-questions').addEventListener('click', async e => {
    const ouvrir = e.target.closest('[data-question]');
    if (ouvrir) { ouvrirQuestion(QUESTIONS.find(q => q.id === Number(ouvrir.dataset.question))); return; }
    const sens = e.target.closest('[data-monter]') ? -1 : e.target.closest('[data-descendre]') ? 1 : 0;
    if (!sens) return;
    const id = Number((e.target.closest('[data-monter]') || e.target.closest('[data-descendre]')).dataset[sens < 0 ? 'monter' : 'descendre']);
    const ids = QUESTIONS.map(q => q.id), i = ids.indexOf(id);
    [ids[i], ids[i + sens]] = [ids[i + sens], ids[i]];
    await appeler(() => socle.api('/api/candidatures/questions/ordre', { method: 'PUT', body: { ids } }));
  });

  // ---- éditeur d'une question ----
  let EN_EDITION = null, OUVREUR = null;
  function majChoix() { $q('question-champ-choix').classList.toggle('cache', $q('question-type').value !== 'choix'); }
  function ouvrirQuestion(q) {
    EN_EDITION = q || null;
    gestion.message('zone-message-modale-question', '');
    $q('modale-question-titre').textContent = q ? 'Modifier la question' : 'Nouvelle question';
    $q('question-libelle').value = q?.libelle || '';
    $q('question-type').value = q?.type || 'court';
    $q('question-fiche').value = q?.champFiche || '';
    $q('question-choix').value = (q?.choix || []).join('\n');
    $q('question-obligatoire').checked = q ? q.obligatoire : true;
    $q('question-enregistrer').textContent = q ? 'Enregistrer' : 'Ajouter';
    $q('question-supprimer').classList.toggle('cache', !q);
    for (const s of ['question-type', 'question-fiche']) $q(s).dispatchEvent(new Event('change'));
    majChoix();
    OUVREUR = document.activeElement;
    $q('modale-question').classList.remove('cache');
    $q('question-libelle').focus();
  }
  const fermerQuestion = () => { $q('modale-question').classList.add('cache'); if (OUVREUR?.isConnected) OUVREUR.focus(); };
  $q('bouton-ajouter-question').addEventListener('click', () => ouvrirQuestion(null));
  $q('fermer-modale-question').addEventListener('click', fermerQuestion);
  $q('annuler-modale-question').addEventListener('click', fermerQuestion);
  $q('modale-question').addEventListener('click', e => { if (e.target.id === 'modale-question') fermerQuestion(); });
  $q('question-type').addEventListener('change', majChoix);
  $q('formulaire-question').addEventListener('submit', async e => {
    e.preventDefault();
    const corps = { libelle: $q('question-libelle').value.trim(), type: $q('question-type').value, champFiche: $q('question-fiche').value || null, choix: $q('question-choix').value.split('\n'), obligatoire: $q('question-obligatoire').checked };
    try {
      const r = EN_EDITION
        ? await socle.api(`/api/candidatures/questions/${EN_EDITION.id}`, { method: 'PUT', body: corps })
        : await socle.api('/api/candidatures/questions', { method: 'POST', body: corps });
      QUESTIONS = r.questions; dessinerQuestions(); fermerQuestion();
      gestion.notifier(EN_EDITION ? 'Question enregistrée ✓' : 'Question ajoutée ✓');
    } catch (err) { gestion.message('zone-message-modale-question', err.message); }
  });
  $q('question-supprimer').addEventListener('click', async () => {
    if (!EN_EDITION) return;
    if (!await gestion.confirmer('Les candidatures déjà reçues gardent leur réponse à cette question.', `Supprimer la question « ${EN_EDITION.libelle} » ?`, 'Supprimer la question', { danger: true })) return;
    if (await appeler(() => socle.api(`/api/candidatures/questions/${EN_EDITION.id}`, { method: 'DELETE' }), 'Question supprimée ✓')) fermerQuestion();
  });

  // ---- réglages généraux ----
  document.querySelectorAll('[name="recrutement-mode"]').forEach(r => r.addEventListener('change', montrerSite));
  $q('formulaire-recrutement-reglages').addEventListener('submit', async e => {
    e.preventDefault();
    const mode = modeCoche();
    const corps = { mode, ...(mode === 'site' ? { piece: $q('recrutement-piece').value, gradeArrivee: $q('recrutement-grade').value } : {}) };
    if (mode !== MODE && !await gestion.confirmer(
      mode === 'site' ? 'Le formulaire du site s’ouvre, et les candidatures acceptées sur Discord ne créent plus de fiche.' : 'Le formulaire du site se ferme, et les candidatures acceptées sur Discord créent de nouveau une fiche. Les candidatures déjà reçues du site restent consultables jusqu’à leur effacement.',
      mode === 'site' ? 'Passer le recrutement sur le site ?' : 'Repasser le recrutement sur le bot Discord ?', 'Changer', { danger: false })) return;
    try {
      await socle.api('/api/candidatures/reglages', { method: 'PUT', body: corps });
      gestion.notifier('Réglages enregistrés ✓');
      if (mode !== MODE) { location.hash = 'recrutement'; location.reload(); return; }
    } catch (err) { gestion.message('zone-message-recrutement-reglages', err.message); }
  });

  // rh.js : init(grades, reglages) une fois la coque dessinée et les réglages lus
  window.recrutementReglages = {
    init(grades, reglages) {
      MODE = reglages.mode; QUESTIONS = reglages.questions;
      document.querySelector(`[name="recrutement-mode"][value="${MODE}"]`).checked = true;
      $q('recrutement-grade').innerHTML = `<option value="">— À choisir —</option>` + grades.map(g => `<option value="${echapper(g.cle)}">${echapper(g.libelle)}</option>`).join('');
      $q('recrutement-grade').value = reglages.gradeArrivee || '';
      $q('recrutement-piece').value = reglages.piece;
      ameliorerSelect($q('recrutement-grade')); ameliorerSelect($q('recrutement-piece'));
      ameliorerSelect($q('question-type')); ameliorerSelect($q('question-fiche'));
      dessinerQuestions(); montrerSite();
    },
  };
})();
