-- Migration pour ajouter les fonctionnalités de découverte de serveurs communautaires
-- Date: 2026-01-23

-- Ajouter les colonnes au tableau server
ALTER TABLE server
ADD COLUMN IF NOT EXISTS is_community boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]',
ADD COLUMN IF NOT EXISTS language varchar(10) DEFAULT 'en',
ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS member_count integer DEFAULT 0;

-- Créer un index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_server_is_community ON server(is_community);
CREATE INDEX IF NOT EXISTS idx_server_is_featured ON server(is_featured);
CREATE INDEX IF NOT EXISTS idx_server_language ON server(language);
CREATE INDEX IF NOT EXISTS idx_server_tags ON server USING gin(tags);

-- Créer une fonction trigger pour mettre à jour member_count automatiquement
CREATE OR REPLACE FUNCTION update_server_member_count()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE server SET member_count = member_count + 1 WHERE id = NEW.server;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE server SET member_count = member_count - 1 WHERE id = OLD.server;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger sur accessServer
DROP TRIGGER IF EXISTS update_member_count_trigger ON accessServer;
CREATE TRIGGER update_member_count_trigger
AFTER INSERT OR DELETE ON accessServer
FOR EACH ROW
EXECUTE FUNCTION update_server_member_count();

-- Initialiser member_count pour les serveurs existants
UPDATE server SET member_count = (
    SELECT COUNT(*) FROM accessServer WHERE accessServer.server = server.id
);
