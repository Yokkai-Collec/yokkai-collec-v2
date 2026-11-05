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

Flammes, éclairs, brume et aurore utilisent un canvas décoratif sur toute la surface de vitrine, en dehors du rail défilant des cartes. Le rendu reste derrière les commandes et illustrations, sans intercepter les clics. Textures de bruit pour le feu et la brume, éclairs avec subdivisions et branches, rideau lumineux continu pour l’aurore. Aucun média distant ni téléchargement de vidéo. Résolution et cadence plafonnées ; le rendu s’arrête hors écran, dans un onglet masqué, à intensité zéro et en mode réduit (image statique). Les cartes sont agrandies ; leur rail reste accessible au toucher.

Les flammes utilisent désormais des volutes lumineuses et des étincelles, sans aplat opaque. L’ambiance Glace et givre ajoute des cristaux ramifiés sur les bords et des particules de neige. Migration `20261105030000_showcase_frost.sql` appliquée uniquement en local après sauvegarde ; aucun nouvel accès SQL. Le lecteur de vitrine conserve les classes attendues par le contrat mobile existant.
