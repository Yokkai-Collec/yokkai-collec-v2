# Dossiers thématiques dans une licence

Un joueur crée un dossier depuis le bouton « Créer un dossier » du classeur de
licence, nomme sa sélection et choisit des cartes du catalogue de cette licence.
Les cartes manquantes peuvent être incluses. Aucune copie n’est déplacée,
consommée ou verrouillée ; la possession est calculée au moment de la lecture.
Les dossiers existants peuvent être ouverts, modifiés et supprimés avec une
confirmation explicite. L’étoile « Mettre ce dossier en avant sur mon profil »
les affiche dans la section commune « Collection mise en avant », avec les
classeurs choisis, leur couverture, leur progression et leur pagination.

Depuis son profil, le propriétaire utilise « Choisir les éléments à mettre en
avant » pour sélectionner des classeurs et des dossiers dans une même fenêtre.
La recherche et la pagination conservent les choix. L’enregistrement est atomique,
et les choix de classeurs sont indépendants des favoris utilisés dans la
collection et les packs. Les favoris existants servent de sélection initiale
jusqu’au premier enregistrement ; une sélection vide explicite reste vide.
Les dossiers gardent leur option de mise en avant depuis le classeur d’origine.
Le sélecteur du profil propose également « Créer un dossier » : choix de licence,
puis réutilisation du même éditeur de cartes sans quitter le profil. Les choix en
cours sont préservés ; le nouveau dossier est créé sans mise en avant immédiate,
ajouté à la sélection, puis affiché sur le profil après son enregistrement global.

La collection privée, les amitiés et les blocages continuent de s’appliquer.
Un visiteur ne peut consulter que les dossiers mis en avant d’une collection
visible. Les noms sont du texte, jamais du HTML. Limites : 100 dossiers par
joueur, 500 cartes par dossier, nom de 1 à 60 caractères. Les noms sont uniques
par joueur et par licence, sans distinction de casse. Les écritures vérifient le
propriétaire, le bannissement, la licence et chaque carte, dans une transaction.

Migration `20261104080000_license_folders.sql` : tables, quatre fonctions RPC et
ajout des données propres au joueur à son export existant. **Non appliquée sur le
VPS**. La migration des couvertures `20261104060000` est aussi incluse, non
appliquée sur le VPS. Walid a validé les nouveaux accès de l’allowlist SQL stricte.
Migration `20261104180000_profile_featured_selection.sql` : choix des classeurs
sur le profil, lecteur commun et enregistrement atomique, export des préférences.
Appliquée uniquement en local, **non appliquée sur le VPS**. Walid a validé les
deux nouveaux accès SQL stricts correspondants.
Les contrôles existants restent conservés. Les adaptations antérieures des tests
de profil et des limites 12/6 ont également été validées par Walid.
