-- Migration : ajout colonne titre aux annonces
ALTER TABLE annonces ADD COLUMN IF NOT EXISTS titre VARCHAR(300);
