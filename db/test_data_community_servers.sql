-- Script de test pour la fonctionnalité Community Servers
-- Crée des serveurs de test avec différentes configurations

-- Note: Remplacez USER_ID_1, USER_ID_2 par des IDs d'utilisateurs réels de votre base

-- 1. Créer un serveur de gaming en anglais
INSERT INTO server (name, owner, is_community, description, language, tags, is_featured)
VALUES (
    'Epic Gaming Community',
    1, -- Remplacer par USER_ID_1
    true,
    'Join us for epic gaming sessions! We play FPS, RPG, and strategy games. Active community with events every weekend.',
    'en',
    '["gaming", "fps", "rpg", "english", "active"]'::jsonb,
    true
) RETURNING id;

-- 2. Créer un serveur d'étude en français
INSERT INTO server (name, owner, is_community, description, language, tags, is_featured)
VALUES (
    'Entraide Étudiants',
    1, -- Remplacer par USER_ID_1
    true,
    'Communauté d''entraide pour les étudiants. Partage de notes, sessions d''étude en groupe, et soutien académique.',
    'fr',
    '["study", "français", "university", "homework", "friendly"]'::jsonb,
    false
) RETURNING id;

-- 3. Créer un serveur d'art multilingue
INSERT INTO server (name, owner, is_community, description, language, tags, is_featured)
VALUES (
    'Creative Artists Hub',
    2, -- Remplacer par USER_ID_2
    true,
    'A place for artists to share their work, get feedback, and collaborate. All skill levels welcome!',
    'en',
    '["art", "creative", "drawing", "painting", "community"]'::jsonb,
    true
) RETURNING id;

-- 4. Créer un serveur de développement
INSERT INTO server (name, owner, is_community, description, language, tags, is_featured)
VALUES (
    'Dev & Code',
    2, -- Remplacer par USER_ID_2
    true,
    'Community for developers. Share code, ask questions, collaborate on projects. Python, JavaScript, and more.',
    'en',
    '["coding", "dev", "tech", "python", "javascript", "opensource"]'::jsonb,
    false
) RETURNING id;

-- 5. Créer un serveur casual en français
INSERT INTO server (name, owner, is_community, description, language, tags, is_featured)
VALUES (
    'Café Détente',
    1, -- Remplacer par USER_ID_1
    true,
    'Un serveur décontracté pour discuter de tout et de rien. Bonne ambiance garantie !',
    'fr',
    '["français", "casual", "chill", "friendly", "chat"]'::jsonb,
    false
) RETURNING id;

-- 6. Créer un serveur anime/manga
INSERT INTO server (name, owner, is_community, description, language, tags, is_featured)
VALUES (
    'Anime & Manga Lovers',
    2, -- Remplacer par USER_ID_2
    true,
    'Discuss your favorite anime and manga! Weekly watch parties and chapter discussions.',
    'en',
    '["anime", "manga", "otaku", "japanese", "community"]'::jsonb,
    true
) RETURNING id;

-- Vérifier les serveurs créés
SELECT
    id,
    name,
    is_community,
    is_featured,
    language,
    tags,
    member_count,
    description
FROM server
WHERE is_community = true
ORDER BY is_featured DESC, member_count DESC;

-- Vérifier les tags disponibles
SELECT DISTINCT jsonb_array_elements_text(tags) as tag
FROM server
WHERE is_community = true
ORDER BY tag;

-- Statistiques
SELECT
    COUNT(*) as total_servers,
    COUNT(*) FILTER (WHERE is_community = true) as community_servers,
    COUNT(*) FILTER (WHERE is_featured = true) as featured_servers,
    COUNT(*) FILTER (WHERE language = 'fr') as french_servers,
    COUNT(*) FILTER (WHERE language = 'en') as english_servers
FROM server;
