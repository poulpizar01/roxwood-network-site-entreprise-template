// ENTREPRISE — membres en service, reçus du bot Discord entreprise : événement « monitoring.duty » (journaux FiveM de
// prise et de fin de service, lus par le bot ; abonnement à créer dans son panneau Monitoring, docs/webhooks.md). Le
// site ne lit aucun salon. Une ligne par service :
//   - prise : nouvelle ligne ouverte ; une prise précédente de la même personne restée ouverte est fermée à l'heure de
//     la nouvelle (« debut_en_double ») ;
//   - fin : ferme le service ouvert de la personne (ou remplace une clôture automatique) ; sans service, une ligne est
//     créée à l'heure de la fin (« fin_sans_debut »), complétée si sa prise arrive ensuite ;
//   - reçus dans le désordre (le bot rejoue ses envois en échec après une coupure) : chaque événement reprend sa place ;
//   - service jamais fermé : fermé à 16 h, heure de Paris (« cloture_auto », voir cloturerServicesOublies) ; une vraie
//     fin reçue plus tard, ou une fin saisie à la main (terminerMonService/terminerServiceDe), la remplace ;
//   - même événement renvoyé par le bot : sans effet (identifiant tiré de la personne et de l'heure).
// Seuls les événements signés du bot arrivent ici (socle/routes/webhooks.ts) ; leur contenu est revérifié (services-duty.ts).
import type { EvenementBot } from '../socle/contrat.js';
import { prisma } from '../socle/db.js';
import { parisVersDate } from './agenda-regles.js';
import { Refus } from './refus.js';
import { nomComplet } from './rh.js';
import { lireDuty, normaliser, type EvenementDuty } from './services-duty.js';
import { debutSemaineParis, jourParis, versDate, versJour } from './texte.js';

type Fiche = { id: number; prenom: string; nom: string; discordId: string | null };
// fiche RH de la personne : par identifiant Discord, sinon par « Prénom Nom »
function trouverFiche(employes: Fiche[], ev: EvenementDuty): Fiche | null {
  const f = employes.find(e => e.discordId === ev.discordId);
  if (f) return f;
  const nom = normaliser(ev.nom);
  return nom ? employes.find(e => normaliser(`${e.prenom} ${e.nom}`) === nom) ?? null : null;
}

// Le bot rejoue ses envois en échec dans le désordre (après une coupure du site) : chaque événement est remis à sa place
// dans le temps, quel que soit l'ordre d'arrivée.
async function enregistrer(ev: EvenementDuty, fiche: Fiche | null): Promise<void> {
  // 120 caractères au plus (colonne employe_nom) : prénom et nom de la fiche en font jusqu'à 121
  const nom = (fiche ? `${fiche.prenom} ${fiche.nom}`.trim() : ev.nom).slice(0, 120);
  const personne = { discordId: ev.discordId };
  await prisma.$transaction(async tx => {
    if (ev.sens === 'debut') {
      if (await tx.service.findUnique({ where: { serviceId: ev.serviceId } })) return;   // déjà reçu
      // sa fin est déjà arrivée (reçue avant elle) : la ligne « fin sans début » est complétée, pas de service fantôme
      const orpheline = await tx.service.findFirst({ where: { ...personne, anomalie: 'fin_sans_debut', fin: { gte: ev.instant } }, orderBy: { fin: 'asc' } });
      if (orpheline && !await tx.service.count({ where: { ...personne, debut: { gte: ev.instant, lt: orpheline.debut } } })) {
        await tx.service.update({ where: { id: orpheline.id }, data: { serviceId: ev.serviceId, debut: ev.instant, anomalie: '' } });
        return;
      }
      // un service commencé avant et resté ouvert (ou fermé par une prise plus tardive) s'arrête à cette prise
      await tx.service.updateMany({
        where: { ...personne, debut: { lt: ev.instant }, OR: [{ fin: null }, { finSource: 'doublon', fin: { gt: ev.instant } }] },
        data: { fin: ev.instant, causeFin: 'Nouvelle prise de service sans fin', finSource: 'doublon', anomalie: 'debut_en_double' },
      });
      // une prise plus tardive est déjà arrivée : ce service s'arrête au plus tard à elle (une vraie fin reçue ensuite corrige)
      const suivante = await tx.service.findFirst({ where: { ...personne, debut: { gt: ev.instant } }, orderBy: { debut: 'asc' } });
      await tx.service.create({
        data: {
          serviceId: ev.serviceId, employeNom: nom, discordId: ev.discordId, employeId: fiche?.id ?? null, debut: ev.instant,
          ...(suivante && { fin: suivante.debut, causeFin: 'Nouvelle prise de service sans fin', finSource: 'doublon', anomalie: 'debut_en_double' }),
        },
      });
      return;
    }
    // fin : le dernier service commencé avant elle, s'il est encore ouvert, fermé automatiquement, ou fermé
    // provisoirement par une prise plus tardive (la vraie fin l'emporte dans les trois cas)
    const dernier = await tx.service.findFirst({ where: { ...personne, debut: { lte: ev.instant } }, orderBy: { debut: 'desc' } });
    if (dernier && (!dernier.fin || dernier.finSource === 'auto' || (dernier.finSource === 'doublon' && dernier.fin >= ev.instant))) {
      await tx.service.update({ where: { id: dernier.id }, data: { fin: ev.instant, causeFin: 'Fin de service', finSource: 'bot', anomalie: '' } });
      return;
    }
    if (await tx.service.findFirst({ where: { ...personne, fin: ev.instant, finSource: 'bot' } })) return;   // même fin renvoyée
    await tx.service.create({ data: { serviceId: `${ev.serviceId}-fin`, employeNom: nom, discordId: ev.discordId, employeId: fiche?.id ?? null, debut: ev.instant, fin: ev.instant, causeFin: 'Fin de service', finSource: 'bot', anomalie: 'fin_sans_debut' } });
  });
}

