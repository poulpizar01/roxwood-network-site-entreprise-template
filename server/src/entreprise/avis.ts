// ENTREPRISE — avis publics de la vitrine (module « avis ») : dépôt par une personne dont l'identité est prouvée par Discord
// (vérification légère du socle : jamais la seule limite de débit), publication après modération (permission « avis »),
// un seul avis épinglé à la fois, un seul avis en attente par personne.
import { prisma } from '../socle/db.js';
import type { IdentiteVerifiee } from '../socle/routes/discord-leger.js';
import { Refus } from './refus.js';

export const STATUTS_AVIS = ['attente', 'publie', 'refuse'] as const;
export type StatutAvis = typeof STATUTS_AVIS[number];

const texte = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

// nombre d'avis par page de la vitrine (/avis.html) ; l'accueil n'en montre que 4 (épinglé + 3), voir listerAvisAccueil
export const AVIS_PAR_PAGE = 6;

export function lireChampsAvis(b: Record<string, unknown>) {
  const nom = texte(b.nom, 100);
  if (!nom) throw new Refus('Le nom est obligatoire.');
  const avisTexte = texte(b.texte, 800);
  if (!avisTexte) throw new Refus('L’avis est obligatoire.');
  const note = Number(b.note);
  if (!Number.isInteger(note) || note < 1 || note > 5) throw new Refus('La note doit être comprise entre 1 et 5.');
  return { nom, entreprise: texte(b.entreprise, 100) || null, note, texte: avisTexte };
}

// ---- formulaire public : identité Discord exigée (la route la lit du cookie signé, jamais du corps) ----
export async function creerAvis(b: Record<string, unknown>, identite: IdentiteVerifiee | null) {
  if (!identite) throw new Refus('Connectez-vous avec Discord pour déposer un avis.', 401);
  const champs = lireChampsAvis(b);
  // un avis à la fois : le suivant attend que le premier soit modéré (évite qu'une même personne remplisse la file)
  if (await prisma.avis.count({ where: { discordId: identite.id, statut: 'attente' } })) {
    throw new Refus('Vous avez déjà un avis en attente de validation : il sera examiné avant que vous puissiez en déposer un autre.', 409);
  }
  return prisma.avis.create({ data: { ...champs, discordId: identite.id, pseudoDiscord: identite.pseudo.slice(0, 100) } });
}

// ---- lecture publique (accueil + page « Tous les avis ») ----
// seuls les champs que la vitrine affiche : ni identifiant, ni statut de modération, ni compte Discord
type LigneAvis = { nom: string; entreprise: string | null; note: number; texte: string; epingle: boolean; creeLe: Date };
export type AvisPublic = ReturnType<typeof publicAvis>;
const publicAvis = ({ nom, entreprise, note, texte, epingle, creeLe }: LigneAvis) => ({ nom, entreprise, note, texte, epingle, creeLe });

// l'épinglé (s'il existe) passe toujours en tête, même hors de son rang chronologique ; jamais répété sur la page 1
export async function listerAvisAccueil() {
  const epingle = await prisma.avis.findFirst({ where: { statut: 'publie', epingle: true } });
  const autres = await prisma.avis.findMany({
    where: { statut: 'publie', id: { not: epingle?.id ?? -1 } },
    orderBy: { creeLe: 'desc' },
    take: epingle ? 3 : 4,
  });
  return (epingle ? [epingle, ...autres] : autres).map(publicAvis);
}

// Pagination d'une page de la vitrine (pure, sans base). L'épinglé (s'il existe) occupe une place à part sur la page 1
// (affiché en tête, jamais répété) ; les pages suivantes continuent la liste des « autres » là où la page 1 l'a laissée.
export function calculerPageAvis(total: number, pageDemandee: number, epinglePresent: boolean) {
  const totalPages = Math.max(1, Math.ceil(total / AVIS_PAR_PAGE));
  const page = Math.min(Math.max(1, Number.isInteger(pageDemandee) ? pageDemandee : 1), totalPages);
  const slotsAutresPage1 = epinglePresent ? AVIS_PAR_PAGE - 1 : AVIS_PAR_PAGE;
  const skip = page === 1 ? 0 : slotsAutresPage1 + (page - 2) * AVIS_PAR_PAGE;
  const take = page === 1 ? slotsAutresPage1 : AVIS_PAR_PAGE;
  return { page, totalPages, skip, take, avecEpingle: page === 1 && epinglePresent };
}

