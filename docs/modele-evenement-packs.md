# Modèle d’événement à packs

GTA VI Sunset est la référence visuelle et fonctionnelle des prochains événements à packs de Yokkai.

## Parcours à reprendre

- **Accueil**. Un bandeau horizontal et compact, sous la présentation principale et au-dessus de Mystery Auction et Referral Event. Le bandeau mène directement au pack. Il affiche le titre, une description courte et l’action ou le compte à rebours adapté à la réserve. Montrer le sachet sur tous les écrans et les miniatures des cartes vedettes sur ordinateur.
- **Événements**. Une carte dans la grille avec les visuels vedettes, le statut, le compte à rebours et un lien vers le même pack.
- **Packs**. Placer le pack événement dans le même emplacement que le Regular Pack. La flèche fait défiler la sélection entre les deux et permet de revenir au Regular Pack. Le Decision Pack garde son emplacement. Le lien `/boosters#<identifiant-evenement>` sélectionne directement le pack événement.
- **Ouverture**. Réutiliser l’animation d’ouverture standard avec le sachet et le fond de l’événement. Afficher l’éventail correspondant au nombre de cartes et centrer la rangée pendant la révélation et sur l’écran final. Une carte vedette avec une invocation dédiée se révèle en dernier. Son badge #1, si elle en a un, apparaît à la fin de l’invocation.

## Paramètres propres à chaque événement

Choisir le nom, l’identifiant, la période, les visuels, les cartes vedettes, le nombre de cartes par pack et les taux de tirage. Les chiffres de Sunset appartiennent à cette édition. Le panneau d’information du pack affiche les taux de l’édition tels que renvoyés par le serveur.

Pour un événement à packs gratuits, reprendre le crédit automatique et la réserve. Le bandeau affiche l’action d’ouverture lorsqu’un pack est prêt et le compte à rebours lorsqu’un autre crédit est prévu. À la clôture, les packs déjà crédités restent ouvrables et le bandeau disparaît lorsque la réserve est vide.

Une édition exclusive d’une carte existante a son propre nom, son propre identifiant de catalogue et son propre visuel. Le tirage de l’événement utilise ces identifiants.

## Import Blackout

Les noms et identifiants source des cartes sont dans [le fichier des éditions Blackout](../data/blackout-cards.json). Déposer les illustrations finales dans `public/assets/events/blackout/cards/`, au format WebP, avec le nom de l’identifiant sans le préfixe `blackout-`. Par exemple, l’illustration de Sung Jin-Woo s’appelle `sung-jinwoo.webp`.

La commande `node scripts/prepare-blackout-import.mjs` vérifie toutes les illustrations et écrit le SQL d’import sur la sortie standard. Intégrer les lignes générées à la migration qui publie les cartes. L’import crée les cartes exclusives avec le suffixe `(Blackout)` et conserve leurs identifiants de catalogue lors des relances.

Pour tester les achats Blackout avec le solde du compte connecté, appliquer la [recette du portefeuille Blackout](../supabase/recipes/blackout_preview_wallet.sql) sur Supabase local, y compris après une réinitialisation de la base. Le débit et la réserve sont enregistrés sur ce compte local. L’ouverture utilise les cartes de démonstration de l’aperçu.

## Lancement du Black Friday 2026

- Le lancement est automatique le 26 novembre à 20 h, heure de Paris. Les crédits gratuits arrivent à 20 h chaque jour, jusqu’au 30 novembre inclus. La réserve gratuite dépend du statut Basic ou Pro au moment de l’ouverture et des journées pour lesquelles le compte existait. Les achats à 750 Karas, limités à 3 par date de Paris, et les ouvertures gratuites se terminent le 1er décembre à minuit. Les packs achetés restent ouvrables 24 h de plus.
- Appliquer les migrations `20261122200000_black_friday_blackout.sql` et `20261122201000_whop_blackout_checkout.sql` avec `scripts/deploy-migrations.sh` avant le déploiement de l’application. La première importe les dix cartes et installe la boutique et le tirage. Vérifier que la version déployée sert leurs illustrations dès l’import. Le SQL émis par `prepare-blackout-import.mjs` sert à vérifier l’import et n’est pas une étape de production supplémentaire.
- Dans le produit Whop de production, préparer un plan dédié récurrent à 4,99 EUR sur le même cycle de 30 jours que le plan habituel, sans frais initiaux ni essai. Désactiver la tarification adaptative pour ce plan. Créer un code de réduction de 2 EUR, valable uniquement sur le premier paiement du plan dédié, à raison d’une utilisation par client, et expirant à minuit le 1er décembre à Paris (30 novembre à 23 h UTC). Vérifier le montant de la première échéance et celui du renouvellement sur le checkout avant le lancement.
- Renseigner `WHOP_BLACKOUT_PLAN_ID` et `WHOP_BLACKOUT_PROMO_CODE` dans l’environnement serveur Coolify. L’application sélectionne le plan dédié pendant la fenêtre de l’événement et préremplit le code sur Whop. Laisser l’identifiant du plan en place après l’événement pour la vérification des abonnements. Une session Whop déjà créée reste associée à son plan pour éviter une seconde facturation. Les sessions envoyées par Yokkai pendant la promo ne remontent pas un ancien lien d’essai.
- Après déploiement, vérifier le bandeau, la réserve Basic et Pro, et l’ouverture des packs. Pour la facturation, vérifier l’affichage des conditions dans Whop et la remontée de l’accès Pro sur un paiement de test contrôlé.

## Références dans le dépôt

- [Bandeau d’accueil, carte Événements, états de réserve et panneau du pack](../components/gta-sunset-event.tsx)
- [Flèche, lien direct et séquence de révélation](../components/boosters.tsx)
- [Styles du bandeau et du sélecteur](../styles/gta-sunset.css)
- [Fond d’ouverture et éventail](../lib/ui/booster-opening-document.ts)
- [Fin d’invocation et apparition du badge](../components/lr-card-reveal.tsx)
