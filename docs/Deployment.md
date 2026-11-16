# Deployment — Contabo VPS

Target: **213.136.66.153** · subdomain: **https://ai-evals-studio.duckdns.org**

Assumes the server already has: Ubuntu (22.04/24.04), Node.js 18+, PostgreSQL, nginx, and that `ai-evals-studio.duckdns.org` resolves to `213.136.66.153`.

> These steps run on the **server** (via SSH), not on your local machine.

---

## 1. Prepare the database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER arip WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
CREATE DATABASE arip OWNER arip;
SQL
```

## 2. Get the code

```bash
sudo mkdir -p /var/www/arip
sudo chown "$USER" /var/www/arip
git clone https://github.com/ravinder024/ai-release-intelligence-platform.git /var/www/arip
cd /var/www/arip
```

## 3. Configure `.env`

```bash
# Generate the two secrets ONCE and keep them stable:
#   openssl rand -hex 32   (for ENCRYPTION_KEY)
#   openssl rand -hex 32   (for SESSION_COOKIE_SECRET)
cat > .env <<'ENV'
DATABASE_URL="postgresql://arip:CHANGE_ME_STRONG_PASSWORD@localhost:5432/arip?schema=public"
PORT=5101
OPENROUTER_API_KEY="PASTE_SERVER_OPENROUTER_KEY"
OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
ENCRYPTION_KEY="PASTE_GENERATED_HEX_1"
SESSION_COOKIE_SECRET="PASTE_GENERATED_HEX_2"
NODE_ENV=production
ENV
```

> Keep `OPENROUTER_API_KEY` on the server and never commit it. The server key is used for Platform Free model discovery, the five-evaluation allowance, and the scheduled OpenRouter health check. Users may also add their own provider keys in **Settings → API keys**. Without the server key, Platform Free models and health checks are unavailable. `NODE_ENV=production` makes the session cookie `Secure` (HTTPS-only).

## 4. Install, build, migrate, and seed

```bash
npm ci
npm run build
cd apps/api && npx prisma migrate deploy && cd ../..
npm run db:seed      # creates the 2 sample datasets
```

Do **not** run `npm run db:prune` during an update: it deletes user accounts and all non-sample datasets, runs, and experiments. For an existing installation, take a database backup before migrations; `prisma migrate deploy` preserves existing rows.

## 5. Run as a systemd service

Create `/etc/systemd/system/arip.service`:

```ini
[Unit]
Description=AI Release Intelligence Platform
After=network.target postgresql.service

[Service]
Type=simple
User=arip
Group=arip
WorkingDirectory=/var/www/arip
EnvironmentFile=/var/www/arip/.env
ExecStart=/usr/bin/node /var/www/arip/apps/api/dist/server.js
Restart=always
RestartSec=5
# Free-model runs can be long; give the process time.
TimeoutStartSec=30

[Install]
WantedBy=multi-user.target
```

> If the app runs as the same user that cloned the repo, `User=`/`Group=` can be omitted. Adjust if your login user differs.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now arip
curl http://127.0.0.1:5101/health   # expect {"status":"ok","database":"configured"}
```

## 6. nginx reverse proxy + TLS

Create `/etc/nginx/sites-available/ai-evals-studio`:

```nginx
server {
    listen 80;
    server_name ai-evals-studio.duckdns.org;

    location / {
        proxy_pass http://127.0.0.1:5101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and get a certificate:

```bash
sudo ln -s /etc/nginx/sites-available/ai-evals-studio /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

sudo apt update && sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ai-evals-studio.duckdns.org
```

Certbot automatically installs the certificate and redirects HTTP → HTTPS. Renewal is automatic (`certbot renew` via systemd timer).

## 7. Verify

1. Open **https://ai-evals-studio.duckdns.org** — you should land on the public **Home** page.
2. **Create an account** (or sign in), then go to **Settings → API keys** to add and validate a labelled provider connection if you want to use BYOK.
3. Run a comparison on the **Playground**, then create a private dataset and run an evaluation/experiment.
4. Confirm only the 2 sample datasets are visible to anonymous visitors, and that they are read-only.
5. Confirm the **Manual** menu item renders the User Manual.

> Upgrading an older installation imports each account's previously hidden single OpenRouter key as a labelled **Imported key** connection. Those cards show **Models not loaded** until the owner clicks **Load models** once.

## Common operations

| Task | Command |
| --- | --- |
| See logs | `journalctl -u arip -f` |
| Restart the app | `sudo systemctl restart arip` |
| Deploy a new version | `cd /var/www/arip && git pull && npm ci && npm run build && cd apps/api && npx prisma migrate deploy && cd ../.. && sudo systemctl restart arip` |
| Reset to samples-only | `npm run db:prune` |
| Renew TLS (auto) | `sudo certbot renew` |

## Security notes

- `ENCRYPTION_KEY` / `SESSION_COOKIE_SECRET` must be stable — changing them invalidates stored keys/sessions.
- `.env` is gitignored; never commit it.
- Each user's provider key is encrypted at rest and only used for their own requests. The platform OpenRouter key stays server-side and powers only the Platform Free catalog/checks.
- Back up the database before production migrations; do not prune user data during an update.
- Deploy only a commit that has been reviewed and exercised locally.
