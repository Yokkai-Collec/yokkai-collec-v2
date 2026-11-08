# Collaboration — workflow à deux sur Yokkai Collec'

Deux développeurs travaillent en parallèle sur ce repo, chacun avec ses propres agents de code
(Claude Code, Codex…). Ces règles valent pour les humains **et** pour les agents.

## 0. Prérequis : installer le hook git (une fois, après le clone)

```bash
npm run setup
```

Ça active les hooks `.githooks/pre-commit` (formatage des fichiers indexés) et `.githooks/pre-push` (refus des pushes directs sur `master`). Le premier
`npm install` le fait aussi automatiquement (script `prepare`) ; `npm run setup` reste utile si
les dépendances étaient déjà installées. Vérifier :
`git config core.hooksPath` doit afficher `.githooks`.

> **État actuel : le dépôt est public et la CI GitHub Actions est automatique.** Une Pull Request
> vers `master` déclenche les contrôles complets ; un push sur `master` les rejoue après le merge.
> La protection de branche doit être configurée côté GitHub pour rendre ces contrôles obligatoires.

Ne jamais utiliser `--no-verify`, pour les humains comme pour les agents. Lancer `npm run format` avant tout commit. Le hook utilise Prettier déjà installé, respecte `.prettierignore`, réindexe uniquement le contenu staged et préserve les modifications non indexées et les fichiers non suivis.

> La protection de branche (« Require a pull request before merging » et contrôles requis) est
> disponible pour ce dépôt public et doit rester activée dans les paramètres GitHub.

Le hook pre-push et la CI sont deux garde-fous distincts : le hook local bloque un push direct sur
`master`, tandis que la CI vérifie le code d'une PR et surveille aussi les pushes sur `master`.

## 1. Jamais de commit direct sur `master`

Toute tâche part d'une branche créée depuis un `master` à jour :

```bash
git fetch origin
git checkout -b <branche> origin/master
```

On ne pousse jamais sur `master` : on y merge via Pull Request. Le hook pre-push local reste une
protection supplémentaire, même lorsque la règle GitHub est active.

## 2. Nom de branche : `<initiales>/<description-courte>`

Exemples : `wz/market-realtime`, `xx/collection-filters`.
On voit d'un coup d'œil sur GitHub qui travaille sur quoi.

## 3. Avant de commencer une tâche

```bash
git status            # rien d'inattendu en local ?
git fetch origin
git branch -r         # branches en cours de l'autre dev
gh pr list            # PR ouvertes (si le CLI GitHub est dispo)
```

Repérer si une branche ou PR ouverte touche les mêmes fichiers que la tâche prévue. En cas de
recoupement : se coordonner sur Discord avant de commencer.

## 4. Merge via Pull Request uniquement

- Jamais de merge local poussé directement sur `master`.
- Ne jamais merger une PR dont la vérification CI est rouge, même si GitHub propose le bouton de
  merge en l'absence de protection de branche.
- Ouvrir la PR **dès que le travail est prêt à être relu**, pas en fin de chantier (une PR en
  draft est très bien).
- Remplir le template de PR, en particulier la liste des fichiers/zones touchées et les
  migrations.

## CI — GitHub Actions uniquement

- La CI complète est exécutée par GitHub Actions. Les agents ne lancent jamais `npm run verify`, `npm run ci` ni `npm run ci:db` en local, y compris dans les plans des PR de traduction.
- En local : lancer `npm run format` avant chaque commit et laisser le hook pre-push bloquer uniquement les pushes directs sur `master`. Ne jamais contourner les hooks.
- Les triggers `push` et `pull_request` vers `master` de `.github/workflows/ci.yml` restent actifs. Ne jamais les désactiver sans accord explicite de PhyesGG.
- Après le push, ouvrir la PR et transmettre son lien. Ne pas surveiller la CI GitHub, lancer `gh pr checks` ni consulter les runs ou leurs logs, sauf demande explicite de PhyesGG. PhyesGG surveille lui-même la CI et signale les problèmes à corriger. Ne jamais merger sans CI verte sur la branche à jour avec `origin/master`.
- Dans la partie validation de la PR, indiquer seulement les checks passés ou la cause de l'échec ; ne jamais coller de sortie de vérification locale.
- Pushes groupés : regrouper les commits puis pousser une version relisible ; repousser uniquement les corrections nécessaires, notamment celles de CI.

