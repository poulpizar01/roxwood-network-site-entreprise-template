# Stockage des images (CDN)

Le socle sait recevoir des images (photo d'article, bannière, pièce jointe…) pour le compte des routes de l'entreprise. Le serveur ne garde **jamais** le fichier reçu : il le contrôle, le réencode en WebP et en fait deux versions, puis les enregistre sur un service de stockage distant (CDN) — ou, **en dev uniquement**, sur le disque du poste.

## Parcours d'une image (`server/src/socle/images.ts`)
1. **Réception** (`...recevoirImage`, à placer après la garde de la route) : stockage configuré (sinon `503`), 20 envois par compte toutes les 10 minutes, 3 envois en cours au plus sur tout le site (sinon `503` avec `Retry-After`), 15 Mo maximum, une seule image par envoi, champ de formulaire `image`. Les images sont traitées **une à la fois** (une image de 25 Mpx occupe ~190 Mo ; deux en parallèle dépasseraient la mémoire du conteneur) ; un envoi abandonné pendant l’attente n’est pas traité.
   Une image n'est jamais affichée depuis une adresse extérieure : seul un fichier envoyé au site entre sur le stockage.
2. **Contrôle du contenu réel** (`enregistrerImage`), pas seulement de l'extension : jpg, png ou webp ; ni GIF ni image animée, ni HEIC ; 25 mégapixels maximum. Un refus lève `ImageRefusee`, rendue en `400` avec son message.
3. **Réencodage** : une grande version (1 800 px maximum, WebP qualité 84) et une miniature (600 px, qualité 78). L'orientation du téléphone est appliquée, les métadonnées (position GPS…) disparaissent.
4. **Enregistrement** des deux fichiers sous `<dossier>/<horodatage>-<aléa>.webp` (et `-m.webp`) ; la route enregistre ensuite en base les clés et adresses renvoyées (`cle`, `url`, `cleMini`, `urlMini`).

Pour retirer une image : `retirerImage({ cle, url, cleMini, urlMini })`. Elle lève une erreur si le stockage ne répond pas : garder alors la ligne en base (marquée supprimée) et réessayer plus tard, plutôt que de laisser un fichier en ligne sans trace.

## Image par son adresse, en jeu
Le sélecteur de fichiers est peu fiable dans l'ordinateur en jeu (guide FBFA, B7). Quand `FOLKOS_HOTE` est réglé et que la page est affichée en jeu, un clic sur un champ fichier de la gestion propose de coller une adresse `https://` ou de choisir un fichier.

`POST /api/image-distante` (`server/src/socle/routes/image-lien.ts`) télécharge l'image, vérifie que c'en est une et la rend au navigateur, qui la place dans le champ : elle suit ensuite le parcours ci-dessus. Rien n'est enregistré par cette route.

Garde-fous : compte validé seulement (les formulaires publics n'ont pas cette possibilité), `https` et port par défaut, jamais le serveur ni le réseau interne (contrôlé à chaque connexion et à chaque redirection, 3 au plus), 15 Mo, 25 mégapixels, 15 s, 2 récupérations à la fois, 20 envois et récupérations par compte toutes les 10 minutes.

## Deux modes
| | CDN (production uniquement) | Disque local (dev uniquement) |
|---|---|---|
| Quand | Image de production (`NODE_ENV=production`), avec `STORAGE_URL`, `STORAGE_TOKEN` et `STORAGE_PREFIX` remplis | Toujours en dev, **même si le CDN est paramétré** (réglages ignorés, signalé au démarrage) |
| Emplacement | Service de stockage distant, sous le dossier `STORAGE_PREFIX` | `uploads/` à la racine du dépôt, sur le poste |
| Adresse publique | Celle renvoyée par le service | `/uploads/<dossier>/<fichier>.webp`, servie par le site |

**En production (`NODE_ENV=production`, c'est-à-dire l'image Docker), le CDN est obligatoire** : sans `STORAGE_URL` / `STORAGE_TOKEN`, le site démarre mais tout envoi est refusé (« L'envoi d'images n'est pas encore configuré sur ce site ») et un avertissement apparaît au démarrage. Les deux variables vont ensemble (une seule remplie bloque le démarrage).

**En dev, jamais le CDN** : des images d'essai n'ont rien à faire sur le stockage de la prod, et un poste de dev ne doit pas pouvoir y supprimer quoi que ce soit. Une base de dev copiée de la prod affiche les images du CDN (adresses publiques), mais ne peut ni en ajouter ni en retirer.

**Un préfixe par site** : plusieurs sites peuvent partager le même service de stockage, chacun dans son dossier (`STORAGE_PREFIX=monentreprise/`). Ne jamais réutiliser le préfixe d'un autre site. Ne plus le changer une fois des images envoyées : la base garde les clés sans le préfixe, et une suppression viserait le nouveau dossier (le stockage répond 404, compté comme « déjà absent », et le fichier de l'ancien dossier reste en ligne).

## Contrat attendu du service de stockage
Le site parle au service par deux requêtes HTTP, authentifiées par `Authorization: Bearer <STORAGE_TOKEN>` :

| Requête | Effet attendu | Réponse attendue |
|---|---|---|
| `PUT <STORAGE_URL>/api/object/<STORAGE_PREFIX><clé>` avec l'image en corps (`Content-Type: image/webp`) | Enregistre le fichier | `2xx` et un JSON `{ "url": "<adresse publique du fichier>" }` |
| `DELETE <STORAGE_URL>/api/object/<STORAGE_PREFIX><clé>` | Supprime le fichier | `2xx` (un `404` est accepté : fichier déjà absent) |

Délai maximal d'une requête : 30 s. Si le service ne répond pas à l'envoi, rien n'est enregistré (la grande version déjà déposée est retirée).

L'adresse publique renvoyée doit être sur la même origine que `STORAGE_URL` : la politique de sécurité du site n'autorise l'affichage d'images que depuis le site lui-même, Discord (avatars) et l'origine de `STORAGE_URL`. Une autre adresse est refusée à l'envoi.

## Ce qui ne passe jamais par le stockage
Les visuels du projet (`assets/`) : ce sont des fichiers du dépôt, servis par le site. Seul ce que les utilisateurs envoient part sur le stockage.
