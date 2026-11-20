# Le marché noir — développement local

Branche : `ad/black-market`. Aucune migration appliquée sur le VPS et aucun déploiement.

- Événement : `/black-market`, accessible depuis `/events` et l’accueil lorsqu’il contient des enchères ouvertes.
- Administration : `/admin/black-market`.
- La liste reprend les vignettes, la grille de six cartes sur grand écran et le panneau de filtres du marché classique. Recherche par nom/licence, rareté SSR/LR, catégorie et tris partagent le même composant. Sur mobile, les filtres s’ouvrent dans le panneau habituel.
- Aperçu sans connexion : `/design-system/black-market-preview` (développement uniquement). Cartes de démonstration, aucune requête vers Supabase. `?empty=1` pour l’état vide et `?locale=en` pour l’anglais.

L’événement est désactivé à l’installation. L’activation de la récupération quotidienne et de la programmation utilise la RPC admin `admin_configure_black_market(boolean)`. La migration `20261120005000_black_market_private_stock.sql` déplace l’ancien stock encore disponible vers l’inventaire privé du Marché noir et conserve les enchères programmées, leurs identifiants et leurs mises.

Après activation, le job privé `black-market-recovery` s’exécute chaque jour à 20 h, heure de Paris. Pg_cron utilise UTC et propose les créneaux de 18 h et 19 h. Le job choisit celui qui correspond à 20 h à Paris, été comme hiver. Il récupère les exemplaires SSR et LR encore détenus par les comptes bannis définitivement depuis au moins 14 jours complets. Un nouveau bannissement après débannissement repart de zéro.

Pour les bannissements existants, la dernière entrée ban/unban du journal fournit la date lorsqu’elle établit le bannissement courant. Sans date fiable, l’installation ouvre une nouvelle période d’attente de 14 jours. Un transfert n’est jamais antidaté pour accélérer la récupération.

Le passage annule les offres en attente et clôt les enchères encore actives qui bloquent une carte récupérable. L’enchérisseur en tête récupère les Karas immobilisés, et la fiche de l’enchère conserve ses mises. Les cartes réservées pour une enquête sont réévaluées au passage suivant. L’identifiant, la rareté et les variantes suivent l’exemplaire. Le journal d’administration conserve les transferts, les annulations et les remboursements.

Les cartes récupérées rejoignent l’inventaire privé du Marché noir, accessible depuis le panneau admin. L’administrateur choisit le jour, les exemplaires (1 à 60) et le prix de départ de chaque lot. Le formulaire préremplit 1 000 Karas pour les LR et 500 pour les SSR. Les prix, le jour et la sélection restent modifiables avant l’ouverture. Les enchères ouvrent à midi et leur clôture est prévue à minuit, heure de Paris. La première offre peut égaler le prix de départ à tout moment. Le palier normal est de 1 000 Karas pour une LR et de 500 pour une SSR. Chaque mise acceptée lorsqu’il reste au plus trois minutes repousse la clôture du lot d’une minute. Dans cette fenêtre, le premier palier de surenchère vaut deux fois le palier normal. Chaque surenchère acceptée dans cette fenêtre ajoute un palier normal au palier suivant. La progression est conservée si le compteur repasse temporairement au-dessus de trois minutes.

Les lots sont visibles dans l’événement à partir de son ouverture. Le gagnant reçoit l’exemplaire d’origine et les Karas du prix final sont retirés de la circulation. Sans enchérisseur, la carte reste dans le stock admin et peut être reproposée. La migration `20261118150000_black_market_editions.sql` ferme l’accès aux anciennes annonces ouvertes hors édition et laisse le règlement des anciennes mises à leur échéance initiale.

Validation sans production : `node --test tests/black-market-db.test.mjs tests/events-hub.test.mjs tests/mystery-auction-db.test.mjs tests/migration-security.test.mjs tests/banned-account-guard-db.test.mjs`. Le moteur PGlite est jetable et le cron y est seulement enregistré, jamais exécuté automatiquement.
