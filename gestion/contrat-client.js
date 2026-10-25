/* GESTION — espace public du client (gestion/contrat-client.html) : lien à jeton dans l'URL (?jeton=…), sans compte
   ni session. Le client colle la liste des membres de sa tablette (le serveur repère les noms et leur ID unique,
   aperçu avant ajout) ou ajoute une personne à la fois, retire qui il veut, puis enregistre la liste entière. Droits
   et limites revérifiés par le serveur (entreprise/contrats.ts, contrats-beneficiaires.ts) : l'interface ne fait que
   suivre. */

const $c = id => document.getElementById(id);
const JETON = new URLSearchParams(location.search).get('jeton');
const MAX = 50;
const SVG_RETIRER = '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
let ENREGISTREE = [];   // liste telle qu'enregistrée : [{ nom, idUnique }]
let LISTE = [];         // liste en cours de modification ; nouveau : ajoutée depuis le dernier enregistrement
let APERCU = [];        // personnes repérées dans le collage : [{ nom, idUnique, etat: 'nouvelle' | 'deja' | 'complete', coche }]
let MODIFIABLE = false;

// même comparaison que le serveur (cleNom) : sans casse, accents, ni tirets/espaces multiples
const cle = v => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-\s]+/g, ' ');
const jourFr = (iso, o = { weekday: 'long', day: 'numeric', month: 'long' }) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...o });
const texteModele = id => $c(id).content.textContent.trim();
const personnes = n => `${n} ${n > 1 ? 'personnes' : 'personne'}`;

// place d'une personne dans la liste : même règle que le serveur (dedoublonner) — une par ID ; sans ID, une par nom ;
// un nom sans ID qui retrouve le même nom avec ID est la même personne (la version avec ID la complète)
function situer(p, liste) {
  if (p.idUnique && liste.some(x => x.idUnique === p.idUnique)) return { etat: 'deja' };
  const memeNom = liste.findIndex(x => cle(x.nom) === cle(p.nom));
  if (memeNom < 0) return { etat: 'nouvelle' };
  if (p.idUnique && !liste[memeNom].idUnique) return { etat: 'complete', index: memeNom };
  return p.idUnique && liste[memeNom].idUnique ? { etat: 'nouvelle' } : { etat: 'deja' };   // deux ID différents : homonymes
}
function ajouter(p) {
  const s = situer(p, LISTE);
  if (s.etat === 'nouvelle') LISTE.push({ nom: p.nom, idUnique: p.idUnique ?? null, nouveau: true });
  else if (s.etat === 'complete') LISTE[s.index] = { ...LISTE[s.index], idUnique: p.idUnique };
  return s.etat;
}

// ---- état et enregistrement ----
const signature = l => JSON.stringify(l.map(p => [cle(p.nom), p.idUnique || '']).sort());
function bilan() {
  const avant = new Set(ENREGISTREE.map(p => `${cle(p.nom)}|${p.idUnique || ''}`)), apres = new Set(LISTE.map(p => `${cle(p.nom)}|${p.idUnique || ''}`));
  return { ajouts: [...apres].filter(x => !avant.has(x)).length, retraits: [...avant].filter(x => !apres.has(x)).length };
}
function majEtat() {
  const modifiee = signature(LISTE) !== signature(ENREGISTREE);
  $c('client-enregistrer').classList.toggle('cache', !MODIFIABLE || !modifiee);
  if (modifiee) {
    const { ajouts, retraits } = bilan();
    const parties = [ajouts ? `${ajouts} ${ajouts > 1 ? 'ajouts' : 'ajout'}` : '', retraits ? `${retraits} ${retraits > 1 ? 'retraits' : 'retrait'}` : ''].filter(Boolean);
    $c('client-etat').textContent = parties.length ? `${parties.join(', ')} non ${ajouts + retraits > 1 ? 'enregistrés' : 'enregistré'}` : 'Modifications non enregistrées';
  }
  $c('client-enregistree').textContent = !modifiee && MODIFIABLE && ENREGISTREE.length ? 'Liste enregistrée.' : '';
}

