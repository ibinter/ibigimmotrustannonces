require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

const ALLOWED = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'https://ibigimmotrust.com',
  'https://www.ibigimmotrust.com',
].filter(Boolean);
app.use(cors({ origin: ALLOWED }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/annonces',  require('./routes/annonces'));
app.use('/api/recherches', require('./routes/recherches'));
app.use('/api/pipeline',  require('./routes/pipeline'));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date() }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Erreur interne' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`IBIG Immo Trust API — port ${PORT}`));
