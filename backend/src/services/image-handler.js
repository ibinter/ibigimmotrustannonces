const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const sharp   = require('sharp');
const multer  = require('multer');

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.memoryStorage();
const upload  = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Fichier image requis'));
    cb(null, true);
  },
});

async function traiterImage(buffer, nomOrigine) {
  const hash = crypto.createHash('md5').update(buffer).digest('hex');
  const ext  = '.webp';
  const nom  = `${hash}${ext}`;
  const dest = path.join(UPLOAD_DIR, nom);

  if (!fs.existsSync(dest)) {
    const meta = await sharp(buffer)
      .resize({ width: 1200, height: 900, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(dest);

    return {
      url_locale: `/uploads/${nom}`,
      hash_md5:   hash,
      taille_ko:  Math.round(meta.size / 1024),
      largeur:    meta.width,
      hauteur:    meta.height,
    };
  }

  const stat = fs.statSync(dest);
  const meta = await sharp(dest).metadata();
  return {
    url_locale: `/uploads/${nom}`,
    hash_md5:   hash,
    taille_ko:  Math.round(stat.size / 1024),
    largeur:    meta.width,
    hauteur:    meta.height,
  };
}

module.exports = { upload, traiterImage };
