#!/bin/bash
set -e

echo "=== 1. PostgreSQL ==="
sudo -u postgres psql -c "DO \$\$ BEGIN CREATE USER ibig_user WITH PASSWORD 'ibig2026'; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;"
sudo -u postgres psql -c "SELECT 1 FROM pg_database WHERE datname='ibig_immo'" | grep -q 1 || sudo -u postgres createdb -O ibig_user ibig_immo
sudo -u postgres psql -d ibig_immo -f /var/www/ibig-immo-trust/src/db/schema.sql 2>&1 | grep -E "CREATE|ERROR" | head -20

echo "=== 2. npm install ==="
cd /var/www/ibig-immo-trust
npm install --omit=dev 2>&1 | tail -3

echo "=== 3. .env ==="
cat > /var/www/ibig-immo-trust/.env << 'EOF'
PORT=3001
FRONTEND_URL=https://ibigimmotrust.com
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ibig_immo
DB_USER=ibig_user
DB_PASSWORD=ibig2026
ANTHROPIC_API_KEY=VOTRE_CLE_ANTHROPIC_ICI
EOF

echo "=== 4. Nginx ==="
cat > /etc/nginx/sites-available/api.ibigimmotrust.com << 'EOF'
server {
    listen 80;
    server_name api.ibigimmotrust.com;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 20M;
    }
}
EOF
ln -sf /etc/nginx/sites-available/api.ibigimmotrust.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo "=== 5. PM2 ==="
cd /var/www/ibig-immo-trust
pm2 delete ibig-api 2>/dev/null || true
pm2 start src/index.js --name ibig-api
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo "=== DEPLOY OK ==="
pm2 status ibig-api
