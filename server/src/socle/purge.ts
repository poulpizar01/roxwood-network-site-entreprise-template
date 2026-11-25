// SOCLE — purge quotidienne : événements du bot reçus il y a plus de 30 jours (gardés jusque-là pour dédoublonner les
// nouvelles tentatives du bot et diagnostiquer un traitement en échec). Les sessions expirées sont effacées par
// connect-pg-simple. Les durées de conservation propres à l'entreprise se planifient dans entreprise.demarrage().
import { prisma } from './db.js';
import { purgerEnvoisInacheves } from './images.js';

const JOURS_WEBHOOKS = 30;

async function purge() {
  const avant = new Date(Date.now() - JOURS_WEBHOOKS * 24 * 3600e3);
  const { count } = await prisma.webhookRecu.deleteMany({ where: { recuLe: { lt: avant } } });
  if (count) console.log(`Purge : ${count} événement(s) du bot reçus il y a plus de ${JOURS_WEBHOOKS} jours, effacés`);
}

// au démarrage puis une fois par jour ; unref : ce minuteur ne retient pas l'arrêt du serveur
export function planifierPurge() {
  const run = () => purge().catch(e => console.error('[purge]', e));
  run();
  setInterval(run, 24 * 3600e3).unref();
  const nettoyerImages = () => purgerEnvoisInacheves().catch(e => console.error('[purge images]', e));
  nettoyerImages();
  setInterval(nettoyerImages, 15 * 60e3).unref();
}
