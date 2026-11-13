# Annonces des changements de rareté

Le serveur Discord des joueurs utilise son propre webhook, distinct de celui des admins.
Une modification réelle de `cards.rarete_base` crée une annonce transactionnelle avec
le nom, la licence, l’image de la carte et les raretés avant/après. Les modifications
effectuées dans l’admin, par import ou directement en SQL sont couvertes. Une sauvegarde
sans changement ou une transaction annulée ne publie rien. Les nouvelles cartes sont
également annoncées.

Les imports de l’administration et le CLI standard utilisent un identifiant commun
à tous leurs lots. Jusqu’à cinq ajouts/changements réels : une annonce par carte.
Au-delà : un seul bilan pour tout le CSV, listant toutes les licences principales avec
le nombre réellement ajouté pour chacune et, si nécessaire, le nombre de raretés modifiées.
Les lignes déjà présentes et inchangées
ne gonflent pas les compteurs. Exemple : 500 nouvelles cartes Dragon Ball → une annonce
« Ajouts au catalogue · Dragon Ball · 500 cartes ajoutées ».
Un CSV multi-licences produit également un seul message, avec une ligne par licence
et un total. Si la liste dépasse les limites de longueur de Discord, ce même message
fournit un lien vers la liste complète (licences et quantités publiques uniquement).
Une importation partiellement réussie annonce seulement ses écritures confirmées ;
si le processus est interrompu, le cron finalise le bilan après 30 minutes sans écriture.
Les scripts externes qui écrivent directement dans `cards` doivent utiliser les RPC
`import_catalogue_cards_announced` puis `finish_catalogue_discord_import` pour obtenir
ce regroupement. Le mode CLI `--match-name-category` est également regroupé.

## Activation opérateur

Appliquer `20261113060000_discord_card_rarity_announcements.sql` et
`20261113061000_group_discord_catalogue_imports.sql` selon le runbook de
migrations. L’intégration reste inactive tant que son webhook dédié n’est pas configuré.
Renseigner `webhook_url` dans `public.card_rarity_discord_config` avec `id=true`, puis
passer `enabled=true` dans une session SQL opérateur privée. Ne jamais copier l’URL
réelle dans le dépôt, une PR ou les logs. La configuration est inaccessible aux rôles API.

La file ne collecte que les changements survenus lorsque l’intégration est activée.
Le cron envoie les annonces dans l’ordre, à raison d’une nouvelle requête par passage
(chaque minute). Mettre `enabled=false` suspend capture et livraison ; les annonces déjà
en attente sont conservées pour la reprise. Les anciennes alertes anti-triche ne sont
jamais routées vers cette destination.

## Contrôle

```sql
select status,count(*) from public.card_rarity_discord_outbox group by status;
select id,card_id,old_rarity,new_rarity,attempts,last_error
from public.card_rarity_discord_outbox where status='FAILED' order by id;
```

Les réponses confirmées passent à `SENT`. Les limites Discord et erreurs temporaires
sont réessayées, au maximum 12 fois ; le délai `retry_after` est respecté.
Les erreurs permanentes ou livraisons non confirmées restent à examiner en `FAILED`.
Avant de réarmer une livraison non confirmée, vérifier le numéro de modification dans
le salon pour éviter un doublon. Un webhook externe ne permet pas une garantie absolue
d’envoi unique en cas de réponse perdue. Aucun ping automatique de rôle ou de joueur.

Références : [webhooks Discord](https://docs.discord.com/developers/resources/webhook),
[limites de débit](https://docs.discord.com/developers/topics/rate-limits).
