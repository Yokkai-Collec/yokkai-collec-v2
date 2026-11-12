# Audit Phase 0 — anti-triche et quarantaines

Date : 11 novembre 2026
Base auditee : `origin/master` (`f38ce2d2`)
Branche d'implementation : `ad/anticheat-quarantine-v2`

## Etat reel de la production

La production possede un registre anti-triche prive et immuable
(`anticheat_events`, `anticheat_event_subjects`, `anticheat_cases`), des
observations reseau et navigateur pseudonymisees, un score de risque et des
parcours de sanction manuelle. Les IP brutes ne sont pas enregistrees.

Les flux economiques observes sont :

1. Les offres d'echange sont acceptees par `respond_trade_offer`.
2. Cette fonction verrouille les profils et les cartes, transfere les Karas et
   les cartes, puis marque l'offre `accepted`.
3. Les triggers anti-triche observes se declenchent apres cette mise a jour.
4. Les encheres, les offres, les transactions et les parrainages ont chacun
   des evenements immuables et des lecteurs admin bornes.

Cette ordre est essentiel : un trigger **apres** `accepted` ne peut pas mettre
en quarantaine un echange sans que les actifs aient deja bouge. Une vraie
quarantaine devra donc etre appelee dans `respond_trade_offer`, apres les
verrouillages et avant tout transfert de carte ou de Kara.

## Sanctions manuelles existantes a preserver

- `admin_preview_smurf_sanction` / `admin_apply_smurf_sanction` : preuve
  reseau + navigateur + echange accepte, previsualisation, confirmation,
  verrouillage et recuperation atomique.
- `admin_preview_sanction` / `admin_apply_sanction` : voie manuelle unifiee,
  annulation d'actifs en cours, remboursement des encheres actives et
  protection des acheteurs tiers.
- `admin_preview_deleted_account_sanction` /
  `admin_apply_deleted_account_sanction` : recuperation historique pour un
  compte supprime.

Ces voies possedent deja des recu, des verrous, des apercus lies a l'etat
courant et des barrieres contre les recuperations doubles. La quarantaine ne
doit pas les remplacer ; elle doit diriger les cas complexes vers elles.

## Notifications Discord

La migration actuellement deployee envoie une alerte pour chaque sujet ayant
un score strictement positif. Elle deduplique par `event_id`, mais cela inclut
les echanges desequilibres, les transferts importants et les signaux de reseau
isoles. Elle possede des tentatives mais pas de file de lettres mortes explicite
ni de cle de regroupement par dossier.

La phase suivante doit limiter l'envoi aux sanctions, risques critiques,
fraudes de parrainage confirmees, echecs de recuperation et dossiers de
relation reseau+navigateur necessitant une revue.

## PR #104 — non consideree comme deployee

La branche `ad/auto-trade-anticheat` contient :

- la sanction automatique de comptes lies apres echange ;
- des avertissements du principal et une suspension apres trois avertissements ;
- des recuperations de cartes, Karas et gains d'encheres ;
- un filtre Discord plus restreint ;
- une detection de ferme de parrainage meme sans IP partagee.

Elle n'est pas integree a cette base et ne doit pas etre deployee ou appliquee
sans audit de compatibilite avec les sanctions manuelles et les nouveaux recu
de quarantaine.

## Risques trouves

| Risque                    | Consequence                       | Traitement prevu                                          |
| ------------------------- | --------------------------------- | --------------------------------------------------------- |
| Detection apres transfert | Impossible de reserver les actifs | Insertion du controle dans la RPC avant mutation          |
| Discord trop bavard       | Bruit et fatigue de moderation    | Allowlist, regroupement et dead-letter queue              |
| Seuils fixes              | Contournement par fractionnement  | Score V2 en observation et fenetres multiples             |
| IP ou navigateur seuls    | Faux positifs foyer/VPN/ecole     | Confiance distincte du score et revue humaine             |
| Recuperation concurrente  | Double retrait/remboursement      | Cles d'idempotence, version de dossier et recu uniques    |
| Panne d'analyse           | Risque de blocage injustifie      | Mode shadow par defaut, fail-open controle et kill switch |

## Architecture cible progressive

1. Ajouter un registre de quarantaines prive, versionne et auditable.
2. Ajouter des flags prives tous desactives par defaut.
3. Executer les evaluations en `SHADOW` sans reserver ni bloquer d'actifs.
4. Comparer le resultat aux decisions manuelles et mesurer les faux positifs.
5. Integrer la reservation dans `respond_trade_offer` seulement apres
   validation, avec des etats et des mutations atomiques.
6. Reutiliser les fonctions manuelles pour toute sanction et recuperation
   complexe.

## Fondations implementees sur cette branche

Cette branche implemente uniquement les etapes sans effet economique :

- un registre prive de quarantaines avec etat, version, expiration et audit
  immuable ;
- des feature flags prives, tous desactives par defaut ;
- une evaluation `SHADOW` optionnelle pour les echanges corroborant reseau et
  navigateur ; elle s'execute apres acceptation uniquement pour mesurer les
  faux positifs et ne peut ni reserver, ni annuler, ni transferer un actif ;
- un lecteur admin borne qui n'expose aucun HMAC reseau ou navigateur ;
- une section responsive dans `/admin/security` qui rend visible ce mode
  observation ;
- une fondation Discord V2 desactivee par defaut : filtrage par politique et
  file de lettres mortes apres les tentatives existantes.

Les etapes volontairement non implementees sont la reservation avant reglement,
la liberation/annulation automatique, les actions de sanction depuis une
quarantaine, la recuperation avancee et l'activation des flags. Elles demandent
une revue complementaire des contrats d'echange et des flux de recours.

## Plan de rollout et rollback

- Migrations additives uniquement ; aucune reecriture des preuves historiques.
- Tous les flags restent a `false` lors de l'application.
- Le rollback fonctionnel consiste a desactiver les flags ; le registre et les
  audits restent en lecture pour ne pas detruire les preuves.
- Aucune migration de production, activation de flag, sanction automatique ou
  modification d'actif joueur n'est autorisee par cette branche seule.
