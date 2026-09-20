const { query } = require('../db');

const POIDS = {
  localisation: 35,
  budget:       30,
  type_bien:    20,
  superficie:   10,
  fraicheur:     5,
};

function scoreLocalisation(annonce, recherche) {
  const quartiers = (recherche.quartiers || []).map(q => q.toLowerCase());
  const communes  = (recherche.communes  || []).map(c => c.toLowerCase());

  const aq = (annonce.quartier || '').toLowerCase();
  const ac = (annonce.commune  || '').toLowerCase();

  if (quartiers.length && quartiers.includes(aq)) return POIDS.localisation;
  if (communes.length  && communes.includes(ac))  return 20;
  return 0;
}

function scoreBudget(annonce, recherche) {
  const prix = annonce.prix;
  const max  = recherche.budget_max;
  if (!prix || !max) return 0;

  if (prix <= max) return POIDS.budget;
  const depassement = (prix - max) / max;
  if (depassement > 0.20) return 0;
  return Math.round(POIDS.budget * (1 - depassement / 0.20));
}

function scoreTypeBien(annonce, recherche) {
  if (!recherche.type_bien || !annonce.type_bien) return 0;
  return annonce.type_bien.toLowerCase() === recherche.type_bien.toLowerCase()
    ? POIDS.type_bien : 0;
}

function scoreSuperficie(annonce, recherche) {
  const s   = annonce.superficie;
  const min = recherche.superficie_min;
  const max = recherche.superficie_max;
  if (!s) return 0;

  const inRange = (!min || s >= min) && (!max || s <= max);
  if (inRange) return POIDS.superficie;

  const ref   = min || max;
  const ecart = Math.abs(s - ref) / ref;
  if (ecart <= 0.20) return Math.round(POIDS.superficie * (1 - ecart / 0.20));
  return 0;
}

function scoreFraicheur(annonce) {
  const ageDays = (Date.now() - new Date(annonce.date_collecte).getTime()) / 86400000;
  if (ageDays <= 7)  return POIDS.fraicheur;
  if (ageDays >= 30) return 0;
  return Math.round(POIDS.fraicheur * (1 - (ageDays - 7) / 23));
}

function calculerScore(annonce, recherche) {
  const detail = {
    localisation: scoreLocalisation(annonce, recherche),
    budget:       scoreBudget(annonce, recherche),
    type_bien:    scoreTypeBien(annonce, recherche),
    superficie:   scoreSuperficie(annonce, recherche),
    fraicheur:    scoreFraicheur(annonce),
  };
  const total = Object.values(detail).reduce((a, b) => a + b, 0);
  return { score: total, detail };
}

async function matcherNouvelleAnnonce(annonce_id) {
  const { rows: [annonce] } = await query(
    'SELECT * FROM annonces WHERE id = $1', [annonce_id]
  );
  if (!annonce) return [];

  const { rows: recherches } = await query(
    `SELECT * FROM recherches_clients WHERE statut = 'actif'`
  );

  const results = [];
  for (const r of recherches) {
    const { score, detail } = calculerScore(annonce, r);
    if (score < 10) continue;

    await query(
      `INSERT INTO matchs (annonce_id, recherche_id, score, score_detail)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (annonce_id, recherche_id)
       DO UPDATE SET score = $3, score_detail = $4`,
      [annonce_id, r.id, score, JSON.stringify(detail)]
    );

    if (score >= 40) {
      const { rows: [m] } = await query(
        'SELECT id FROM matchs WHERE annonce_id=$1 AND recherche_id=$2',
        [annonce_id, r.id]
      );
      await query(
        `INSERT INTO pipeline (match_id) VALUES ($1)
         ON CONFLICT DO NOTHING`,
        [m.id]
      );
    }

    results.push({ recherche_id: r.id, nom_client: r.nom_client, score, detail });
  }

  return results.sort((a, b) => b.score - a.score);
}

module.exports = { calculerScore, matcherNouvelleAnnonce, POIDS };
