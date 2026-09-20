const router  = require('express').Router();
const { query } = require('../db');

// POST /api/recherches — créer une demande client
router.post('/', async (req, res) => {
  try {
    const {
      nom_client, telephone, email,
      type_bien, transaction,
      communes, quartiers,
      budget_min, budget_max,
      superficie_min, superficie_max,
      nb_pieces_min, nb_pieces_max,
      criteres_libres,
    } = req.body;

    if (!nom_client) return res.status(400).json({ error: 'nom_client requis' });

    const { rows: [r] } = await query(
      `INSERT INTO recherches_clients
         (nom_client, telephone, email, type_bien, transaction,
          communes, quartiers, budget_min, budget_max,
          superficie_min, superficie_max, nb_pieces_min, nb_pieces_max, criteres_libres)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [nom_client, telephone, email, type_bien, transaction,
       communes || [], quartiers || [],
       budget_min || null, budget_max || null,
       superficie_min || null, superficie_max || null,
       nb_pieces_min || null, nb_pieces_max || null,
       criteres_libres]
    );

    res.status(201).json({ ok: true, recherche: r });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recherches
router.get('/', async (req, res) => {
  try {
    const { statut = 'actif' } = req.query;
    const { rows } = await query(
      `SELECT r.*,
         COUNT(m.id) FILTER (WHERE m.score >= 70) AS matchs_forts,
         COUNT(m.id) FILTER (WHERE m.score >= 40 AND m.score < 70) AS matchs_moyens
       FROM recherches_clients r
       LEFT JOIN matchs m ON m.recherche_id = r.id
       WHERE r.statut = $1
       GROUP BY r.id
       ORDER BY r.created_at DESC`,
      [statut]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recherches/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [r] } = await query(
      'SELECT * FROM recherches_clients WHERE id = $1', [req.params.id]
    );
    if (!r) return res.status(404).json({ error: 'Recherche introuvable' });

    const { rows: matchs } = await query(
      `SELECT m.*, a.type_bien, a.commune, a.quartier, a.prix, a.contact,
              a.date_collecte, a.source,
              COALESCE(
                (SELECT url_locale FROM images WHERE annonce_id=a.id ORDER BY ordre LIMIT 1), NULL
              ) AS image_principale
       FROM matchs m
       JOIN annonces a ON a.id = m.annonce_id
       WHERE m.recherche_id = $1
       ORDER BY m.score DESC`,
      [req.params.id]
    );

    res.json({ ...r, matchs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/recherches/:id
router.patch('/:id', async (req, res) => {
  try {
    const fields = Object.keys(req.body);
    if (!fields.length) return res.status(400).json({ error: 'Aucun champ' });

    const sets   = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = fields.map(f => req.body[f]);

    const { rows: [r] } = await query(
      `UPDATE recherches_clients SET ${sets} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    if (!r) return res.status(404).json({ error: 'Recherche introuvable' });
    res.json({ ok: true, recherche: r });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
