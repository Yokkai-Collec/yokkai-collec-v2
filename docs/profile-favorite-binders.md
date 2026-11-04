# Classeurs favoris sur le profil

Les favoris affichent leur couverture native du catalogue, leur nom complet et
leur progression. La section affiche 6 favoris par page sur téléphone et 12 dès
640 px, avec trois colonnes lorsque le conteneur atteint 720 px. Le résumé porte
sur tous les favoris, y compris les pages non visibles.
Le changement de page n’entraîne aucune lecture supplémentaire de collection.

Un clic ouvre le classeur sur le profil, en lecture seule : cartes possédées et
manquantes, filtre des cartes possédées et pages de 24 cartes. Les lectures
réutilisent `getFriendPaniniAlbumCardsPage` et son propriétaire explicite ; elles
ne montrent pas la progression de la personne qui consulte le profil. La fenêtre
se ferme avec Échap et rend le focus au classeur d’origine.

Les deux lecteurs de profil existants sont enrichis avec `favoriteAlbums.image`,
en conservant toutes leurs décisions de visibilité et leurs statistiques.
La couverture choisie reste une image native, privilégie les raretés élevées,
ignore les URL vides et ne dépend pas de la possession d’une carte par le joueur.
En l’absence d’image, le composant de couverture existant affiche l’initiale.

Migration : `20261104060000_profile_favorite_binder_covers.sql`, **non appliquée
sur le VPS**. Aucun nouvel accès SQL, privilège ou stockage personnel.

Walid a validé l’adaptation des tests stricts de profil : la couverture attendue
est ajoutée à l’assertion complète des statistiques et le nouveau sous-composant
est déclaré dans la fixture du test de confidentialité des amis. Les assertions
de confidentialité, de rôles et de statistiques sont conservées.

Aperçu local : `/design-system/profile-favorite-binders-preview` (25 favoris,
français), `?lang=en`, `?private=1`, `?count=0`, `?count=1`, `?fail=1` pour la
reprise après erreur. Les images et cartes y sont des exemples ; aucune écriture
n’est effectuée en base. Les routes design-system restent masquées en production.
