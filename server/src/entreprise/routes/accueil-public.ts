// ENTREPRISE — page d'accueil de la vitrine, rendue par le serveur : les sections des modules allumés (services et postes ouverts
// du module « vitrine », avis du module « avis ») sont écrites dans le HTML envoyé, jamais ajoutées par script après coup —
// rien ne saute à l'affichage. Module éteint : sa section reste cachée dans index.html. Monté toujours, sans permission.
import { join } from 'node:path';
import { Router } from 'express';
import { config } from '../../socle/config.js';
import { prisma } from '../../socle/db.js';
import { renderFile, withNonce } from '../../socle/site.js';
import { injecterAvis, listerAvisAccueil } from '../avis.js';
import { MODULES, moduleActif } from '../modules.js';
import { recrutementSiteActif } from '../recrutement-mode.js';
import { injecterVitrine, postesPublics, servicesPublics, urlPhoto } from '../vitrine.js';

export const accueilPublic = Router();

// plan du site : les pages publiques d'un module n'y figurent que s'il est allumé (avis.html sans le module répond 404)
accueilPublic.get('/sitemap.xml', (_req, res, next) => {
  let xml: string;
  try { xml = renderFile(join(config.root, 'sitemap.xml')); } catch { next(); return; }
  const pages = Object.entries(MODULES).filter(([m]) => moduleActif(m)).flatMap(([, d]) => d.publiques ?? []);
  const lignes = pages.map(p => `  <url>\n    <loc>${config.baseUrl}/${p}.html</loc>\n  </url>`).join('\n');
  res.type('application/xml').send(xml.replace(/ *<!-- pages publiques[^>]*-->/, lignes));
});

accueilPublic.get(['/', '/index.html'], async (_req, res, next) => {
  try {
    let html: string;
    try { html = renderFile(join(config.root, 'index.html')); } catch { next(); return; }
    if (moduleActif('vitrine')) {
      const photos = new Map((await prisma.apparenceImage.findMany({ where: { cle: { startsWith: 'service-' } }, select: { cle: true, majLe: true } })).map(p => [p.cle, p]));
      html = injecterVitrine(html, await servicesPublics(s => urlPhoto(s, photos.get(`service-${s.id}`))), await postesPublics());
    }
    if (moduleActif('avis')) html = injecterAvis(html, await listerAvisAccueil());
    if (recrutementSiteActif()) {
      // la section Recrutement s'affiche même sans poste ouvert (candidature spontanée), et ses boutons « Postuler » se montrent
      html = html.replace(/ data-si-recrutement hidden/g, '').replace(/(<section[^>]*id="recrutement")[^>]*>/, '$1>');
    }
    if (moduleActif('demandes')) html = html.replace(/ data-si-demandes hidden/g, '');   // boutons « Demander un devis » / « Nous écrire »
    res.type('text/html').send(withNonce(html, res));
  } catch (e) { next(e); }
});
