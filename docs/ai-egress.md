# Gemini production egress runbook

## Diagnosis and decision (2026-09-15)

The operator confirmed the same key succeeds in AI Studio, while production Worker
requests reach Google and return `400 FAILED_PRECONDITION: User location is not
supported for the API use`. This is evidence of upstream location/network rejection,
not a reason to regenerate credentials. This session has not independently accessed
production logs or verified Google's classification of a specific egress IP.

Repository inspection: `src/worker.ts` registers POST `/api/ai`; `src/index.tsx`
(not index.ts) creates Hono. `src/ai.ts` previously used direct global fetch, a
hardcoded `gemini-3.6-flash`, and mapped all non-429 upstream failures to 502.
There was no provider abstraction, authentication middleware or retry mechanism.
The client posts system/context/history and reads `{ text }` or `error.message`;
its seven commands and UI are unchanged. Vite builds the Worker separately from
the esbuild client and gets local Worker bindings through the Cloudflare adapter.
Runtime secrets are not Vite variables.

### Supported routing, not a location spoof

Cloudflare now supports public Internet egress through Zero Trust Gateway using a
Workers VPC Network binding with `network_id: "cf1:network"`:

- https://developers.cloudflare.com/changelog/post/2026-06-05-gateway-egress/
- https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/
- https://developers.cloudflare.com/cloudflare-one/traffic-policies/egress-policies/dedicated-egress-ips/
- https://developers.cloudflare.com/workers/configuration/placement/

The first experiment uses **default/shared Gateway egress**, not dedicated IPs.
Workers VPC is available on Free and Paid plans and is free during its open beta.
Dedicated Gateway egress is a separate Enterprise feature, is not required for this
experiment, and is not configured here. No Enterprise features, BYOIP, paid proxy,
or additional AI provider are being activated.

**AI Gateway is a different product** and is not used here. Routing through Zero
Trust Gateway is supported, but does not guarantee Google will accept its shared
IP/location classification. This is a diagnostic experiment, not a verified fix.

The existing implementation keeps Gemini and selects `direct` (ordinary Worker
fetch) or `gateway` (only the bound Gateway fetch). The code defaults to `direct`
when the variable is absent; `wrangler.jsonc` now explicitly selects `gateway`.
Gateway misconfiguration fails closed rather than reverting to direct egress.
The origin remains fixed to Google; redirects are refused to avoid forwarding keys.
No arbitrary proxy URL, location spoofing, automatic fallback or retry is added.

## Diagnostic configuration — do not deploy yet

The repository now contains:

```json
"vars": { "GEMINI_TRANSPORT": "gateway" },
"vpc_networks": [
  { "binding": "GEMINI_EGRESS", "network_id": "cf1:network", "remote": true }
]
```

Retain `GEMINI_API_KEY` as the existing Worker runtime secret. Do not configure
or purchase dedicated egress IPs, Enterprise features, BYOIP, or a paid proxy.
No account-side policies or services are changed by editing this repository.
The binding uses the account's Gateway routing and existing applicable policies;
if that account already has dedicated-egress policies, check them before a future
live test to ensure this experiment actually uses default/shared egress.

Current verification is limited to `npm run verify` and
`npx wrangler deploy --dry-run`. A dry run validates packaging/configuration, not
account readiness, policy matching, the runtime secret, or Google's acceptance.
`remote: true` allows real account bindings during local development: do not start
remote local development as a substitute for an approved live test. Mocked tests
make no external AI requests.

### Future live test, only after explicit approval

1. Confirm the account's Zero Trust/Gateway setup and applicable DNS, HTTP, network
   and egress policies permit the Gemini destination. Do not activate paid features
   or change unrelated security policies. Use the default/shared Gateway route.
2. Deploy only after explicit approval. Review Worker Observability and Gateway
   logs to confirm policy matching and routing. Do not log request headers/bodies,
   the API key, or personal productivity context.
3. Run Plan My Day in the production app and check that POST `/api/ai` returns 200
   with a nonempty `{ text }`; smoke-test the other six commands. A repeated
   `provider_location` / 503 means this experiment has not resolved Google's
   rejection. Do not retry deterministic 400s or claim success based on a dry run.

### Reversal

Set `vars.GEMINI_TRANSPORT` to `"direct"` in `wrangler.jsonc` and redeploy only with
approval. The binding may remain unused or be removed. Direct mode uses ordinary
Worker fetch even if the binding is present. This restores the original network
path, not a promise that Gemini will accept that path. Keep configuration changes
in source control so subsequent deployments preserve the intended selection.

The existing endpoint has no application authentication (the app has no accounts).
No new endpoint is introduced here. For a future live test, restrict the personal
app with Cloudflare Access and appropriate rate limiting. Cover the workers.dev
hostname too (or disable it when using a protected custom domain); origin checks
alone are not authentication. Do not disable existing protections for this test.

## Runtime configuration and errors

- `GEMINI_API_KEY`: existing required server secret, unchanged.
- `GEMINI_MODEL`: optional plain server variable; defaults to `gemini-3.6-flash`.
  The model is preserved, not claimed universally available. Google's published
  model page lists it, but Enterprise/Vertex availability does not prove this
  project's AI Studio API entitlement:
  https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-6-flash
  Verify generateContent access from approved egress. A 404 is diagnosed separately;
  only change the override to a model confirmed available to this project.
- `GEMINI_TRANSPORT`: `direct` or `gateway`; code default is `direct`, while the
  diagnostic Wrangler configuration explicitly selects `gateway`.
- `GEMINI_EGRESS`: VPC Network binding required only for `gateway`; not a secret.

Success remains `{ text }`. Errors retain `{ error: { message } }` and add a stable
`code`. Logs contain fixed provider/transport/category and numeric upstream status,
never raw provider bodies, exception messages, prompts, keys or URLs.

| Category | Client HTTP | Rationale |
| --- | --- | --- |
| malformed_request | 400 | Invalid client JSON/shape/messages |
| configuration / provider_model_configuration | 500 | Operator configuration |
| provider_authentication | 500 | Server credentials; not browser authentication |
| provider_location | 503 | Server's provider route unavailable, not bad user input |
| provider_bad_request | 400 | Other Google 400; not incorrectly converted to 502 |
| provider_rate_limit | 429 | No automatic retries |
| provider_unavailable / provider_network | 503 | Upstream 5xx or connectivity |
| provider_timeout | 504 | 25-second request deadline |
| provider_protocol / provider_empty | 502 | Invalid/empty successful upstream response |
| provider_safety | 422 | Existing safety refusal behavior |

Tests mock fetch and the binding; no real provider credentials or calls are needed.
Wrangler's installed lockfile version is 4.130.0 (package range ^4.110.0), whose
schema supports `secrets.required`, VPC `network_id`, and the existing assets setup.
