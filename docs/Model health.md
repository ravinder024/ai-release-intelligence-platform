# OpenRouter Free-Model Health

The app keeps the supported `:free` model IDs as a server-side allowlist. A daily QA run tests only those IDs, writes a health report to `apps/api/model-health.json`, and `GET /api/models` serves the latest result to all model selectors.

Health behavior:

- `healthy`: model completed a small test request.
- `rate_limited`: OpenRouter returned HTTP 429. Model stays selectable; users can retry later.
- `unavailable`: OpenRouter returned 404 or a malformed/no-content completion. The selector disables it until a later successful check.
- `check_failed`: a transient/other error. Model stays selectable with a warning.
- Reports older than 36 hours are marked stale and treated as unverified.

The health report is generated data and is gitignored. It contains model IDs, status, latency, short output snippets, and safe error messages; it never contains the API key.

## Windows Task Scheduler

From the repository root, build and register the daily 6:00 AM task:

```powershell
npm run build -w @prompt-playground/api
npm run model-health:register-task
```

The task name is `ARIP-OpenRouter-Free-Model-Health`. It runs as the current Windows user and reads the root `.env` through the QA script. Run it immediately with:

```powershell
Start-ScheduledTask -TaskName ARIP-OpenRouter-Free-Model-Health
Get-ScheduledTaskInfo -TaskName ARIP-OpenRouter-Free-Model-Health
```

Run a one-off check manually with:

```powershell
npm run model-health:check
```

## Contabo VPS cron

On the VPS, install a daily 6:00 AM check under the same non-root account as the app. Ensure this account can read the deployment `.env` and write `apps/api/model-health.json`.

```cron
0 6 * * * cd /var/www/arip && /usr/bin/node apps/api/dist/scripts/qaModels.js >> /var/log/arip/model-health.log 2>&1
```

The QA script loads `/var/www/arip/.env` itself. Keep `OPENROUTER_API_KEY` server-side; do not put it in the crontab line. After the first run, `GET /api/models` immediately exposes the refreshed status. The Express app does not need to restart.

To change the check time, edit the single cron schedule. No source model IDs are automatically added from OpenRouter's wider catalog: adding a model to the application's allowlist remains a deliberate code review decision so the free-only security boundary is preserved.
