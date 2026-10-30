# EasyStream

Extension Chrome/Firefox qui intercepte automatiquement les flux HLS (`.m3u8`) et génère les commandes prêtes à l'emploi pour les télécharger ou les lire.

## Fonctionnement

L'extension écoute toutes les requêtes réseau. Dès qu'une requête dont le **chemin** se termine par `.m3u8` est chargée par le navigateur, elle capture l'URL, les headers de la requête (Referer, Origin, User-Agent, Cookie, Authorization) et le titre de la page. Ces données sont stockées localement et accessibles via la popup.

Le filtrage se fait sur le chemin (et non sur l'URL complète) pour éviter les faux positifs : certaines requêtes de tracking référencent un `.m3u8` dans leur query string sans être elles-mêmes une playlist. Cas particulier des pings analytics JWPlayer (`ping.gif`) : la vraie URL du flux, encodée dans le paramètre `mu`, est extraite automatiquement.

## Installation

**Chrome / Chromium**

1. Ouvrir `chrome://extensions`
2. Activer le **Mode développeur** (interrupteur en haut à droite)
3. Cliquer **Charger l'extension non empaquetée**
4. Sélectionner le dossier `EasyStream/`

**Firefox**

1. Ouvrir `about:debugging#/runtime/this-firefox`
2. Cliquer **Charger un module complémentaire temporaire**
3. Sélectionner le fichier `manifest.json`

> Pour Firefox, le manifest_version 3 nécessite Firefox 109+. En cas de problème de compatibilité, passer `manifest_version` à `2` et remplacer `service_worker` par `scripts: ["background.js"]`.

**Générer le paquet Chrome**

```bash
bash build.sh
```

Le paquet est écrit dans `dist/easystream-chrome.zip`. Ce dossier n'est pas versionné.

## Utilisation

1. Naviguer vers une page contenant une vidéo en streaming
2. Lancer la lecture — le flux M3U8 est intercepté automatiquement
3. Cliquer sur l'icône EasyStream dans la barre d'extensions
4. Chaque flux détecté affiche quatre onglets :
   - **curl** — requête HTTP brute, utile pour tester l'accès ou inspecter la playlist
   - **ffmpeg** — téléchargement direct en `.mp4`, nom de fichier basé sur le titre de la page
   - **vlc** — lecture directe dans VLC avec le bon Referer
   - **yt-dlp** — téléchargement avec yt-dlp, nom de fichier basé sur le titre de la page
5. Cliquer **Copier** pour copier la commande dans le presse-papiers
6. **Effacer** vide la liste des flux détectés

## Commandes générées

Les URL et headers proviennent des pages visitées. Ils sont échappés pour que la commande collée dans un shell ne puisse pas exécuter de code injecté.

> La commande curl inclut `Cookie` et `Authorization` s'ils ont été capturés. Ne pas la partager telle quelle : ces valeurs peuvent donner accès à une session.

### curl

```bash
curl 'https://cdn.exemple.com/stream.m3u8' \
  --compressed \
  -H 'referer: https://exemple.com/' \
  -H 'origin: https://exemple.com' \
  -H 'user-agent: Mozilla/5.0 ...'
```

Utile pour vérifier que le flux est accessible, ou pour l'inspecter avec `| cat`.

### ffmpeg

```bash
ffmpeg \
  -headers $'User-Agent: Mozilla/5.0 ...\r\nReferer: https://exemple.com/\r\nOrigin: https://exemple.com\r\n' \
  -i 'https://cdn.exemple.com/stream.m3u8' \
  -c copy Titre_de_la_page.mp4
```

`-c copy` remuxe les segments sans réencodage — rapide et sans perte de qualité. Le nom du fichier est dérivé du titre de la page HTML au moment de la requête.

### vlc

```bash
vlc \
  --http-referrer 'https://exemple.com/' \
  'https://cdn.exemple.com/stream.m3u8'
```

Ouvre le flux directement dans VLC. Seul le Referer est transmis — c'est généralement suffisant pour contourner les vérifications d'origine.

### yt-dlp

```bash
yt-dlp \
  --add-header 'Referer: https://exemple.com/' \
  --add-header 'Origin: https://exemple.com' \
  --add-header 'User-Agent: Mozilla/5.0 ...' \
  -o "Titre_de_la_page.%(ext)s" \
  'https://cdn.exemple.com/stream.m3u8'
```

Transmet `Referer`, `Origin` et `User-Agent`. L'extension du fichier est choisie par yt-dlp.

## Résolution des problèmes

**Le flux n'apparaît pas dans la popup**

- Vérifier que la lecture a bien été lancée (le M3U8 doit être chargé par le navigateur)
- Certains flux initialisent la playlist via un `<video>` en autoplay avant que l'extension soit active — recharger la page

**Erreur 403 avec ffmpeg ou curl**

Les serveurs vérifient souvent le `Referer` et l'`Origin`. Utiliser la commande curl générée pour confirmer l'accès, puis copier la commande ffmpeg, qui inclut `User-Agent`, `Referer` et `Origin`. Elle n'inclut pas `Cookie` ni `Authorization` : si le flux en a besoin, seule la commande curl les transmet.

**Le nom de fichier est `stream.mp4`**

Le titre de la page était vide ou ne contenait que des caractères spéciaux au moment de la capture. Renommer manuellement après le téléchargement.

## Structure du projet

```
EasyStream/
├── manifest.json   — déclaration de l'extension (MV3)
├── background.js   — service worker : interception des requêtes, stockage
├── popup.html      — interface utilisateur
├── popup.js        — rendu de la liste, génération des commandes
└── build.sh        — génération du paquet Chrome
```

## Permissions requises

| Permission | Raison |
|---|---|
| `webRequest` | Intercepter les requêtes et lire leurs headers |
| `storage` | Persister la liste des flux entre les ouvertures de popup |
| `tabs` | Lire le titre de la page (`tab.title`) au moment de la requête |
| `<all_urls>` | Couvrir tous les domaines (les CDN de streaming varient) |

## Licence

[MIT](LICENSE)
