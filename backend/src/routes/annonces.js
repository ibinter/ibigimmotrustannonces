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
router.post('/', upload.array('images', 20), async (req, res) => {
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
      const imgData = await traiterImage(file.buffer, file.originalname);
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
      budget_max, q, statut = 'actif',
      limit = 50, offset = 0,
    } = req.query;

    const conditions = ['a.statut = $1'];
    const params = [statut];
    let p = 2;

    if (commune)     { conditions.push(`a.commune ILIKE $${p++}`);     params.push(`%${commune}%`); }
    if (type_bien)   { conditions.push(`a.type_bien = $${p++}`);       params.push(type_bien); }
    if (transaction) { conditions.push(`a.transaction = $${p++}`);     params.push(transaction); }
    if (source)      { conditions.push(`a.source = $${p++}`);          params.push(source); }
    if (budget_max)  { conditions.push(`a.prix <= $${p++}`);           params.push(parseInt(budget_max)); }
    if (q)           { conditions.push(`a.texte_brut ILIKE $${p++}`);  params.push(`%${q}%`); }

    const where = conditions.join(' AND ');

    const { rows } = await query(
      `SELECT a.*,
         COALESCE(json_agg(i.url_locale ORDER BY i.ordre) FILTER (WHERE i.id IS NOT NULL), '[]') AS images,
         COUNT(m.id) FILTER (WHERE m.score >= 40) AS nb_matchs
       FROM annonces a
       LEFT JOIN images i ON i.annonce_id = a.id
       LEFT JOIN matchs m ON m.annonce_id = a.id
       WHERE ${where}
       GROUP BY a.id
       ORDER BY a.date_collecte DESC
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

module.exports = router;
