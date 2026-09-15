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

Dedicated Gateway egress IPs are account-provisioned and tied to data centers.
Placement hints optimize execution proximity; they are not a guarantee of Google's
IP classification. **AI Gateway is a different product** and is not used here as an
assumed geolocation fix. Merely adding a VPC binding without an egress policy does
not establish acceptable egress.

The smallest implementation keeps Gemini and adds an explicit transport choice:
`direct` (unchanged default) or `gateway` (only the bound Gateway fetch). No second
AI provider, proxy URL, public proxy route, automatic fallback or retry is added.
Gateway misconfiguration fails closed rather than reverting to rejected shared IPs.
The origin remains fixed to Google; redirects are refused to avoid forwarding keys.
This can remove the offending shared egress path **only after** account provisioning
and successful Google acceptance testing. It cannot guarantee Google's policy.

## STOP: operator action required before enabling Gateway

No Cloudflare account entitlement, dedicated IP or policy is established by this
repository. Do not deploy the commented Gateway configuration as a claimed fix.

1. Contact your Cloudflare account team to confirm Workers VPC / Mesh Gateway egress
   availability and pricing and provision dedicated egress IPs in two locations
   where your legitimate Gemini usage is supported. Confirm IPv4 and IPv6 coverage
   and Google acceptance; do not use location spoofing. Review Google's applicable
   API terms and region requirements.
2. In Cloudflare **Zero Trust → Traffic policies → Traffic settings**, enable
   **Allow Secure Web Gateway to proxy traffic**, selecting TCP.
3. In **Traffic policies → Egress policies**, create a policy matching the Gemini
   destination (`generativelanguage.googleapis.com`) and choose your provisioned
   dedicated primary and secondary egress locations. Consult Cloudflare on the
   correct destination selector for Worker traffic. Do not choose `0.0.0.0` as the
   secondary: that can revert to nearest/default egress. Confirm the effective
   policy and failover behavior with Cloudflare; both paths must be acceptable.
4. Retain the existing `GEMINI_API_KEY` Worker runtime secret. No new API key is
   required. In `wrangler.jsonc`, enable the documented optional configuration:

   ```json
   "vars": { "GEMINI_TRANSPORT": "gateway" },
   "vpc_networks": [
     { "binding": "GEMINI_EGRESS", "network_id": "cf1:network", "remote": true }
   ]
   ```

   Merge with any existing vars/bindings, rather than replacing them. Keep this
   configuration in source control so a later Wrangler deployment preserves it.
   Remote local bindings contact the real account; mocked tests do not use them.
5. Run `npm run verify` and `npx wrangler deploy --dry-run`, then deploy only after
   approval with `npm run deploy`. Review Worker Observability logs and Gateway
   DNS/HTTP/Network logs to confirm policy matching and actual egress. Do not enable
   request-header/body logging or record the key or personal productivity context.
6. From the production app, run Plan My Day and confirm POST `/api/ai` returns 200
   with a nonempty `{ text }`. Smoke-test all seven commands. Test primary and
   secondary egress with Cloudflare assistance. If Google still rejects either IP,
   stop and escalate the IP classification to Google/Cloudflare; do not retry 400s.

The existing endpoint has no application authentication (the app has no accounts).
No new endpoint is introduced here. Before enabling chargeable infrastructure,
protect the personal app with Cloudflare Access restricted to your identity and
appropriate rate limiting. Cover the workers.dev hostname too (or disable it when
using a protected custom domain); origin checks alone are not authentication.

If dedicated egress is unavailable or uneconomic, **do not enable this transport**.
The next architecture decision requires operator approval: either an authenticated,
owner-controlled regional Gemini backend (fixed destination, managed secrets,
verified region, Access/service authentication and quotas), or an explicitly chosen
Workers AI binding as a location-only provider fallback. Neither infrastructure nor
provider billing/terms is silently assumed here. A future provider fallback should
trigger only on `provider_location`, never on authentication or rate-limit failures.

## Runtime configuration and errors

- `GEMINI_API_KEY`: existing required server secret, unchanged.
- `GEMINI_MODEL`: optional plain server variable; defaults to `gemini-3.6-flash`.
  The model is preserved, not claimed universally available. Google's published
  model page lists it, but Enterprise/Vertex availability does not prove this
  project's AI Studio API entitlement:
  https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-6-flash
  Verify generateContent access from approved egress. A 404 is diagnosed separately;
  only change the override to a model confirmed available to this project.
- `GEMINI_TRANSPORT`: optional `direct` (default) or `gateway`.
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
