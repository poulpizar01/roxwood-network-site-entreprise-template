// ENTREPRISE — file de nettoyage du stockage : une image qui n'est plus utilisée (image de la marque remplacée ou
// rétablie, routes/apparence.ts) est inscrite ici dans la même transaction que le changement, puis effacée du stockage
// au passage suivant. Un échec du stockage garde la ligne (réessai au passage suivant) : jamais un fichier en ligne sans
// trace en base.
import { prisma } from '../socle/db.js';
import { retirerImage } from '../socle/images.js';

// un passage peut durer (stockage lent : jusqu'à 30 s par fichier) : le suivant ne le chevauche pas
let nettoyageEnCours = false;
async function nettoyer(): Promise<void> {
  if (nettoyageEnCours) return;
  nettoyageEnCours = true;
  try { await nettoyerUneFois(); } finally { nettoyageEnCours = false; }
}
async function nettoyerUneFois(): Promise<void> {
  // les plus anciennes d'abord ; un échec enregistre l'erreur, ce qui renvoie la ligne en fin de file (majLe) : 50
  // suppressions qui échouent durablement ne bloquent pas les autres
  const aEffacer = await prisma.imageRetiree.findMany({ orderBy: { majLe: 'asc' }, take: 50 });
  let effacees = 0;
  for (const i of aEffacer) {
    try {
      await retirerImage(i);
      await prisma.imageRetiree.delete({ where: { id: i.id } });
      effacees++;
    } catch (e) {
      await prisma.imageRetiree.update({ where: { id: i.id }, data: { erreur: String((e as Error).message).slice(0, 300) } }).catch(() => {});
    }
  }
  if (effacees) console.log(`Images : ${effacees} image(s) inutilisée(s) retirée(s) du stockage`);
}

export function planifierNettoyageImages(): void {
  const run = () => nettoyer().catch(e => console.error('[images]', e));
  setTimeout(run, 60_000).unref();
  setInterval(run, 15 * 60_000).unref();
}
