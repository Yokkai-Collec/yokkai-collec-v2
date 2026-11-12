# Anti-triche V2 — quarantaine des échanges et groupes réseau

La [phase 2](ANTICHEAT_QUARANTINE_V2_PHASE2.md) remplace la règle de
libération à échéance décrite dans ce rapport.

Branche `ad/anticheat-quarantine-v2`, PR #105. Base d’audit `f38ce2d2`.
Migrations `20261112100000_trade_quarantine_reservations.sql` et
`20261112110000_anticheat_network_clusters.sql`. La migration d’observation
de cette même PR enrichit aussi le DTO de la file administrateur.

## Fonctionnement vérifié

- `respond_trade_offer` conserve son contrat booléen. Le nouveau RPC
  `respond_trade_offer_with_status` renvoie l’état à la page Échanges et à la
  messagerie après les mêmes contrôles. La décision est prise après verrouillage
  de l’offre, des profils et des cartes. Les transferts à sens unique avec
  concordance réseau et navigateur sur sept jours sont soumis à revue si
  l’admission est activée. La concordance constitue un signal de revue.
- Les cartes retenues restent dans les collections d’origine. Les écritures
  de solde respectent le montant réservé et les enchères, changements de
  propriétaire et suppressions de cartes retenues sont contrôlés. Une offre
  retirée ou privée d’un participant libère ses réservations.
- Les admins peuvent autoriser ou annuler avec un motif. Une version et les
  verrous d’offre et de dossier empêchent deux décisions concurrentes. Le job
  optionnel réévalue la validité de l’échange à l’échéance et le finalise s’il
  reste valide. Une invalidation métier explicite peut le clore sans transfert.
  Une erreur inattendue laisse le dossier révisable et fait l’objet d’un retry.
- Le job réseau utilise une fenêtre de sept jours et compte les comptes
  directement observés sur chaque HMAC. Les seuils 3, 4, 6 et 10 sont
  configurables. Le traitement économique optionnel agrège les échanges et
  parrainages internes des 30 derniers jours. Le bénéficiaire affiché est le
  compte ayant reçu le plus de transferts à sens unique dans le groupe.
- Discord enfile une alerte par groupe et palier 3/4. Le payload utilise
  l’identifiant de dossier, les compteurs, le lien admin et des mentions
  désactivées. La fiche admin montre les membres et leurs dates de création.

## Portée restante

La confirmation économique d’une ferme, le graphe multi-sauts, les enchères
artificielles, l’analyse de provenance des packs, la mise en attente des
récompenses, la récupération avancée, les sanctions et leurs recours restent
à implémenter. La PR #104 applique sa sanction après acceptation sur une paire
réseau et navigateur. Ce critère et son compteur d’avertissements ne sont pas
transposés aux dossiers de ferme. La politique déterministe autorisant une
sanction de ferme doit être validée sur des preuves économiques indépendantes.

La résolution manuelle d’un échange détenu est disponible. La récupération
manuelle existante peut rencontrer un actif réservé et nécessiter de clore
d’abord la quarantaine correspondante. La fiche d’enquête détaillée, la
supervision, la déduplication Discord inter-dossiers et l’automatisation de
l’annulation pour fraude restent à compléter. Les dossiers Nils et
Buveur2Cyprine restent à examiner sur un accès administrateur en lecture seule.

## Validation locale

Les 38 tests ciblés couvrent notamment le replay de 339 migrations,
les permissions SQL, les parcours d’échange, les seuils réseau et la sanction
manuelle existante. Sur PostgreSQL 17 isolé, un échange concurrent attend le
verrou puis échoue sur une carte réservée, une dépense issue d’un instantané
obsolète échoue et une seule décision admin concurrente est appliquée.
Sur 100 acceptations ordinaires, le p50 était de 5,4 ms, le p95 de 7,1 ms et
le p99 de 11,2 ms. Ce test local séquentiel ne mesure ni l’écart avec la
branche de base ni la charge de production. La vérification visuelle des
écrans admin reste à effectuer.

## Activation et retour arrière

Les flags `quarantine_enforcement`, `quarantine_auto_release`,
`ip_cluster_detection`, `cluster_investigation` et `discord_alerts_v2` sont
désactivés par défaut. `automatic_decisions_paused` suspend l’admission et
la libération automatique lorsqu’il est activé. Le délai de revue vaut 24 h
par défaut et se règle via `quarantine_enforcement.config.reviewMinutes`.
Les seuils du groupe se règlent dans la table privée
`anticheat_cluster_settings`. Le job Discord s’appuie sur l’outbox existante.

Avant toute activation en production, vérifier la compatibilité des
sanctions manuelles en présence de réservations, la volumétrie et les faux
positifs. Pour arrêter les nouvelles réservations, activer la pause ou couper
l’admission. Résoudre les dossiers existants et confirmer que les deux tables
de réservations sont vides avant tout retrait des gardes SQL. Chaque mise en
production et chaque activation reste soumise à validation explicite.
