const router  = require('express').Router();
const { query } = require('../db');

const STATUTS = ['a_contacter','contacte','en_negociation','conclu','perdu'];

// GET /api/pipeline — vue Kanban complète
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT p.*,
         m.score, m.score_detail,
         a.type_bien, a.commune, a.quartier, a.prix, a.contact AS contact_agent,
         a.source, a.date_collecte,
         COALESCE(
           (SELECT url_locale FROM images WHERE annonce_id=a.id ORDER BY ordre LIMIT 1), NULL
         ) AS image_principale,
         r.nom_client, r.telephone AS telephone_client,
         COALESCE(
           json_agg(json_build_object('note', n.note, 'date', n.created_at)
             ORDER BY n.created_at DESC)
           FILTER (WHERE n.id IS NOT NULL), '[]'
         ) AS notes
       FROM pipeline p
       JOIN matchs m      ON m.id  = p.match_id
       JOIN annonces a    ON a.id  = m.annonce_id
       JOIN recherches_clients r ON r.id = m.recherche_id
       LEFT JOIN pipeline_notes n ON n.pipeline_id = p.id
       GROUP BY p.id, m.score, m.score_detail, a.type_bien, a.commune, a.quartier,
                a.prix, a.contact, a.source, a.date_collecte,
                r.nom_client, r.telephone
       ORDER BY p.statut, m.score DESC`
    );

    const kanban = STATUTS.reduce((acc, s) => {
      acc[s] = rows.filter(r => r.statut === s);
      return acc;
    }, {});

    res.json(kanban);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/pipeline/:id — changer le statut
router.patch('/:id', async (req, res) => {
  try {
    const { statut } = req.body;
    if (!STATUTS.includes(statut)) {
      return res.status(400).json({ error: 'Statut invalide', valides: STATUTS });
    }
    const { rows: [p] } = await query(
      'UPDATE pipeline SET statut=$1 WHERE id=$2 RETURNING *',
      [statut, req.params.id]
    );
    if (!p) return res.status(404).json({ error: 'Entrée pipeline introuvable' });
    res.json({ ok: true, pipeline: p });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pipeline/:id/notes — ajouter une note
router.post('/:id/notes', async (req, res) => {
  try {
    const { note } = req.body;
    if (!note) return res.status(400).json({ error: 'note requis' });
    const { rows: [n] } = await query(
      'INSERT INTO pipeline_notes (pipeline_id, note) VALUES ($1, $2) RETURNING *',
      [req.params.id, note]
    );
    res.status(201).json({ ok: true, note: n });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