// ---- liste ----
function dessinerListe(focusApres) {
  const terme = cle($c('client-recherche').value);
  const ul = $c('liste-beneficiaires');
  $c('client-compteur').textContent = MODIFIABLE ? `${LISTE.length} / ${MAX}` : personnes(LISTE.length);   // la limite ne compte que si on peut encore ajouter
  $c('client-compteur').classList.toggle('client-compteur--plein', LISTE.length >= MAX);
  $c('client-recherche-zone').classList.toggle('cache', LISTE.length <= 10);
  const tries = LISTE.map((p, i) => ({ ...p, i })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
  const visibles = terme ? tries.filter(p => cle(p.nom).includes(terme) || p.idUnique === terme) : tries;
  ul.innerHTML = !LISTE.length
    ? `<li class="client-vide">${MODIFIABLE ? 'Personne pour le moment. Collez la liste de votre tablette ou ajoutez une personne ci-dessus.' : 'Aucune personne enregistrée.'}</li>`
    : !visibles.length ? '<li class="client-vide">Personne ne correspond à cette recherche.</li>'
    : visibles.map(p => `<li class="client-personne">
        <span class="client-personne-nom">${echapper(p.nom)}${p.nouveau ? ' <span class="puce puce-or">Nouveau</span>' : ''}</span>
        ${p.idUnique ? `<small>ID ${echapper(p.idUnique)}</small>` : ''}
        ${MODIFIABLE ? `<button type="button" class="client-retirer" data-retirer="${p.i}" aria-label="Retirer ${echapper(p.nom)}">${SVG_RETIRER}</button>` : ''}
      </li>`).join('');
  if (focusApres) (ul.querySelector('[data-retirer]') || $c('client-collage')).focus();
  majEtat();
}
$c('liste-beneficiaires').addEventListener('click', e => {
  const b = e.target.closest('[data-retirer]');
  if (!b) return;
  const p = LISTE[Number(b.dataset.retirer)];
  LISTE.splice(Number(b.dataset.retirer), 1);
  dessinerListe(true);
  gestion.notifier(`Retrait de ${p.nom} : pensez à enregistrer la liste`);
});
$c('client-recherche').addEventListener('input', () => dessinerListe());

$c('bouton-enregistrer').addEventListener('click', async () => {
  gestion.message('zone-message', '');
  try {
    await socle.api(`/api/contrats/acces/${JETON}`, { method: 'PUT', body: { beneficiaires: LISTE.map(({ nom, idUnique }) => ({ nom, idUnique })) } });
    await charger(true);
    gestion.notifier('Liste enregistrée ✓');
  } catch (e) {
    gestion.message('zone-message', `La liste n’a pas été enregistrée : ${e.message}`);
    $c('zone-message').scrollIntoView({ block: 'nearest' });
  }
});
$c('bouton-annuler-modifs').addEventListener('click', () => {
  LISTE = ENREGISTREE.map(p => ({ ...p }));
  dessinerListe();
  gestion.notifier('Modifications annulées');
});

// ---- ajout : une personne à la fois ----
$c('mode-une').addEventListener('submit', e => {
  e.preventDefault();
  gestion.message('zone-message-une', '');
  const nom = $c('client-nom').value.replace(/\s+/g, ' ').trim();
  const idUnique = $c('client-id').value.trim() || null;
  if (!nom) { gestion.message('zone-message-une', 'Écrivez le prénom et le nom de la personne.'); $c('client-nom').focus(); return; }
  if (!/^[\p{L}][\p{L}\p{M} .'’-]*$/u.test(nom)) { gestion.message('zone-message-une', 'Seuls les lettres, espaces, tirets et apostrophes sont acceptés.'); $c('client-nom').focus(); return; }
  if (idUnique && !/^\d{1,12}$/.test(idUnique)) { gestion.message('zone-message-une', 'L’ID Unique ne contient que des chiffres, par exemple 42.'); $c('client-id').focus(); return; }
  if (LISTE.length >= MAX) { gestion.message('zone-message-une', `La liste compte déjà ${MAX} personnes : retirez-en une pour en ajouter une autre.`); return; }
  const etat = ajouter({ nom, idUnique });
  if (etat === 'deja') { gestion.message('zone-message-une', `${nom} est déjà dans la liste.`); $c('client-nom').select(); return; }
  $c('client-nom').value = '';
  $c('client-id').value = '';
  $c('client-nom').focus();
  dessinerListe();
});

// ---- ajout : collage d'une tablette, aperçu avant ajout ----
const FORMATS = { entreprise: 'tablette entreprise', illegale: 'tablette famille', liste: 'liste de noms' };
async function analyser() {
  const texte = $c('client-collage').value;
  gestion.message('zone-message-apercu', '');
  if (!texte.trim()) { $c('client-apercu').classList.add('cache'); $c('client-collage').focus(); return; }
  try {
    const l = await socle.api(`/api/contrats/acces/${JETON}/analyser`, { method: 'POST', body: { texte } });
    APERCU = l.personnes.map(p => { const s = situer(p, LISTE); return { ...p, etat: s.etat, coche: s.etat !== 'deja' }; });
    const nouvelles = APERCU.filter(p => p.etat !== 'deja').length;
    $c('client-apercu-titre').textContent = !l.format
      ? 'Aucun nom repéré dans ce texte.'
      : `${FORMATS[l.format]} : ${personnes(l.personnes.length)} ${l.personnes.length > 1 ? 'repérées' : 'repérée'}`;
    $c('client-apercu-aide').textContent = !l.format
      ? 'Copiez la liste des membres depuis la tablette (Ctrl + A puis Ctrl + C), ou ajoutez les personnes une par une.'
      : [
        nouvelles < l.personnes.length ? `${l.personnes.length - nouvelles} déjà dans la liste.` : '',
        l.doublons ? `${l.doublons} ${l.doublons > 1 ? 'lignes en double fusionnées' : 'ligne en double fusionnée'}.` : '',
        l.illisibles.length ? `${l.illisibles.length} ${l.illisibles.length > 1 ? 'lignes illisibles ignorées' : 'ligne illisible ignorée'} : ${l.illisibles.slice(0, 3).join(' ; ')}.` : '',
        'Décochez qui ne doit pas être ajouté.',
      ].filter(Boolean).join(' ');
    dessinerApercu();
    $c('client-apercu').classList.remove('cache');
    $c('client-apercu-titre').scrollIntoView({ block: 'nearest' });
  } catch (e) { gestion.message('zone-message-apercu', e.message); $c('client-apercu').classList.remove('cache'); }
}
function dessinerApercu() {
  $c('client-apercu-liste').innerHTML = APERCU.map((p, i) => `<li>
    <label class="client-apercu-ligne${p.etat === 'deja' ? ' client-apercu-ligne--deja' : ''}">
      <input type="checkbox" data-apercu="${i}"${p.coche ? ' checked' : ''}${p.etat === 'deja' ? ' disabled' : ''}>
      <span>${echapper(p.nom)}${p.idUnique ? ` <small>ID ${echapper(p.idUnique)}</small>` : ''}</span>
      ${p.etat === 'deja' ? '<em>déjà dans la liste</em>' : p.etat === 'complete' ? '<em>ajoute son ID</em>' : ''}
    </label></li>`).join('');
  majBoutonApercu();
}
function majBoutonApercu() {
  const choisis = APERCU.filter(p => p.coche && p.etat !== 'deja');
  const nouvelles = choisis.filter(p => p.etat === 'nouvelle').length, places = MAX - LISTE.length;
  const bouton = $c('bouton-ajouter-apercu');
  bouton.textContent = choisis.length ? `Ajouter ${personnes(choisis.length)}` : 'Ajouter';
  bouton.disabled = !choisis.length || nouvelles > places;
  gestion.message('zone-message-apercu', nouvelles > places ? `Il reste ${places} ${places > 1 ? 'places' : 'place'} sur ${MAX} : décochez ${nouvelles - places} ${nouvelles - places > 1 ? 'personnes' : 'personne'}, ou retirez-en de la liste.` : '');
}
$c('client-apercu-liste').addEventListener('change', e => {
  const c = e.target.closest('[data-apercu]');
  if (!c) return;
  APERCU[Number(c.dataset.apercu)].coche = c.checked;
  majBoutonApercu();
});
function fermerApercu() {
  APERCU = [];
  $c('client-apercu').classList.add('cache');
  $c('client-collage').value = '';
  gestion.message('zone-message-apercu', '');
}
$c('bouton-ajouter-apercu').addEventListener('click', () => {
  const choisis = APERCU.filter(p => p.coche && p.etat !== 'deja');
  choisis.forEach(ajouter);
  fermerApercu();
  dessinerListe();
  gestion.notifier(`${personnes(choisis.length)} ${choisis.length > 1 ? 'ajoutées' : 'ajoutée'} : pensez à enregistrer la liste`);
  $c('bouton-enregistrer').focus();
});
$c('bouton-annuler-apercu').addEventListener('click', () => { fermerApercu(); $c('client-collage').focus(); });
$c('bouton-analyser').addEventListener('click', analyser);
// un collage lance l'analyse tout seul (le texte est dans le champ juste après l'événement)
$c('client-collage').addEventListener('paste', () => setTimeout(analyser, 0));

// ---- onglets : coller / une personne ----
document.querySelectorAll('.client-mode').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.client-mode').forEach(x => { x.classList.toggle('actif', x === b); x.setAttribute('aria-selected', String(x === b)); });
  $c('mode-coller').classList.toggle('cache', b.dataset.mode !== 'coller');
  $c('mode-une').classList.toggle('cache', b.dataset.mode !== 'une');
  (b.dataset.mode === 'une' ? $c('client-nom') : $c('client-collage')).focus();
}));

