/* SOCLE — ordinateur en jeu (FolkOS, navigateur FiveM). Mutualisé : ne pas modifier dans un site.
   Ajouté par le serveur en tête de chaque page quand FOLKOS_HOTE est réglé (site.ts) ; aucune page n'a à l'inclure.
   Hors iframe (navigateur normal), ne fait rien. Dans l'iframe :
   - charge le SDK de l'opérateur (fbfa-game.js : clavier rendu au site dès qu'un champ a le focus, Échap qui ferme la
     fenêtre du jeu sauf dans le navigateur de l'ordinateur en jeu ; fbfa-bridge.js : la barre d'adresse de FolkOS suit
     la page) ;
   - pose la classe « en-jeu » sur <html> : à tester par les pages pour couper ce qui coûte au GPU (WebGL, grosses
     animations), partagé avec le jeu ;
   - ouvre les liens dans le cadre en jeu, et réserve les nouveaux onglets aux navigateurs hors jeu ;
   - si la page est affichée sur un écran placé dans le monde : recrée les touches envoyées par le jeu (le jeu ne peut pas
     donner son clavier à un écran) — docs/guide-dev-fbfa.md, B9.3 ;
   - dans la gestion, un clic sur un champ fichier propose aussi de coller l'adresse d'une image (B7). */
