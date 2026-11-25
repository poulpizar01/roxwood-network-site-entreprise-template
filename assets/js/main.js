/* VITRINE (personnalisable) — menu burger. Scripts de la vitrine : ici ou dans d'autres fichiers de assets/js/. */
const burger = document.querySelector('.burger'), menu = document.getElementById('menu');
if (burger && menu) {
  const basculer = ouvert => { burger.setAttribute('aria-expanded', String(ouvert)); menu.classList.toggle('is-open', ouvert); };
  burger.addEventListener('click', () => basculer(burger.getAttribute('aria-expanded') !== 'true'));
  // un lien choisi (ancre de la page) referme le menu
  menu.addEventListener('click', e => { if (e.target.closest('a')) basculer(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && menu.classList.contains('is-open')) { e.preventDefault(); basculer(false); burger.focus(); } });   // le focus revient au bouton, pas sur la page
}
