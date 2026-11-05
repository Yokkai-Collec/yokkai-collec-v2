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

## Bordure de glace photographique

L’ambiance `frost` utilise désormais exclusivement l’image fournie par le propriétaire du projet, conservée dans `public/images/ice-frame.png` (2172 × 724, RGBA). Le centre est réellement transparent : le pixel central vaut RGBA `(0,0,0,0)` ; aucun pixel noir opaque n’a été détecté. Aucun détourage par couleur n’est effectué.

Deux découpes à largeur native conservent l’alpha : `ice-top.webp` (2172 × 380, lignes 0–379) et `ice-bottom.webp` (2172 × 224, lignes 500–723). WebP qualité 90, alpha qualité 100 : 317110 et 165178 octets. L’original est conservé mais seuls les deux WebP sont chargés par l’interface. Aucun service externe.

Les images sont positionnées par arrière-plans `auto 100%` répétés horizontalement : pas d’étirement des stalactites, hauteur responsive limitée. Un observateur de taille place la bordure supérieure sous le titre et ses commandes, y compris quand le titre revient à la ligne. La bordure inférieure reste au bord de la vitrine. Les overlays ne bloquent pas les clics. La glace passe devant les cartes ; les commandes restent au premier plan. L’ancien dessin canvas de givre, ses triangles et sa neige animée sont supprimés ; aucun rendu canvas permanent n’est exécuté pour cette ambiance. Aucune migration supplémentaire.

Une brume froide accompagne les deux bordures : voiles bleutés sous les stalactites et nappes diffuses au ras du sol. Deux couches CSS se déplacent lentement par transform, sans boucle de rendu JavaScript ; pause hors écran, dans un onglet masqué et à intensité zéro. Le mode réduit conserve un brouillard statique. Le centre et les commandes restent libres.

La vitrine et son aper�u masquent leur barre horizontale. La molette fait d�filer les cartes horizontalement seulement tant que la vitrine peut avancer dans ce sens ; aux extr�mit�s, la page reprend son d�filement normal. Le cliquer-glisser � la souris commence apr�s un seuil de 6 px et ne d�clenche pas la modale d�une carte. Le clic simple, le clavier et le balayage tactile natif restent disponibles. Aucun changement SQL.

### Feu photographique

Le th�me feu utilise maintenant `public/images/fire-bottom.webp`, extrait de la bande inf�rieure (2172 � 304 px) de l�image fournie par le propri�taire du projet. Le canal alpha est conserv� � l�identique ; les pixels sombres de la texture ne sont pas transform�s en transparence. L�asset optimis� p�se 304 624 octets. Aucune animation de feu avec alpha n��tant disponible dans le projet, ce rendu est statique : aucun faux mouvement de flamme CSS/SVG/canvas. Une lueur chaude discr�te accompagne la bande, avec un masque qui att�nue les pointes au centre. Les dimensions de la vitrine, les cartes et les autres th�mes restent inchang�s. Aucun changement SQL.
