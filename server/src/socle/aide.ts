// SOCLE — Aide en ligne : articles lus sur le disque (jamais en base), filtrés par compte avant d'être envoyés. Un
// article hérite par défaut du niveau d'accès de la page qu'il décrit (entreprise.pages, via declarerNiveauPage,
// transmis par index.ts comme pour declarerParametres — ce module ne lit pas entreprise/index.ts, dépendance
// circulaire) ; `permission` en en-tête le surcharge. Un passage réservé (`::: si <permission>`) est retiré pour qui
// n'a pas la permission : jamais envoyé au navigateur, donc jamais trouvé par la recherche.
//
// Deux dossiers de contenu, à la racine du dépôt (jamais servis statiquement, voir index.ts) :
//   - aide-socle/ : articles fournis par le modèle, mis à jour avec lui ;
//   - aide/ : articles de l'entreprise, qui peut remplacer un article du socle en reprenant le même nom de fichier.
// Relus au démarrage puis à la demande en développement (comme site.ts) ; mis en cache en production.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Compte } from '../generated/prisma/client.js';
import type { NiveauPage } from './contrat.js';
import { config } from './config.js';
import { peut, permissions as toutesLesPermissions } from './droits.js';

type Chunk = { permission: string | null; html: string; texte: string; schema?: string; etapes?: string[] };
type Intertitre = { id: string; texte: string };
// position d'un repère sur le schéma de la page, en % (x, y) ; a : repère d'attention (ambre)
export type Repere = { x: number; y: number; a: boolean };
export type Article = {
  slug: string; titre: string; rubrique: string; motsCles: string[]; permission?: string;
  type: 'article' | 'faq'; suggestion: boolean; voirAussi: string[]; reperes: Repere[]; zone: string;
  chunks: Chunk[]; intertitres: Intertitre[];
};
// schema / etapes : lus dans les passages visibles seulement (un schéma ou une étape d'un « si » réservé ne fuit jamais)
export type ArticleResume = { slug: string; titre: string; rubrique: string; extrait: string; type: 'article' | 'faq'; suggestion: boolean; schema: string | null; etapes: string[]; reperes: Repere[]; zone: string };
export type ArticleFiltre = {
  slug: string; titre: string; rubrique: string; html: string; intertitres: Intertitre[]; type: 'article' | 'faq'; reperes: Repere[];
  minutes: number; pastilles: string[]; voirAussi: { slug: string; titre: string; rubrique: string; schema: string | null }[];
};

let niveauPage: Record<string, NiveauPage> = {};
// transmis par index.ts une fois NIVEAU_PAGE construit (mêmes règles que l'accès aux pages de gestion/)
export function declarerNiveauPage(carte: Record<string, NiveauPage>): void {
  niveauPage = carte;
  for (const a of articles.values()) if (!(a.rubrique in carte)) console.warn(`aide : « ${a.slug} » cite une rubrique inconnue « ${a.rubrique} » (compte validé exigé par défaut)`);
}

// synonymes du métier pour la recherche (« rib » → « rib virement »…), déclarés par l'entreprise ; facultatif
let synonymes: Record<string, string[]> = {};
export function declarerSynonymes(carte: Record<string, string[]> = {}): void { synonymes = carte; }

const normaliser = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// même longueur que le texte d'origine (accents retirés, minuscules) : sert à retrouver une position pour un extrait lisible
const normaliserSimple = (v: string): string => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const echapper = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const permissionLibelle = (cle: string): string => toutesLesPermissions.find(p => p.cle === cle)?.libelle ?? cle;