(() => {
  const hote = document.currentScript?.dataset.hote;
  const ancetres = Array.from(location.ancestorOrigins || []);
  const enCadre = ancetres.length > 0 || window.frameElement !== null;
  const enJeu = enCadre && !!hote;
  // La délégation couvre les liens de menu et de signature ajoutés après le chargement.
  document.addEventListener('click', e => {
    const lien = e.target.closest?.('a');
    if (!lien) return;
    if (enJeu && lien.hasAttribute('data-hors-jeu')) { e.preventDefault(); return; }
    if (enJeu && lien.target === '_blank') lien.removeAttribute('target');
    if (!enJeu && lien.hasAttribute('data-nouvel-onglet')) lien.target = '_blank';
  }, true);
  if (!enJeu) return;
  document.documentElement.classList.add('en-jeu');

  const charger = (nom, quandPret) => {
    const s = document.createElement('script');
    s.src = `${hote}/${nom}`;
    s.async = true;
    if (quandPret) s.onload = quandPret;
    s.onerror = () => { /* SDK indisponible : le site reste utilisable */ };
    document.head.appendChild(s);
  };
  charger('fbfa-game.js', () => {
    // Échap ferme la fenêtre du jeu, sauf dans le navigateur de l'ordinateur en jeu (parent direct = FOLKOS_HOTE) : elle
    // fermerait tout l'ordinateur, le joueur revient avec le bouton « précédent » de FolkOS (B5)
    try { window.FBFAGame?.init?.({ typing: { mode: 'field' }, autofocus: ancetres.length > 0, escape: ancetres.length > 0 && ancetres[0] !== hote }); } catch { /* hors FiveM */ }
  });
  charger('fbfa-bridge.js');

  // Image par adresse (B7 : le sélecteur de fichiers est peu fiable en jeu). Gestion seulement : le serveur ne télécharge
  // que pour un compte validé. L'image reçue est placée dans le champ comme un fichier choisi : la page n'a rien à faire.
  let selecteurDemande = null;   // champ dont on laisse s'ouvrir le sélecteur (« Choisir un fichier »)
  document.addEventListener('click', e => {
    const champ = e.target;
    if (!location.pathname.startsWith('/gestion') || !champ.matches?.('input[type="file"]')) return;
    if (champ === selecteurDemande) { selecteurDemande = null; return; }
    if (champ.accept && !champ.accept.includes('image/')) return;
    e.preventDefault();
    proposerAdresse(champ);
  }, true);

  function proposerAdresse(champ) {
    const fenetre = document.createElement('dialog');
    fenetre.setAttribute('aria-labelledby', 'image-lien-titre');
    fenetre.style.cssText = 'box-sizing:border-box;width:min(440px,calc(100vw - 32px));padding:20px;border:1px solid #767676;border-radius:8px;background:#fff;color:#111;font:15px/1.4 system-ui,sans-serif;text-align:left';
    const bouton = 'min-height:40px;padding:8px 14px;border:1px solid #767676;border-radius:6px;background:#fff;color:#111;font:inherit;cursor:pointer';
    fenetre.innerHTML = `<form novalidate>
      <h2 id="image-lien-titre" style="margin:0 0 12px;font:700 18px/1.3 system-ui,sans-serif;color:#111">Ajouter une image</h2>
      <label for="image-lien-adresse" style="display:block;margin:0 0 6px;color:#111">Adresse de l’image (https://…)</label>
      <input id="image-lien-adresse" type="url" maxlength="2000" autocomplete="off" style="box-sizing:border-box;width:100%;min-height:40px;padding:8px;border:1px solid #767676;border-radius:6px;background:#fff;color:#111;font:inherit">
      <p role="alert" style="margin:8px 0 0;min-height:1.4em;color:#a30000"></p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
        <button type="submit" style="${bouton}">Ajouter l’image</button>
        <button type="button" data-fichier style="${bouton}">Choisir un fichier</button>
        <button type="button" data-annuler style="${bouton}">Annuler</button>
      </div></form>`;
    const adresse = fenetre.querySelector('input'), erreur = fenetre.querySelector('[role="alert"]'), valider = fenetre.querySelector('[type="submit"]');
    const fermer = () => { fenetre.close(); fenetre.remove(); };
    // les clics et touches de cette fenêtre ne doivent pas agir sur la page ni sur ses propres fenêtres ; Échap la ferme
    // elle seule (preventDefault : sinon le SDK fermerait la tablette)
    fenetre.addEventListener('click', e => e.stopPropagation());
    fenetre.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); fermer(); }
    });
    fenetre.addEventListener('cancel', e => { e.preventDefault(); fermer(); });
    fenetre.querySelector('[data-annuler]').addEventListener('click', fermer);
    fenetre.querySelector('[data-fichier]').addEventListener('click', () => { fermer(); selecteurDemande = champ; champ.click(); });
    fenetre.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      if (!adresse.value.trim()) { erreur.textContent = 'Collez l’adresse de l’image.'; return; }
      valider.disabled = true; erreur.textContent = ''; valider.textContent = 'Récupération…';
      try {
        const r = await fetch('/api/image-distante', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: adresse.value.trim() }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'L’image n’a pas pu être récupérée.');
        const image = await r.blob();
        if (!fenetre.isConnected) return;   // annulé pendant la récupération
        const fichiers = new DataTransfer();
        fichiers.items.add(new File([image], 'image.' + image.type.split('/')[1], { type: image.type }));
        fermer();
        champ.files = fichiers.files;
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        champ.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (err) {
        erreur.textContent = err instanceof TypeError ? 'Connexion impossible, réessayez.' : err.message;
        valider.disabled = false; valider.textContent = 'Ajouter l’image';
      }
    });
    document.body.appendChild(fenetre);
    fenetre.showModal();
    adresse.focus();
  }

  // Écran dans le monde : le jeu n'envoie pas de vraies touches à la page, ce script les recrée.
  (() => {
    const RESSOURCE = "https://cfx-nui-external-iframe";
    // Page vraiment embarquée par le jeu ? (liste fournie par le navigateur, impossible à falsifier)
    if (!Array.from(location.ancestorOrigins || []).includes(RESSOURCE)) return;

    const post = (route, body) =>
      fetch("https://external-iframe/" + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    const NOT_TEXT = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"];
    const isField = (el) =>
      !!el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !NOT_TEXT.includes(el.type)));

    // Demande le clavier quand un champ prend le focus (le jeu ne l'accorde que juste après un clic).
    document.addEventListener("focusin", (e) => isField(e.target) && post("typing", { typing: true }));
    document.addEventListener("click", () => isField(document.activeElement) && post("typing", { typing: true }));
    document.addEventListener("focusout", (e) => isField(e.target) && post("typing", { typing: false }));

    // Valeur posée par le setter natif : React, Vue… voient le changement (sinon le champ se vide).
    const setValue = (el, v) => {
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      set ? set.call(el, v) : (el.value = v);
    };
    const edit = (el, insert, start, end) => {
      try {
        el.setRangeText(insert, start, end, "end");
      } catch {
        setValue(el, insert ? el.value + insert : el.value.slice(0, -1)); // number, email… : pas de sélection
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };

    window.addEventListener("message", (e) => {
      const data = e.data;
      if (!data || e.origin !== RESSOURCE) return; // touches du jeu seulement
      const el = document.activeElement;
      if (data.type === "externalIframeTypingEnd") {
        if (isField(el)) el.blur();
        return;
      }
      if (data.type !== "externalIframeKey") return;

      const { event, key, code, repeat, shiftKey, ctrlKey, altKey } = data;
      const init = { key, code, repeat, shiftKey, ctrlKey, altKey, bubbles: true, cancelable: true };
      const notCancelled = (el || document.body).dispatchEvent(new KeyboardEvent(event, init));
      if (event !== "keydown" || !notCancelled || !isField(el)) return;

      if (el.isContentEditable) {
        if (key.length === 1 && !ctrlKey) document.execCommand("insertText", false, key);
        else if (key === "Backspace") document.execCommand("delete");
        else if (key === "Enter") document.execCommand("insertParagraph");
        return;
      }
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      if (key.length === 1 && !ctrlKey) edit(el, key, start, end);
      else if (key === "Backspace") edit(el, "", start === end ? Math.max(0, start - 1) : start, end);
      else if (key === "Delete") edit(el, "", start, start === end ? end + 1 : end);
      else if (key === "Enter") el.tagName === "TEXTAREA" ? edit(el, "\n", start, end) : el.form?.requestSubmit();
      else if (key === "ArrowLeft" || key === "ArrowRight") {
        const caret = Math.max(0, Math.min(el.value.length, start + (key === "ArrowLeft" ? -1 : 1)));
        try {
          el.setSelectionRange(caret, caret);
        } catch {}
      }
    });
  })();
})();
