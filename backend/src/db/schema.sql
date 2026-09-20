-- IBIG IMMO TRUST — Schéma PostgreSQL

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── ANNONCES ────────────────────────────────────────────────────────────────

CREATE TABLE annonces (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source        VARCHAR(20) NOT NULL CHECK (source IN ('facebook','whatsapp')),
  groupe_source VARCHAR(255),
  lien_original TEXT,
  texte_brut    TEXT NOT NULL,
  auteur_nom    VARCHAR(255),
  auteur_id     VARCHAR(255),
  date_publication TIMESTAMPTZ,
  date_collecte TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Champs structurés par IA
  type_bien     VARCHAR(50),   -- villa, appartement, terrain, bureau, magasin…
  transaction   VARCHAR(20) CHECK (transaction IN ('vente','location','colocation','autre')),
  commune       VARCHAR(100),
  quartier      VARCHAR(100),
  prix          NUMERIC(15,0),
  devise        VARCHAR(10) DEFAULT 'FCFA',
  superficie    NUMERIC(10,2),
  nb_pieces     SMALLINT,
  contact       VARCHAR(255),
  description_ia TEXT,

  -- Métadonnées
  statut        VARCHAR(20) DEFAULT 'actif' CHECK (statut IN ('actif','doublon','archivé')),
  doublon_de    UUID REFERENCES annonces(id),
  extraction_brute JSONB,

  CONSTRAINT unique_contact_prix_quartier UNIQUE NULLS NOT DISTINCT (contact, prix, quartier)
);

CREATE INDEX idx_annonces_commune    ON annonces(commune);
CREATE INDEX idx_annonces_type       ON annonces(type_bien);
CREATE INDEX idx_annonces_transaction ON annonces(transaction);
CREATE INDEX idx_annonces_prix       ON annonces(prix);
CREATE INDEX idx_annonces_date       ON annonces(date_collecte DESC);
CREATE INDEX idx_annonces_texte      ON annonces USING GIN (texte_brut gin_trgm_ops);

-- ─── IMAGES ──────────────────────────────────────────────────────────────────

CREATE TABLE images (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  annonce_id  UUID NOT NULL REFERENCES annonces(id) ON DELETE CASCADE,
  url_locale  TEXT NOT NULL,
  url_origine TEXT,
  hash_md5    VARCHAR(32),
  taille_ko   INTEGER,
  largeur     SMALLINT,
  hauteur     SMALLINT,
  ordre       SMALLINT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_images_annonce ON images(annonce_id);
CREATE INDEX idx_images_hash    ON images(hash_md5);

-- ─── RECHERCHES CLIENTS ──────────────────────────────────────────────────────

CREATE TABLE recherches_clients (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom_client    VARCHAR(255) NOT NULL,
  telephone     VARCHAR(50),
  email         VARCHAR(255),
  type_bien     VARCHAR(50),
  transaction   VARCHAR(20) CHECK (transaction IN ('vente','location','colocation','autre')),
  communes      TEXT[],
  quartiers     TEXT[],
  budget_min    NUMERIC(15,0),
  budget_max    NUMERIC(15,0),
  superficie_min NUMERIC(10,2),
  superficie_max NUMERIC(10,2),
  nb_pieces_min SMALLINT,
  nb_pieces_max SMALLINT,
  criteres_libres TEXT,
  statut        VARCHAR(20) DEFAULT 'actif' CHECK (statut IN ('actif','suspendu','conclu','annulé')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recherches_statut ON recherches_clients(statut);

-- ─── MATCHS ──────────────────────────────────────────────────────────────────

CREATE TABLE matchs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  annonce_id      UUID NOT NULL REFERENCES annonces(id) ON DELETE CASCADE,
  recherche_id    UUID NOT NULL REFERENCES recherches_clients(id) ON DELETE CASCADE,
  score           SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  score_detail    JSONB,   -- détail des 5 critères
  priorite        VARCHAR(20) GENERATED ALWAYS AS (
    CASE
      WHEN score >= 70 THEN 'forte'
      WHEN score >= 40 THEN 'moyenne'
      ELSE 'faible'
    END
  ) STORED,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (annonce_id, recherche_id)
);

CREATE INDEX idx_matchs_recherche ON matchs(recherche_id);
CREATE INDEX idx_matchs_score     ON matchs(score DESC);
CREATE INDEX idx_matchs_priorite  ON matchs(priorite);

-- ─── PIPELINE DE DÉMARCHAGE ──────────────────────────────────────────────────

CREATE TABLE pipeline (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id    UUID NOT NULL REFERENCES matchs(id) ON DELETE CASCADE,
  statut      VARCHAR(30) DEFAULT 'a_contacter' CHECK (
    statut IN ('a_contacter','contacte','en_negociation','conclu','perdu')
  ),
  ordre       SMALLINT DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pipeline_notes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id UUID NOT NULL REFERENCES pipeline(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_statut ON pipeline(statut);
CREATE INDEX idx_pipeline_match  ON pipeline(match_id);

-- ─── TRIGGER updated_at ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recherches_updated_at
  BEFORE UPDATE ON recherches_clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_pipeline_updated_at
  BEFORE UPDATE ON pipeline
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
