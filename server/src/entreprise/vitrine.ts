// ENTREPRISE — contenu de la vitrine publique (module « vitrine », table services_vitrine…) : services de la page d'accueil,
// leurs étiquettes et les postes ouverts. Autant de services qu'on veut, ordre réglable, masqués ou supprimés
// définitivement (aucune table ne référence un service par id). Photo : routes/vitrine.ts (clé d'apparence service-<id>).
import { prisma } from '../socle/db.js';
import { couleur as validerCouleur } from '../socle/http.js';
import { Refus } from './refus.js';

const texte = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const codeErreur = (e: unknown) => (e as { code?: string }).code;

export const RESUME_MAX = 120, DESCRIPTION_MAX = 400, INCLUS_MAX = 6, POINT_MAX = 60;
const ETIQUETTES_MAX = 30, POSTES_MAX = 30;

export type ServiceVitrine = {
  id: number; nom: string; resume: string; description: string; inclus: string[]; etiquetteIds: number[]; position: number; masque: boolean;
};
export type EtiquetteService = { id: number; nom: string; couleur: string };

export async function listerServices(): Promise<ServiceVitrine[]> {
  return (await prisma.serviceVitrine.findMany({ orderBy: { position: 'asc' } })).map(s => ({ ...s, inclus: Array.isArray(s.inclus) ? s.inclus.map(String) : [] }));
}
export const listerEtiquettes = (): Promise<EtiquetteService[]> => prisma.etiquetteService.findMany({ orderBy: [{ position: 'asc' }, { nom: 'asc' }] });
export async function serviceDe(id: number): Promise<ServiceVitrine | undefined> { return (await listerServices()).find(s => s.id === id); }

// ---- saisie d'un service (fonction pure, testée) : seules les étiquettes qui existent encore, sans doublon ----
export function lireService(b: Record<string, unknown>, etiquettes: readonly EtiquetteService[]) {
  const nom = texte(b.nom, 60);
  if (!nom) throw new Refus('Donnez un nom au service.');
  const resume = String(b.resume ?? '').trim();
  if (resume.length > RESUME_MAX) throw new Refus(`Le résumé tient en ${RESUME_MAX} caractères au plus.`);
  const description = String(b.description ?? '').trim();
  if (description.length > DESCRIPTION_MAX) throw new Refus(`Décrivez ce service en ${DESCRIPTION_MAX} caractères au plus.`);
  const inclus = (Array.isArray(b.inclus) ? b.inclus : []).map(p => String(p ?? '').trim()).filter(Boolean);
  if (inclus.length > INCLUS_MAX) throw new Refus(`${INCLUS_MAX} points inclus au plus.`);
  const tropLong = inclus.find(p => p.length > POINT_MAX);
  if (tropLong) throw new Refus(`« ${tropLong.slice(0, 30)}… » dépasse ${POINT_MAX} caractères.`);
  const saisies = Array.isArray(b.etiquetteIds) ? b.etiquetteIds.map(Number) : [];
  const etiquetteIds = [...new Set(saisies)].filter(id => etiquettes.some(e => e.id === id));
  return { nom, resume, description, inclus, etiquetteIds, masque: !!b.masque };
}

export async function creerService(b: Record<string, unknown>): Promise<number> {
  const s = lireService(b, await listerEtiquettes());
  const dernier = await prisma.serviceVitrine.aggregate({ _max: { position: true } });
  return (await prisma.serviceVitrine.create({ data: { ...s, position: (dernier._max.position ?? 0) + 1 } })).id;
}
export async function modifierService(id: number, b: Record<string, unknown>): Promise<void> {
  const s = lireService(b, await listerEtiquettes());
  try { await prisma.serviceVitrine.update({ where: { id }, data: s }); }
  catch (e) { if (codeErreur(e) === 'P2025') throw new Refus('Service introuvable.', 404); throw e; }
}
// nouvel ordre complet (liste des id)
export async function ordonnerServices(ids: unknown): Promise<void> {
  const liste = Array.isArray(ids) ? ids.map(Number) : [];
  const actuels = await prisma.serviceVitrine.findMany({ select: { id: true } });
  if (liste.length !== actuels.length || !actuels.every(s => liste.includes(s.id))) throw new Refus('Ordre incomplet : actualisez la page puis réessayez.');
  await prisma.$transaction(liste.map((id, i) => prisma.serviceVitrine.update({ where: { id }, data: { position: i + 1 } })));
}
// sa photo (apparence_images) part au nettoyage du stockage comme un remplacement normal
export async function supprimerService(id: number): Promise<void> {
  await prisma.$transaction(async tx => {
    const photo = await tx.apparenceImage.findUnique({ where: { cle: `service-${id}` } });
    if (photo) {
      await tx.apparenceImage.delete({ where: { cle: `service-${id}` } });
      await tx.imageRetiree.create({ data: { cle: photo.cleImage, url: photo.url, cleMini: photo.cleMini, urlMini: photo.urlMini } });
    }
    await tx.serviceVitrine.delete({ where: { id } });
  });
}

