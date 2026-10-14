# Consultant Hub

Application de gestion de consultants pour ESN : **CVthèque** (recherche par compétences, disponibilité, TJM), **missions / clients**, **saisie et validation des CRA**, **tableau de bord** (jours travaillés, montant à facturer).

Zéro dépendance : Node **≥ 22.5** uniquement (SQLite et serveur HTTP intégrés).

## Lancer

```bash
npm run seed     # données de démonstration (optionnel ; --force pour réinitialiser)
npm start        # http://localhost:3000
```

Variables (voir `.env.example`, à copier en `.env`) : `PORT`, `CRA_MODE`, `CRA_API_URL`, `CRA_API_TOKEN`.

## Démo en ligne (GitHub Pages)

GitHub Pages ne sait servir que des fichiers statiques, pas le serveur Node. Le dossier `public/` fonctionne pourtant tel quel : sans serveur joignable, l'interface bascule toute seule en **mode démo** (`public/demo-api.js`), avec les données enregistrées dans le navigateur. Déposez simplement le contenu de `public/` (`index.html`, `style.css`, `app.js`, `demo-api.js`) à la racine du dépôt publié. Un bandeau jaune signale ce mode.

## Structure

```
server/
  index.js        routes API (consultants, clients, missions, CRA, dashboard)
  db.js           schéma SQLite (data.db)
  cra-adapter.js  ⇐ LE point de raccordement à votre CRA
  mini.js         mini routeur HTTP sans dépendance
  seed.js         données de démo
public/           interface (HTML / CSS / JS vanilla)
```

## Relier le site à votre CRA

Toute la logique CRA passe par `server/cra-adapter.js`, qui expose 4 fonctions :

| Fonction | Rôle |
|---|---|
| `getCra(missionId, month)` | CRA d'une mission pour un mois (`YYYY-MM`) |
| `saveDays(missionId, month, days)` | enregistre les jours `{day, value (1 / 0.5), kind (Travaillé / Congé)}` |
| `setStatus(missionId, month, status, comment)` | `Brouillon`, `Soumis`, `Validé`, `Refusé` |
| `listCra(month)` | CRA du mois avec total de jours (`daysWorked`) |

Deux modes, via `CRA_MODE` :

- **`local`** (défaut) : les CRA vivent dans la base de l'application. Le site fonctionne seul.
- **`http`** : l'adaptateur appelle l'API de votre CRA (`CRA_API_URL` + jeton Bearer). Les routes et formats attendus sont dans la section « HTTP » du fichier : **adaptez-les à votre API** (ou remplacez le corps des fonctions par des requêtes SQL si votre CRA est une base accessible directement).

Le lien consultant ↔ CRA se fait avec le champ **« ID dans le CRA »** (`external_cra_id`) de chaque fiche consultant.

> Les fonctions doivent renvoyer le format décrit en tête de `cra-adapter.js`. L'interface n'a pas besoin d'être modifiée.

## À prévoir avant une mise en production

- **Authentification et rôles** : aucune pour l'instant. Tout le monde peut saisir *et* valider. À ajouter : consultant (sa saisie), manager (validation), admin.
- Sauvegarde de `data.db`, HTTPS derrière un reverse proxy.
- Pistes : import de CV (PDF), export des jours à facturer, rappel automatique des CRA manquants.
