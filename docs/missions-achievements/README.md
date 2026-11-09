# Missions fixes et catalogue de succès

## Règles validées

- Lancement : 9 novembre 2026 à 20 h Europe/Paris (`2026-11-09T19:00:00Z`). Aucune mission ne reprend les actions antérieures.
- 14 missions quotidiennes fixes et 12 hebdomadaires, toutes visibles, toutes actives ; les objectifs qui partagent un événement avancent ensemble. Aucun tirage, activation ou reroll.
- Jauges plafonnées à 100 points : 265 points quotidiens et 190 hebdomadaires disponibles. Aucun besoin de tout faire.
- Reset quotidien 20 h Europe/Paris, hebdomadaire lundi 20 h ; changement d'heure géré dans les calculs serveur, UTC en stockage, compte à rebours côté joueur.
- Même liste pour tous ; Pro donne uniquement +50 % sur chaque récompense de jauge, arrondi au supérieur (166/jour et 901/semaine si tous les paliers sont réclamés).
- Paliers réclamables manuellement ; ceux non réclamés des périodes expirées sont crédités au prochain chargement des missions, pour toutes les périodes impayées. Le statut Pro au crédit fait foi.
- Aucun cosmétique nouveau. Loyal et Supporter sont exclus ; Night Owl, Bidding War et Heartbreak sont retirés. Regret reste secret, destruction d'une SSR, 50 Karas une seule fois. Stylist est exclu car sa condition reposait sur le dos de carte non retenu dans la discussion.
- Pro Grinder est remplacé par Perfect Week, accessible à tous. Artist concerne l'image de la carte. Les succès Pro acquis restent acquis après résiliation.

## Intégration

Accueil : deux jauges compactes et lien vers la liste complète. `/achievements` : toutes les missions, filtres de succès par section, une famille de paliers par carte avec historique dépliable. EN/FR ajoutés aux catalogues et aux namespaces du fournisseur client ; flag français inchangé.

Les événements sont capturés dans les transactions existantes. Les insertions et suppressions de cartes restent traitées par instruction. Un cache indexé de quantités par joueur/carte conserve les pics de possession, sans rescanner toute la collection pour chaque carte. Les évolutions sont distinguées du recyclage. Wishlist obtenue : cartes différentes, une récompense par carte. Les missions hebdomadaires Decision Pack comptent des jours différents.

Les succès de timing des enchères utilisent le délai avant prolongation anti-snipe. Les candidatures Sniper et So Close ne deviennent des succès qu’au règlement, selon le gagnant final.

Les paliers supplémentaires de Trader et Negotiator exigent une amitié d'au moins trois jours, et ne comptent qu'une fois par ami et par jour. Le premier succès Trader historique garde sa condition. Auction House compte des jours différents. Tous les montants et objectifs sont définis en SQL.

## Rétroactivité et limites des preuves

Les compteurs existants de packs, Decision Packs, enchères et échanges sont conservés. Les collections présentes, quantités, catégories, vitrines, profils et personnalisations prouvent leurs conditions actuelles. Les contenus de Regular Packs conservés depuis l'ajout de leur provenance, les choix Decision Packs, les ventes et les enchères permettent les reprises précises associées. Les nouveaux pics de possession persistent même après une vente/destruction avant consultation des succès.

Les historiques absents ne sont pas inventés : anciennes destructions Regular Pack indiscernables d'une suppression administrative/évolution ; anciennes cartes vendues avant la provenance ; anciennes wishlist effacées ; anciennes situations de stock plein/lot de cinq sans identité de transaction ; rythme Pro sans preuve d'abonnement au tirage ; ancien retour après absence sans historique de connexion. Karas Earner reprend un minimum prouvé (ventes et solde actuel), puis suit les revenus de jeu, hors remboursements. Les seuils non prouvés poursuivent leur suivi dès la migration.

Les 11 identifiants historiques et leurs dates restent conservés. Specialist remplace le palier 50 % d'une catégorie connue pour le joueur, sans seconde récompense du même palier. Les trois récompenses revalorisées déjà réclamées (Shiny Hunter, Specialist, Evolution) donnent droit à un **bonus supplémentaire du nouveau montant complet**, avec un registre unique, à réclamer par le joueur. La migration ne crédite aucun ancien solde automatiquement. Les anciens paiements ne sont pas réinitialisés.

Les taux de drop ne sont pas modifiés. La dernière définition de tirage d'origin/master au développement (`20261105230000_maintenance_pack_compensation.sql`) utilise 1 % de Shiny parmi les LR, contrairement à la migration du 23 octobre précédemment citée dans la discussion.

Les tables dédiées `achievement_catalogue` et `user_catalogue_achievements` portent les nouveaux paliers. Les tables et réclamations historiques restent inchangées ; les nouvelles réclamations délèguent les paiements historiques à leur fonction existante. Les notifications historiques restent conservées ; les nouveaux paliers sont signalés dans la page de succès. La lecture historique `get_achievements()` conserve ses 11 entrées pour les anciens clients ; la page utilise la nouvelle lecture `get_achievement_catalogue()`.

## Livraison et validation

Une seule PR ; migrations à appliquer dans l'ordre :

1. `20261109190000_fixed_missions.sql`
2. `20261109190100_game_progress_events.sql`
3. `20261109190200_achievement_catalogue.sql`

**Non appliquées sur le VPS.** Coordonner l'application avec l'autre développeur et vérifier `supabase_migrations.schema_migrations` avant toute opération. Le gate de lancement est fixe ; si la migration des événements est appliquée après ce gate, les actions déjà passées ne sont pas rejouées en missions et seuls les événements capturés après installation progressent. Déployer avant le gate pour garantir le suivi dès 20 h.

Contrôles ciblés : frontières lundi/quotidien et été/hiver, absence de progression pré-lancement, objectifs simultanés, plafonnement, doubles réclamations, rattrapage multi-périodes, bonus Pro, rétroactivité et anciennes réclamations, distinction destruction/évolution, conservation des paliers après recyclage, droits des RPC et régressions des lots de packs.

Chrome sur données fictives : EN/FR à 320, 375, 540, 768, 1024, 1440 px et zoom 200 %, sans débordement ; filtres, paliers dépliables et boutons vérifiés. Aucun compte ou solde de production utilisé.

Le registre `tests/security-definer-allowlist.mjs` ajoute uniquement les six nouvelles RPC propres au joueur : `get_achievement_catalogue`, `claim_catalogue_achievement`, `get_missions`, `claim_mission_milestone`, `claim_achievement_upgrade`, `record_friend_visit`. **Extension des accès SQL à relire/valider par Walid** ; aucune assertion existante supprimée, aucun droit ancien élargi, aucun contrôle ignoré.

Rollback : avant exposition, retirer le front et conserver les tables privées ; après utilisation, ne supprimer ni réclamations ni compteurs et ne tenter aucun débit de compensation. Préparer une migration corrective additive si nécessaire. Aucun merge sans CI GitHub verte sur la branche à jour.
