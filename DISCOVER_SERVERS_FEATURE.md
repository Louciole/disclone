# Discover Servers Feature - Documentation

## Vue d'ensemble

Cette fonctionnalité permet aux utilisateurs de découvrir et rejoindre des serveurs communautaires publics. Les serveurs peuvent être rendus découvrables par leurs propriétaires et filtrés par tags, langue et nom.

## Nouveaux champs de base de données

### Table `server`
- `is_community` (boolean) : Indique si le serveur est découvrable publiquement
- `tags` (jsonb) : Liste de tags pour la catégorisation (max 10 tags)
- `language` (varchar) : Code de langue du serveur (fr, en, es, de, it, pt)
- `is_featured` (boolean) : Indique si le serveur est mis en avant (admin uniquement)
- `description` (text) : Description du serveur pour attirer de nouveaux membres
- `member_count` (integer) : Nombre de membres (mis à jour automatiquement via trigger)

## Migration

Pour appliquer les changements à une base de données existante, exécutez :

```bash
psql -U your_user -d your_database -f db/migration_community_servers.sql
```

Ce script ajoute les colonnes nécessaires, crée les index pour les performances, et met en place un trigger pour maintenir `member_count` à jour automatiquement.

## API Endpoints

### Backend (server.py)

#### `getDiscoverableServers(search=None, tags=None, language=None)`
- **Méthode** : GET
- **Authentification** : Requise
- **Paramètres** :
  - `search` (optionnel) : Terme de recherche pour le nom ou la description
  - `tags` (optionnel) : JSON array de tags à filtrer
  - `language` (optionnel) : Code de langue pour filtrer
- **Retour** : JSON avec `featured` (serveurs mis en avant) et `regular` (serveurs normaux)

#### `joinCommunityServer(server_id)`
- **Méthode** : POST
- **Authentification** : Requise
- **Paramètres** :
  - `server_id` : ID du serveur à rejoindre
- **Retour** : JSON avec statut de succès

#### `getAvailableTags()`
- **Méthode** : GET
- **Authentification** : Requise
- **Retour** : JSON array de tous les tags disponibles

#### `setServerFeatured(server_id, featured)` 
- **Méthode** : POST
- **Authentification** : Admin uniquement
- **Paramètres** :
  - `server_id` : ID du serveur
  - `featured` : "true" ou "false"
- **Retour** : JSON avec statut de succès

#### `editServer(property, id, value, ...)`
Nouvelles propriétés supportées :
- `is_community` : Rend le serveur découvrable (owner uniquement)
- `tags` : JSON array de tags
- `language` : Code de langue
- `description` : Description du serveur

## Frontend

### Nouveau composant : Discover Servers Menu

#### Fichiers créés :
- `static/discover.mjs` : Logique JavaScript pour la découverte de serveurs
- `static/templates/discover-servers-menu.html` : Template du menu fullscreen
- `static/templates/discover-servers-button.html` : Bouton de découverte
- `static/templates/discover-server-card.html` : Template pour une carte de serveur
- `static/icons/material/compass.svg` : Icône de boussole
- `static/icons/material/people.svg` : Icône de membres

#### Styles CSS :
Ajoutés dans `static/style.css` :
- `.fullscreen-menu` : Menu plein écran
- `.discover-*` : Classes pour les différents éléments de l'interface
- `.server-card` : Cartes de serveurs avec effets hover
- `.featured-badge` : Badge pour les serveurs mis en avant

### Paramètres de serveur

Le template `server-main-settings.html` a été étendu avec :
- **Checkbox** pour activer le mode communautaire
- **Textarea** pour la description du serveur
- **Select** pour choisir la langue
- **Système de tags** avec ajout/suppression

### Fonctions JavaScript (crud.mjs)

- `toggleCommunityServer()` : Active/désactive le mode communautaire
- `updateLanguage()` : Met à jour la langue du serveur
- `renderServerTags()` : Affiche les tags du serveur
- `addServerTag()` : Ajoute un nouveau tag
- `removeServerTag(index)` : Supprime un tag

## Utilisation

### Pour rendre un serveur découvrable :

1. Ouvrir les paramètres du serveur
2. Cocher "Rendre ce serveur découvrable"
3. Ajouter une description
4. Sélectionner la langue
5. Ajouter des tags pertinents (max 10)
6. Sauvegarder les modifications

### Pour découvrir des serveurs :

1. Cliquer sur l'icône de boussole sous la liste des serveurs
2. Utiliser la barre de recherche pour trouver des serveurs spécifiques
3. Filtrer par langue avec le menu déroulant
4. Cliquer sur les tags pour filtrer par catégorie
5. Cliquer sur "Rejoindre" pour rejoindre un serveur

### Pour mettre en avant un serveur (admin) :

Utiliser l'endpoint API `setServerFeatured` :
```javascript
xhr('setServerFeatured?server_id=123&featured=true', callback, 'POST');
```

## Permissions

- **Rendre un serveur communautaire** : Propriétaire du serveur uniquement
- **Éditer les paramètres communautaires** : Propriétaire ou membres avec droit "edit"
- **Mettre en avant un serveur** : Admins de la plateforme uniquement (via droit "disclone_admin")
- **Rejoindre un serveur communautaire** : Tous les utilisateurs authentifiés

## Performances

### Index créés :
- `idx_server_is_community` : Pour filtrer les serveurs communautaires
- `idx_server_is_featured` : Pour séparer les serveurs mis en avant
- `idx_server_language` : Pour filtrer par langue
- `idx_server_tags` : Index GIN pour rechercher dans les tags JSON

### Trigger :
- `update_member_count_trigger` : Met à jour automatiquement `member_count` quand un membre rejoint ou quitte un serveur

### Limites :
- Max 10 serveurs mis en avant retournés
- Max 50 serveurs normaux retournés
- Max 10 tags par serveur
- Max 20 caractères par tag

## Tests

Pour tester la fonctionnalité :

1. Créer un serveur de test
2. Rendre le serveur communautaire via les paramètres
3. Ajouter une description et des tags
4. Se connecter avec un autre compte
5. Ouvrir le menu de découverte
6. Vérifier que le serveur apparaît dans les résultats
7. Rejoindre le serveur

## Améliorations futures possibles

- Pagination pour les listes de serveurs
- Système de catégories prédéfinies
- Statistiques de serveurs (activité, croissance)
- Preview du serveur avant de rejoindre
- Système de notation/reviews
- Bannière personnalisée pour les serveurs
- Recherche avancée avec opérateurs booléens
- API publique pour lister les serveurs communautaires

## Compatibilité

- Compatible avec tous les navigateurs modernes
- Responsive design pour mobile et desktop
- Pas de breaking changes pour les serveurs existants
- Migration non destructive (les serveurs existants restent privés par défaut)