// ---- étiquettes ----
const nomPris = (e: unknown) => codeErreur(e) === 'P2002';
function lireEtiquette(b: Record<string, unknown>) {
  const nom = texte(b.nom, 40);
  if (!nom) throw new Refus('Donnez un nom à l’étiquette.');
  const c = validerCouleur(b.couleur);
  if (!c) throw new Refus('Couleur invalide.');
  return { nom, couleur: c };
}
export async function creerEtiquette(b: Record<string, unknown>): Promise<void> {
  const e = lireEtiquette(b);
  if (await prisma.etiquetteService.count() >= ETIQUETTES_MAX) throw new Refus(`${ETIQUETTES_MAX} étiquettes au plus : regroupez-en avant d’en créer une autre.`);
  const dernier = await prisma.etiquetteService.aggregate({ _max: { position: true } });
  try { await prisma.etiquetteService.create({ data: { ...e, position: (dernier._max.position ?? -1) + 1 } }); }
  catch (err) { if (nomPris(err)) throw new Refus(`L’étiquette « ${e.nom} » existe déjà.`, 409); throw err; }
}
export async function modifierEtiquette(id: number, b: Record<string, unknown>): Promise<void> {
  const e = lireEtiquette(b);
  try { await prisma.etiquetteService.update({ where: { id }, data: e }); }
  catch (err) {
    if (nomPris(err)) throw new Refus(`L’étiquette « ${e.nom} » existe déjà.`, 409);
    if (codeErreur(err) === 'P2025') throw new Refus('Étiquette introuvable.', 404);
    throw err;
  }
}
// retirée de tous les services qui la portaient : un service ne garde jamais un id d'étiquette disparu
export async function supprimerEtiquette(id: number): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.etiquetteService.deleteMany({ where: { id } });
    const porteurs = await tx.serviceVitrine.findMany({ where: { etiquetteIds: { has: id } }, select: { id: true, etiquetteIds: true } });
    for (const s of porteurs) await tx.serviceVitrine.update({ where: { id: s.id }, data: { etiquetteIds: s.etiquetteIds.filter(x => x !== id) } });
  });
}

// ---- postes ouverts : réglés à la main (jamais calculés depuis l'effectif réel) ----
export const listerPostes = () => prisma.posteOuvert.findMany({ orderBy: [{ position: 'asc' }, { nom: 'asc' }] });
function lirePoste(b: Record<string, unknown>) {
  const nom = texte(b.nom, 80);
  if (!nom) throw new Refus('Donnez un nom au poste.');
  const nombre = Number(b.nombre);
  if (!Number.isInteger(nombre) || nombre < 0 || nombre > 999) throw new Refus('Le nombre de places doit être un entier entre 0 et 999.');
  return { nom, nombre };
}
export async function creerPoste(b: Record<string, unknown>): Promise<void> {
  const p = lirePoste(b);
  if (await prisma.posteOuvert.count() >= POSTES_MAX) throw new Refus(`${POSTES_MAX} postes au plus : regroupez-en avant d’en créer un autre.`);
  const dernier = await prisma.posteOuvert.aggregate({ _max: { position: true } });
  await prisma.posteOuvert.create({ data: { ...p, position: (dernier._max.position ?? -1) + 1 } });
}
export async function modifierPoste(id: number, b: Record<string, unknown>): Promise<void> {
  const p = lirePoste(b);
  try { await prisma.posteOuvert.update({ where: { id }, data: p }); }
  catch (err) { if (codeErreur(err) === 'P2025') throw new Refus('Poste introuvable.', 404); throw err; }
}
export const supprimerPoste = (id: number) => prisma.posteOuvert.deleteMany({ where: { id } });

