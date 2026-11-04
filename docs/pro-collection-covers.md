# Couvertures personnelles des classeurs et dossiers

Les propriétaires PRO peuvent envoyer une image JPG, PNG, WebP ou un GIF animé de 4 Mo maximum depuis le bouton Couverture d’une licence ou d’un dossier. L’image d’origine reste disponible via la remise à zéro. Le même média apparaît dans la collection, le choix des éléments mis en avant et le profil, sous réserve de leur confidentialité.

L’envoi réutilise `/api/profile-media` : authentification, contrôle d’origine, contrôle PRO côté serveur, inspection des octets, quotas et URL immuable. Le lecteur est borné à 200 cibles. Un joueur ne peut enregistrer qu’un média validé lui appartenant, pour son propre dossier ou un classeur du catalogue. Les couvertures sont personnelles, sans modification du catalogue commun.

À l’expiration du PRO, les lecteurs affichent les images d’origine. La préférence reste enregistrée pour le réabonnement ; sa suppression reste autorisée. Supprimer un dossier retire sa préférence de couverture. Les médias encore utilisés sont exclus du nettoyage des fichiers inutilisés. L’export de données comprend les préférences propres au demandeur dans `collection_covers` et les métadonnées de médias dans la section existante `profile_media`.

Migration : `20261104200000_pro_collection_covers.sql`, appliquée sur Supabase local uniquement, non appliquée sur le VPS.

Walid a validé les deux signatures ajoutées à l’allowlist stricte et les tests associés au nouveau type de média. Aucun contrôle existant n’est supprimé ou assoupli.
