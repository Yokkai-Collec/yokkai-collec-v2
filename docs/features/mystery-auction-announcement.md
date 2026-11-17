# Annonce des nouvelles Mystery Auctions

L’accueil présente une nouvelle annonce dédiée aux deux éditions quotidiennes et à la progression LR. Son identifiant `2026-11-mystery-twice-daily-lr`, sa clé de stockage local et son reçu Auth `yokkai_seen_mystery_auction_announcement` sont indépendants de l’ancienne mise à jour profils/vitrines/missions : l’avoir fermée ne masque pas cette annonce.

Le suivi de lecture réutilise la mécanique existante : session vérifiée côté serveur, aucun identifiant de joueur fourni par le client, synchronisation entre onglets, attente lorsqu’un autre dialogue est ouvert. L’annonce cesse d’apparaître le 1er décembre 2026 à 23 h UTC, même pour les nouveaux comptes. L’aperçu local `/design-system/mystery-auction-announcement-preview` n’écrit pas de reçu et renvoie 404 en production.

Les anciennes fenêtres de mise à jour et de compensation ainsi que leurs aperçus sont retirés. Les attributions de packs déjà effectuées et le SQL de compensation restent inchangés. Discord/Twitter, invitation aux notifications et avertissements de compte restent disponibles. Aucun nouveau changement de base.
