# Export personnel

Mise à jour M01 : voir [l’inventaire des relations](data-export-inventory.json)
et [le contrat parrainage / procédure support](audits/M01-referral-data-export.md).
La migration `20261021100000_referral_data_export.sql` ajoute `referral_codes`
et `referrals` ; elle n’est pas encore appliquée sur le VPS. Les exclusions
documentées ci-dessous sont historiques : l’inventaire distingue maintenant
les projections, référentiels et données nécessitant une revue manuelle.

Migration : `20261014000005_data_export.sql`, **non appliquée au VPS**.
Le bouton `/settings` télécharge directement un JSON UTF-8 version 1 ; aucune
copie persistante, URL publique ou donnée d’export dans les journaux.

## Catalogue vérifié en production le 14 octobre 2026

Lectures uniquement, transactions `READ ONLY` terminées par `ROLLBACK`.
Dernière migration relevée : `20261014000001_filter_favorite_panini_albums`.
Les 12 colonnes de `user_profiles` sont classées : `user_id` rattache le compte ;
les 11 autres sont projetées explicitement. `is_public` contrôle aussi la
visibilité des amis (`get_profile`), sans préférence distincte. Les URL sont
limitées à HTTPS, sans paramètres ni fragments. Aucune colonne applicative
inconnue dans le catalogue relevé ; les futurs ajouts restent exclus jusqu’à
classification. Le test compare les colonnes du profil à cette projection.

Mesures finales avec `scripts/data-export-measure.sql`, agrégats uniquement :
le joueur ayant le plus de lignes est aussi celui dont la taille estimée est
maximale. **5 080 lignes**, dont 2 403 références de catalogue, et **1 163 553
octets estimés** (environ 1,11 Mio). L’estimation additionne les projections
JSONB, les séparateurs et une réserve de 8 Kio pour l’enveloppe ; aucun contenu
de joueur n’est retourné. Les plafonds de 100 000 lignes/25 Mio sont retenus
avec cette marge ; les octets finaux sont contrôlés séparément à l’exécution.

| Table/section                     | Lignes |
| --------------------------------- | -----: |
| auth.users / account              |      1 |
| auth.identities / login_providers |      1 |
| user_profiles / profile           |      1 |
| user_achievement_stats / progress |      1 |
| user_cards / collection           |  2 385 |
| folders                           |      1 |
| wishlists / wishlist              |      5 |
| panini_album_favorites            |      0 |
| decision_packs                    |     11 |
| decision_pack_choices             |     55 |
| user_achievements                 |      8 |
| auctions                          |     65 |
| bids                              |     34 |
| auction_watchers                  |      0 |
| auction_chat_messages             |     12 |
| notifications                     |     58 |
| trade_offers                      |     28 |
| friendships                       |     10 |
| user_blocks émis                  |      0 |
| user_reports émis                 |      0 |
| card_reports émis                 |      0 |
| card_shares                       |      0 |
| storage.objects / avatar_files    |      1 |
| cards / catalogue_cards           |  2 403 |

Comptages complémentaires, toujours sans contenu : 3 événements de création de
partage, 9 lignes d’audit administrateur (acteur ou cible structurée), 261 audits
Auth par `actor_id`, 11 sessions et 114 lignes de refresh tokens. Ces lignes sont
**toutes exclues**. Une ligne `admin_users` fournit seulement le booléen propre
déjà inclus dans `account`. Cinq objets Storage hors avatars sont des ressources
globales et sont exclus. Zéro ligne pour les signalements/blocages reçus,
notifications des autres dont le joueur est acteur, journal de suppression,
flow state, MFA factors, autorisations/consentements OAuth, one-time tokens,
WebAuthn challenges/credentials et uploads multipart. Aucun secret ou jeton n’a
été sélectionné pour ces comptages.

## Contrat

Les sections `account`, `profile`, `progress` sont des objets ou `null`.
Toutes les autres sont des tableaux, vides quand aucune donnée n’est conservée.
`exported_at` et les dates sont en UTC, les UUID propres restent des chaînes.

