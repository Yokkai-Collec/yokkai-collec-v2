# Referral Event

Première édition : du 16 novembre 2026 à 19:00 UTC au 30 novembre à 19:00 UTC
(20h au démarrage et à la fin dans Europe/Paris). Grâce jusqu'au 1er décembre
à 19:00 UTC, uniquement pour les comptes inscrits dans les dernières 24 heures.

Le parrainage et ses 5 Regular Packs pour chaque joueur restent inchangés.
`referrals.rewarded_at` confirme la validation existante et ses contrôles anti-abus.
L'event ajoute l'âge de 24h et une ouverture de Regular Pack ou récupération de
Decision Pack après ces 24h. Les dates viennent des journaux serveur existants.
La date de qualification est la plus tardive entre activité, vérification et
approbation de la récompense habituelle, jamais la date de passage du cron.

`settle-referral-events` s'exécute chaque minute. Seul le propriétaire de la base
peut appeler le worker. Une contrainte primaire `(user_id,event_id,threshold)`
empêche les doublons ; reçu, crédit via `credit_karas`, progression et notification
sont dans la même transaction. Les lectures n'attribuent rien. Les exclusions
(compte absent, supprimé/anonymisé, banni, parrainage sanctionné) sont recalculées.
Les récompenses déjà versées ne sont pas automatiquement reprises si un compte
devient inéligible ultérieurement ; les sanctions existantes restent indépendantes.

Le titre Recruiter est un droit acquis porté par le reçu du palier 20 et lié à
l'édition ; il ne dépend ni de Pro ni des décorations modifiables du profil.
Il est déverrouillé dans `player_title_unlocks`, puis sélectionnable dans le sélecteur de titres existant, sans équipement automatique. Les projections sociales et règles de visibilité existantes s’appliquent.

## Économie consultée en lecture seule le 13 novembre 2026

- 503 parrainages, récompense habituelle : 5 Regular Packs par bénéficiaire.
- Un pack contient 5 cartes. Recyclage C/R/SR/SSR/LR : 1/2/3/4/5 Karas.
  Avec les probabilités normales .694/.200/.100/.005/.001, les 5 packs valent
  environ 35,5 Karas de recyclage attendu, sans valoriser la collection.
- 1 150 journées avec ouverture de pack sur les 7 jours complets précédents :
  moyenne d'environ 450 Karas/journée provenant des ventes aux enchères, missions
  réclamées et succès réclamés, médiane 0. Ce n'est pas un registre exhaustif :
  les recyclages et échanges ne disposent pas d'un historique complet des crédits.
- Jauges : 110 Karas/jour et 600/semaine avant bonus Pro existant.
- Succès en base : 10 à 100 Karas, moyenne 50.
- 2 973 enchères vendues sur 30 jours : moyenne 283 Karas, médiane 90.

Paliers validés par Walid : 3 → 750 Karas ; 5 → 750 Karas ; 10 → 1 600 Karas ;
20 → un Decision Pack spécial de 5 LR aléatoires, toutes conservées, et le titre Recruiter.
Le cumul en Karas est de 3 100. Aucun temps de Pro n'est offert.
Le pack utilise decision_packs / decision_pack_choices et l'insertion de collection
existante, avec le marqueur de pack bonus pour préserver le quota quotidien.
Il est attribué et ouvert côté serveur avec le reçu unique ; la révélation UI
ne fait que lire les cinq cartes déjà attribuées. Cette attribution automatique
ne compte pas comme une activité du filleul. Doublons possibles et chance
Shiny LR habituelle du Decision Pack (1 %), jamais Infinity.

## Relancer une édition

Ajouter une ligne `referral_events` avec un slug unique et des dates UTC, puis ses
quatre lignes `referral_event_tiers` (seuils 3/5/10/20, montant, nombre de LR et titre au seuil 20).
Les fenêtres d'inscription ne peuvent pas se chevaucher. Les anciens reçus restent
liés à leur édition ; aucun changement d'interface ou de worker n'est nécessaire.
La page `/referral-event` présente l'édition active, sinon la prochaine ou la dernière.
Les encarts Home/Packs n'apparaissent qu'entre début et fin, pas pendant la grâce.

Migration `20261116130001_referral_event.sql` : à appliquer en production uniquement
via `scripts/deploy-migrations.sh`. Aucun déploiement n'a été effectué pour cette PR.
Test SQL autonome : `tests/sql/referral-event.sql`, enveloppe de test
`node --test tests/referral-event-db.test.mjs` sur une base jetable.

## Installation puis activation

Les migrations installent les deux events avec `event_runtime_config.enabled=false`.
Ce verrou opérateur est privé : ni un joueur ni le rôle de service ne peut l’activer.
Les workers restent sans effet et les DTO d’événement renvoient null pendant
la préparation, pour préserver la compatibilité avec l’ancien front.
Après CI verte et déploiement du front, l’opérateur active les données de
configuration dans une transaction :

```sql
begin;
update public.event_runtime_config set enabled=true where singleton;
select public.create_daily_mystery_auction();
select public.settle_referral_events();
commit;
```

La création quotidienne rattrape un démarrage après 20h locale, une seule fois
par date. Les enchères existantes continuent toujours leur clôture normale.
