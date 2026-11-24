// ENTREPRISE — modules activables, choisis dans site.json (« modules »: "vitrine avis demandes"). Un module absent :
// ses pages de gestion/ répondent 404 (entreprise.pagesInactives), ses permissions ne sont pas déclarées (absentes de la
// page Grades), ses routes ne sont pas montées, sa section de vitrine n'est pas rendue. Ce fichier n'importe que le
// registre de site.ts : permissions.ts et index.ts le lisent avant les routes.
import { modulesActifs, moduleActif } from '../socle/site.js';

// pages : pages de gestion/ du module (sans .html) ; permissions : clés déclarées dans permissions.ts, retirées si le module est éteint
export const MODULES: Record<string, { pages: string[]; permissions: string[] }> = {
  vitrine: { pages: ['vitrine'], permissions: ['vitrine-voir', 'vitrine', 'postes-voir', 'postes'] },
  avis: { pages: [], permissions: [] },
  demandes: { pages: [], permissions: [] },
};

// une faute de frappe dans site.json se voit au démarrage, pas par un module qui ne s'allume jamais
const inconnus = [...modulesActifs].filter(m => !(m in MODULES));
if (inconnus.length) { console.error(`site.json : module inconnu « ${inconnus.join(', ')} » (connus : ${Object.keys(MODULES).join(', ')})`); process.exit(1); }

export { moduleActif };
export const pagesInactives = Object.entries(MODULES).filter(([m]) => !moduleActif(m)).flatMap(([, d]) => d.pages);
export const permissionsInactives = new Set(Object.entries(MODULES).filter(([m]) => !moduleActif(m)).flatMap(([, d]) => d.permissions));
