# Dossiers de collection unifiés

Un dossier peut contenir des cartes de plusieurs licences et catégories, même lorsqu’il a été créé depuis un classeur de licence. La licence d’origine sert seulement de contexte de navigation.

La liste des dossiers de la collection et les dossiers affichables sur le profil utilisent `license_folders` et `license_folder_cards`. La migration conserve les identifiants des anciens dossiers, leur nom et leurs cartes. Les couvertures et sélections de profil continuent donc de pointer vers les mêmes identifiants. Les tables historiques et les fonctions de déplacement restent compatibles avec les affectations d’exemplaires ; aucun exemplaire n’est transféré ou détruit par cette fusion.

Le sélecteur parcourt le catalogue entier, avec recherche et filtre des cartes possédées. Le gestionnaire est accessible dans la section Dossier de la collection. Les compteurs et les filtres utilisent les mêmes appartenances que les dossiers du profil. Les droits de propriété et la confidentialité restent appliqués.

Migration : `20261106110000_unified_collection_folders.sql`, appliquée à la base Docker locale uniquement, non appliquée sur le VPS. Aucune nouvelle signature RPC ni modification de droits SQL.

Validation produit : Walid a validé l’adaptation de `tests/license-folders-db.test.mjs` à la règle des dossiers multi-licences. Les assertions de propriété, confidentialité, export et conservation des exemplaires sont conservées. Le nouveau test `tests/unified-folders-db.test.mjs` couvre la reprise des dossiers historiques, les filtres et les déplacements compatibles.
