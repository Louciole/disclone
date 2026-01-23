# Quick Start Guide - Community Servers Feature

## Installation

### 1. Appliquer la migration de base de données

```bash
# Connectez-vous à votre base de données PostgreSQL
psql -U your_username -d disclone_db -f db/migration_community_servers.sql
```

Cette commande va :
- Ajouter les nouveaux champs à la table `server`
- Créer les index nécessaires pour les performances
- Mettre en place un trigger pour maintenir `member_count` à jour automatiquement
- Initialiser `member_count` pour les serveurs existants

### 2. Redémarrer le serveur

```bash
python server.py
```

### 3. Vérifier que tout fonctionne

Ouvrez votre navigateur et connectez-vous à l'application. Vous devriez voir :
- Une nouvelle icône de boussole sous la liste de serveurs (entre les serveurs et le bouton "+")

## Utilisation rapide

### Pour les propriétaires de serveurs :

1. **Rendre votre serveur découvrable :**
   - Cliquez sur le nom du serveur → "Paramètres du serveur"
   - Cochez "Rendre ce serveur découvrable"
   - Ajoutez une description accueillante
   - Sélectionnez la langue principale
   - Ajoutez des tags pertinents (ex: "gaming", "français", "communauté")
   - Les modifications sont sauvegardées automatiquement

### Pour les utilisateurs :

1. **Découvrir des serveurs :**
   - Cliquez sur l'icône de boussole (🧭)
   - Utilisez la barre de recherche pour trouver des serveurs spécifiques
   - Filtrez par langue avec le menu déroulant
   - Cliquez sur les tags pour filtrer par catégorie
   - Cliquez sur "Rejoindre" pour rejoindre un serveur instantanément

### Pour les administrateurs :

1. **Mettre en avant un serveur :**
   
   Utilisez l'API depuis la console JavaScript :
   ```javascript
   xhr('setServerFeatured?server_id=123&featured=true', () => {
       console.log('Server featured successfully');
   }, 'POST');
   ```
   
   Ou créez une interface admin dédiée selon vos besoins.

## Exemples de tags suggérés

Voici quelques suggestions de tags populaires :

**Par thématique :**
- gaming, rpg, fps, mmorpg
- study, homework, university
- art, music, photography
- coding, dev, tech, python, javascript
- anime, manga, k-pop
- sports, fitness, football

**Par langue/région :**
- français, english, español, deutsch
- europe, americas, asia

**Par ambiance :**
- friendly, chill, active, 24/7
- mature, teen, family-friendly
- competitive, casual

**Par taille :**
- small, medium, large
- growing, new

## Configuration avancée

### Limites par défaut

Vous pouvez modifier ces limites dans le code :

**Backend (`server.py`)** :
```python
# Dans getDiscoverableServers()
'featured': featured[:10],  # Limite de serveurs featured
'regular': regular[:50]     # Limite de serveurs normaux
```

**Frontend (`crud.mjs`)** :
```javascript
// Dans addServerTag()
if (tagsList.length >= 10) {  // Limite de tags par serveur
    alert('Vous ne pouvez pas ajouter plus de 10 tags.');
    return;
}
```

### Ajouter plus de langues

Éditez les fichiers suivants pour ajouter des langues :

**`static/templates/server-main-settings.html`** :
```html
<option value="nl" ${global.state.currentServer?.language === 'nl' ? 'selected' : ''}>Nederlands</option>
<option value="ru" ${global.state.currentServer?.language === 'ru' ? 'selected' : ''}>Русский</option>
```

**`static/main.html`** (dans le menu de découverte) :
```html
<option value="nl">Nederlands</option>
<option value="ru">Русский</option>
```

### Personnaliser les styles

Les styles CSS se trouvent dans `static/style.css` sous la section :
```css
/* ==================== Discover Servers Styles ==================== */
```

Vous pouvez modifier :
- Les couleurs (variables CSS en haut du fichier)
- La taille des cartes de serveurs
- Les animations et transitions
- Le layout du grid

## Dépannage

### Le bouton de découverte n'apparaît pas

1. Vérifiez que `discover.mjs` est bien importé dans `main.html`
2. Vérifiez la console JavaScript pour des erreurs
3. Videz le cache du navigateur (Ctrl+Shift+R)

### Les serveurs n'apparaissent pas dans la recherche

1. Vérifiez que `is_community` est bien à `true` dans la base de données :
   ```sql
   SELECT id, name, is_community FROM server WHERE is_community = true;
   ```

2. Vérifiez que le serveur a bien au moins 1 membre (vous)

### Les tags ne s'affichent pas

1. Vérifiez le format JSON dans la base de données :
   ```sql
   SELECT id, name, tags FROM server WHERE id = YOUR_SERVER_ID;
   ```
   
2. Les tags doivent être au format : `["tag1", "tag2", "tag3"]`

### Les filtres ne fonctionnent pas

1. Ouvrez la console du navigateur (F12)
2. Regardez les requêtes réseau dans l'onglet Network
3. Vérifiez que l'endpoint `getDiscoverableServers` retourne bien des données

## Performance

### Index créés automatiquement

La migration crée ces index pour optimiser les performances :
- `idx_server_is_community` - Filtre les serveurs communautaires
- `idx_server_is_featured` - Sépare les serveurs featured
- `idx_server_language` - Filtre par langue
- `idx_server_tags` - Recherche dans les tags JSON (GIN index)

### Trigger automatique

Le trigger `update_member_count_trigger` maintient `member_count` à jour :
- Se déclenche automatiquement lors d'un INSERT ou DELETE dans `accessServer`
- Pas besoin de maintenance manuelle

## Sécurité

### Permissions

- **Créer un serveur communautaire** : Propriétaire uniquement
- **Éditer les paramètres** : Propriétaire ou membres avec droit "edit"
- **Mettre en avant** : Administrateurs plateforme uniquement
- **Rejoindre** : Tous les utilisateurs authentifiés

### Validation

- Max 10 tags par serveur
- Max 20 caractères par tag
- Max 500 caractères pour la description
- Vérification que le serveur est bien communautaire avant de rejoindre

## Support

Pour plus d'informations, consultez :
- `DISCOVER_SERVERS_FEATURE.md` - Documentation technique complète
- `LLM_GUIDE.md` - Guide du projet
- `tests/backend/test_community_servers.py` - Exemples de tests

## Prochaines étapes suggérées

1. **Créer quelques serveurs de test** avec différentes langues et tags
2. **Tester le flux complet** de découverte et adhésion
3. **Personnaliser les styles** selon votre thème
4. **Ajouter des traductions** pour l'interface multilingue
5. **Implémenter une interface admin** pour gérer les serveurs featured

Bon développement ! 🚀
