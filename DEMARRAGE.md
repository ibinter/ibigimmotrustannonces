# IBIG Immo Trust — Démarrage rapide

## Prérequis
- Node.js 20+
- PostgreSQL 15+
- Clé API Anthropic

## 1. Base de données

```bash
createdb ibig_immo
psql ibig_immo -f backend/src/db/schema.sql
```

## 2. Backend

```bash
cd backend
cp .env.example .env
# Remplir .env (DB_PASSWORD, ANTHROPIC_API_KEY)
npm install
npm run dev
# → API sur http://localhost:3000
```

## 3. Frontend

```bash
cd frontend
npm install
npm run dev
# → Dashboard sur http://localhost:5173
```

## 4. Extension Chrome (optionnel)

1. Ouvrir `chrome://extensions`
2. Activer "Mode développeur"
3. "Charger l'extension non empaquetée" → dossier `extension/`
4. Aller sur Facebook → bouton **📋 IBIG** apparaît sur chaque post

## Structure

```
ibig-immo-trust/
├── backend/
│   ├── src/
│   │   ├── db/schema.sql          ← Schéma PostgreSQL complet
│   │   ├── services/
│   │   │   ├── ai-extraction.js   ← Structuration IA (Claude Haiku)
│   │   │   ├── matching-engine.js ← Moteur de matching pondéré (100 pts)
│   │   │   └── image-handler.js   ← Upload + compression WebP (sharp)
│   │   └── routes/
│   │       ├── annonces.js        ← Import, liste, détail
│   │       ├── recherches.js      ← Demandes clients CRUD
│   │       └── pipeline.js        ← Kanban + notes
├── frontend/
│   └── src/pages/
│       ├── Dashboard.jsx          ← Liste annonces + demandes clients
│       ├── Import.jsx             ← Formulaire import + IA
│       ├── Recherches.jsx         ← Gestion clients
│       └── Pipeline.jsx           ← Kanban de démarchage
└── extension/
    ├── manifest.json              ← Manifest V3
    ├── content.js                 ← Bouton IBIG sur les posts FB
    └── content.css
```

## Score de matching (100 pts)

| Critère      | Max  |
|--------------|------|
| Localisation | 35   |
| Budget       | 30   |
| Type de bien | 20   |
| Superficie   | 10   |
| Fraîcheur    | 5    |

- ≥ 70 → **match fort** (alerte prioritaire)
- 40–69 → match moyen (à vérifier)
- < 40 → invisible sauf filtrage manuel
