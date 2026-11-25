// ENTREPRISE — modules activables, choisis dans site.json (« modules »: "vitrine avis demandes"). Un module absent :
// ses pages de gestion/ répondent 404 (entreprise.pagesInactives), ses permissions ne sont pas déclarées (absentes de la
// page Grades), ses routes ne sont pas montées, sa section de vitrine n'est pas rendue. Ce fichier n'importe que le
// registre de site.ts : permissions.ts et index.ts le lisent avant les routes.
import { modulesActifs, moduleActif } from '../socle/site.js';

// pages : pages de gestion/ du module (sans .html) → niveau d'accès, déclaré seulement si le module est allumé (un niveau qui nomme une
// permission absente ferait refuser le démarrage) ; permissions : clés déclarées dans permissions.ts, retirées si le module est éteint
// publiques : pages de la racine du site (sans .html) qui n'existent que si le module est allumé
export const MODULES: Record<string, { pages: Record<string, string>; permissions: string[]; publiques?: string[] }> = {
  // deux onglets, chacun avec sa permission (vitrine-voir, postes-voir) : la page est ouverte à tout compte validé
  vitrine: { pages: { vitrine: 'valide' }, permissions: ['vitrine-voir', 'vitrine', 'postes-voir', 'postes'] },
  avis: { pages: { avis: 'avis-voir' }, permissions: ['avis-voir', 'avis'], publiques: ['avis'] },
  demandes: { pages: { demandes: 'demandes-voir' }, permissions: ['demandes-voir', 'demandes-gerer'] },
  // permissions : celles de RH (rh-voir, rh-creer…), toujours déclarées ; le module n'en ajoute pas
  recrutement: { pages: { recrutement: 'rh-voir' }, permissions: [] },
};

// une faute de frappe dans site.json se voit au démarrage, pas par un module qui ne s'allume jamais
const inconnus = [...modulesActifs].filter(m => !(m in MODULES));
if (inconnus.length) { console.error(`site.json : module inconnu « ${inconnus.join(', ')} » (connus : ${Object.keys(MODULES).join(', ')})`); process.exit(1); }

export { moduleActif };
export const pagesInactives = Object.entries(MODULES).filter(([m]) => !moduleActif(m)).flatMap(([, d]) => Object.keys(d.pages));
// niveaux d'accès des pages des modules allumés (entreprise.pages)
export const pagesDesModules: Record<string, string> = Object.assign({}, ...Object.entries(MODULES).filter(([m]) => moduleActif(m)).map(([, d]) => d.pages));
export const pagesPubliquesInactives = Object.entries(MODULES).filter(([m]) => !moduleActif(m)).flatMap(([, d]) => d.publiques ?? []);
export const permissionsInactives = new Set(Object.entries(MODULES).filter(([m]) => !moduleActif(m)).flatMap(([, d]) => d.permissions));
