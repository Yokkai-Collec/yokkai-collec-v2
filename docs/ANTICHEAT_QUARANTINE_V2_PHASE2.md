# Anti-triche V2 — phase 2

Branche `ad/anticheat-quarantine-v2`, PR #105. Référence de mesure `f38ce2d2`.
Les migrations de cette phase sont datées du 12 novembre 2026, de 12 h à 16 h
dans leur numérotation. Les validations utilisent des bases isolées.

## Quarantaines

À échéance, le worker réexamine les preuves initiales, le risque enregistré
et les signaux réseau, navigateur et économiques applicables à l’échange.
Un risque critique, un signal persistant ou des preuves insuffisantes
conduisent à une revue manuelle. Une observation expirée ne constitue pas
une preuve positive. Le moteur ne possède actuellement aucune règle
automatique de confirmation positive. Il conserve les réservations et
inscrit une échéance de revue humaine à 24 heures.

En cas d’erreur, le dossier reste révisable. Le worker consigne le SQLSTATE
dans le journal privé, émet une entrée dans le log PostgreSQL et réessaie
toutes les 30 minutes jusqu’à la limite de revue. Les dossiers qui
dépassent cette limite restent à traiter par l’administration. Le
retard seul ne provoque aucun transfert ni aucune annulation.

La provenance des cartes enregistre maintenant une référence d’échange
exacte lors d’une autorisation après quarantaine.

## Règle économique

Le groupe doit atteindre le seuil critique configuré, quatre comptes par
défaut. Il faut au moins trois comptes secondaires distincts créés dans
la même fenêtre de 24 heures. Chacun doit avoir un parrainage effectivement
récompensé vers le même bénéficiaire et au moins une carte issue d’un pack
gratuit ou de parrainage ouvert dans les 72 heures suivant la création.
La carte doit atteindre le bénéficiaire dans les sept jours suivant la
création, via un à trois échanges acceptés et à sens unique entre membres
du groupe. Une carte dont le parcours observable forme ensuite un cycle
est exclue des preuves.

Le score correspond à 25 points par compte corroboré, plafonnés à 100. Le
niveau de confiance et la décision sont stockés séparément. Un admin peut
confirmer les critères remplis ou rejeter un soupçon sur une version
précise des preuves. Le journal de revue est append-only. Les preuves
combinées peuvent encore correspondre à un groupe légitime qui parraine et
offre des cartes ensemble. La classification économique déclenche une
revue, elle ne détermine pas une sanction.

Le graphe réutilise les ouvertures et transferts existants. Il explore
jusqu’à 30 packs par compte, six arêtes chronologiques par carte et dix
groupes par job. Les groupes de plus de 100 membres sont renvoyés à la revue.
Le détail affiche les chemins probants et les compteurs de transferts
indirects, cycles de cartes et ventes. Les cycles identifiés sont des signaux
et ne suffisent pas à qualifier du wash trading.

## Parrainage et sanctions manuelles

Le flag `referral_evidence_hold`, désactivé par défaut, permet une mise en
attente de 24 h depuis la vérification. Le parrain doit être bénéficiaire
d’un groupe corroboré récent, le filleul doit avoir moins de 72 h et leurs
observations directes sur ce groupe doivent dater de moins de 24 h. Le
parcours réutilise la file de récompenses existante et son paiement à
échéance. Une nouvelle analyse ne repousse pas la date maximale du hold.

Les prévisualisations de sanction existantes signalent les dossiers et les
montants ou cartes qui bloquent une récupération. L’admin résout ces
dossiers puis régénère la prévisualisation avant l’application. Les
contrôles de solde et d’inventaire continuent à protéger les réservations
en cas de concurrence. Les reçus et contrôles existants de double
récupération sont conservés.

## Validation et limites

Les tests ciblés couvrent les preuves insuffisantes, le risque critique,
une panne simulée, la provenance après quarantaine, les comptes légitimes
sur un réseau partagé, un transfert indirect, le retour d’une carte en
cycle, la mise en attente du parrainage et le conflit de prévisualisation.
Le test PostgreSQL 17 lance des transactions concurrentes pour les
réservations et les décisions de quarantaine. Le benchmark rejoue chaque
schéma dans sa propre base, avec les mêmes données fictives et 100 échanges
après dix opérations d’échauffement. Il mesure la durée SQL en local, à
faible charge, avec les nouveaux flags désactivés.

| Schéma          |     p50 |     p95 |     p99 |
| --------------- | ------: | ------: | ------: |
| Base `f38ce2d2` | 4,09 ms | 4,64 ms | 4,94 ms |
| Phase 2         | 4,50 ms | 5,06 ms | 5,53 ms |

Restent à développer la récupération avancée des packs consommés et des
gains revendus, la protection opérationnelle des tiers dans ce nouveau
parcours, la qualification des enchères artificielles et des cycles de
Karas, les sanctions automatiques, les avertissements, les suspensions,
les recours et la supervision complète. La charge réelle des jobs et une
course entre une sanction complète et une résolution de quarantaine
restent à tester. L’interface n’a pas été vérifiée visuellement.

## Déploiement progressif et rollback

1. Rejouer les migrations sur un environnement isolé et vérifier les RPC
   de sanction, les journaux techniques et la file des dossiers.
2. Une fois le déploiement autorisé, commencer par l’observation, puis
   mesurer les faux positifs, la couverture et la latence du graphe.
3. Activer les réservations et la mise en attente des récompenses
   séparément, après validation explicite. La règle de revue humaine et la
   capacité de traitement de l’équipe font partie de cette validation.
4. Pour interrompre les nouvelles mises en attente, activer la pause ou
   couper les flags concernés. Les réservations existantes restent
   protégées. Résoudre les dossiers et vérifier que les files sont vides
   avant tout retrait des gardes. Conserver les historiques de preuve et
   de revue.