| Section                | Propriété et projection                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| account                | `auth.users.id` : UUID propre, email/téléphone, dates de création/mise à jour/confirmation, statut administrateur propre                                                                   |
| profile                | `user_profiles.user_id` : pseudo, timers, solde, avatar, bio, cartes mises en avant/bannière, visibilité, présence                                                                         |
| progress               | `user_achievement_stats.user_id` : cinq compteurs de progression                                                                                                                           |
| collection             | `user_cards.user_id` : instance/catalogue, obtention, rareté, shiny/évolution, dossier, première propriété, image personnalisée, verrouillage                                              |
| folders                | `folders.user_id` : ID, nom, création                                                                                                                                                      |
| wishlist               | `wishlists.user_id` : carte, création ; vue `wishlist` non dupliquée                                                                                                                       |
| album_favorites        | `panini_album_favorites.user_id` : licence, création                                                                                                                                       |
| decision_packs         | `decision_packs.user_id` : ID, état, création/réclamation, choix conservé                                                                                                                  |
| decision_pack_choices  | pack appartenant au joueur : ID, pack/carte, rareté/shiny, suppression, position                                                                                                           |
| achievements           | `user_achievements.user_id` : succès, réalisation/réclamation                                                                                                                              |
| bids                   | `bids.bidder_id` : ses mises seulement, ID/enchère, montant/date                                                                                                                           |
| auctions               | vendeur/acheteur ou ses mises : ID, rôle, prix initial/durée/fin/état/création ; montant final seulement si son résultat ; contrepartie pseudo/date seulement                              |
| watched_auctions       | `auction_watchers.user_id` : enchères suivies, sans enrichissement privé                                                                                                                   |
| trades                 | émetteur/destinataire : ID, sens/état/dates, ses cartes/montants, instantané de ses cartes par liste blanche ; parent seulement si également impliqué ; contrepartie pseudo/date seulement |
| friendships            | une des deux extrémités : ID, sens/état/dates, autre pseudo/date seulement                                                                                                                 |
| blocks                 | bloqueur uniquement : pseudo bloqué/date ; blocages reçus exclus                                                                                                                           |
| messages               | `auction_chat_messages.user_id` : ses messages/GIF seulement, ID/enchère/date ; aucun fil entier                                                                                           |
| notifications          | destinataire uniquement : ID/type/lecture/création/succès ; référence seulement à une interaction propre ; acteur pseudo/date uniquement                                                   |
| submitted_reports      | auteur uniquement : ID/motif/type de contexte/date ; rapports reçus, cible, contexte détaillé, texte libre, instantané et statut interne exclus                                            |
| submitted_card_reports | auteur uniquement : ID/carte/motif/date ; instantané/statut interne exclus                                                                                                                 |
| card_shares            | propriétaire uniquement : carte/libellé/licence/rareté/shiny, option/pseudo affiché/image/date ; ID de lien et URL de partage exclus                                                       |
| login_providers        | `auth.identities.user_id` : fournisseur/création/mise à jour ; identité JSON et identifiants fournisseur exclus                                                                            |
| avatar_files           | bucket avatars, propriétaire ou chemin UUID : type/taille/création/mise à jour/dernier accès ; **aucun contenu, chemin ou lien**                                                           |
| catalogue_cards        | seules références de sa collection/wishlist/packs/bannière : ID, nom, catégorie, rareté/licences ; aucune donnée d’un autre joueur                                                         |

La section `karas_gifts_received` couvre les cadeaux Karas activés par le joueur.
Elle contient le montant, le message affiché au destinataire et la date
d’activation. Les empreintes des codes, les données d’émission et les autres
destinataires restent exclus.

Exclusions intégrales : `card_share_creations`, `admin_audit_logs`,
`account_deletion_log`, colonnes `admin_users.granted_by/created_at`, sessions,
jetons et leurs empreintes, mots de passe et empreintes, MFA/WebAuthn, OAuth,
audits Auth/Storage et cron. Les comptes en suppression sont refusés.
Les référentiels globaux ne sont pas exportés intégralement.

Les tables `anticheat_events`, `anticheat_event_subjects` et `anticheat_cases`
relèvent de la revue manuelle des éléments de sécurité et des données de tiers,
comme les journaux de modération. Leur exclusion du téléchargement automatique
ne dispense pas de traiter une demande d'accès par la procédure manuelle.

## Cohérence, plafonds et envoi

La RPC `build_data_export` construit **toutes** les sections, Auth et métadonnées
Storage comprises, dans une seule instruction SQL `STABLE`. Les tables restent
dans le même instantané même si une autre transaction est validée entre deux
lectures. Le test PostgreSQL provoque ce chevauchement puis prouve qu’une version
mutante à deux instructions `VOLATILE` mélange les versions.

Plafonds retenus : 100 000 lignes (références et manifeste compris) et 25 Mio de
JSON UTF-8. Chaque section borne son parcours à 100 001 lignes. La taille est
vérifiée avant agrégation finale, en SQL après assemblage et sur les octets
réels avant envoi. Dépassement : HTTP 413, aucune troncature, demande d’export
complet auprès de l’équipe. Génération limitée à 30 s ; durée de route configurée
à 60 s sur les plateformes qui appliquent `maxDuration`.

Créneau réservé atomiquement par joueur. Une génération échouée ou une réponse
interrompue libère la réservation. Le `finish` de la réponse HTTP consomme les
24 h glissantes ; il atteste la remise au transport serveur, **pas** la sauvegarde
sur l’appareil. La route App Router utilise `after` et le signal de la requête :
dans le runtime Node installé, Next interrompt ce signal si la réponse se ferme
avant `writableFinished`. Le test vérifie ce contrat du framework. Fermer un
Web Stream ne constitue pas une preuve d’envoi HTTP.

Une réservation de génération orpheline expire après cinq minutes. Avant
l’envoi, une marque durable protège contre un crash après remise au transport
mais avant enregistrement du reçu : en cas de résultat indéterminé, la protection
reste conservatrice pendant 24 h. Les échecs explicites sont libérés. Un reçu
indéterminé maintient une réservation (`409`), sans prétendre que l’export a
réussi ni enregistrer de date d’envoi. Un reçu
impossible à enregistrer produit uniquement `DATA_EXPORT_RECEIPT_FAILED`, sans
UUID, contenu ni détail fournisseur. Ce cas requiert une vérification d’équipe.

Session vérifiée (`getClaims` et `getUser` concordants), login primaire de moins
de cinq minutes, refus des sessions anonymes ; le renouvellement du JWT ne
rafraîchit pas le login. POST de même origine, sans UUID dans le corps.
RPC réservées à `service_role`, `search_path` vide, projections explicites.
Tous les résultats du handler ont `private, no-store`, le nom du fichier ne
contient que la date. La route dépend de `NEXT_PUBLIC_SITE_URL` correctement
configuré. Aucun déploiement ni application de migration durant ce travail.
