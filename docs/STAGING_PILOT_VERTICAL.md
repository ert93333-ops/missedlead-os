# Staging pilot vertical (1B)

This runbook is an owner-only gate. The automated contract uses synthetic providers and performs no live model call, send, payment, or production action.

## Automated evidence

Run the exact focused command from the repository root:

```powershell
pnpm.cmd exec vitest run server/intake-remote.test.ts server/intake-safety.test.ts
```

It must pass the synthetic unavailable, upstream-429/quota-like, timeout, malformed-response, deterministic emergency-first, actor-bound token, expired token, confirmation/query, and zero-money cases. These tests do not prove that staging identity, credentials, provider quota, or networking are correct.

## Owner staging gates

Before allowing a pilot user, the staging owner must establish all of the following. Do not paste secret values into a receipt, terminal transcript, issue, or repository file.

1. **Deployment identity:** `STAGING_API_ORIGIN` is the approved HTTPS origin and the deployed git SHA equals `STAGING_EXPECTED_GIT_SHA`. The origin must not be an alias that redirects to preview, production, login, or another project.
2. **Database identity:** the access-token `iss` project reference equals `STAGING_EXPECTED_SUPABASE_PROJECT_REF`. The staging service's `SUPABASE_URL`, anon key, and service-role key must all belong to that same project. Confirm this in the deployment secret manager; never echo the keys.
3. **Actor-bound credential:** use a newly issued, staging-only customer access token. Its `sub` must equal `STAGING_EXPECTED_CUSTOMER_ID`, its `aud` must include `authenticated`, and its expiry must cover the pilot window. Provider/operator tokens are not acceptable for customer intake.
4. **Model identity and quota:** the owner must confirm `GEMINI_MODEL` is the approved staging model and that `GEMINI_API_KEY` is a staging-restricted key. Record only the key fingerprint or secret version. Deployment values for `INTAKE_ACCOUNT_DAILY_CREDITS`, `INTAKE_TOTAL_DAILY_CREDITS`, `INTAKE_GLOBAL_ACTIVE_LIMIT`, and `INTAKE_ACCOUNT_ACTIVE_LIMIT` must equal the approved pilot limits. Upstream 429, timeout, unavailable, and malformed responses must remain fail-closed as proven by the synthetic suite; do not fault-inject against staging.
5. **Redirect and transport:** `/api/capabilities` must answer directly from the approved HTTPS origin with no `Location` header. TLS validation must remain enabled. Never use `-k`, `--insecure`, or automatic redirect following for the gate.
6. **Rate limit:** ten authenticated emergency-only analyze requests in one minute may succeed without calling the model; the eleventh must return HTTP 429. Perform this only in an owner-approved window because it temporarily consumes that actor's request allowance.
7. **Zero money:** `/api/capabilities` must return `payments.mode=disabled` and `payments.enabled=false`. Do not call deposit, balance, refund, transfer, settlement, webhook, or reconciliation routes. Synthetic confirmation must create a queryable intake request with no payment or claim records; the focused suite is the acceptance evidence for that contract.

## Literal owner preflight command

Set these values only in the owner's private shell/session, then run the block. The block never prints the access token and makes no model request: the rate-limit probe uses deterministic gas-emergency input, which returns before usage storage and provider invocation.

```powershell
$env:STAGING_API_ORIGIN='https://staging-api.example.invalid'
$env:STAGING_EXPECTED_SUPABASE_PROJECT_REF='approved-staging-project-ref'
$env:STAGING_EXPECTED_CUSTOMER_ID='approved-staging-customer-uuid'
$env:STAGING_CUSTOMER_ACCESS_TOKEN='<owner-injected-secret>'

$ErrorActionPreference='Stop'
$origin=[Uri]$env:STAGING_API_ORIGIN
if ($origin.Scheme -ne 'https' -or $origin.AbsolutePath -ne '/') { throw 'staging_origin_must_be_https_origin_only' }
if ([string]::IsNullOrWhiteSpace($env:STAGING_CUSTOMER_ACCESS_TOKEN)) { throw 'missing_staging_customer_token' }

$jwtPart=$env:STAGING_CUSTOMER_ACCESS_TOKEN.Split('.')[1].Replace('-','+').Replace('_','/')
while (($jwtPart.Length % 4) -ne 0) { $jwtPart += '=' }
$claims=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($jwtPart)) | ConvertFrom-Json
if ($claims.sub -ne $env:STAGING_EXPECTED_CUSTOMER_ID) { throw 'customer_actor_mismatch' }
if ([string]$claims.aud -notmatch 'authenticated') { throw 'customer_audience_mismatch' }
if ([DateTimeOffset]::FromUnixTimeSeconds([int64]$claims.exp) -le [DateTimeOffset]::UtcNow.AddMinutes(30)) { throw 'customer_token_window_too_short' }
if ([string]$claims.iss -notmatch ('https://' + [regex]::Escape($env:STAGING_EXPECTED_SUPABASE_PROJECT_REF) + '\.supabase\.co/auth/v1')) { throw 'supabase_project_mismatch' }

$work=Join-Path ([IO.Path]::GetTempPath()) ('wecover-staging-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $headers=Join-Path $work 'capability-headers.txt'
  $body=Join-Path $work 'capability.json'
  $status=curl.exe --silent --show-error --max-redirs 0 --connect-timeout 10 --max-time 30 --dump-header $headers --output $body --write-out '%{http_code}' "$($origin.AbsoluteUri)api/capabilities"
  if ($status -ne '200') { throw "capabilities_http_$status" }
  if (Select-String -Quiet -Path $headers -Pattern '^Location:' ) { throw 'unexpected_redirect' }
  $capability=Get-Content -Raw $body | ConvertFrom-Json
  if ($capability.payments.mode -ne 'disabled' -or $capability.payments.enabled -ne $false) { throw 'payments_not_disabled' }

  $dashboard=Join-Path $work 'dashboard.json'
  $status=curl.exe --silent --show-error --max-redirs 0 --connect-timeout 10 --max-time 30 --header "Authorization: Bearer $env:STAGING_CUSTOMER_ACCESS_TOKEN" --output $dashboard --write-out '%{http_code}' "$($origin.AbsoluteUri)api/dashboard"
  if ($status -ne '200') { throw "customer_credential_http_$status" }

  $payload='{"locale":"en","history":[{"role":"user","content":"I smell gas near the furnace"}]}'
  $statuses=@()
  1..11 | ForEach-Object {
    $probe=Join-Path $work "rate-$_.json"
    $statuses += curl.exe --silent --show-error --max-redirs 0 --connect-timeout 10 --max-time 30 --header "Authorization: Bearer $env:STAGING_CUSTOMER_ACCESS_TOKEN" --form "payload=$payload" --output $probe --write-out '%{http_code}' "$($origin.AbsoluteUri)api/intake/analyze"
  }
  if (($statuses[0..9] | Where-Object { $_ -ne '200' }).Count -ne 0 -or $statuses[10] -ne '429') { throw ('rate_limit_mismatch:' + ($statuses -join ',')) }
  [pscustomobject]@{ identity='matched'; credential='accepted'; redirect='none'; payments='disabled'; emergencyProbeStatuses=$statuses; secretsRecorded=$false } | ConvertTo-Json -Depth 4
} finally {
  Remove-Item -Recurse -Force $work
}
```

