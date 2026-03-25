# ForestGEO Environment Variable Update Checklist

This note documents every place that may need to be updated when authentication, database, or Azure Function credentials change.

## 1. Web App runtime settings in Azure

App Service: `forestgeo-development`

Azure Portal path:
- `App Services`
- `forestgeo-development`
- `Settings`
- `Environment variables`

Common values to verify here:
- `AUTH_SECRET`
- `AUTH_URL`
- `AUTH_FUNCTIONS_POLL_URL`
- `AUTH_MICROSOFT_ENTRA_ID_ID`
- `AUTH_MICROSOFT_ENTRA_ID_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
- `AZURE_SQL_USER`
- `AZURE_SQL_PASSWORD`
- `AZURE_SQL_SERVER`
- `AZURE_SQL_PORT`
- `AZURE_SQL_SCHEMA`
- `AZURE_SQL_CATALOG_SCHEMA`

Use this location when:
- the deployed NextAuth flow is broken
- the deployed web app is talking to the wrong auth app registration
- the deployed web app is using stale DB credentials

After changes:
- click `Apply`
- restart the App Service

## 2. Azure Function runtime settings

Function App: `polluserinformation`

Azure Portal path:
- `Function Apps`
- `polluserinformation`
- `Settings`
- `Environment variables`

Critical values here:
- `AZURE_SQL_USER`
- `AZURE_SQL_PASSWORD`
- `AZURE_SQL_SERVER`
- `AZURE_SQL_PORT`
- `AZURE_SQL_CATALOG_SCHEMA`

Use this location when:
- `https://polluserinformation.azurewebsites.net/api/polluserstate?...` fails
- login succeeds with Microsoft but `/api/auth/session` becomes `null`
- Azure logs show `API call FAILURE!` or MySQL access denied

After changes:
- click `Apply`
- restart the Function App

## 3. Key Vault references

Some Azure app settings may not contain raw values. They may use a Key Vault reference such as:

`@Microsoft.KeyVault(...)`

If so, the real secret must be updated in Key Vault, not only in the App Service or Function App settings page.

Check this when:
- the setting name looks correct but the app still behaves as if the old secret is being used

After changing a Key Vault secret:
- restart the App Service or Function App that consumes it

## 4. GitHub Actions environment secrets

GitHub path:
- repository `Settings`
- `Environments`
- `development_temp`

Secrets commonly used by the development deployment workflow:
- `AUTH_SECRET`
- `AUTH_URL`
- `AUTH_FUNCTIONS_POLL_URL`
- `AUTH_MICROSOFT_ENTRA_ID_ID`
- `AUTH_MICROSOFT_ENTRA_ID_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
- `AZURE_SQL_USER`
- `AZURE_SQL_PASSWORD`
- `AZURE_SQL_SERVER`
- `AZURE_SQL_PORT`
- `AZURE_SQL_SCHEMA`
- `AZURE_SQL_CATALOG_SCHEMA`

Workflow reference:
- [/Users/mason/dev/ForestGEO/.github/workflows/dev-forestgeo-livesite.yml](/Users/mason/dev/ForestGEO/.github/workflows/dev-forestgeo-livesite.yml)

Use this location when:
- the next deployment should pick up updated secrets
- the current Azure runtime settings were created by deployment and need to stay in sync

Important:
- changing GitHub secrets does not fix a currently running Azure Function or App Service until something redeploys or rewrites those values

## 5. Local development env files

Local path:
- [/Users/mason/dev/ForestGEO/frontend/.env.local](/Users/mason/dev/ForestGEO/frontend/.env.local)
- [/Users/mason/dev/ForestGEO/frontend/.env](/Users/mason/dev/ForestGEO/frontend/.env)

Use this location when:
- local login works differently from deployed login
- you need to compare working local credentials with deployed credentials

Common values to compare:
- `AUTH_MICROSOFT_ENTRA_ID_ID`
- `AUTH_MICROSOFT_ENTRA_ID_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
- `AUTH_SECRET`
- `AUTH_URL`
- `AUTH_FUNCTIONS_POLL_URL`
- `AZURE_SQL_USER`
- `AZURE_SQL_PASSWORD`
- `AZURE_SQL_SERVER`
- `AZURE_SQL_PORT`
- `AZURE_SQL_CATALOG_SCHEMA`

## 6. Azure App Service Authentication settings

App Service: `forestgeo-development`

Azure Portal path:
- `App Services`
- `forestgeo-development`
- `Settings`
- `Authentication`

Use this location when:
- requests are blocked before NextAuth runs
- `/login` or `/api/auth/*` return Azure auth responses instead of app responses

Things to verify:
- whether App Service Authentication is enabled
- which identity provider is configured
- whether anonymous access is allowed or authentication is required

## 7. Microsoft Entra App Registration

Azure Portal path:
- `Microsoft Entra ID`
- `App registrations`

Use this location when:
- local and deployed environments use different `client_id` values
- the OAuth callback or redirect URI is wrong
- Microsoft login succeeds for one environment but not another

Things to verify:
- Application (client) ID
- Client secret
- Redirect URI:
  - `https://forestgeo-development.azurewebsites.net/api/auth/callback/microsoft-entra-id`
  - `http://localhost:3000/api/auth/callback/microsoft-entra-id`

## 8. Quick diagnosis order for future incidents

When login works with Microsoft but the app still lands on a blank or inert `/dashboard`, check in this order:

1. Browser network:
   - does `/api/auth/callback/microsoft-entra-id` succeed?
   - does `/api/auth/session` return `null`?
2. App Service log stream:
   - look for `JWTSessionError`
   - look for `API call FAILURE!`
3. Poll function URL directly:
   - `https://polluserinformation.azurewebsites.net/api/polluserstate?email=...`
4. Function App env vars:
   - especially `AZURE_SQL_USER` and `AZURE_SQL_PASSWORD`
5. If needed, compare with local `.env.local`
6. If needed, update GitHub environment secrets so future deploys stay aligned

## 9. Current lesson from this incident

The observed failure pattern was:
- Microsoft login succeeded
- NextAuth callback succeeded
- poll function failed to connect to MySQL
- `session` callback threw
- Auth.js returned `JWTSessionError`
- `/api/auth/session` returned `null`

That means a successful OAuth redirect does not prove the app is fully logged in. The post-login dependency chain must also be healthy.
