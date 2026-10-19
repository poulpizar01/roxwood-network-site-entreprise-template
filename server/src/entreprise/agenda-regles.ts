// ENTREPRISE — Agenda partagé : règles pures (sans base ni Discord), testées dans test/agenda.test.ts.
// Un événement est destiné à :
//   - perso : son auteur, et la personne choisie quand il l'a créé pour quelqu'un d'autre (prévenue sur Discord) ;
//   - tous  : tout compte validé ;
//   - grade : événements explicitement accessibles à ce grade.
// Chaque grade a trois listes explicites, réglées dans sa fiche (page Grades), sans héritage implicite.
// Les événements pour toute l'équipe ont des droits de consultation et de modification séparés.
// Le propriétaire du serveur Discord a tout. Ses propres événements, chacun les voit et les gère toujours ; le « Perso »
// d'un autre ne se gère que par son auteur.

export const DESTINATIONS = ['perso', 'tous', 'grade'] as const;
export type Destination = (typeof DESTINATIONS)[number];
export const estDestination = (v: unknown): v is Destination => typeof v === 'string' && (DESTINATIONS as readonly string[]).includes(v);

export type DroitsAgenda = {
  tout: boolean;
  consulter: string[];
  creer: string[];
  modifier: string[];
  consulterTous: boolean;
  gererTous: boolean;
};
export type DroitsEnregistres = {
  consulter: string[];
  creer: string[];
  modifier: string[];
  consulterTous?: boolean;
  gererTous?: boolean;
} | null;

// droits d'un compte ; une clé de grade supprimée est ignorée jusqu'au nettoyage de sa ligne
export function droitsAgenda(grades: readonly string[], gradeCle: string | null, proprietaire: boolean, enregistres: DroitsEnregistres): DroitsAgenda {
  if (proprietaire) return { tout: true, consulter: [...grades], creer: [...grades], modifier: [...grades], consulterTous: true, gererTous: true };
  const lire = (v: string[] | undefined): string[] => Array.isArray(v) ? [...new Set(v.filter(cle => grades.includes(cle)))] : [];
  if (!gradeCle || !grades.includes(gradeCle)) return { tout: false, consulter: [], creer: [], modifier: [], consulterTous: true, gererTous: false };
  return {
    tout: false,
    consulter: lire(enregistres?.consulter),
    creer: lire(enregistres?.creer),
    modifier: lire(enregistres?.modifier),
    consulterTous: enregistres?.consulterTous ?? false,
    gererTous: enregistres?.gererTous ?? false,
  };
}

const droitSurGrade = (autorisations: readonly string[], destination: string, destinationGrade: string | null): boolean =>
  destination === 'grade' && !!destinationGrade && autorisations.includes(destinationGrade);

export type EvenementVu = { compteId: number | null; destination: string; destinationGrade: string | null; invitesDiscordIds?: readonly string[] };
export type Lecteur = { id: number; discordId: string | null };

export function voit(e: EvenementVu, moi: Lecteur, d: DroitsAgenda, _grades: readonly string[]): boolean {
  if (e.compteId === moi.id) return true;
  if (e.destination === 'perso') return !!moi.discordId && !!e.invitesDiscordIds?.includes(moi.discordId);
  if (e.destination === 'tous') return d.tout || d.consulterTous;
  return d.tout || droitSurGrade(d.consulter, e.destination, e.destinationGrade);
}

export function modifiable(e: EvenementVu, moi: Lecteur, d: DroitsAgenda, _grades: readonly string[]): boolean {
  if (e.compteId === moi.id) return true;
  if (e.destination === 'perso') return false;
  if (e.destination === 'tous') return d.tout || (d.consulterTous && d.gererTous);
  return d.tout || droitSurGrade(d.modifier, e.destination, e.destinationGrade);
}

// créer (ou déplacer un événement vers) cette destination ; « perso » pour soi : toujours
export const peutCreer = (d: DroitsAgenda, destination: Destination, destinationGrade: string | null, _grades: readonly string[]): boolean =>
  destination === 'perso' || d.tout || (destination === 'tous' ? d.consulterTous && d.gererTous : droitSurGrade(d.creer, destination, destinationGrade));

// Une personne ne peut être invitée que si son grade exact est autorisé à la création.
export function peutInviter(d: DroitsAgenda, gradeCible: string | null, grades: readonly string[]): boolean {
  if (d.tout) return true;
  return !!gradeCible && grades.includes(gradeCible) && d.creer.includes(gradeCible);
}

// Un acteur ne peut accorder des droits qu'à son propre grade ou à un grade inférieur.
export function gradeAccordable(cle: string, grades: readonly string[], gradeActeur: string | null, proprietaire: boolean): boolean {
  if (!grades.includes(cle)) return false;
  if (proprietaire) return true;
  return !!gradeActeur && grades.includes(gradeActeur) && grades.indexOf(cle) >= grades.indexOf(gradeActeur);
}

// Comme les permissions : on n'accorde à un grade que des droits qu'on détient soi-même. Renvoie les grades ajoutés à
// la liste (par rapport à ce qui était enregistré) que l'acteur n'a pas dans sa propre liste ; retirer reste libre, et un
// droit déjà accordé par un supérieur peut être conservé.
export const ajoutsNonDetenus = (acteur: DroitsAgenda, propre: readonly string[], avant: readonly string[], apres: readonly string[]): string[] =>
  acteur.tout ? [] : apres.filter(cle => !avant.includes(cle) && !propre.includes(cle));

export const droitsInclusDansConsultation = (consulter: readonly string[], droits: readonly string[]): boolean =>
  droits.every(cle => consulter.includes(cle));

// « 2026-10-08 », « 14:30 », heure de Paris (celle du serveur RP, heure d'été comprise) → instant réel
export function parisVersDate(jour: string, heure: string): Date {
  const [a, mo, j] = jour.split('-').map(Number), [h, mi] = heure.split(':').map(Number);
  const naif = Date.UTC(a, mo - 1, j, h, mi);
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const decalage = (instant: number) => {
    const p = Object.fromEntries(format.formatToParts(new Date(instant)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - instant;
  };
  const premier = naif - decalage(naif);
  return new Date(naif - decalage(premier));   // second passage : jour de changement d'heure
}

export type SalonDiscord = { id?: unknown; type?: unknown; parent_id?: unknown; permission_overwrites?: { id?: unknown; type?: unknown }[] };

// ticket le plus récent de la personne : salon texte d'une des catégories réglées où elle a une permission à son nom
// (un bot de tickets ouvre ainsi le salon à celui qui l'a créé). Les ID Discord croissent avec le temps.
export function choisirTicket(salons: unknown, discordId: string, categories: readonly string[]): string | null {
  const tickets = (Array.isArray(salons) ? salons as SalonDiscord[] : [])
    .filter(c => c && c.type === 0 && /^\d{15,22}$/.test(String(c.id)) && categories.includes(String(c.parent_id ?? ''))
      && (c.permission_overwrites ?? []).some(o => String(o.type) === '1' && String(o.id) === discordId))
    .map(c => BigInt(String(c.id)));
  if (!tickets.length) return null;
  return String(tickets.reduce((a, b) => (b > a ? b : a)));
}