// traitement de l'événement du bot (entreprise.webhooks['monitoring.duty']) : une forme inattendue est ignorée (la
// renvoyer ne la rendrait pas valide) ; une erreur de base remonte, le bot réessaiera
export async function recevoirDuty(e: EvenementBot): Promise<void> {
  const ev = lireDuty(e.payload, e.sentAt);
  // forme inattendue : ignorée (la renvoyer ne la rendrait pas valide), mais consignée — si le bot change de format,
  // c'est la seule trace qui le dira
  if (!ev) { console.warn('[services] événement monitoring.duty ignoré : forme inattendue', JSON.stringify(e.payload).slice(0, 300)); return; }
  // cas courant (le bot connaît l'ID Discord) : une seule ligne lue plutôt que toute la table ; repli par nom
  // seulement si aucune fiche ne porte encore cet identifiant
  let fiche: Fiche | null = await prisma.employe.findFirst({ where: { discordId: ev.discordId }, select: { id: true, prenom: true, nom: true, discordId: true } });
  if (!fiche) {
    const employes = await prisma.employe.findMany({ select: { id: true, prenom: true, nom: true, discordId: true } });
    fiche = trouverFiche(employes, ev);
  }
  await enregistrer(ev, fiche);
  // dernier événement reçu : affiché dans Paramètres (preuve que l'abonnement fonctionne)
  await prisma.serviceEtat.upsert({ where: { id: 1 }, create: { id: 1, derniereLecture: new Date(), nbReconnus: 1 }, update: { derniereLecture: new Date(), nbReconnus: { increment: 1 } } });
}

// dernière échéance de 16 h (heure de Paris) déjà passée : aujourd'hui si 16 h est déjà sonné, hier sinon — un
// service pris avant 16 h et resté ouvert, ou pris après 16 h et resté ouvert jusqu'au 16 h suivant, s'arrête à elle
export function limiteCloture16h(maintenant: Date): Date {
  const jour = jourParis(maintenant), borne = parisVersDate(jour, '16:00');
  if (borne <= maintenant) return borne;
  return parisVersDate(versJour(new Date(versDate(jour).getTime() - 24 * 3600e3)), '16:00');
}

// services encore ouverts à la dernière échéance de 16 h : fermés à cette heure-là (chaque ligne a la même fin : une
// seule requête, plutôt qu'un aller-retour par service ouvert)
export async function cloturerServicesOublies(maintenant = new Date()): Promise<number> {
  const limite = limiteCloture16h(maintenant);
  return await prisma.$executeRaw`
    UPDATE services SET fin = ${limite}, cause_fin = 'Clôture automatique (16 h)', fin_source = 'auto', anomalie = 'cloture_auto'
    WHERE fin IS NULL AND debut < ${limite}
  `;
}

// clôture des services oubliés, chaque minute (la requête ne fait rien hors de l'échéance de 16 h : debut < limite
// n'est vrai qu'une fois 16 h passé pour la ligne concernée)
export function planifierServices(): void {
  const run = () => cloturerServicesOublies().catch(e => console.error('[services]', e));
  setTimeout(run, 30_000).unref();
  setInterval(run, 60_000).unref();
}

