# Referral Event

Première édition : du 14 novembre 2026 à 19:00 UTC au 28 novembre à 19:00 UTC
(20h au démarrage et à la fin dans Europe/Paris). Grâce jusqu'au 29 novembre
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

Le badge Recruiter est un droit acquis porté par le reçu du palier 20 et lié à
l'édition ; il ne dépend ni de Pro ni des décorations modifiables du profil.
Il est lisible sur son propre profil ou un profil public, en respectant les blocages.

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

Paliers cumulatifs : 400 / 750 / 1 600 / 4 000 Karas (total 6 750).
Chaque bonus vaut environ quatre à six fois le recyclage attendu des récompenses
habituelles correspondant à son nombre de filleuls. Aucun temps de Pro n'est offert.

## Relancer une édition

Ajouter une ligne `referral_events` avec un slug unique et des dates UTC, puis ses
quatre lignes `referral_event_tiers` (seuils 3/5/10/20, montant et badge au seuil 20).
Les fenêtres d'inscription ne peuvent pas se chevaucher. Les anciens reçus restent
liés à leur édition ; aucun changement d'interface ou de worker n'est nécessaire.
La page `/referral-event` présente l'édition active, sinon la prochaine ou la dernière.
Les encarts Home/Packs n'apparaissent qu'entre début et fin, pas pendant la grâce.

Migration `20261114100000_referral_event.sql` : à appliquer en production uniquement
via `scripts/deploy-migrations.sh`. Aucun déploiement n'a été effectué pour cette PR.
Test SQL autonome : `tests/sql/referral-event.sql`, enveloppe de test
`node --test tests/referral-event-db.test.mjs` sur une base jetable.
