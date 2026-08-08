# Resume Builder contract foundation

This directory is the executable Milestone 1 contract boundary shared by the future BrainDrive app platform and Resume Builder. It contains schemas, deterministic validators, fixtures, and conformance tests only. Importing these modules does not register a route, start a process, create storage, call a provider, or enable an app.

Contract authority is the project-owner-approved Resume Builder Specs 1–5 in `/home/hex/Reference/Designs/BrainDrive-Tools/Resume-Builder/MVP/`. The accepted verification plan is `/home/hex/Reference/Designs/BrainDrive-Tools/Resume-Builder/MVP/test-plan.md`.

All authority-bearing envelopes are strict: unknown fields fail. Durable owner-data records use an explicit `extensions` object so a compatible reader can preserve unknown extension fields without granting them authority. Schema version 1 cannot be silently downgraded.

Package verification authority is split deliberately: `PackageManifestSchema` describes archive identity and contents, `PackageDescriptorSchema` binds canonical manifest and exact archive digests to an Ed25519 signature, `PackageSourceIndexSchema` resolves immutable descriptors, `TrustRootSchema` defines the pinned-root/release-key hierarchy, and `RevocationListSchema` supplies monotonic explicit denials. `supervisor.ts` freezes the runtime-neutral control protocol; it does not implement or start a supervisor.

The valid trust/source/revocation/package-signature fixtures contain mutually verified public keys and signatures. Their one-time private keys were discarded and are not present in the repository, so later runtime fixture generation must use an ephemeral test trust root or release-authority-provided signing material rather than treating conformance vectors as signing credentials.

JSON Schema artifacts are generated from the Zod authorities with `npm run contracts:schemas` from `builds/typescript`. Generated artifacts are checked for drift by the contract tests.
