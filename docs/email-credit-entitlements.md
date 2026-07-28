# Email Credit Entitlement Client

The BrainDrive client supports the default-off BrainDrive Models email-credit
pilot. It does not decide eligibility or own financial state. The local gateway
is the security boundary between the browser, the encrypted Models-key vault,
and the hosted Credits service.

## User behavior

Settings requests `GET /api/credits/entitlements/capability`. If the route is
absent, unavailable, or returns `available: false`, the email-credit UI is
hidden and existing Settings behavior is unchanged.

When available, the form explains that email ownership is not verified and the
first successful claim is final. A claim occurs only on explicit form submit;
prefill, autofill, blur, mount, and capability discovery never claim. The pilot
has no reset or transfer action.

The browser sends only the normalized email to
`POST /api/credits/entitlements/claim`. It never receives the Models bearer key.
Completed responses show the exact applied amount and authoritative balance.
Pending or partial results preserve the operation and offer “Refresh this
claim”; duplicate submits do not start a second claim.

## Local gateway contract

| Local route | Purpose |
|---|---|
| `GET /credits/entitlements/capability` | Proxy the sanitized hosted capability |
| `POST /credits/entitlements/claim` | Prepare/vault a Models key, then make one hosted key-bound claim |
| `GET /credits/entitlements/status` | Refresh only the locally persisted operation |

Before calling the hosted claim route, the gateway validates an existing
Models key or provisions a new one and commits it to the encrypted vault. Only
safe key metadata and the opaque claim operation are persisted in preferences.
If local finalization is ambiguous, reopening Settings refreshes the same
operation instead of submitting the email again.

Hosted status/error bodies are mapped to a small local contract. Unknown,
expired, revoked, and another-key-won entitlements all remain the same safe
no-credit result. Logs must not include the full email, raw key, Authorization
header, or unsanitized hosted response.

## Compatibility and rollback

Old services without the capability route and services with the capability off
are equivalent to feature absence. New clients therefore remain compatible
during a mixed-version rollout.

To pause the pilot, operators disable hosted client capability and new claims.
No BrainDrive client release rollback is required: the Settings surface
disappears while existing Models status/use and persisted operation recovery
remain available.

## Verification

From `builds/typescript`:

```bash
npm run build
npm run test
npm run web:typecheck
npm run web:test
npm run web:build
npm run desktop:preflight
```

Focused evidence is in `gateway/auth-routes.integration.test.ts`,
`gateway/credits-provisioning.test.ts`,
`client_web/src/api/gateway-adapter.test.ts`, and
`client_web/src/components/settings/SettingsModal.test.tsx`.
