# Préparation du passage de Stripe à Whop

L’offre [Yokkai Collec' Pro](https://whop.com/checkout/plan_9Kh2sFBJpQR9Q) affiche 4,99 € par mois hors taxes, sans essai. Le 21 novembre 2026, Stripe comptait 19 abonnements actifs à l’offre Yokkai Pro, dont 16 candidats au transfert par carte et 3 déjà programmés pour s’arrêter. Le rapport de prévisualisation Whop déterminera l’éligibilité au moment du transfert.

## Vérifier une offre

Créer un tarif équivalent dans le [sandbox Whop](https://sandbox.whop.com/) pour la recette. Le sandbox et la production ont des identifiants et des clés distincts. Choisir une clé Whop limitée en lecture au tarif et à son produit, selon les [autorisations de l’API Variants](https://docs.whop.com/api-reference/variants/variant). Renseigner l’identifiant d’entreprise `biz_…`, l’identifiant du tarif `plan_…` et la clé dans un fichier d’environnement ignoré par Git ou dans le gestionnaire de secrets. Le fichier d’exemple ci-dessous correspond au sandbox.

```dotenv
WHOP_MODE=sandbox
WHOP_ACCOUNT_ID=
WHOP_PRO_PLAN_ID=
WHOP_API_KEY=
```

```sh
node --env-file=.env.whop-sandbox.local scripts/check-whop-setup.mjs
```

Le script appelle uniquement `GET /variants/{id}` sur l’hôte de l’environnement choisi. Il vérifie le compte, le tarif, la devise, la récurrence, le montant, l’essai et le traitement des taxes. Pour lire l’offre réelle, utiliser `WHOP_MODE=production`, le tarif `plan_9Kh2sFBJpQR9Q` et les secrets de cet environnement. Le résultat contient uniquement des informations de configuration et des codes d’erreur, sans clé ni donnée client.

## Tester l’achat en local

- Appliquer la migration `20261121190000_whop_sandbox_entitlements.sql` à la base locale. Sur cette base, renseigner `billing_entitlement_config.whop_sandbox_scope` avec `sandbox:<WHOP_ACCOUNT_ID>:<WHOP_PRO_PLAN_ID>`. Cette colonne est vide par défaut. La clé de test doit pouvoir créer les configurations de checkout et lire les abonnements (`checkout_configuration:create` et `member:basic:read`).
- Démarrer Next.js en développement avec les variables de Supabase local et de Whop Sandbox. Charger `.env.whop-sandbox.local` dans le processus qui lance Next lorsque les variables ne sont pas déjà définies. Un lancement reproductible est `node -e "process.loadEnvFile('.env.whop-sandbox.local'); require('node:child_process').spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1'], { stdio: 'inherit' })"`.
- Ouvrir `/design-system/whop-preview` avec un compte Yokkai local. Le serveur crée une [session de paiement](https://docs.whop.com/api-reference/checkout-configurations/create-a-checkout-configuration) avec une référence privée propre à ce compte. Utiliser la [carte de test Whop](https://docs.whop.com/developer/guides/sandbox) et attendre la confirmation sur l’aperçu après le retour. Vérifier ensuite les limites Pro dans `/boosters`.
- Sur cet aperçu local, Yokkai lit l’état courant de l’abonnement dans Whop. La référence sauvegardée, le compte Whop et le tarif doivent correspondre. Seuls les états essai et actif avec une période valide ouvrent les avantages. Rafraîchir la page de test après un changement dans Whop pour vérifier son effet.
- Pour la recette des notifications, appliquer aussi `20261121200000_whop_sandbox_webhook_jobs.sql`. Le récepteur `POST /api/billing/whop-sandbox/webhook` accepte les événements d’abonnement signés avec `WHOP_SANDBOX_WEBHOOK_SECRET` et épinglés au 20 novembre 2026. Il conserve uniquement les identifiants nécessaires et relit l’abonnement directement dans Whop. `POST /api/billing/whop-sandbox/reconcile`, protégé par le jeton `WHOP_SANDBOX_RECONCILIATION_SECRET`, reprend les notifications restées en attente. Whop exige une URL publique pour les envois depuis son tableau de bord. [Documentation Whop](https://docs.whop.com/developer/guides/webhooks)

## Synchroniser l’accès Pro des abonnements importés

- Appliquer `20261121210000_whop_live_entitlements.sql` après les deux migrations sandbox. La table de correspondance démarre vide. Dans le runtime Coolify, configurer `WHOP_LIVE_ACCOUNT_ID` et `WHOP_LIVE_API_KEY` puis activer `WHOP_LIVE_SYNC_ENABLED=true`. La clé doit permettre de lire les abonnements et les paiements (`member:basic:read`, `payment:basic:read`) et d’annuler un abonnement lors d’une suppression de compte (`membership:cancel`, `member:manage`). Les secrets restent dans le gestionnaire de secrets. Le script de réconciliation Stripe lance aussi la synchronisation Whop si elle est activée. Vérifier son exécution toutes les cinq minutes et les erreurs du journal.
- Après autorisation du transfert et réception du rapport officiel, préparer les paires **ID d’abonnement Stripe → ID d’abonnement Whop**. Confirmer le client Stripe via l’API Stripe, la date de fin payée, le montant, et récupérer via l’API Whop l’entreprise, le membre, le produit et le tarif de chaque abonnement importé. Utiliser la correspondance Stripe → compte Yokkai existante via `billing_link_whop_import(p_customer, p_subscription, p_account, p_membership, p_member, p_product, p_variant, p_paid_until)` depuis un accès serveur. La fonction vérifie le client Stripe et sa période payée. Conserver le rapport comme source du lien entre les deux abonnements. Les adresses e-mail peuvent être partagées entre plusieurs comptes.
- Vérifier `billing_has_game_pro` pour les comptes importés et comparer les dates de facturation avant d’ouvrir les nouvelles souscriptions Whop. La période déjà payée sur Stripe continue jusqu’à sa fin, sous réserve d’un abonnement Whop valide. Les périodes suivantes exigent un paiement Whop correspondant, sans remboursement ni signal de litige pour la période. La synchronisation passe par les lectures API périodiques et ne lance aucun achat, import, ni transfert.
- Fermer les nouvelles souscriptions Stripe quand Whop ouvre les inscriptions. L’annulation Whop lors d’une suppression de compte est vérifiée avant d’effacer le lien du compte.

## Préparer le transfert des abonnés actuels

- Dans le tableau de bord Whop, ouvrir **Settings → Migrations → Stripe** et lancer la prévisualisation. Whop documente le transfert des abonnements actifs ou en période d’essai payés par carte, avec conservation de la date de renouvellement. [Documentation Whop](https://whop.com/blog/migrations/)
- Comparer la prévisualisation avec les abonnements Stripe de Yokkai Pro. Exclure les résiliations déjà programmées du renouvellement Whop. Vérifier le prix et la prochaine échéance pour chaque abonnement retenu et vérifier que chaque abonnement Whop importé correspond à un seul compte Yokkai.
- Avant la bascule, vérifier la continuité de Pro pour les comptes transférés et l’absence d’un second renouvellement sur Stripe. Les comptes encore facturés par Stripe gardent leur intégration jusqu’à leur sortie de Stripe.

## Basculer les nouvelles souscriptions vers Whop

- Appliquer `20261121220000_whop_live_checkout.sql` avant le déploiement.
- Dans Coolify, définir `WHOP_LIVE_PLAN_ID` sur l’offre Pro de production. Activer `WHOP_LIVE_CHECKOUT_ENABLED=true` et fermer `STRIPE_CHECKOUT_ENABLED=false` dans le même déploiement. Garder `STRIPE_BILLING_ENABLED=true`, son webhook et sa tâche de réconciliation. La clé Whop utilise la création de checkout, la lecture des adhésions/paiements et l’annulation pour les suppressions demandées.
- Le client authentifié reçoit un lien privé dont la référence aléatoire est conservée par Yokkai. Le serveur la rapproche d’une adhésion Whop vérifiée. Les achats existants et les sessions Stripe encore ouvertes bloquent un second checkout. La réconciliation planifiée rattrape les retours navigateur manqués.
- Les paramètres affichent le prestataire de l’abonnement. Les nouveaux abonnés sont facturés 4,99 € hors taxes tous les 30 jours par Whop. Le premier paiement est dû dès la souscription.
- Pendant la transition, vérifier les deux prestataires et le compteur d’échecs de la tâche de réconciliation. Pour fermer temporairement les nouvelles ventes, désactiver `WHOP_LIVE_CHECKOUT_ENABLED` et garder la synchronisation des adhésions déjà créées active.
