# Préparation du passage de Stripe à Whop

L’offre [Yokkai Collec' Pro](https://whop.com/checkout/plan_9Kh2sFBJpQR9Q) affiche trois jours d’essai, puis 4,99 € par mois hors taxes. Le 21 novembre 2026, Stripe comptait 19 abonnements actifs à l’offre Yokkai Pro, dont 16 candidats au transfert par carte et 3 déjà programmés pour s’arrêter. Le rapport de prévisualisation Whop déterminera l’éligibilité au moment du transfert.

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

## Intégrer et tester l’achat

- Créer le checkout côté serveur avec le tarif vérifié et une preuve de rattachement à la session Yokkai. Utiliser une référence créée et conservée par le serveur dans les métadonnées de la [configuration de checkout](https://docs.whop.com/api-reference/checkout-configurations/create-a-checkout-configuration).
- Vérifier la signature des [webhooks Whop](https://docs.whop.com/developer/guides/webhooks). Vérifier auprès de l’API le compte, le tarif, l’abonnement et sa période avant de mettre à jour l’accès Pro. Tester les erreurs, les notifications répétées ou désordonnées, l’essai et son expiration, le renouvellement, la résiliation et le remboursement dans le sandbox.
- Relier le statut Whop aux contrôles Pro existants, à la gestion de l’abonnement et à la suppression de compte. Afficher l’essai et le prix hors taxes selon l’offre confirmée.

## Préparer le transfert des abonnés actuels

- Dans le tableau de bord Whop, ouvrir **Settings → Migrations → Stripe** et lancer la prévisualisation. Whop documente le transfert des abonnements actifs ou en période d’essai payés par carte, avec conservation de la date de renouvellement. [Documentation Whop](https://whop.com/blog/migrations/)
- Comparer la prévisualisation avec les abonnements Stripe de Yokkai Pro. Exclure les résiliations déjà programmées du renouvellement Whop. Vérifier le prix et la prochaine échéance pour chaque abonnement retenu et vérifier que chaque abonnement Whop importé correspond à un seul compte Yokkai.
- Avant la bascule, vérifier la continuité de Pro pour les comptes transférés et l’absence d’un second renouvellement sur Stripe. Les comptes encore facturés par Stripe gardent leur intégration jusqu’à leur sortie de Stripe.
