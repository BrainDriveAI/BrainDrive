# Monday Release Operator Checklist

Use this checklist for the production image release window.

## 1) Pre-Release (Monday Morning)

1. Confirm `main` is green (CI/tests passing).
2. Confirm no open Severity-1 or release-blocking incidents.
3. Confirm release version (`vX.Y.Z`) and channel target (`stable`).
4. Confirm signing key is available in CI secret store (private key only).
5. Confirm rollback target (last known good release) is documented.

## 2) Build + Publish

1. Build images:
   - `./scripts/build-release-images.sh vX.Y.Z`
2. Publish images and capture digest refs:
   - `./scripts/publish-release-images.sh vX.Y.Z`
3. Record `APP_REF` and `EDGE_REF` in release notes draft.

## 3) Manifest + Signature

1. Generate manifest:
   - `./scripts/generate-release-manifest.sh vX.Y.Z <APP_REF> <EDGE_REF> stable ./releases.json`
2. Sign manifest:
   - `./scripts/sign-release-manifest.sh ./releases.json ./releases.json.sig`
3. Verify signature:
   - `./scripts/verify-release-manifest.sh ./releases.json ./releases.json.sig ./cosign.pub`
4. Publish `releases.json` and `releases.json.sig` to release endpoint.

## 4) Production Apply + Smoke

1. Run production upgrade with signature required.
2. Confirm app is healthy and edge is reachable.
3. Run smoke checks:
   - health endpoint
   - login/auth path
   - minimal message roundtrip
4. Confirm deployed image digests match manifest refs.

## 5) Rollback Readiness

1. Keep previous release manifest ready.
2. If release fails, re-apply previous manifest refs immediately.
3. Confirm recovery health before closing incident.

## 6) Cadence + Auto-Apply Policy

Recommended default for non-technical users:
1. Cadence: weekly Monday release.
2. Auto-check: enabled daily.
3. Auto-apply window: Monday `02:00-04:00` local time.
4. Freeze window: no Friday production releases.
