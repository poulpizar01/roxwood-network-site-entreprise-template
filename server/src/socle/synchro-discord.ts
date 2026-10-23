// SOCLE — rôles Discord relus par le bot entre deux connexions. Sans lui, un rôle retiré sur Discord (rétrogradation,
// renvoi) ne comptait qu'à la connexion Discord suivante : jusqu'à 7 jours (durée d'une session) avec les anciens droits.
// Avec DISCORD_BOT_TOKEN, toutes les 10 minutes, chaque compte validé ou en attente (hors propriétaire) est relu sur
// Discord et suit les règles de la connexion (grade-connexion.ts, synchroCompte) :
//   - rôle retiré : grade lié retiré, aussitôt effectif (le compte est relu en base à chaque requête) ;
//   - nouveau rôle lié à un grade : grade donné (et compte en attente validé) ;
//   - membre parti du serveur : ses sessions sont fermées et il est marqué parti (quitteLe) : la connexion Discord le
//     refuse déjà (pas membre), la connexion en jeu aussi. Il redevient normal à sa prochaine connexion Discord.
// Un appel par compte (« Get Guild Member », sans intention privilégiée à activer), espacés : quelques centaines de
// comptes au plus. Une erreur du bot (jeton refusé, Discord coupé) interrompt la passe sans rien changer : la suivante
// reprend. Sans jeton : rien ne tourne, les rôles restent relus à chaque connexion.
import { config } from './config.js';
import { prisma } from './db.js';
import { appelBot, botDiscordConfigure, ErreurDiscord, ID_DISCORD } from './discord.js';
import { tousLesGrades } from './droits.js';
import { synchroCompte } from './grade-connexion.js';
import { gradesImposes } from './grades-imposes.js';

const INTERVALLE_MS = 10 * 60_000, PREMIERE_MS = 2 * 60_000, ESPACEMENT_MS = 250;
const MEMBRE_INCONNU = 10007;   // code d'erreur Discord : cet utilisateur n'est pas (plus) membre du serveur
const attendre = (ms: number) => new Promise(ok => setTimeout(ok, ms));

// rôles du membre sur le serveur, null s'il n'y est plus ; toute autre erreur remonte (passe interrompue)
async function rolesDuMembre(discordId: string): Promise<string[] | null> {
  for (let essai = 0; ; essai++) {
    try {
      const m = await appelBot('GET', `/guilds/${config.discord.guildId}/members/${discordId}`) as { roles?: unknown } | null;
      if (!Array.isArray(m?.roles)) throw new ErreurDiscord(0, 'réponse illisible');
      return [...new Set(m.roles.map(String).filter(r => ID_DISCORD.test(r)))].slice(0, 250);
    } catch (e) {
      if (e instanceof ErreurDiscord && e.statut === 404 && e.code === MEMBRE_INCONNU) return null;
      // limite de Discord : une attente courte, puis une seule nouvelle tentative
      if (e instanceof ErreurDiscord && e.statut === 429 && essai === 0 && e.reessayerApres <= 60) { await attendre((e.reessayerApres + 1) * 1000); continue; }
      throw e;
    }
  }
}

let enCours = false;
export async function synchroniserComptes(): Promise<{ lus: number; modifies: number; partis: number }> {
  const bilan = { lus: 0, modifies: 0, partis: 0 };
  if (enCours || !botDiscordConfigure()) return bilan;
  enCours = true;
  try {
    const comptes = await prisma.compte.findMany({
      where: { statut: { in: ['valide', 'attente'] }, proprietaire: false, quitteLe: null },
      select: { id: true, discordId: true, gradeCle: true, statut: true, rolesDiscord: true },
    });
    for (const c of comptes) {
      if (!ID_DISCORD.test(c.discordId)) continue;   // compte de dev local
      const roles = await rolesDuMembre(c.discordId);
      bilan.lus++;
      // grades et compte relus au moment d'écrire : une connexion ou une modification faite entre-temps l'emporte
      const actuel = await prisma.compte.findUnique({ where: { id: c.id }, select: { gradeCle: true, statut: true, rolesDiscord: true, proprietaire: true, quitteLe: true } });
      if (!actuel || actuel.proprietaire || actuel.quitteLe || actuel.statut === 'refuse') continue;
      const d = synchroCompte(tousLesGrades(), actuel, roles);
      // grade imposé par l'entreprise (fiche RH…) : il l'emporte sur le rôle, comme à la connexion
      const impose = (await gradesImposes([c.discordId])).get(c.discordId)?.grade;
      if (impose && !d.parti) { d.gradeCle = impose; d.change = d.change || impose !== actuel.gradeCle; }
      if (d.parti) {
        await prisma.$transaction([
          prisma.compte.update({ where: { id: c.id }, data: { quitteLe: new Date(), gradeCle: d.gradeCle, rolesDiscord: [] } }),
          prisma.$executeRaw`DELETE FROM "session" WHERE (sess->>'compteId') = ${String(c.id)}`,
        ]);
        bilan.partis++;
      } else if (d.change) {
        await prisma.compte.update({
          where: { id: c.id },
          data: { gradeCle: d.gradeCle, rolesDiscord: roles ?? [], ...(d.valider && { statut: 'valide' as const, valideLe: new Date() }) },
        });
        if (d.gradeCle !== actuel.gradeCle || d.valider) bilan.modifies++;
      }
      await attendre(ESPACEMENT_MS);
    }
  } finally { enCours = false; }
  if (bilan.modifies || bilan.partis) console.log(`[synchro discord] ${bilan.lus} compte(s) relu(s) : ${bilan.modifies} grade(s) ou statut(s) mis à jour, ${bilan.partis} membre(s) parti(s) du serveur`);
  return bilan;
}

// premier passage peu après le démarrage, puis toutes les 10 minutes ; unref : ne retient pas l'arrêt du serveur
export function planifierSynchroDiscord(): void {
  if (!botDiscordConfigure()) return;
  const passe = () => synchroniserComptes().catch(e => console.error(`[synchro discord] passe interrompue : ${(e as Error).message}`));
  setTimeout(() => { passe(); setInterval(passe, INTERVALLE_MS).unref(); }, PREMIERE_MS).unref();
}
