# Dossiers thématiques dans une licence

Un joueur crée un dossier depuis le bouton « Créer un dossier » du classeur de
licence, nomme sa sélection et choisit des cartes du catalogue de cette licence.
Les cartes manquantes peuvent être incluses. Aucune copie n’est déplacée,
consommée ou verrouillée ; la possession est calculée au moment de la lecture.
Les dossiers existants peuvent être ouverts, modifiés et supprimés avec une
confirmation explicite. L’étoile « Mettre ce dossier en avant sur mon profil »
les affiche dans une section dédiée, avec couverture, progression et pagination.

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
Les contrôles existants restent conservés. Les adaptations antérieures des tests
de profil et des limites 12/6 ont également été validées par Walid.