The `.invalid` example is deliberately non-routable. The owner must replace it with the approved staging origin. This command intentionally does not confirm a request against a live model; confirmation/query acceptance is synthetic-only in this slice.

## Receipt

Store the receipt in the owner-controlled evidence system, not in git. It must contain these fields and no token, API key, cookie, authorization header, raw JWT claims, or secret-manager value:

```json
{
  "checkedAtUtc": "RFC3339 UTC timestamp",
  "ownerRole": "staging-release-owner role name",
  "environment": "staging",
  "apiOrigin": "approved HTTPS origin",
  "gitSha": "40-character deployed SHA",
  "supabaseProjectRef": "approved staging project ref",
  "customerActorId": "staging fixture UUID",
  "customerCredentialIssuedAtUtc": "RFC3339 UTC timestamp",
  "customerCredentialExpiresAtUtc": "RFC3339 UTC timestamp",
  "credentialSecretVersionOrFingerprint": "non-secret identifier",
  "geminiModel": "approved model name",
  "geminiKeySecretVersionOrFingerprint": "non-secret identifier",
  "quota": {
    "accountDailyCredits": 0,
    "totalDailyCredits": 0,
    "globalActiveLimit": 0,
    "accountActiveLimit": 0
  },
  "redirect": { "capabilitiesStatus": 200, "locationHeaderPresent": false },
  "rateLimit": { "windowSeconds": 60, "firstTenStatuses": [200], "eleventhStatus": 429, "providerCallsExpected": 0 },
  "payments": { "mode": "disabled", "enabled": false, "moneyRoutesCalled": [] },
  "syntheticTests": { "command": "pnpm.cmd exec vitest run server/intake-remote.test.ts server/intake-safety.test.ts", "passedFiles": 2, "passedTests": 0 },
  "stagingRequest": { "performed": false, "reason": "synthetic-only slice" },
  "secretsRecorded": false,
  "decision": "pass or stop",
  "stoppedAtUtc": null,
  "stopVerificationStatus": null
}
```

Replace every placeholder and zero count with observed evidence. `decision=pass` is invalid if any field is missing or any gate differs.

## Fail-closed stop procedure

On any mismatch, provider anomaly, unexpected redirect, identity uncertainty, quota exhaustion, or money capability exposure, stop rather than retrying broadly:

1. Set the staging deployment to maintenance/private access and remove pilot-user access.
2. Remove `GEMINI_API_KEY` from the staging deployment (or disable that staging key in Google Cloud), redeploy/restart, and do not substitute another key.
3. Keep `PAYMENTS_MODE=disabled`; if capabilities show otherwise, stop the deployment entirely. Do not exercise a money route to investigate.
4. Revoke the staging customer token/session used by the pilot and rotate it only after the root cause is resolved.
5. Verify fail-closed behavior with the exact command below. Expected results are HTTP 503 for ordinary intake and `payments.mode=disabled`, `payments.enabled=false`. Emergency safety guidance may still return HTTP 200 because it is deterministic and provider-independent.

```powershell
curl.exe --silent --show-error --max-redirs 0 --header "Authorization: Bearer $env:STAGING_CUSTOMER_ACCESS_TOKEN" --form 'payload={"locale":"en","history":[{"role":"user","content":"The synthetic test faucet drips"}]}' --write-out "`nHTTP %{http_code}`n" "$($env:STAGING_API_ORIGIN.TrimEnd('/'))/api/intake/analyze"
curl.exe --silent --show-error --max-redirs 0 --write-out "`nHTTP %{http_code}`n" "$($env:STAGING_API_ORIGIN.TrimEnd('/'))/api/capabilities"
```

Record the stop time and both observed statuses in the receipt. Do not reopen access until a new complete owner receipt passes every gate.