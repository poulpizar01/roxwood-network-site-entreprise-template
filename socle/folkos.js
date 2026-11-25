/* SOCLE — ordinateur en jeu (FolkOS, navigateur FiveM). Mutualisé : ne pas modifier dans un site.
   Ajouté par le serveur en tête de chaque page quand FOLKOS_HOTE est réglé (site.ts) ; aucune page n'a à l'inclure.
   Hors iframe (navigateur normal), ne fait rien. Dans l'iframe :
   - charge le SDK de l'opérateur (fbfa-game.js : clavier rendu au site dès qu'un champ a le focus, Échap qui ferme la
     fenêtre du jeu sauf dans le navigateur de l'ordinateur en jeu ; fbfa-bridge.js : la barre d'adresse de FolkOS suit
     la page) ;
   - pose la classe « en-jeu » sur <html> : à tester par les pages pour couper ce qui coûte au GPU (WebGL, grosses
     animations), partagé avec le jeu ;
   - ouvre les liens target="_blank" et window.open() dans le cadre (en jeu, un nouvel onglet n'ouvre rien) ;
   - si la page est affichée sur un écran placé dans le monde : recrée les touches envoyées par le jeu (le jeu ne peut pas
     donner son clavier à un écran) — docs/guide-dev-fbfa.md, B9.3. */
(() => {
  const hote = document.currentScript?.dataset.hote;
  // dans un cadre ? ancestorOrigins (guide FBFA, B5) ; window.top seulement pour un navigateur qui ne le fournit pas (Firefox)
  let enJeu = true;
  if (location.ancestorOrigins) enJeu = location.ancestorOrigins.length > 0;
  else { try { enJeu = window.self !== window.top; } catch { /* cadre d'une autre origine : en jeu */ } }
  if (!enJeu || !hote) return;
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
    const ancetres = Array.from(location.ancestorOrigins || []);
    try { window.FBFAGame?.init?.({ typing: { mode: 'field' }, autofocus: ancetres.length > 0, escape: ancetres.length > 0 && ancetres[0] !== hote }); } catch { /* hors FiveM */ }
  });
  charger('fbfa-bridge.js');

  // délégation : couvre aussi les liens ajoutés plus tard par les scripts de la page
  document.addEventListener('click', e => { e.target.closest?.('a[target="_blank"]')?.removeAttribute('target'); }, true);
  window.open = url => { if (url) location.href = String(url); return null; };

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