// terminer un service ouvert à la main (fin normale, pas une anomalie : comptée dans la paie comme une fin reçue du
// bot) — depuis son profil (soi-même, par ID Discord) ou depuis une fiche RH (un supérieur, pour quelqu'un d'autre)
async function terminerServiceOuvert(critere: { discordId: string } | { employeId: number }, cause: string): Promise<void> {
  const service = await prisma.service.findFirst({ where: { ...critere, fin: null }, orderBy: { debut: 'desc' } });
  if (!service) throw new Refus('Aucun service en cours.', 404);
  await prisma.service.update({ where: { id: service.id }, data: { fin: new Date(), causeFin: cause, finSource: 'manuel', anomalie: '' } });
}

export const terminerMonService = (discordId: string): Promise<void> =>
  terminerServiceOuvert({ discordId }, 'Service terminé depuis le profil');

export const terminerServiceDe = (employeId: number): Promise<void> =>
  terminerServiceOuvert({ employeId }, 'Service terminé par les ressources humaines');

// ---------- heures de la semaine, pour la paie à l'heure (DOT, dot.ts) ----------
// Seuls les services sans anomalie comptent : une anomalie non traitée (RH/Services) exclut ses heures tant qu'elle
// n'a pas été corrigée (l'anomalie disparaît alors) ou ignorée (traite = true : ses heures restent exclues).
export async function heuresServiceSemaine(iso?: string): Promise<Map<number, number>> {
  const debut = debutSemaineParis(iso);
  const fin = new Date(debut);
  fin.setUTCDate(fin.getUTCDate() + 7);
  const lignes = await prisma.service.findMany({
    where: { employeId: { not: null }, anomalie: '', fin: { not: null }, debut: { gte: debut, lt: fin } },
    select: { employeId: true, debut: true, fin: true },
  });
  const minutes = new Map<number, number>();
  for (const l of lignes) {
    const id = l.employeId as number;
    minutes.set(id, (minutes.get(id) ?? 0) + Math.round((l.fin!.getTime() - l.debut.getTime()) / 60000));
  }
  return minutes;
}

// ---------- anomalies à traiter (RH/Services) ----------
export async function anomaliesATraiter() {
  const lignes = await prisma.service.findMany({ where: { anomalie: { not: '' }, traite: false }, orderBy: { debut: 'desc' }, take: 200 });
  const fiches = new Map((await prisma.employe.findMany({
    where: { id: { in: lignes.map(l => l.employeId).filter((x): x is number => x !== null) } },
  })).map(e => [e.id, e]));
  return lignes.map(l => ({
    id: l.id,
    employeNom: l.employeId && fiches.get(l.employeId) ? nomComplet(fiches.get(l.employeId)!) : l.employeNom,
    debut: l.debut, fin: l.fin, causeFin: l.causeFin, anomalie: l.anomalie,
  }));
}

const RE_JOUR = /^\d{4}-\d{2}-\d{2}$/, RE_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

// corriger : nouvelles heures de début et de fin (même jour, heure de Paris), l'anomalie disparaît (comptée dans la
// paie dès la semaine suivante)
export async function corrigerService(id: number, jour: string, heureDebut: string, heureFin: string): Promise<void> {
  if (!RE_JOUR.test(jour)) throw new Refus('Date invalide.');
  if (!RE_HEURE.test(heureDebut) || !RE_HEURE.test(heureFin)) throw new Refus('Heure invalide : attendue au format 14:30.');
  const debut = parisVersDate(jour, heureDebut), fin = parisVersDate(jour, heureFin);
  if (fin <= debut) throw new Refus('La fin doit être après le début.');
  const { count } = await prisma.service.updateMany({
    where: { id }, data: { debut, fin, anomalie: '', causeFin: 'Corrigé dans Ressources humaines', finSource: 'bot' },
  });
  if (!count) throw new Refus('Service introuvable.', 404);
}

// ignorer : l'anomalie ne remonte plus dans la liste à traiter, mais ses heures restent exclues de la paie
export async function ignorerAnomalie(id: number): Promise<void> {
  const { count } = await prisma.service.updateMany({ where: { id, anomalie: { not: '' } }, data: { traite: true } });
  if (!count) throw new Refus('Anomalie introuvable ou déjà traitée.', 404);
}
