# Antitriche V2 · bilan de la phase 4

Branche `ad/anticheat-quarantine-v2` · PR #105 · référence de charge `f38ce2d2`. Les vérifications utilisent des données fictives et des bases isolées. L’application de ces migrations en production et l’activation des flags restent soumises à autorisation.

## 1. Détection et sanctions

Les seuils réseau restent configurables, avec les valeurs par défaut de 3, 4, 6 et 10 comptes. Deux comptes restent au stade de l’observation. Le passage à 3 et 4 peut déclencher une alerte. Les scénarios A à D alimentent les investigations.

La politique automatique V1 exige une preuve A et une preuve C pour chacun d’au moins trois comptes secondaires dans un groupe critique. Elle contrôle la fraîcheur du dossier et des observations HMAC. Elle exige un lot de parrainage réellement distribué, une consommation corroborée, puis un transfert de carte à sens unique et direct au bénéficiaire. Le moteur relit la provenance, le transfert accepté et le retour éventuel de la carte. Un classement humain « écarté » prime. Les comptes admin sont exclus et les dossiers périmés, ambigus, trop grands ou privés de preuve individuelle passent en revue. Les scénarios B et D seuls et le scénario C seul ne déclenchent pas le bannissement automatique.

Le job traite jusqu’à cinq dossiers par exécution. Il réutilise le bannissement Auth, la révocation des sessions, l’audit et le traitement des enchères existants. Il annule les offres à sens unique encore ouvertes entre les comptes concernés. Un compte avec un échange en quarantaine conserve cette protection en attendant la résolution. Une simulation enregistre la décision, les secondaires identifiés, la participation du bénéficiaire et un inventaire estimatif des récupérations. La récupération effective vérifie séparément l’actif et la version au moment de l’écriture.

## 2. Avertissements et suspensions

Un avertissement exige deux demandes de cartes à sens unique initiées par le bénéficiaire auprès de secondaires individuellement impliqués. Le journal déduplique les dossiers qui recoupent les mêmes secondaires. Trois avertissements actifs de dossiers distincts déclenchent une suspension de 48 heures, avec révocation de sessions et contrôle d’expiration par le garde Auth. Les mêmes avertissements ne déclenchent qu’une suspension. L’annulation d’un avertissement réévalue la suspension et peut la lever. Une restriction ultérieure ou différente est préservée.

## 3. Récupérations

- Un admin peut retirer le reliquat du lot référé exactement identifié, après réconciliation de la réserve de packs.
- Une carte issue d’un lot attribué peut être retirée de l’inventaire d’un compte sanctionné. Le système conserve l’instance complète dans le reçu. Les cartes bloquées, réservées, listées, revendues ou détenues par un tiers sont protégées.
- Une vente traçable à un acheteur tiers ouvre une récupération chez le vendeur sanctionné. Le calcul utilise le crédit réellement enregistré et le solde libre de réservations. Le reçu indique le retrait réel et le reliquat indisponible.
- Un admin peut annuler une récompense encore en attente après confirmation humaine du scénario B. Deux ouvertures de packs gratuits distinctes et deux transferts directs à sens unique, sans retour enregistré, doivent relier personnellement le filleul au bénéficiaire. Le traitement verrouille le parrainage avant de créer le reçu et bloque un versement ultérieur.
- Les verrous et les reçus uniques protègent contre les reprises concurrentes. Les écritures vérifient également les reçus historiques. Un changement de propriétaire, de réservation, de solde ou de preuve pertinente peut rendre la prévisualisation obsolète.

## 4. Recours et corrections

L’historique du joueur affiche les décisions. La page de connexion propose `/appeal` aux joueurs sans session. Un admin vérifie l’identité via le canal d’assistance puis enregistre la vérification et remet un code à usage unique valable 15 minutes. La base conserve son empreinte. Le code donne accès au reçu désigné pour déposer un recours ou lire son statut. Un nouveau code permet une consultation ultérieure.

La décision admin est motivée et conservée. Les corrections peuvent annuler un avertissement, lever une suspension ou rétablir un compte banni par la politique. La compensation restaure le retrait exact associé au recours, par reçu unique. Si la carte originale ne peut pas être remise ou que le lot ne se réconcilie plus, l’admin voit une proposition immuable reprenant l’actif ou le montant d’origine. Un nouvel essai de restitution exacte est possible si l’obstacle disparaît. Une compensation de substitution reste à examiner manuellement.

## 5. Administration et alertes

`/admin/security` réunit les examens de quarantaine, les décisions de ferme, les simulations, les prévisualisations et les recours. Le tableau ajoute les sanctions, récupérations partielles, compensations, erreurs, retries, dernière durée maximale des évaluations et âge de l’alerte la plus ancienne en file.

Les seuils réseau et les événements opérationnels utilisent l’outbox et la file d’échec existantes. Les alertes distinguent ferme confirmée, bannissement, avertissement, suspension, quarantaine critique et erreurs techniques. Les références opaques et catégories ne contiennent aucun HMAC, IP ni identifiant de navigateur. La déduplication SQL s’effectue par catégorie et référence stable. Un incident répété sur le même dossier n’ajoute pas une nouvelle alerte de même catégorie.

