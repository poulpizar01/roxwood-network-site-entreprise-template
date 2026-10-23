// ENTREPRISE — membres en service, reçus du bot Discord entreprise : événement « monitoring.duty » (journaux FiveM de
// prise et de fin de service, lus par le bot ; abonnement à créer dans son panneau Monitoring, docs/webhooks.md). Le
// site ne lit aucun salon : seule la clôture automatique se règle (Paramètres). Une ligne par service :
//   - prise : nouvelle ligne ouverte ; une prise précédente de la même personne restée ouverte est fermée à l'heure de
//     la nouvelle (« debut_en_double ») ;
//   - fin : ferme le service ouvert de la personne (ou remplace une clôture automatique) ; sans service, une ligne est
//     créée à l'heure de la fin (« fin_sans_debut »), complétée si sa prise arrive ensuite ;
//   - reçus dans le désordre (le bot rejoue ses envois en échec après une coupure) : chaque événement reprend sa place ;
//   - service jamais fermé : fermé N heures après son début (« cloture_auto ») ; une vraie fin reçue plus tard la remplace ;
//   - même événement renvoyé par le bot : sans effet (identifiant tiré de la personne et de l'heure).
// Seuls les événements signés du bot arrivent ici (socle/routes/webhooks.ts) ; leur contenu est revérifié (services-duty.ts).
import type { EvenementBot } from '../socle/contrat.js';
import { prisma } from '../socle/db.js';
import { entierRegle } from './parametres.js';
import { lireDuty, normaliser, type EvenementDuty } from './services-duty.js';

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

// services ouverts depuis plus de `heures` : fermés à début + heures (chaque ligne a sa propre fin, calculée à partir
// de son propre début : une seule requête, plutôt qu'un aller-retour par service ouvert)
export async function cloturerServicesOublies(heures: number, maintenant = new Date()): Promise<number> {
  const limite = new Date(maintenant.getTime() - heures * 3600e3);
  const cause = `Clôture automatique (${heures} h sans fin de service)`;
  return await prisma.$executeRaw`
    UPDATE services SET fin = debut + (${heures} * interval '1 hour'), cause_fin = ${cause}, fin_source = 'auto', anomalie = 'cloture_auto'
    WHERE fin IS NULL AND debut <= ${limite}
  `;
}

// clôture des services oubliés, chaque minute
export function planifierServices(): void {
  const run = () => cloturerServicesOublies(entierRegle('services_cloture_heures')).catch(e => console.error('[services]', e));
  setTimeout(run, 30_000).unref();
  setInterval(run, 60_000).unref();
}
