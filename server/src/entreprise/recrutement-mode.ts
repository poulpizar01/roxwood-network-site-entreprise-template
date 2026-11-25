// ENTREPRISE — d'où viennent les candidatures : du bot Discord (tickets, webhook recruitment.updated) OU du site (formulaire public),
// jamais des deux (la direction choisit dans Employés → Recrutement → Réglages). Sans le module « recrutement » de site.json, seul le
// bot existe. Fichier sans dépendance vers rh.ts : rh.ts le lit pour ignorer les événements du bot quand le site prend le relais.
import { reglage } from '../socle/reglages.js';
import { moduleActif } from '../socle/site.js';

export const CLE_MODE = 'recrutement.mode', CLE_PIECE = 'recrutement.piece';
export const CLE_GRADE_ARRIVEE = 'rh.grade_arrivee';   // le même réglage que celui du bot (rh.ts REGLAGES_BOT.gradeArrivee) : un seul grade d'arrivée
export type ModeRecrutement = 'bot' | 'site';
export type ModePiece = 'obligatoire' | 'facultative' | 'aucune';

// « bot » tant que rien n'est choisi : un site existant garde son fonctionnement
export const modeRecrutement = (): ModeRecrutement => (moduleActif('recrutement') && reglage(CLE_MODE) === 'site' ? 'site' : 'bot');
export const recrutementSiteActif = () => modeRecrutement() === 'site';
export const modePiece = (): ModePiece => { const v = reglage(CLE_PIECE); return v === 'facultative' || v === 'aucune' ? v : 'obligatoire'; };