// --- inline : gras, code, lien, bouton, chemin ( {chemin:A›B} ), touche ( {Ctrl} ) --------------------------------
function inline(ligneBrute: string): string {
  let l = echapper(ligneBrute);
  l = l.replace(/`([^`]+)`/g, '<code>$1</code>');
  l = l.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  l = l.replace(/\[([^\]]+)\]\((\/[^)\s]*|#[^)\s]*)\)/g, '<a href="$2">$1</a>');                 // lien interne seulement
  l = l.replace(/\{chemin:([^}]+)\}/g, (_m, chemin) => {
    const etapes = chemin.split('›').map((e: string) => `<span>${e.trim()}</span>`);
    return `<span class="chemin">${etapes.join('<svg class="ico-ch" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>')}</span>`;
  });
  l = l.replace(/\{([^}:]{1,20})\}/g, '<span class="kbd">$1</span>');                              // touche
  l = l.replace(/\[-([^\]]+)\]/g, '<span class="ui-btn ui-btn-sec">$1</span>');                    // bouton secondaire
  l = l.replace(/\[([^\]]+)\]/g, '<span class="ui-btn">$1</span>');                                 // bouton principal
  return l;
}
const texteSeul = (ligneBrute: string): string => ligneBrute.replace(/[*`[\]{}]/g, '').replace(/chemin:|›/g, ' ');

