// ENTREPRISE — verrouillage automatique de la déclaration DOT : si personne n'a cliqué « Valider la déclaration »
// avant la fin de sa semaine, elle est figée seule (sans compte associé) dès que la semaine suivante commence — pour
// que l'historique ne reste jamais indéfiniment modifiable faute d'y avoir pensé.
import { construireEtVerrouiller, estVerrouillee, semaineCourante } from './dot.js';

const JOUR = 24 * 3600e3;
const semainePrecedente = (iso: string) => new Date(new Date(`${iso}T00:00:00Z`).getTime() - 7 * JOUR).toISOString().slice(0, 10);
// une panne ou un échec silencieux de plusieurs jours à cheval sur un changement de semaine civile ne doit pas
// laisser les semaines plus anciennes indéfiniment déverrouillées : on remonte jusqu'à en retrouver une déjà
// verrouillée, avec une borne pour ne pas boucler sans fin sur un site jamais encore verrouillé
const LIMITE_RATTRAPAGE = 52;

async function verrouillerSiOubliee(): Promise<void> {
  let semaine = semainePrecedente(semaineCourante());
  for (let i = 0; i < LIMITE_RATTRAPAGE; i++) {
    if (await estVerrouillee(semaine)) return;
    await construireEtVerrouiller(semaine, null, 'auto');
    console.log(`[dot] déclaration de la semaine du ${semaine} verrouillée automatiquement`);
    semaine = semainePrecedente(semaine);
  }
}

// au démarrage puis une fois par jour ; unref : ce minuteur ne retient pas l'arrêt du serveur
export function planifierVerrouillageDot(): void {
  const run = () => verrouillerSiOubliee().catch(e => console.error('[dot] verrouillage automatique', e));
  run();
  setInterval(run, JOUR).unref();
}
