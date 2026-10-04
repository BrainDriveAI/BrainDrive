import {
  check,
  canonical,
  fingerprint,
  Memory,
  TestSigner,
  validSignature,
  type Offer,
} from "./core.js";
export interface Description {
  schema: 1;
  provider: string;
  identityKey: string;
  endpoint: string;
  interface: "OpenAPI-fixture";
  version: string;
  payee: string;
  quotePath: string;
  auth: "owner-test-proof";
  payment: { asset: "TEST-CENTS"; network: "mock" };
  terms: {
    retention: string;
    privacy: string;
    refund: string;
    support: string;
  };
  issuedAt: number;
  expiresAt: number;
  signature: string;
}
export function describeProvider(
  owner: TestSigner,
  endpoint: string,
): Description {
  const body = {
    schema: 1 as const,
    provider: "fixture-seller",
    identityKey: owner.publicKey,
    endpoint,
    interface: "OpenAPI-fixture" as const,
    version: "0.0.1",
    payee: "fixture-payee",
    quotePath: "/offer",
    auth: "owner-test-proof" as const,
    payment: { asset: "TEST-CENTS" as const, network: "mock" as const },
    terms: {
      retention: "local test lifetime",
      privacy: "synthetic data only",
      refund: "mock reconciliation only",
      support: "fixture operator",
    },
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60000,
  };
  return { ...body, signature: owner.sign("provider-description", body) };
}
export class DirectoryFixture {
  available = true;
  constructor(
    readonly name: string,
    readonly addresses: string[],
  ) {}
  search(query: string) {
    check(this.available, "directory unavailable");
    check(query === "synthetic model", "query disclosure not approved");
    return this.addresses.map((address) => ({ source: this.name, address }));
  }
}
export class Discovery {
  constructor(
    readonly memory: Memory,
    readonly allowedOrigins: string[],
    readonly trustedProviderKey: string,
  ) {}
  async retrieve(address: string) {
    const url = new URL(address);
    check(!url.username && !url.password && !url.hash, "unsafe destination");
    check(
      this.allowedOrigins.includes(url.origin),
      "destination not configured",
    );
    check(
      url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(url.hostname)),
      "unsafe scheme",
    );
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(2000),
    });
    check(response.status === 200, "redirect or unavailable description");
    check(
      response.headers.get("content-type")?.includes("application/json"),
      "description content type",
    );
    const reader = response.body?.getReader();
    check(reader, "empty description");
    let raw = "";
    let size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        check(size <= 65536, "description too large");
        raw += decoder.decode(next.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      await reader.cancel();
    }
    const d = JSON.parse(raw) as Description;
    check(
      d &&
        d.schema === 1 &&
        d.provider === "fixture-seller" &&
        d.identityKey === this.trustedProviderKey,
      "provider identity/schema",
    );
    check(
      d.interface === "OpenAPI-fixture" &&
        typeof d.version === "string" &&
        d.endpoint === url.origin &&
        d.payee === "fixture-payee" &&
        d.quotePath === "/offer" &&
        d.auth === "owner-test-proof",
      "missing or mismatched service meanings",
    );
    check(
      d.payment?.asset === "TEST-CENTS" && d.payment.network === "mock",
      "unsupported payment",
    );
    check(
      d.terms &&
        ["retention", "privacy", "refund", "support"].every(
          (k) =>
            typeof (d.terms as unknown as Record<string, unknown>)[k] ===
            "string",
        ),
      "missing terms",
    );
    check(
      Number.isSafeInteger(d.issuedAt) &&
        Number.isSafeInteger(d.expiresAt) &&
        d.issuedAt <= Date.now() &&
        d.expiresAt > Date.now(),
      "stale description",
    );
    const { signature, ...body } = d;
    check(
      validSignature(
        this.trustedProviderKey,
        "provider-description",
        body,
        signature,
      ),
      "description signature",
    );
    const record = {
      kind: "provider-claim",
      description: d,
      source: address,
      retrievedAt: Date.now(),
      verification: "publisher-key-control-only",
      hash: fingerprint(d),
      quality: "not-established",
    };
    this.memory.write("provider-" + fingerprint(address).slice(0, 20), record);
    return d;
  }
  validateOffer(d: Description, offer: Offer) {
    check(d.expiresAt > Date.now(), "stale description");
    check(
      offer.seller === d.provider &&
        offer.payee === d.payee &&
        offer.asset === d.payment.asset &&
        offer.network === d.payment.network &&
        offer.expiresAt > Date.now(),
      "offer identity/payment mismatch",
    );
    return offer;
  }
}
export interface TrustRecord {
  kind:
    | "provider-claim"
    | "third-party-assessment"
    | "owner-transaction"
    | "ai-assessment"
    | "owner-preference";
  source: string;
  observedAt: number;
  evidence: unknown;
}
export class Trust {
  constructor(readonly memory: Memory) {}
  retain(records: TrustRecord[]) {
    const unique = new Map<string, TrustRecord>();
    for (const r of records) {
      check(
        [
          "provider-claim",
          "third-party-assessment",
          "owner-transaction",
          "ai-assessment",
          "owner-preference",
        ].includes(r.kind),
        "trust category",
      );
      check(r.source && Number.isSafeInteger(r.observedAt), "trust provenance");
      unique.set(
        fingerprint({ kind: r.kind, source: r.source, evidence: r.evidence }),
        r,
      );
    }
    const result = [...unique.values()];
    this.memory.write("trust", {
      records: result,
      quality: "not-established",
      authorization: "none",
      warnings: [
        "signatures prove origin only",
        "copied sources do not add independence",
      ],
    });
    return result;
  }
}