const echapperTitre = (v: string): string => v.replace(/[\[\]{}*`]/g, '');   // le titre en gras ne porte pas de balisage

// --- blocs : ::: si <permission>, ::: etapes, ::: cycle, ::: attention <titre>, ::: info ---------------------------
function rendreBloc(type: string, arg: string, lignes: string[]): { html: string; texte: string; schema?: string; etapes?: string[] } {
  const corps = lignes.join('\n');
  if (type === 'etapes') {
    const items = lignes.filter(Boolean).map(l => {
      const m = /^\*\*([^*]+)\*\*\s*(.*)$/.exec(l.trim());
      if (!m) return `<li><div>${inline(l)}</div></li>`;
      // « **Dans « Créer un poste »**, saisissez… » : une suite qui commence par une ponctuation prolonge la phrase du titre,
      // elle ne se met pas dessous (elle commencerait par une virgule)
      if (/^[,;:.]/.test(m[2])) return `<li><span class="num"></span><div><b>${inline(echapperTitre(m[1]) + (m[2].startsWith(':') ? ' ' : '') + m[2])}</b></div></li>`;
      return `<li><span class="num"></span><div><b>${echapper(m[1])}</b><span class="d">${inline(m[2])}</span></div></li>`;
    });
    const titres = lignes.filter(Boolean).map(l => texteSeul(l).replace(/\s+/g, ' ').trim());
    return { html: `<ol class="etapes">${items.join('')}</ol>`, texte: lignes.map(texteSeul).join(' '), etapes: titres };
  }
  if (type === 'cycle') {
    // « À venir (pas encore facturée) > ~facturer > Facturée (facture émise) | Annulée (retour à « À venir ») » :
    // « (…) » = sous-titre de l'état, « ~mot » = légende de la flèche qui suit, « | » = état à part, sans flèche.
    const [principal, ...parts] = (arg || lignes.join(' ')).split('|');
    const COULEURS = ['accent', 'alerte', 'ok'];
    const carte = (e: string, i: number, aPart = false) => {
      const m = /^([^(]+?)\s*(?:\((.*)\))?$/.exec(e.trim());
      const couleur = aPart ? 'var(--erreur)' : `var(--${COULEURS[i % COULEURS.length] === 'accent' ? 'accent-dark' : COULEURS[i % COULEURS.length]})`;
      return `<div class="etat${aPart ? ' etat-a-part' : ''}" style="--c:${couleur}"><b>${echapper(m?.[1] ?? e)}</b>${m?.[2] ? `<small>${echapper(m[2])}</small>` : ''}</div>`;
    };
    const jetons = principal.split('>').map(e => e.trim()).filter(Boolean);
    let html = '', etat = 0, etiquette = '';
    for (let k = 0; k < jetons.length; k++) {
      if (jetons[k].startsWith('~')) { etiquette = jetons[k].slice(1).trim(); continue; }
      if (etat > 0) html += `<span class="fl" aria-hidden="true"><svg viewBox="0 0 34 14"><path d="M2 7h28M24 2l6 5-6 5"/></svg>${etiquette ? echapper(etiquette) : ''}</span>`;
      etiquette = '';
      html += carte(jetons[k], etat++);
    }
    html += parts.map(e => carte(e, 0, true)).join('');
    return { html: `<div class="cycle">${html}</div>`, texte: `${principal} ${parts.join(' ')}`.replace(/[>~|()]/g, ' ') };
  }
  if (type === 'attention' || type === 'info') {
    const icone = type === 'attention' ? 'alerte' : 'info';
    const titre = type === 'attention' && arg ? `<b>${echapper(arg)}</b>` : '';
    return { html: `<div class="encart ${type}"><svg class="ico" aria-hidden="true"><use href="#ico-${icone}"></use></svg><div>${titre}${lignes.map(l => `<p>${inline(l)}</p>`).join('')}</div></div>`, texte: `${arg} ${lignes.map(texteSeul).join(' ')}` };
  }
  if (type === 'schema') {
    // « N [cle] Libellé : texte » — [cle] facultatif, jamais affiché : si la page réelle porte data-zone="cle", la
    // coque entoure cet élément quand on clique la légende (D13). Le libellé, lui, est toujours une phrase lisible
    // (jamais l'identifiant technique de la zone) : « Type d'absence », pas « sorte-absence ».
    const legende = lignes.filter(Boolean).map(l => {
      const m = /^(\d+)\s+(?:\[([a-z0-9-]+)\]\s+)?([^:]+):\s*(.*)$/.exec(l.trim());
      if (!m) return '';
      const zoneRef = m[2] ? ` data-zone-ref="${echapper(m[2])}"` : '';
      return `<li${zoneRef}><span class="rep">${m[1]}</span><span><b>${echapper(m[3].trim())}</b> ${inline(m[4])}</span></li>`;
    }).join('');
    // le SVG réel de la page (fidèle à l'écran) est fourni par la coque (gestion.js, registre des schémas par page) :
    // le socle ne fait que réserver la zone et poser la légende, jamais de dessin inventé.
    const [nomSchema, ...legendeSchema] = arg.split('|');
    const cap = legendeSchema.join('|').trim();
    return { html: `<div class="figure" data-schema="${echapper(nomSchema.trim())}"><div class="sui" data-schema-svg></div><ol class="legende-sui">${legende}</ol></div>${cap ? `<p class="aide-cap">${echapper(cap)}</p>` : ''}`, texte: lignes.map(texteSeul).join(' '), schema: nomSchema.trim() };
  }
  return { html: `<p>${corps.split('\n').map(inline).join('<br>')}</p>`, texte: lignes.map(texteSeul).join(' ') };
}

// --- corps complet → liste de chunks (texte hors « si » toujours visible, « si x » retiré sans la permission x) ---
function rendreCorps(corps: string): { chunks: Chunk[]; intertitres: Intertitre[] } {
  const lignes = corps.replace(/\r\n/g, '\n').split('\n');
  const chunks: Chunk[] = [];
  const intertitres: Intertitre[] = [];
  let permissionCourante: string | null = null;
  let paragraphe: string[] = [];
  let liste: string[] = [];
  const ajouter = (html: string, texte: string, extra: { schema?: string; etapes?: string[] } = {}) => chunks.push({ permission: permissionCourante, html, texte, ...extra });
  const viderParagraphe = () => { if (paragraphe.length) { ajouter(`<p>${paragraphe.map(inline).join(' ')}</p>`, paragraphe.map(texteSeul).join(' ')); paragraphe = []; } };
  const viderListe = () => { if (liste.length) { ajouter(`<ul>${liste.map(l => `<li>${inline(l)}</li>`).join('')}</ul>`, liste.map(texteSeul).join(' ')); liste = []; } };

  let i = 0;
  while (i < lignes.length) {
    const ligne = lignes[i];
    const trim = ligne.trim();
    if (trim.startsWith('::: ') || trim === ':::') {
      viderParagraphe(); viderListe();
      if (trim === ':::') { i++; continue; }   // fermeture d'un « si » (son contenu a déjà été rendu ligne à ligne)
      const [, type, ...reste] = /^:::\s+(\S+)\s*(.*)$/.exec(trim) ?? [, '', ''];
      const arg = reste.join(' ');
      if (type === 'si') {
        const avant: string | null = permissionCourante;
        permissionCourante = arg.trim();
        i++;
        const sousLignes: string[] = [];
        while (i < lignes.length && lignes[i].trim() !== ':::') { sousLignes.push(lignes[i]); i++; }
        // shortcut: un « si » imbriqué dans un « si » perdrait sa propre permission (remplacée par celle du bloc englobant) ;
        // aucun article n'en a besoin pour l'instant — l'interdire proprement si ça arrive.
        const { chunks: sousChunks, intertitres: sousIntertitres } = rendreCorps(sousLignes.join('\n'));
        for (const c of sousChunks) chunks.push({ ...c, permission: permissionCourante });
        intertitres.push(...sousIntertitres);
        permissionCourante = avant;
        i++; continue;
      }
      const sousLignes: string[] = [];
      i++;
      while (i < lignes.length && lignes[i].trim() !== ':::') { sousLignes.push(lignes[i]); i++; }
      const { html, texte, schema, etapes } = rendreBloc(type, arg, sousLignes);
      ajouter(html, texte, { schema, etapes });
      i++; continue;
    }
    if (/^##\s+/.test(trim)) {
      viderParagraphe(); viderListe();
      const texte = trim.replace(/^##\s+/, '');
      const id = normaliser(texte).replace(/ /g, '-');
      intertitres.push({ id, texte });
      ajouter(`<h3 id="${id}">${inline(texte)}</h3>`, texte);
      i++; continue;
    }
    if (/^-\s+/.test(trim)) { viderParagraphe(); liste.push(trim.replace(/^-\s+/, '')); i++; continue; }
    if (trim === '') { viderParagraphe(); viderListe(); i++; continue; }
    viderListe(); paragraphe.push(trim); i++;
  }
  viderParagraphe(); viderListe();
  return { chunks, intertitres };
}

// --- en-tête (--- cle: valeur ---) : lecture minimale, volontairement sans dépendance YAML ------------------------
function lireEntete(brut: string): { entete: Record<string, string>; corps: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(brut);
  if (!m) return { entete: {}, corps: brut };
  const entete: Record<string, string> = {};
  for (const ligne of m[1].split('\n')) {
    const mc = /^([a-z-]+):\s*(.*)$/.exec(ligne.trim());
    if (mc) entete[mc[1]] = mc[2].trim();
  }
  return { entete, corps: m[2] };
}

// « reperes: 84,13; 50,44! » : un repère par étape de l'article, sur le schéma de la page (rubrique) ; « ! » = ambre
function lireReperes(brut: string): Repere[] {
  return brut.split(';').map(v => /^\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(!?)\s*$/.exec(v)).filter((m): m is RegExpExecArray => !!m)
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), a: !!m[3] }));
}

function construireArticle(slug: string, brutSource: string): Article | null {
  // fins de ligne normalisées avant toute chose : un article édité ou extrait sur Windows revient en CRLF (vu au
  // premier article réel, se-connecter.md, après un `git merge` dans un site), ce qui casse l'en-tête (---\n…).
  const brut = brutSource.replace(/\r\n/g, '\n');
  const { entete, corps } = lireEntete(brut);
  if (!entete.titre || !entete.rubrique) { console.warn(`aide : « ${slug} » ignoré (titre et rubrique obligatoires en en-tête)`); return null; }
  const { chunks, intertitres } = rendreCorps(corps);
  return {
    slug, titre: entete.titre, rubrique: entete.rubrique,
    motsCles: (entete['mots-cles'] || '').split(',').map(m => m.trim()).filter(Boolean),
    permission: entete.permission || undefined,
    type: entete.type === 'faq' ? 'faq' : 'article',
    suggestion: /^(oui|true|1)$/i.test(entete.suggestion || ''),
    reperes: lireReperes(entete.reperes || ''),
    zone: /^[a-z0-9-]+$/.test(entete.zone || '') ? entete.zone : '',
    voirAussi: (entete['voir-aussi'] || '').split(',').map(v => v.trim()).filter(Boolean),
    chunks, intertitres,
  };
}

function lireDossier(dossier: string): Map<string, Article> {
  const parSlug = new Map<string, Article>();
  let fichiers: string[] = [];
  try { fichiers = readdirSync(dossier).filter(f => f.endsWith('.md') && statSync(join(dossier, f)).isFile()); } catch { return parSlug; }
  for (const fichier of fichiers) {
    const slug = fichier.replace(/\.md$/, '');
    const a = construireArticle(slug, readFileSync(join(dossier, fichier), 'utf8'));
    if (a) parSlug.set(slug, a);
  }
  return parSlug;
}

let articles: Map<string, Article> = new Map();
let figePourTest = false;   // posé par _chargerArticlesDepuis : le relu de dev ne doit pas écraser les sources du test
export function chargerArticles(): void {
  // aide/ (entreprise) après aide-socle/ (modèle) : un même nom de fichier remplace l'article du socle
  articles = new Map([...lireDossier(join(config.root, 'aide-socle')), ...lireDossier(join(config.root, 'aide'))]);
}
chargerArticles();

// pour les tests seulement : remplace le contenu par des sources en mémoire, sans toucher au disque
export function _chargerArticlesDepuis(sources: Record<string, string>): void {
  figePourTest = true;
  articles = new Map(Object.entries(sources).map(([slug, brut]) => [slug, construireArticle(slug, brut)]).filter((e): e is [string, Article] => !!e[1]));
}

// --- accès : mêmes règles que l'accès aux pages de gestion/ (index.ts, accesPage) ---------------------------------
function accesNiveau(compte: Compte | null, niveau: NiveauPage | undefined): boolean {
  if (!niveau || niveau === 'valide') return !!compte && (compte.statut === 'valide');
  if (niveau === 'public') return true;
  if (niveau === 'connecte') return !!compte;
  if (!compte || compte.statut !== 'valide') return false;
  return peut(compte, niveau);
}
const accesArticle = (compte: Compte | null, a: Article): boolean => accesNiveau(compte, a.permission ?? niveauPage[a.rubrique]);

function filtrerChunks(compte: Compte | null, chunks: Chunk[]): Chunk[] {
  return chunks.filter(c => c.permission === null || (!!compte && peut(compte, c.permission)))
    .map(c => c.permission === null ? c : {
      ...c,
      html: `<div class="reserve"><div class="lib"><svg class="ico" aria-hidden="true"><use href="#ico-cle"></use></svg>Visible parce que vous avez « ${echapper(permissionLibelle(c.permission))} »</div>${c.html}</div>`,
    });
}

// relu à chaque requête en dev (un article modifié s'affiche aussitôt, comme site.ts) ; mis en cache en production
function actualiser(): void { if (!config.production && !figePourTest) chargerArticles(); }

const metaVisible = (visibles: Chunk[]) => ({
  schema: visibles.find(c => c.schema)?.schema ?? null,
  etapes: (visibles.find(c => c.etapes?.length)?.etapes ?? []).slice(0, 5),
});
const premiereMinuscule = (v: string): string => v.charAt(0).toLowerCase() + v.slice(1);

export function indexAide(compte: Compte | null): ArticleResume[] {
  actualiser();
  return [...articles.values()].filter(a => accesArticle(compte, a)).map(a => {
    const visibles = filtrerChunks(compte, a.chunks);
    const texte = visibles.map(c => c.texte ?? '').join(' ');
    return { slug: a.slug, titre: a.titre, rubrique: a.rubrique, extrait: texte.slice(0, 160), type: a.type, suggestion: a.suggestion, reperes: a.reperes, zone: a.zone, ...metaVisible(visibles) };
  });
}

// « Vous pouvez … » : permissions que l'article cite (celle de sa page, celles de ses passages réservés) et que le
// lecteur détient — calculées, jamais écrites par le rédacteur. Les niveaux « public / connecte / valide » n'en sont pas.
function pastillesDe(compte: Compte | null, a: Article): string[] {
  if (!compte) return [];
  const niveau = a.permission ?? niveauPage[a.rubrique];
  const cles = [niveau, ...a.chunks.map(c => c.permission)].filter((c): c is string => !!c && !['public', 'connecte', 'valide'].includes(c));
  return [...new Set(cles)].filter(c => peut(compte, c)).map(c => `Vous pouvez ${premiereMinuscule(permissionLibelle(c))}`);
}

export function articleAide(compte: Compte | null, slug: string): ArticleFiltre | null {
  actualiser();
  const a = articles.get(slug);
  if (!a || !accesArticle(compte, a)) return null;
  const visibles = filtrerChunks(compte, a.chunks);
  const mots = visibles.map(c => c.texte ?? '').join(' ').split(/\s+/).filter(Boolean).length;
  const voirAussi = a.voirAussi.map(s => articles.get(s)).filter((v): v is Article => !!v && accesArticle(compte, v))
    .map(v => ({ slug: v.slug, titre: v.titre, rubrique: v.rubrique, schema: metaVisible(filtrerChunks(compte, v.chunks)).schema }));
  return {
    slug: a.slug, titre: a.titre, rubrique: a.rubrique, html: visibles.map(c => c.html).join(''), intertitres: a.intertitres,
    type: a.type, reperes: a.reperes, minutes: Math.max(1, Math.ceil(mots / 180)), pastilles: pastillesDe(compte, a), voirAussi,
  };
}

type Resultat = { slug: string; titre: string; rubrique: string; extrait: string; type: 'article' | 'faq'; schema: string | null; etapes: string[]; reperes: Repere[]; zone: string; dansTitre: boolean; score: number };
export function chercherAide(compte: Compte | null, q: string): Resultat[] {
  actualiser();
  const requete = normaliser(q);
  if (!requete) return [];
  const mots = [requete, ...(synonymes[requete] ?? [])];
  const resultats: Resultat[] = [];
  for (const a of articles.values()) {
    if (!accesArticle(compte, a)) continue;
    const visibles = filtrerChunks(compte, a.chunks);
    const corpsTexte = normaliser(visibles.map(c => c.texte ?? '').join(' '));
    const titreTexte = normaliser(a.titre);
    const clesTexte = normaliser(a.motsCles.join(' '));
    let score = 0;
    let extrait = '';
    let dansTitre = false;
    const brut = visibles.map(c => c.texte ?? '').join(' ');
    const brutSimple = normaliserSimple(brut);
    for (const mot of mots) {
      if (!mot) continue;
      if (titreTexte.includes(mot)) { score += 6; dansTitre = true; }
      if (clesTexte.includes(mot)) { score += 4; dansTitre = true; }
      const pos = corpsTexte.indexOf(mot);
      if (pos >= 0) {
        score += 1;
        const p = brutSimple.indexOf(mot);   // l'extrait se découpe dans le texte d'origine (accents, majuscules)
        if (!extrait && p >= 0) extrait = brut.slice(Math.max(0, p - 40), p + 80).trim();
      }
    }
    if (score > 0) resultats.push({ slug: a.slug, titre: a.titre, rubrique: a.rubrique, extrait: extrait || brut.slice(0, 120), type: a.type, reperes: a.reperes, zone: a.zone, dansTitre, ...metaVisible(visibles), score });
  }
  return resultats.sort((x, y) => y.score - x.score).slice(0, 20);
}