## Changements et vérifications

| Migration                                              | Objet                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `20261112220000_anticheat_farm_enforcement.sql`        | Moteur A + C, simulation, exécution, bannissements, avertissements et suspensions |
| `20261112230000_anticheat_asset_recoveries.sql`        | Retrait exact des cartes et des Karas, annulation des récompenses en attente      |
| `20261113000000_anticheat_restriction_corrections.sql` | Correction des restrictions et accès aux recours sans session                     |
| `20261113010000_anticheat_asset_compensations.sql`     | Restitutions exactes et propositions à examiner                                   |
| `20261113020000_anticheat_operational_alerts.sql`      | Alertes dédupliquées, file et compteurs de supervision                            |

Le code applicatif touche l’administration, la page de recours, la connexion, l’historique des sanctions et les catalogues anglais et français. Les validations sont dans `tests/anticheat-farm-scenarios-db.test.mjs`, `tests/security-definer-allowlist.mjs`, `tests/anticheat-phase3.browser.mjs` et `tests/postgres17-trade-quarantine.mjs`. Le diff de la PR liste chaque fichier.

- 354 migrations rejouées et droits de 376 fonctions `SECURITY DEFINER` contrôlés. Neuf tests SQL ciblés et treize tests de non-régression supplémentaires réussis.
- L’intégration vérifie les preuves A à D, l’absence de sanction en simulation, le bannissement, la révocation, la suspension et son expiration, l’annulation d’avertissement, la protection des tiers, le retrait partiel, le rejet d’un aperçu obsolète, les recours, les compensations et l’annulation d’un parrainage avant versement. Une panne injectée vérifie le rollback et la reprise du job.
- Le test PostgreSQL 17 oppose deux acceptations pour une carte, deux décisions administrateur et une sanction manuelle à une résolution de quarantaine. Le scénario isolé vérifie également le rejet d’une écriture à partir d’un instantané obsolète.
- Chrome vérifie le parcours d’administration, la prévisualisation et la page de recours sans session à 320, 375, 768, 1024 et 1440 px, et à l’équivalent d’un zoom de 200 % sur deux largeurs. L’interface est alimentée par des réponses fictives. Les écritures sont vérifiées par les tests SQL.

### Charge mixte sur PostgreSQL 17

Les mesures sont exprimées en millisecondes par acceptation d’échange, après dix opérations de chauffe par session. Chaque scénario a été exécuté une fois avec 1, 4 ou 10 sessions concurrentes. La branche a traité des échanges équilibrés pendant que les jobs relisaient une quarantaine, évaluaient les groupes et simulaient une sanction sur un dossier distinct. Deux cartes et 600 Karas sont restés réservés. PostgreSQL a enregistré zéro interblocage.

| Échanges | Sessions | Référence p50 / p95 / p99 | Branche p50 / p95 / p99 |
| -------: | -------: | ------------------------: | ----------------------: |
|      100 |        1 |     4,072 / 4,388 / 5,080 |   4,404 / 4,709 / 4,798 |
|    1 000 |        4 |     4,449 / 5,283 / 7,870 |   4,891 / 7,278 / 7,937 |
|   10 000 |       10 |    5,384 / 9,059 / 10,314 | 6,264 / 10,255 / 11,277 |

Le p95 augmente de 1,196 ms à 10 000 échanges. Cette comparaison mesure le coût de la branche avec les analyses en parallèle. Elle ne mesure ni le délai HTTP complet, ni la capacité d’une instance de production.

## Flags et procédure

Les flags `farm_policy_v1`, `auto_farm_ban`, `auto_farm_warning`, `auto_farm_suspension` et `farm_compensation` sont ajoutés avec la valeur `false`. `advanced_recovery` reste le flag des récupérations et annulations. `automatic_decisions_paused` sert de coupe-circuit. Les flags existants de détection, investigation, quarantaine, libération, mise en attente des parrainages et Discord gardent leurs valeurs.

Après validation de la CI et autorisation de production, vérifier sauvegarde et restauration, appliquer les migrations dans l’ordre, contrôler les ACL et les flags, puis vérifier les simulations et les files en observation. Activer séparément chaque action mutante après validation des cas simulés.

Pour arrêter les décisions, activer `automatic_decisions_paused` et désactiver les flags de sanction, récupération et compensation. Suspendre les nouvelles quarantaines si nécessaire. Résoudre les dossiers en cours via les RPC pour libérer leurs réservations. Conserver les journaux et corriger les décisions déjà appliquées à partir de leurs reçus. Utiliser une migration corrective si la base doit revenir à une version applicative antérieure.

## Périmètre restant

Les suites ne couvrent pas la concurrence entre chaque nouvelle récupération avancée et une résolution de quarantaine. Le traitement des profits d’enchères est limité aux ventes avec provenance et crédit exacts. Les cycles ou gains indirects hors de cette chaîne restent en revue. La vérification d’identité pour un recours reste manuelle. L’envoi au vrai webhook et les restrictions Auth d’un service de production n’ont pas été essayés. Les statistiques de CPU, mémoire et percentiles continus en production ne sont pas instrumentées.