export async function listerAvisPublics(pageDemandee: number) {
  const total = await prisma.avis.count({ where: { statut: 'publie' } });
  const epingle = await prisma.avis.findFirst({ where: { statut: 'publie', epingle: true } });
  const { page, totalPages, skip, take, avecEpingle } = calculerPageAvis(total, pageDemandee, !!epingle);
  const autres = await prisma.avis.findMany({
    where: { statut: 'publie', id: { not: epingle?.id ?? -1 } },
    orderBy: { creeLe: 'desc' },
    skip, take,
  });
  return { avis: (avecEpingle ? [epingle!, ...autres] : autres).map(publicAvis), page, totalPages, total };
}

// ---- gestion (permissions « avis-voir » / « avis ») : le pseudo Discord de l'auteur y est visible, jamais son identifiant ----
export async function listerAvisGestion() {
  return (await prisma.avis.findMany({ orderBy: { creeLe: 'desc' }, take: 1000 })).map(({ discordId: _id, ...a }) => a);
}

async function avisOu404(id: number) {
  const a = await prisma.avis.findUnique({ where: { id } });
  if (!a) throw new Refus('Avis introuvable.', 404);
  return a;
}
const sansIdentifiant = ({ discordId: _id, ...a }: Awaited<ReturnType<typeof avisOu404>>) => a;

export async function publierAvis(id: number) {
  await avisOu404(id);
  return sansIdentifiant(await prisma.avis.update({ where: { id }, data: { statut: 'publie' } }));
}
export async function refuserAvis(id: number) {
  await avisOu404(id);
  return sansIdentifiant(await prisma.avis.update({ where: { id }, data: { statut: 'refuse', epingle: false } }));
}
// retour en modération : n'est plus affiché, donc plus mis en avant non plus
export async function remettreEnAttenteAvis(id: number) {
  await avisOu404(id);
  return sansIdentifiant(await prisma.avis.update({ where: { id }, data: { statut: 'attente', epingle: false } }));
}
// un seul avis épinglé à la fois : on désépingle les autres dans la même transaction
export async function epinglerAvis(id: number) {
  const a = await avisOu404(id);
  if (a.statut !== 'publie') throw new Refus('Seul un avis publié peut être mis en avant.');
  await prisma.$transaction([
    prisma.avis.updateMany({ where: { epingle: true }, data: { epingle: false } }),
    prisma.avis.update({ where: { id }, data: { epingle: true } }),
  ]);
}
export async function desepinglerAvis(id: number) {
  await avisOu404(id);
  await prisma.avis.update({ where: { id }, data: { epingle: false } });
}
export async function supprimerAvis(id: number) {
  await avisOu404(id);
  await prisma.avis.delete({ where: { id } });
}

// ---- page d'accueil : section rendue par le serveur (comme les services : rien ne saute à l'affichage) ----
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ETOILE = '<path d="M10 1l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L10 14.9 4.4 18l1.4-6.2L1 7.5l6.4-.6z"/>';
const jour = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

export const carteAvisHtml = (a: AvisPublic) =>
  `<article class="avis-carte${a.epingle ? ' avis-carte--epingle' : ''}">${a.epingle ? '<p class="avis-carte__label">Avis mis en avant</p>' : ''}`
  + `<div class="etoiles" role="img" aria-label="${a.note} sur 5">${[1, 2, 3, 4, 5].map(n => `<svg class="${n <= a.note ? 'est-pleine' : 'est-vide'}" viewBox="0 0 20 20" aria-hidden="true">${ETOILE}</svg>`).join('')}</div>`
  + `<p class="avis-carte__texte">« ${esc(a.texte)} »</p>`
  + `<p class="avis-carte__auteur">${esc(a.nom)}<span>${a.entreprise ? `${esc(a.entreprise)} · ` : ''}${jour(a.creeLe)}</span></p></article>`;

// la section reste visible même sans avis publié : elle porte le lien « Donner votre avis »
export function injecterAvis(html: string, avis: AvisPublic[]): string {
  const liste = avis.length ? avis.map(carteAvisHtml).join('') : '<p class="avis-vide">Aucun avis publié pour le moment.</p>';
  return html.replace('<div class="avis" id="avis-liste"></div>', () => `<div class="avis" id="avis-liste">${liste}</div>`).replace(/ data-si-avis hidden/g, '');
}
