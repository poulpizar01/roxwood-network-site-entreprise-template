// ENTREPRISE — normalisation des noms et des dates, partagée par les modules (RH, ventes, tableur, agenda).

// pseudo Discord comparé sans casse ni espaces autour
export const normaliserPseudo = (brut: unknown): string => String(brut ?? '').trim().toLowerCase();
// nom comparé sans casse ni accents (« Élodie » = « elodie »)
export const normaliserTexte = (brut: unknown): string =>
  String(brut ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// jour sans heure (AAAA-MM-JJ) : stocké en DATE, échangé tel quel — jamais d'heure ni de fuseau qui le décalerait
export const versDate = (jour: string): Date => new Date(`${jour}T00:00:00Z`);
export const versJour = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : '');
export const jourValide = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(versDate(v).getTime()) && versDate(v).toISOString().startsWith(v);
// date du jour à Paris (heure du serveur RP), AAAA-MM-JJ
export const jourParis = (instant?: string | Date): string => {
  const d = instant ? new Date(instant) : new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Number.isNaN(d.getTime()) ? new Date() : d);
};
// décalage (en minutes) de l'heure de Paris par rapport à UTC au jour donné (+60 en hiver, +120 en été)
const decalageParis = (d: Date): number => {
  const nom = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value ?? 'GMT+0';
  return (Number(/GMT([+-]\d+)/.exec(nom)?.[1]) || 0) * 60;
};
// lundi de la semaine en cours ou d'un jour donné (calendrier Paris), pour cumuler un objectif hebdomadaire (quota de
// runs) ou consulter une semaine passée. Minuit posé en heure de Paris (CET/CEST), pas en UTC.
export const debutSemaineParis = (jour?: string): Date => {
  const lundi = versDate(jour ?? jourParis());
  lundi.setUTCDate(lundi.getUTCDate() - ((lundi.getUTCDay() + 6) % 7));
  return new Date(lundi.getTime() - decalageParis(lundi) * 60000);
};