// ---- chargement : état du contrat et de la liste ----
function bandeau(titre, texte, classe) {
  $c('client-bandeau').className = `client-bandeau ${classe}`;
  $c('client-bandeau-titre').textContent = titre;
  $c('client-bandeau-texte').textContent = texte;
}
async function charger(apresEnregistrement) {
  if (!JETON) {
    $c('client-contrat').textContent = `Ce lien est incomplet. ${texteModele('texte-nouveau-lien')}`;
    return;
  }
  try {
    const a = await socle.api(`/api/contrats/acces/${JETON}`);
    $c('client-contrat').innerHTML = `Contrat avec <strong>${echapper(a.partenaire)}</strong>${a.type ? ` · ${echapper(a.type.nom)}` : ''}`;
    MODIFIABLE = a.modifiable;
    ENREGISTREE = a.beneficiaires.map(p => ({ nom: p.nom, idUnique: p.idUnique }));
    LISTE = ENREGISTREE.map(p => ({ ...p }));
    if (a.termine) {
      document.title = `Contrat terminé — ${socle.nomSite}`;
      bandeau(`Contrat terminé${a.dateFin ? ` le ${jourFr(a.dateFin, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}`, ` La liste ci-dessous n’est plus modifiable. ${texteModele('texte-contact')}`, 'client-bandeau--termine');
    } else if (a.finProche) {
      bandeau(`Ce contrat se termine le ${jourFr(a.dateFin)}`, ' Après cette date, la liste ne sera plus modifiable.', 'client-bandeau--proche');
    } else if (!a.modifiable) {
      bandeau('La liste ne se modifie pas aujourd’hui',
        a.prochaineOuverture ? ` Prochaine ouverture : ${jourFr(a.prochaineOuverture)}.` : a.jours.length ? ` Elle se modifie le ${a.jours.join(', le ')}.` : ' Elle n’est pas modifiable pour le moment.',
        'client-bandeau--ferme');
    } else $c('client-bandeau').className = 'client-bandeau cache';
    $c('client-explication').classList.toggle('cache', a.termine);
    $c('client-ajout').classList.toggle('cache', !a.modifiable);
    $c('zone-contenu').classList.remove('cache');
    dessinerListe();
    if (!apresEnregistrement && a.modifiable) $c('client-collage').focus();
  } catch (e) {
    $c('client-contrat').textContent = e.message.includes('introuvable') ? `Ce lien n’est plus valide. ${texteModele('texte-nouveau-lien')}` : `${e.message} Rechargez la page dans un instant.`;
    $c('zone-contenu').classList.add('cache');
  }
}

charger();
