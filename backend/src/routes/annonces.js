const router  = require('express').Router();
const { query } = require('../db');
const { extraireAnnonce }     = require('../services/ai-extraction');
const { matcherNouvelleAnnonce } = require('../services/matching-engine');
const { upload, traiterImage } = require('../services/image-handler');

// POST /api/annonces/extraire — structuration IA sans enregistrement
router.post('/extraire', async (req, res) => {
  try {
    const { texte_brut } = req.body;
    if (!texte_brut) return res.status(400).json({ error: 'texte_brut requis' });
    const extraction = await extraireAnnonce(texte_brut);
    res.json({ ok: true, extraction });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/annonces — import complet (texte + images)
router.post('/', upload.array('images', 10), async (req, res) => {
  try {
    const {
      texte_brut, source, groupe_source, lien_original,
      auteur_nom, auteur_id, date_publication,
      type_bien, transaction, commune, quartier,
      prix, superficie, nb_pieces, contact, description_ia,
    } = req.body;

    if (!texte_brut || !source) {
      return res.status(400).json({ error: 'texte_brut et source requis' });
    }

    const { rows: [annonce] } = await query(
      `INSERT INTO annonces
         (source, groupe_source, lien_original, texte_brut, auteur_nom, auteur_id,
          date_publication, type_bien, transaction, commune, quartier, prix,
          superficie, nb_pieces, contact, description_ia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [source, groupe_source, lien_original, texte_brut, auteur_nom, auteur_id,
       date_publication || null, type_bien, transaction, commune, quartier,
       prix ? parseInt(prix) : null, superficie ? parseFloat(superficie) : null,
       nb_pieces ? parseInt(nb_pieces) : null, contact, description_ia]
    );

    // Traitement images
    const imagesInserted = [];
    for (const [i, file] of (req.files || []).entries()) {
      const imgData = await traiterImage(file.buffer, file.originalname, file.mimetype);
      const { rows: [img] } = await query(
        `INSERT INTO images (annonce_id, url_locale, hash_md5, taille_ko, largeur, hauteur, ordre)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, url_locale`,
        [annonce.id, imgData.url_locale, imgData.hash_md5,
         imgData.taille_ko, imgData.largeur, imgData.hauteur, i]
      );
      imagesInserted.push(img);
    }

    // Matching automatique
    const matchs = await matcherNouvelleAnnonce(annonce.id);

    res.status(201).json({ ok: true, annonce, images: imagesInserted, matchs });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Annonce potentiellement en doublon', detail: err.detail });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/annonces — liste avec filtres
router.get('/', async (req, res) => {
  try {
    const {
      commune, type_bien, transaction, source,
      budget_max, budget_min, q, statut = 'actif',
      limit = 20, offset = 0, sort = 'date_desc',
    } = req.query;

    const conditions = ['a.statut = $1'];
    const params = [statut];
    let p = 2;

    if (commune)     { conditions.push(`a.commune ILIKE $${p++}`);     params.push(`%${commune}%`); }
    if (type_bien)   { conditions.push(`a.type_bien = $${p++}`);       params.push(type_bien); }
    if (transaction) { conditions.push(`a.transaction = $${p++}`);     params.push(transaction); }
    if (source)      { conditions.push(`a.source = $${p++}`);          params.push(source); }
    if (budget_max)  { conditions.push(`a.prix <= $${p++}`);           params.push(parseInt(budget_max)); }
    if (budget_min)  { conditions.push(`a.prix >= $${p++}`);           params.push(parseInt(budget_min)); }
    if (q)           { conditions.push(`(a.texte_brut ILIKE $${p} OR a.commune ILIKE $${p} OR a.quartier ILIKE $${p} OR a.contact ILIKE $${p})`); params.push(`%${q}%`); p++; }

    const where = conditions.join(' AND ');
    const ORDER = {
      date_desc:       'a.date_collecte DESC',
      date_asc:        'a.date_collecte ASC',
      prix_asc:        'a.prix ASC NULLS LAST',
      prix_desc:       'a.prix DESC NULLS LAST',
      superficie_asc:  'a.superficie ASC NULLS LAST',
      superficie_desc: 'a.superficie DESC NULLS LAST',
    };
    const orderBy = ORDER[sort] || ORDER.date_desc;

    const { rows } = await query(
      `SELECT a.*,
         COALESCE(json_agg(i.url_locale ORDER BY i.ordre) FILTER (WHERE i.id IS NOT NULL), '[]') AS images,
         COUNT(m.id) FILTER (WHERE m.score >= 40) AS nb_matchs
       FROM annonces a
       LEFT JOIN images i ON i.annonce_id = a.id
       LEFT JOIN matchs m ON m.annonce_id = a.id
       WHERE ${where}
       GROUP BY a.id
       ORDER BY ${orderBy}
       LIMIT $${p} OFFSET $${p+1}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) AS total FROM annonces a WHERE ${where}`, params
    );

    res.json({ total: parseInt(total), annonces: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/annonces/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [annonce] } = await query(
      `SELECT a.*,
         COALESCE(json_agg(json_build_object('id',i.id,'url',i.url_locale,'ordre',i.ordre)
           ORDER BY i.ordre) FILTER (WHERE i.id IS NOT NULL), '[]') AS images
       FROM annonces a
       LEFT JOIN images i ON i.annonce_id = a.id
       WHERE a.id = $1
       GROUP BY a.id`,
      [req.params.id]
    );
    if (!annonce) return res.status(404).json({ error: 'Annonce introuvable' });

    const { rows: matchs } = await query(
      `SELECT m.*, r.nom_client, r.telephone FROM matchs m
       JOIN recherches_clients r ON r.id = m.recherche_id
       WHERE m.annonce_id = $1
       ORDER BY m.score DESC`,
      [req.params.id]
    );

    res.json({ ...annonce, matchs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/annonces/:id — modifier une annonce
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['type_bien','transaction','commune','quartier','prix',
                     'superficie','nb_pieces','contact','description_ia','statut'];
    const fields = Object.keys(req.body).filter(f => allowed.includes(f));
    if (!fields.length) return res.status(400).json({ error: 'Aucun champ modifiable' });

    const sets   = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = fields.map(f => req.body[f]);

    const { rows: [a] } = await query(
      `UPDATE annonces SET ${sets} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    if (!a) return res.status(404).json({ error: 'Annonce introuvable' });
    res.json({ ok: true, annonce: a });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/annonces/re-extraire — re-traiter par lot les annonces sans données structurées
router.post('/re-extraire', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    // Annonces sans type_bien ET avec texte_brut
    const { rows: annonces } = await query(
      `SELECT id, texte_brut FROM annonces
       WHERE type_bien IS NULL AND texte_brut IS NOT NULL AND texte_brut != ''
       ORDER BY date_collecte DESC
       LIMIT $1`,
      [limit]
    );

    if (annonces.length === 0) {
      return res.json({ ok: true, traites: 0, message: 'Toutes les annonces sont déjà structurées' });
    }

    let ok = 0, ko = 0;
    for (const ann of annonces) {
      try {
        const ext = await extraireAnnonce(ann.texte_brut);
        await query(
          `UPDATE annonces SET
             type_bien=$2, transaction=$3, commune=$4, quartier=$5,
             prix=$6, superficie=$7, nb_pieces=$8, contact=$9, description_ia=$10
           WHERE id=$1`,
          [
            ann.id,
            ext.type_bien || null,
            ext.transaction || null,
            ext.commune || null,
            ext.quartier || null,
            ext.prix ? parseInt(ext.prix) : null,
            ext.superficie ? parseFloat(ext.superficie) : null,
            ext.nb_pieces ? parseInt(ext.nb_pieces) : null,
            ext.contact || null,
            ext.description_ia || null,
          ]
        );
        ok++;
      } catch (_) {
        ko++;
      }
    }

    res.json({ ok: true, traites: ok, erreurs: ko, total_restants: annonces.length - ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/annonces/:id — archiver une annonce
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [a] } = await query(
      `UPDATE annonces SET statut='archive' WHERE id=$1 RETURNING id`,
      [req.params.id]
    );
    if (!a) return res.status(404).json({ error: 'Annonce introuvable' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
