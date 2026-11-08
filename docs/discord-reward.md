# Cadeau Discord — 5 Regular Packs

## Parcours

Une fenêtre centrée sur **l’accueil uniquement** propose le cadeau. Aucune page dédiée n’est créée. Le joueur rejoint le serveur via `/discord`, puis vérifie son Discord pour recevoir les packs. Les membres actuels passent directement à cette vérification.

La croix, Échap et le clic hors de la fenêtre enregistrent une fermeture définitive **sur le compte**. Cliquer sur « Rejoindre » ferme également la fenêtre et mémorise ce choix ; un petit message sur l’accueil permet ensuite de vérifier Discord sans rouvrir la fenêtre. Un cadeau déjà récupéré empêche toute réapparition automatique. Un reçu local couvre la fermeture hors ligne et se synchronise à la visite suivante.

L’encart Discord de l’accueil et le lien des paramètres peuvent ouvrir volontairement la fenêtre (`/?discord-reward=claim`), même après fermeture. Le retour OAuth revient sur l’accueil et affiche uniquement le résultat de l’opération, sans rouvrir automatiquement la fenêtre.

Le formulaire POST ouvre une autorisation Discord limitée à `identify guilds.members.read`. Le retour `/auth/discord-reward/callback` vérifie l’identité et la présence sur le serveur configuré. Un membre encore en attente de validation du règlement doit terminer l’accueil avant de récupérer le cadeau. Aucun bot ni privilège administrateur Discord n’est nécessaire.

## Configuration avant activation

Dans l’application Discord **1564269299944788049**, ajouter à **OAuth2 → Redirects** :

```text
<origine publique de Yokkai>/auth/discord-reward/callback
```

Conserver l’URL de retour Supabase existante : la connexion Discord habituelle ne change pas. L’URL doit correspondre exactement à `NEXT_PUBLIC_SITE_URL`, avec le domaine canonique HTTPS.

Variables du serveur Next (jamais dans le navigateur ou une PR) :

```dotenv
DISCORD_CLIENT_ID=1564269299944788049
DISCORD_GUILD_ID=1553766666343817368
DISCORD_CLIENT_SECRET=<secret de cette application Discord>
DISCORD_INVITE_URL=<invitation permanente du serveur Yokkai>
```

`SUPABASE_SECRET_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`) et `NEXT_PUBLIC_SITE_URL` sont également requis. Le secret Discord déjà utilisé par GoTrue peut être réutilisé, mais doit être configuré séparément dans le service Next. Ne pas le transmettre dans le chat. Redémarrer le service après configuration.

Migration : `20261108230000_discord_reward.sql`, **pas appliquée sur le VPS** dans cette PR. Coordonner son application selon `COLLABORATION.md`, puis déployer la branche validée par la CI. La fenêtre ne s’affiche pas si sa configuration ou sa migration manque.

## Garanties et limites

- Le compte Yokkai provient exclusivement d’une session vérifiée par Auth ; l’identifiant Discord provient de `/users/@me`, et l’appartenance de `/users/@me/guilds/{guild}/member`. Aucun identifiant fourni par le navigateur ne permet d’obtenir des packs.
- Le départ OAuth est un POST de même origine. Le retour exige un nonce de 256 bits, un cookie HttpOnly de 10 minutes lié au joueur et l’émetteur Discord attendu. Changer de session invalide le retour. Toutes les réponses OAuth sont privées et non mises en cache.
- La RPC est réservée au serveur. Le reçu et les **5** packs bonus sont enregistrés dans la même transaction. Les contraintes uniques couvrent le compte Yokkai et le compte Discord ; doubles clics et requêtes concurrentes ne donnent qu’un cadeau.
- Les comptes bannis, non vérifiés ou en suppression sont refusés. Une erreur de crédit annule également le reçu. Les gardes économiques existants sur le solde restent actifs.
- Les packs utilisent le stock bonus existant, sans modifier les réserves temporisées, les probabilités ou les récompenses de parrainage.
- Quitter/revenir, changer de Discord ou recréer un compte Yokkai ne réinitialise pas le reçu. Il n’y a aucune reprise des packs si le joueur quitte ensuite le serveur.
- Des personnes contrôlant plusieurs comptes **sur les deux services** ne sont pas identifiables par cette règle seule ; les contrôles multicomptes existants restent nécessaires.

## Données

Seuls les deux identifiants et la date de récupération sont stockés ; aucun token d’accès ou de rafraîchissement Discord n’est conservé. Le reçu est lisible uniquement par son joueur, inclus dans son export et conservé après suppression du compte pour empêcher la réutilisation du Discord. La page de confidentialité et le consentement expliquent cette conservation pendant la disponibilité de l’offre. Si l’offre est définitivement retirée, supprimer ses reçus lors du retrait après revue opérationnelle. La préférence de fermeture est stockée sur le profil, incluse dans l’export et supprimée avec le compte.

## Validation

Les tests `discord-reward.test.mjs` et `discord-reward-db.test.mjs` couvrent les frontières OAuth, les erreurs Discord, les doublons sur les deux identités, la fermeture persistante et isolée par compte, les permissions SQL, les comptes indisponibles, l’export et la persistance après suppression. Les tests existants de droits SQL et d’export restent inchangés ; seules les déclarations des nouveaux objets sont ajoutées à leurs inventaires. Le test de présentation de l’ancienne invitation flottante vérifie désormais la fenêtre d’accueil demandée par Walid (modal accessible, fermeture durable, aucune réapparition automatique après récupération).

Avant activation réelle, avec les secrets configurés : récupérer une fois avec un membre actuel, une fois avec un nouveau membre, puis tenter de nouveau après départ/retour. Vérifier le crédit de 5 packs et l’absence de second crédit. Aucun appel réel d’attribution n’est effectué en production pendant le développement.