## 5. Pushes groupés

Regrouper les commits puis pousser une version relisible et ouvrir la PR en brouillon. Ne repousser ensuite que les corrections nécessaires, notamment celles de CI. Ne jamais pousser directement sur master.

## 6. Migrations Supabase

- **Une seule personne à la fois** applique des migrations sur le VPS applicatif actif
  (`62.83.37.242` au 2 novembre 2026). Vérifier l’hôte réellement utilisé par le
  conteneur applicatif avant chaque intervention ; ne pas se fier à une ancienne IP.
  Prévenir sur Discord **avant** de le faire.
- Avant d'appliquer une migration, **vérifier l'état réel** de la prod au lieu de le supposer :

  ```sql
  select version, name
  from supabase_migrations.schema_migrations
  order by version desc
  limit 20;
  ```

- Chaque PR indique les migrations qu'elle contient et si elles sont **déjà appliquées** sur le
  VPS ou non.

## 7. Pas d'environnement de test séparé (pour l'instant)

Tout le monde teste contre la **même instance Supabase de prod**. Donc :

- Prudence maximale avec toute action qui crée de vraies données.
- Comptes de test : les nettoyer après usage.
- Vérifications pures en SQL : dans une transaction terminée par `ROLLBACK`.

```sql
begin;
-- vérifications…
rollback;
```

## Langue du produit : anglais source + français

- Anglais source + fr dans la même PR : tout nouveau texte joueur passe par les catalogues en/fr, jamais de texte construit par concaténation. Cela inclut erreurs, états vides, textes accessibles et métadonnées.
- Les données de cartes, personnages, licences, catégories, images, raretés, Karas et noms Regular Pack / Decision Pack restent inchangés. Les données interpolées passent en paramètres ICU ; les pluriels utilisent ICU.
- Pour un reset ou une échéance (packs, missions, enchères), afficher un compte à rebours plutôt qu'une heure fixe. Jamais « heure de Paris » / « Paris time » dans un texte joueur. UTC en base, fuseau du navigateur à l'affichage, sans divergence d'hydratation.
- Les routes restent anglaises, minuscules et avec tirets ; aucun préfixe de locale. Les fonctions SQL renvoient des codes stables ; la traduction reste dans l'interface.
- Le français reste caché derrière le flag, désactivé par défaut jusqu'au merge des PR 1 et 2 et à la validation de PhyesGG. Relecture du français par PhyesGG, zone par zone.
- PR, commits et documentation interne peuvent rester en français.

## Responsive obligatoire pour les interfaces web

- Toute création ou modification de site, page ou composant doit fonctionner sur mobile, tablette et ordinateur dès son ajout. Le responsive fait partie des critères de réalisation, même sans demande explicite.
- Concevoir pour les petits écrans en premier (mobile-first), dès 320 px, puis adapter la mise en page au contenu avec les conventions et points de rupture du projet. Préférer les dimensions fluides, Flexbox/Grid et les images adaptatives aux largeurs fixes.
- Éviter tout débordement horizontal de la page, texte tronqué, chevauchement ou contenu inaccessible. Pour les tableaux ou contenus qui nécessitent un défilement horizontal, le limiter à leur conteneur sans masquer les informations utiles.
- Adapter navigation, menus, fenêtres modales, formulaires, images et grilles ; conserver des textes lisibles, des commandes accessibles au clavier et des zones tactiles suffisantes. Aucune interaction essentielle ne doit dépendre uniquement du survol.
- Vérifier les zones modifiées dans un navigateur à 320, 375, 768, 1024 et 1440 px, ainsi que les tailles intermédiaires pertinentes ; vérifier aussi le zoom à 200 %. Corriger les régressions avant de déclarer la tâche terminée. Si une vérification est impossible, indiquer explicitement ce qui reste non vérifié.
