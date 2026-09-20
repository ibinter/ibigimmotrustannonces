import { Client } from 'ssh2';

function execCmd(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', e = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => e += d);
      stream.on('close', () => { if (out.trim()) console.log(out.trim()); resolve(out.trim()); });
    });
  });
}

const conn = new Client();
conn.on('ready', async () => {
  console.log('🔗 Connecté\n');

  // 1. Ajouter colonne titre
  console.log('📐 Migration : ajout colonne titre...');
  await execCmd(conn, `psql -U postgres -d ibigimmotrust -c "ALTER TABLE annonces ADD COLUMN IF NOT EXISTS titre VARCHAR(300);" 2>&1`);
  console.log('  ✓ Colonne titre ajoutée');

  // 2. Vérifier
  const check = await execCmd(conn, `psql -U postgres -d ibigimmotrust -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='annonces' AND column_name='titre';" 2>&1`);
  console.log('  Check:', check);

  // 3. Redémarrer PM2 pour charger le nouveau code
  console.log('\n🔄 Restart PM2...');
  await execCmd(conn, 'pm2 restart ibig-api 2>&1 | tail -3');
  await new Promise(r => setTimeout(r, 2000));
  await execCmd(conn, 'curl -s http://localhost:3010/api/health');

  console.log('\n✅ Migration titre terminée !');
  conn.end();
}).connect({ host: '185.98.139.38', username: 'root', password: 'h1m8c5S9S9v7Q4Q' });
