# Anti-triche V2 — phase 3

Branche `ad/anticheat-quarantine-v2`, PR #105. Les cinq migrations de cette
phase vont de `20261112170000` à `20261112210000`. Les opérations
financières et les sanctions d’essai utilisent des comptes fictifs sur des
bases isolées.

## Scénarios économiques

Les seuils réseau et alertes de la phase 1 restent applicables. Chaque
scénario stocke ses preuves, son score, sa confiance et sa décision
séparément. Les résultats nécessitent une revue humaine.

| Scénario                       | Preuves requises                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A — Affiliation avec transfert | Règle de phase 2. Trois filleuls récents créés dans la même fenêtre de 24 h, récompensés via le même parrain et ayant transmis des cartes issues de packs traçables.                                                                                                                                                                                                                                                                             |
| B — Invocations gratuites      | Trois donneurs récents au minimum. Par donneur, au moins deux ouvertures gratuites distinctes dans les 72 h suivant la création et deux échanges à sens unique avant le septième jour. Au moins 75 % des cartes traçables données par chacun convergent vers le même compte. Les cartes revenues en cycle sont exclues.                                                                                                                          |
| C — Affiliation sans transfert | Trois filleuls récents créés dans la même fenêtre de 24 h, récompensés dans les 24 h suivant la création par le même parrain. Chaque filleul consomme au moins deux packs issus de son propre lot, représentant au moins 75 % de ses ouvertures pendant les 72 premières heures. Le même navigateur pseudonymisé est le seul observé récemment chez chacun des trois filleuls.                                                                   |
| D — Karas                      | Trois payeurs au minimum, chacun avec au moins trois transferts purs à sens unique sur 30 jours, au moins 1 000 Karas nets reçus et une concentration d’au moins 75 % vers le même bénéficiaire. Pour atteindre le niveau corroboré, un exemplaire traçable doit aussi former un cycle après une vente de ce bénéficiaire, avec au moins deux enchérisseurs du groupe, un prix final d’au moins 500 Karas et au moins trois fois la mise à prix. |

A reste prioritaire lorsqu’il correspond. Les autres scénarios sont
classés par verdict, score puis identifiant. Un groupe critique doit
compter au moins quatre comptes. Le score de B, C et D corroboré vaut
25 points par compte corroboré, plafonné à 100. La fragmentation seule
donne à D un statut d’investigation et un plafond de 75 points.

Une famille ou une communauté peut produire certains de ces signaux.
Le rapport entre mise à prix et prix final décrit une enchère atypique.
Il n’est ni une cote de marché ni une preuve autonome d’artificialité.
Le graphe couvre les exemplaires dont la provenance est enregistrée et
garde les limites de la phase 2.

## Récupération et sanctions

`/admin/security` affiche les lots attribués, les cartes détenues par les
comptes concernés, les cartes bloquées et les cartes de tiers protégées.
Les ventes affichent les crédits réellement enregistrés, les reçus déjà
réclamés sont exclus et le plafond de récupération tient compte du solde
et des réservations. Une carte qui est revenue après avoir été vendue
par un compte impliqué reste bloquée dans ce plan.

La récupération effective porte sur un lot non consommé d’un filleul
identifié dans un scénario A ou C. Elle nécessite le flag
`advanced_recovery`, désactivé par défaut, une confirmation manuelle de
la version courante des preuves, le montant prévisualisé et un motif.
Elle verrouille le profil avant le lot et exige que le solde des packs
concorde avec les lots et le solde historique. Le débit, la mise à jour
du lot et le reçu unique sont atomiques. Un échec de reçus simulé annule
les écritures et le rejeu restitue le reçu existant. Les lots du parrain
restent dans le périmètre des mécanismes antérieurs. Les cartes et Karas
issus de reventes sont couverts en prévisualisation.

Les liens vers les sanctions manuelles réutilisent les RPC existantes.
Le test PostgreSQL a exécuté une sanction complète pendant une libération
de quarantaine sur le même payeur, puis vérifié le solde, la carte, la
révocation de session et l’unicité du reçu.

## Recours et supervision

Un joueur avec une session valide peut consulter ses reçus publiés dans
Paramètres et déposer un recours par reçu. Un admin peut maintenir la
sanction ou demander une correction. L’annulation manuelle d’un
avertissement sans pénalité est disponible après une demande de correction.
Les dépôts, décisions et corrections sont conservés dans des journaux
immutables. La connexion des comptes bannis sans session reste à traiter.

Le tableau admin expose les groupes, investigations, décisions, quarantaines,
échecs d’analyse, sanctions manuelles, packs récupérés, recours et
interblocages. Les soupçons rejetés mesurent les décisions de revue et non
un taux de faux positifs exhaustif.

## Validation locale

Chrome a vérifié la route réelle `/admin/security` avec des réponses
Supabase fictives à 320, 375, 768, 1024 et 1440 px ainsi qu’à 200 %.
Les blocs d’enquête, de récupération et de recours ont été contrôlés.

| PostgreSQL 17, 100 échanges ordinaires après échauffement |     p50 |     p95 |     p99 |
| --------------------------------------------------------- | ------: | ------: | ------: |
| Base `f38ce2d2`                                           | 4,47 ms | 5,07 ms | 5,17 ms |
| Phase 3                                                   | 4,44 ms | 5,78 ms | 6,93 ms |

Les temps proviennent d’un essai local séquentiel. Ils ne mesurent
pas le coût des jobs d’analyse sur des données de production.

## Suite et déploiement

Le moteur de sanctions automatiques, les nouveaux avertissements de ferme
et la suspension de 48 h restent à développer. La récupération effective
des cartes consommées et des gains de revente, les compensations, la levée
de suspension, les latences et erreurs des jobs en continu et les tests de
charge prolongés restent ouverts.

1. Valider les migrations, les règles et les faux positifs sur un
   environnement isolé.
2. Après accord explicite, déployer les migrations et ouvrir l’observation
   sur les groupes avant d’envisager toute mutation de récupération.
3. Valider l’opération de récupération séparément avec les reçus et les
   données de provenance.
4. En cas de retour arrière, couper `advanced_recovery` et
   `graph_detection_v2`, ou activer `automatic_decisions_paused` pour
   bloquer la récupération. Conserver
   les reçus et traiter les réservations actives avant de retirer les
   gardes SQL. Tout remboursement de packs nécessite une compensation
   traçable validée séparément.
