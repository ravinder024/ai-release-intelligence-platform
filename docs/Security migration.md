# Public Security Migration

This migration moves the public app from prototype local accounts to Google-first authentication, server-managed sessions, Admin bootstrap, platform-funded credits, and free-model enforcement.

## External preflight

Repository code cannot revoke dashboard credentials. Before deploying:

1. Back up PostgreSQL.
2. Revoke the old OpenRouter platform key in the OpenRouter dashboard.
3. Remove the old key from every local/server `.env` file.
4. Revoke any old Google OAuth client in Google Cloud Console.
5. Configure the replacement Google client callback for:
   - `https://ai-evals-studio.duckdns.org/api/auth/google/callback`
   - local development callback if needed.
6. Generate replacement deployment secrets. Never commit them.
7. Invalidate existing application sessions:

   ```bash
   npm run db:invalidate-sessions
   ```

## Production environment

Required in production:

- `DATABASE_URL`
- `ENCRYPTION_KEY`
- `SESSION_COOKIE_SECRET`
- `ADMIN_INITIAL_PASSWORD`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `ALLOWED_ORIGINS`
- `OPENROUTER_API_KEY` (server-side platform key only)
- `NODE_ENV=production`

`ADMIN_INITIAL_PASSWORD` is read only at startup, hashed, and never returned or logged. The Admin identity is `Admin <ravinderk.jobs@gmail.com>`.

## Authentication model

- Google OIDC is the public login path.
- OIDC uses state, nonce, and PKCE through `openid-client`.
- Identity matching uses Google issuer + subject, not email alone.
- Existing local accounts are not silently merged into Google identities.
- Local username/password remains for emergency Admin access.
- Sessions are opaque DB-backed tokens in secure httpOnly cookies.

## Usage model

- Each user receives 5 platform-funded complete evaluations.
- One dataset/experiment evaluation run consumes one reservation.
- Invalid requests do not consume credits.
- Fully failed provider infrastructure runs release their reservation.
- BYOK runs do not consume platform credits.
- At zero platform credits, browsing, datasets, Settings, and Manual remain available; execution requires BYOK.

## Provider security

- Only the server-side supported free-model allowlist is executable.
- Paid or unknown model IDs are rejected at the provider boundary.
- Platform keys never reach the browser.
- BYOK keys are encrypted at rest with `ENCRYPTION_KEY` and are never returned raw.
- Model QA and reconciliation endpoints require Admin authorization.

## SMTP

SMTP is optional for the current Google authentication flow. It can be added later for password recovery or notifications without becoming a Google sign-in dependency.
