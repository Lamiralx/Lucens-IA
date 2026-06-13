# Système de licences Lucens — Design (2026-06-13)

## Objectif
Vendre des codes de licence à durée. À chaque paiement, l'admin délivre un code qui
débloque l'analyse pour une période choisie. Sert AUSSI de verrou anti-abus : seuls les
codes valides consomment l'API Gemini (fin de l'exposition publique de l'endpoint).

## Périmètre — STRICT (corrigé plusieurs fois par l'utilisateur)
- **TOUT ce qui concerne la licence se passe dans les Réglages. Rien ailleurs.**
- Aucune autre partie de l'interface ne change : accueil, écran d'analyse, boutons
  Live View / Importer — tout reste **exactement comme aujourd'hui**. Pas de badge, pas
  de cadenas, pas de bannière, pas de texte ajouté.
- Le verrou est appliqué **côté serveur (invisible)**. Si une analyse est lancée sans
  licence valide, `/api/analyze` la refuse → aucun appel Gemini, aucun coût. La gestion
  de ce refus passe par le **mécanisme d'erreur déjà existant** de l'app (rien de neuf à
  concevoir côté UI).

## Règles métier
- 1 code = 1 **date d'expiration** (modifiable à la main par l'admin).
- **1 appareil actif** par code, « le dernier l'emporte » : réactiver sur un nouvel
  appareil délie automatiquement l'ancien (1 seul actif à la fois, pas de support manuel).
- **Révocation immédiate** : appliquée à la prochaine tentative d'analyse.

## Côté client — Réglages UNIQUEMENT
- Champ de saisie du code → activation.
- Affichage : **date d'activation + date d'expiration + état** (actif / expiré / aucun code).
- Rien d'autre, nulle part ailleurs dans l'app.

## Côté admin — page web protégée par `LUCENS_ADMIN_TOKEN`
- Fiche complète d'identification : **Nom, Prénom, Email, Entreprise, N° de commande,
  Date d'expiration**.
- Actions : **créer / modifier** (expiration, infos, statut, délier l'appareil) /
  **révoquer / supprimer**.
- Temps réel (écriture directe dans Vercel KV). Aucun redéploiement pour gérer un code.

## Architecture
- **Stockage** : Vercel KV (déjà configuré sur le projet). Source de vérité, lue en
  temps réel par le serveur à chaque analyse. Pas un fichier local.
- **Validation** : fondue dans `/api/analyze` — lecture KV : le code existe ? actif ?
  non expiré (horloge **serveur**) ? appareil OK ou à relier ? Sinon → 403, pas d'appel
  Gemini.
- **Admin** : page statique (`admin-licences.html`) + logique de gestion fondue dans un
  **endpoint existant** (ex. `lucens-stats.js`). Contrainte plan Hobby = **12 fonctions
  max, déjà atteint** → NE PAS créer de nouvelle fonction serverless.
- Le client envoie `code` + `deviceId` (généré une fois, stocké en local) à chaque
  analyse, via un en-tête.

## Modèle de données (KV)
```
licence:{CODE} → {
  code,            // ex. LUCENS-7QK2-9F3A-XR8T (aléatoire, insensible à la casse)
  nom, prenom, email, entreprise, numeroCommande,
  expiresAt,       // date+heure d'expiration (ISO)
  statut,          // "active" | "revoked"
  deviceId,        // appareil lié (vide avant 1re activation)
  createdAt, activatedAt
}
```

## Hors périmètre (YAGNI — v1)
Pas de paiement intégré (l'admin délivre les codes à la main après paiement), pas de
portail client self-service, pas de multi-sièges, pas d'email automatique, pas d'export,
**aucune modification de l'interface hors Réglages**.

## Sécurité
- Clé Gemini déjà 100 % côté serveur (jamais dans le client) — non volable.
- Vérification du code **toujours côté serveur** : un code trafiqué dans le navigateur ne
  débloque rien.
- KV en `fail-open` actuellement pour le rate-limit : à confirmer que la validation de
  licence soit `fail-closed` (si KV indisponible, refuser plutôt que laisser passer) —
  à trancher dans le plan d'implémentation.
