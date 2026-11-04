# Couvertures personnelles des classeurs et dossiers

Les propriétaires PRO peuvent coller un lien HTTPS Imgur ou Pinterest (`i.pinimg.com`), y compris un GIF animé, depuis le bouton Couverture d’une licence ou d’un dossier. Ce bouton est aussi disponible dans la fenêtre des cartes ouverte depuis leur profil. L’image d’origine reste disponible via la remise à zéro. Le même média apparaît dans la collection, le choix des éléments mis en avant et le profil, sous réserve de leur confidentialité.

Les liens reprennent les domaines des images de cartes : `imgur.com`, `i.imgur.com`, `i.pinimg.com`, avec HTTPS et une longueur maximale de 2048 caractères. Aucun téléchargement distant n’est effectué par le serveur. Les anciens médias envoyés et validés dans `/api/profile-media` restent compatibles. Le lecteur est borné à 200 cibles et chaque écriture contrôle le PRO côté SQL. Un joueur ne peut modifier que ses propres couvertures, pour son dossier ou un classeur du catalogue. Les couvertures sont personnelles, sans modification du catalogue commun.

À l’expiration du PRO, les lecteurs affichent les images d’origine. La préférence reste enregistrée pour le réabonnement ; sa suppression reste autorisée. Supprimer un dossier retire sa préférence de couverture. Les médias encore utilisés sont exclus du nettoyage des fichiers inutilisés. L’export de données comprend les préférences propres au demandeur dans `collection_covers` et les métadonnées de médias dans la section existante `profile_media`.

Migrations : `20261104200000_pro_collection_covers.sql` et `20261104210000_collection_cover_links.sql`, appliquées sur Supabase local uniquement, non appliquées sur le VPS.

Walid a validé les deux signatures ajoutées à l’allowlist stricte et les tests associés au nouveau type de média. Aucun contrôle existant n’est supprimé ou assoupli.