// ---- lecture publique de la page d'accueil : services non masqués avec leurs étiquettes résolues, postes à pourvoir ----
export async function servicesPublics(urlPhoto: (s: ServiceVitrine) => string | null) {
  const [services, etiquettes] = await Promise.all([listerServices(), listerEtiquettes()]);
  return services.filter(s => !s.masque).map(s => ({
    id: s.id, nom: s.nom, resume: s.resume, description: s.description, inclus: s.inclus, urlPhoto: urlPhoto(s),
    etiquettes: s.etiquetteIds.map(id => etiquettes.find(e => e.id === id)).filter((e): e is EtiquetteService => !!e).map(e => ({ nom: e.nom, couleur: e.couleur })),
  }));
}
export const postesPublics = async () => (await listerPostes()).filter(p => p.nombre > 0);

// ---- page d'accueil : sections rendues par le serveur, dans le HTML envoyé (rien ne se redessine après l'arrivée de la page) ----
// index.html garde ses sections cachées (`data-si-services`, `data-si-postes` + `hidden`) et deux conteneurs vides ; on remplit
// les conteneurs et on retire `hidden` seulement s'il y a quelque chose à montrer. Fonction pure (testée).
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
type ServicePublic = Awaited<ReturnType<typeof servicesPublics>>[number];
type PostePublic = { nom: string; nombre: number };

const etiquettesHtml = (liste: ServicePublic['etiquettes']) => liste.length
  ? `<p class="etiquettes">${liste.map(t => `<span class="etiquette"${/^#[0-9a-f]{6}$/i.test(t.couleur) ? ` data-couleur="${t.couleur}"` : ''}>${esc(t.nom)}</span>`).join('')}</p>` : '';

export function injecterVitrine(html: string, services: ServicePublic[], postes: PostePublic[]): string {
  if (services.length) {
    const cartes = services.map((s, i) => `<article class="carte carte--service">${s.urlPhoto ? `<img class="carte__photo" src="${esc(s.urlPhoto)}" alt="" loading="lazy" width="340" height="191">` : ''}<h3>${esc(s.nom)}</h3>${s.resume ? `<p>${esc(s.resume)}</p>` : ''}${etiquettesHtml(s.etiquettes)}${s.description || s.inclus.length ? `<button type="button" class="btn btn--ligne" data-service="${i}" aria-label="Découvrir : ${esc(s.nom)}">Découvrir</button>` : ''}</article>`).join('');
    // données de la fiche (fenêtre « Découvrir ») : « < » échappé, le bloc ne peut pas se refermer sur une saisie
    const donnees = JSON.stringify(services).replace(/</g, '\\u003c');
    html = html.replace('<div class="cartes cartes--services" id="services-liste"></div>', () => `<div class="cartes cartes--services" id="services-liste">${cartes}</div><script type="application/json" id="vitrine-services">${donnees}</script>`)
      .replace(/ data-si-services hidden/g, '');
  }
  if (postes.length) {
    const lignes = postes.map(p => `<li class="poste"><strong>${esc(p.nom)}</strong><span class="poste__places">${p.nombre} place${p.nombre > 1 ? 's' : ''}</span></li>`).join('');
    html = html.replace('<ul class="postes" id="postes-liste"></ul>', () => `<ul class="postes" id="postes-liste">${lignes}</ul>`).replace(/ data-si-postes hidden/g, '');
  }
  return html;
}

// adresse de la photo d'un service (la version change avec la photo : jamais l'ancienne en cache) ; masqué : par la gestion seulement
// version dans l'adresse : une photo remplacée change d'adresse, le navigateur ne garde jamais l'ancienne
export function urlPhoto(s: ServiceVitrine, photo: { majLe: Date } | undefined, mini = false): string | null {
  if (!photo) return null;
  const base = s.masque ? `/api/vitrine/services/${s.id}/apercu${mini ? '-mini' : ''}` : `/assets/img/service-${s.id}${mini ? '-mini' : ''}.webp`;
  return `${base}?v=${photo.majLe.getTime()}`;
}
