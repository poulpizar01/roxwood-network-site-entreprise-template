// ENTREPRISE — verrouillage automatique de la déclaration DOT : si personne n'a cliqué « Valider la déclaration »
// avant la fin de sa semaine, elle est figée seule (sans compte associé) dès que la semaine suivante commence — pour
// que l'historique ne reste pas modifiable faute d'y avoir pensé. Il prolonge ce qui est verrouillé : une semaine
// ancienne restée ouverte avant la dernière validation à la main n'est jamais figée toute seule (la valider à la main).
import { prisma } from '../socle/db.js';
import { construireEtVerrouiller, estVerrouillee, semaineCourante } from './dot.js';
import { semainesARattraper } from './stats/verrouillage.js';

const JOUR = 24 * 3600e3;

// une panne de plusieurs jours à cheval sur un changement de semaine se rattrape : on fige les semaines terminées qui
// suivent la dernière verrouillée, jamais celles d'avant (limite de 52 par passage)
async function verrouillerSiOubliee(): Promise<void> {
  const derniere = await prisma.declarationDot.findFirst({ orderBy: { semaine: 'desc' }, select: { semaine: true } });
  for (const semaine of semainesARattraper(semaineCourante(), derniere ? derniere.semaine.toISOString().slice(0, 10) : null)) {
    if (await estVerrouillee(semaine)) continue;
    await construireEtVerrouiller(semaine, null, 'auto');
    console.log(`[dot] déclaration de la semaine du ${semaine} verrouillée automatiquement`);
  }
}

// au démarrage puis une fois par jour ; unref : ce minuteur ne retient pas l'arrêt du serveur
export function planifierVerrouillageDot(): void {
  const run = () => verrouillerSiOubliee().catch(e => console.error('[dot] verrouillage automatique', e));
  run();
  setInterval(run, JOUR).unref();
}
