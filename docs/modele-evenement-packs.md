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

## Références dans le dépôt

- [Bandeau d’accueil, carte Événements, états de réserve et panneau du pack](../components/gta-sunset-event.tsx)
- [Flèche, lien direct et séquence de révélation](../components/boosters.tsx)
- [Styles du bandeau et du sélecteur](../styles/gta-sunset.css)
- [Fond d’ouverture et éventail](../lib/ui/booster-opening-document.ts)
- [Fin d’invocation et apparition du badge](../components/lr-card-reveal.tsx)
