# Personnalisation de la vitrine

Les réglages PRO sont regroupés dans « Modifier la vitrine », avec les cartes sélectionnées et le bouton d’enregistrement commun.

- Huit ambiances : Velours, Ciel étoilé, Marbre noir, Éclairs, Flammes, Brume, Aurore boréale et Braises. Les détails visibles entourent les cartes ; les animations sont décoratives et désactivées en mode réduit.
- Trois dispositions : Galerie, Éventail et Pièce maîtresse. La première carte sélectionnée devient la pièce centrale.
- Couleur personnelle et intensité de 0 à 100 %, sans ombre dorée externe sur les LR.
- Titre facultatif de 60 caractères et description facultative de 160 caractères.
- Aperçu avec les vrais exemplaires, dans l’ordre de sélection. Aucun exemplaire n’est modifié ou consommé.
- Inclinaison au pointeur sur ordinateur ; aucune dépendance au survol sur téléphone. La réduction des animations désactive les mouvements et conserve les dispositions statiques.

Les anciennes valeurs `showcaseEffect` restent lisibles. Les nouvelles préférences sont facultatives dans le JSON existant. Le garde SQL existant conserve ses vérifications PRO, suppression, débit, médias et droits ; aucun nouvel accès SQL n’est ajouté. Les projections serveur masquent toujours les personnalisations quand le PRO expire.

Migration : `20261105010000_showcase_design.sql`, appliquée uniquement à la base Docker locale après sauvegarde. Non appliquée sur le VPS. Aucun déploiement en production.

Migration complémentaire : `20261105020000_showcase_atmospheres.sql`, même périmètre local uniquement. Elle étend la liste des ambiances autorisées dans le garde PRO existant, sans nouveau droit SQL. La modale utilise jusqu’à 1480 px sur ordinateur et conserve une largeur adaptée au téléphone.
