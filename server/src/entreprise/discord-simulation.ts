// ENTREPRISE — ce que les bots de l'entreprise feraient dans le faux Discord du développement (DISCORD_BOT_TOKEN=simulation,
// socle/discord-simulation.ts) : un ticket par employé relié à Discord (agenda : événement créé pour quelqu'un d'autre),
// et des prises / fins de service inventées, envoyées comme le bot entreprise le fait (événement monitoring.duty, même
// forme que le vrai), pour voir vivre l'indicateur « En service ». Ne tourne qu'avec la simulation.
import { config } from '../socle/config.js';
import { prisma } from '../socle/db.js';
import { ajouterPersonnesSimulees } from '../socle/discord-simulation.js';
import { recevoirDuty } from './services.js';

const employes = async () => (await prisma.employe.findMany({ where: { statut: 'actif', discordId: { not: null } }, select: { discordId: true, prenom: true, nom: true } }))
  .filter(e => /^\d{15,21}$/.test(e.discordId!)).map(e => ({ discordId: e.discordId!, nom: `${e.prenom} ${e.nom}` }));

// un événement « monitoring.duty » tel que le bot l'envoie (champs du journal FiveM + parsed.direction)
const duty = (e: { discordId: string; nom: string }, direction: 'in' | 'out', quand = new Date()) => recevoirDuty({
  guildId: config.discord.guildId, eventType: 'monitoring.duty', sentAt: quand.toISOString(),
  payload: { playerDiscord: e.discordId, playerName: e.nom, jobId: 'simulation', description: `${direction === 'in' ? 'prise' : 'fin'} de service (simulation)`, parsed: { direction } },
});

// toutes les 2 minutes, une personne prend ou quitte son service ; au démarrage, la moitié de l'équipe pas encore en
// service le prend, avec des heures étalées sur la dernière heure et demie
export function simulerBotsDiscord(): void {
  if (!config.discord.simulation) return;
  ajouterPersonnesSimulees(employes);
  let premier = true;
  const tic = async () => {
    try {
      const liste = await employes();
      if (!liste.length) return;
      const ouverts = new Set((await prisma.service.findMany({ where: { fin: null }, select: { discordId: true } })).map(x => x.discordId));
      if (premier) {
        premier = false;
        const libres = liste.filter(e => !ouverts.has(e.discordId)).slice(0, Math.ceil(liste.length / 2));
        for (const [i, e] of libres.entries()) await duty(e, 'in', new Date(Date.now() - (90 - i * 15) * 60_000));
        return;
      }
      const e = liste[Math.floor(Math.random() * liste.length)];
      await duty(e, ouverts.has(e.discordId) ? 'out' : 'in');
    } catch (err) { console.error('[discord simulé]', err); }
  };
  setTimeout(tic, 10_000).unref();
  setInterval(tic, 120_000).unref();
}
