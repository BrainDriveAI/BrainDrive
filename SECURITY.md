# Security Policy

Thank you for helping keep **BrainDrive‑Core** and its users safe.

This document explains how to **report vulnerabilities**, what’s **in scope**, how we **triage and disclose**, and our **supported versions** policy.

---

## TL;DR
- **Please do not open public issues or PRs for vulnerabilities.**
- Use **GitHub’s Private Vulnerability Reporting** (Security → *Report a vulnerability*) **or email** `dwaring@braindrive.ai`.
- We acknowledge reports within **3 business days**, begin triage within **7 days**, and aim to remediate or provide mitigations within **90 days** (faster for Critical).
- Good‑faith research is welcome; see **Safe Harbor** & **Rules of Engagement** below.

---

## How to report a vulnerability
**Preferred:**
1. Go to this repository’s **Security** tab → **Report a vulnerability** (creates a private Security Advisory thread with the maintainers).

**Alternative:**
- Email: `dwaring@braindrive.ai`
- If you require encryption, request our PGP public key in your first message and we’ll reply with details.

Please include:
- A clear description of the issue, **impact**, and why you believe it’s a vulnerability
- **Reproduction steps** or a proof‑of‑concept
- Affected **component / path** (file, endpoint, plugin, etc.) and **version/commit**
- Environment details (OS, runtime, configuration) and relevant logs (redact secrets)
- Suggested fix or mitigation if you have one

We will keep your report confidential, coordinate a fix, and credit you if you’d like.

> ⚠️ **Do not** disclose the issue publicly or to third parties until we publish an advisory, unless we explicitly agree otherwise.

---

## Scope
**In scope**
- Code in **this repository** (BrainDrive‑Core), including: backend/API services, CLI, plugin manager, default templates/configuration, and any first‑party plugins that live **inside this repo**.
- Build/release artifacts produced from this repo.

**Out of scope**
- **Third‑party plugins** not maintained in this repo. For issues in other repos (even within the BrainDriveAI org), please report to that repo’s maintainers; if unsure, contact us and we’ll help route.
- **Self‑hosted deployments** operated by others (cloud providers, integrators). Contact the operator for operational issues.
- Social engineering, physical attacks, spam, and threats to privacy unrelated to our software.

---

## Rules of engagement (responsible testing)
We want research to be safe and constructive. When testing:
- Only test **on instances you own or are explicitly authorized to test**.
- **Do not** exfiltrate real user data or secrets. Use test/demo data.
- **No service disruption:** avoid DDoS, brute forcing at scale, or performance degradation.
- **No destructive actions** (e.g., deleting data, writing to disk outside temp/sandbox, mass email, cryptocurrency mining).
- **No automated scanning** that generates excessive traffic without coordination.
- **No social engineering or phishing** of maintainers or community members.
- Follow applicable laws. If you’re unsure whether a method is acceptable, ask us first at `dwaring@braindrive.ai`.

---

## Triage, timelines & disclosure
- **Acknowledgment:** within **3 business days** of receipt.
- **Triage & impact assessment:** within **7 days**.
- **Fix window:** we aim to release a patch and coordinated disclosure within **90 days** of triage. Critical issues may be expedited; complex cases may require extensions.
- **CVE IDs:** We use GitHub Security Advisories and will request a CVE where appropriate.
- **Credit:** We’re happy to acknowledge reporters (handle, name, or org) in the advisory and release notes, unless you prefer anonymity.

If a vulnerability is actively exploited or poses severe risk, we may publish limited details with immediate mitigations and follow with a full advisory once a fix is available.

---

## Severity rating
We use **CVSS v3.1** as a baseline, along with project context:

| Severity | CVSS (guideline) | Examples (non‑exhaustive)
|---|---|---|
| **Critical** | 9.0–10.0 | Remote code execution; unauthenticated data‑destructive or system‑wide compromise; plugin isolation bypass with full host control |
| **High** | 7.0–8.9 | Auth bypass; SSRF with impact; SQL/NoSQL/command injection; sensitive data disclosure enabling account/session compromise |
| **Medium** | 4.0–6.9 | Stored/reflected XSS; CSRF with meaningful state change; directory traversal; privilege escalation requiring specific conditions |
| **Low** | 0.1–3.9 | Missing hardening headers; verbose errors; minor information leak without security impact |

Final severity is determined by maintainers.

---

## Supported versions
We support security fixes for the **main branch** and the **last two minor release series**.

| Version line | Status |
|---|---|
| `main` | ✅ Actively developed and supported |
| Latest minor (e.g., `v0.N.x`) | ✅ Security & bug fixes |
| Previous minor (e.g., `v0.(N‑1).x`) | ☑️ Security fixes only |
| Older | ❌ End‑of‑life (please upgrade) |

Refer to the **Releases** page for currently supported series.

---

## What typically qualifies / doesn’t
**Generally in scope** (examples):
- RCE, injection (SQL/NoSQL/command), deserialization bugs, sandbox/isolation escapes
- AuthN/AuthZ bypass, privilege escalation, CSRF with state change, SSRF with impact
- Sensitive data exposure (tokens, secrets, PII) or secret leakage via logs
- Supply‑chain risks in plugin registration/load mechanisms

**Generally out of scope** (examples):
- Vulnerabilities that require physical access or a rooted/compromised host
- Rate‑limiting/captcha or generic best‑practice suggestions without a concrete exploit
- Clickjacking on pages without sensitive actions, missing security headers without exploit
- Issues in **unsupported** versions or in third‑party plugins not maintained here

When in doubt, send the report—we’ll triage it.

---

## Dependencies & coordinated fixes
If the issue arises from an **upstream dependency**, please report it to us as well; we will coordinate with the upstream project and ship a patched release or mitigation.

We use GitHub’s security tooling (e.g., Advisories, Dependabot alerts). Community PRs that safely update vulnerable dependencies are welcome.

---

## Safe Harbor (good‑faith research)
We will not pursue legal action or law‑enforcement investigation against researchers who:
- Make a good‑faith effort to **follow this policy and Rules of Engagement**, and
- **Report** vulnerabilities promptly, without exploiting them beyond what’s necessary to demonstrate the issue, and
- **Avoid harm** to users, data, and availability, and
- **Give us reasonable time** to remediate before public disclosure.

This safe‑harbor commitment does not apply to actions that are illegal, exploit data, or harm others, and it does not bind third parties.

---

## Contact & updates
- Security contact: `dwaring@braindrive.ai`
- Primary channel: GitHub **Security Advisories** on this repository
- We may maintain a public **Security Hall of Fame** if there is interest (PRs welcome to add `SECURITY-HALL-OF-FAME.md`).

**Thank you** for helping keep BrainDrive secure for everyone.

