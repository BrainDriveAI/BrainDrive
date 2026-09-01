import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { TextDecoder } from "node:util";
import { z } from "zod";

import { OpaqueIdSchema } from "../app-platform/contracts/common.js";
import {
  InternetSearchFailureSchema,
  WebReadEnvelopeSchema,
  type InternetSearchFailure,
  type InternetSearchFailureCode,
  type WebReadEnvelope,
} from "./contracts/index.js";
import { INTERNET_SEARCH_LOCAL_V1_LIMITS } from "./limits.js";
import type { SearxngSidecarSnapshot } from "./sidecar.js";

const PROVIDER_PROFILE = "local-owner-managed";
const PROVIDER_ATTRIBUTION = "host-fetch";
const DEFAULT_TIMEOUT_MS = INTERNET_SEARCH_LOCAL_V1_LIMITS.read_operation_timeout_ms;
const DEFAULT_MAX_REDIRECTS = INTERNET_SEARCH_LOCAL_V1_LIMITS.max_redirects_per_read;
const DEFAULT_MAX_CONTENT_BYTES = INTERNET_SEARCH_LOCAL_V1_LIMITS.max_returned_read_content_bytes;

const ReadRequestSchema = z
  .object({
    request_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    input: z.unknown(),
    authorized: z.boolean().default(true),
    signal: z.instanceof(AbortSignal).optional(),
  })
  .strict();

const RawReadInputSchema = z
  .object({
    url: z.string().trim().url().max(2_048),
  })
  .strict();

export type WebReadExecutionRequest = z.input<typeof ReadRequestSchema>;

export type WebReadTargetResolver = {
  resolve(hostname: string): Promise<readonly string[]>;
};

export type InternetSearchCapabilityStatusSnapshotProvider = {
  snapshot(): SearxngSidecarSnapshot;
};

export interface WebReadExecutor {
  read(request: WebReadExecutionRequest): Promise<WebReadEnvelope>;
}

export class DnsWebReadTargetResolver implements WebReadTargetResolver {
  async resolve(hostname: string): Promise<readonly string[]> {
    const addresses = await lookup(hostname, { all: true, verbatim: false });
    return addresses.map((entry) => entry.address);
  }
}

export class StaticWebReadAdapter implements WebReadExecutor {
  readonly #fetchImpl: typeof fetch;
  readonly #resolver: WebReadTargetResolver;
  readonly #statusProvider: InternetSearchCapabilityStatusSnapshotProvider | null;
  readonly #now: () => string;
  readonly #timeoutMs: number;
  readonly #maxRedirects: number;
  readonly #maxContentBytes: number;

  constructor(options: {
    fetchImpl?: typeof fetch;
    resolver?: WebReadTargetResolver;
    statusProvider?: InternetSearchCapabilityStatusSnapshotProvider | null;
    now?: () => string;
    timeoutMs?: number;
    maxRedirects?: number;
    maxContentBytes?: number;
  } = {}) {
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#resolver = options.resolver ?? new DnsWebReadTargetResolver();
    this.#statusProvider = options.statusProvider ?? null;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#timeoutMs = capPositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.#maxRedirects = capPositiveInt(options.maxRedirects, DEFAULT_MAX_REDIRECTS, DEFAULT_MAX_REDIRECTS);
    this.#maxContentBytes = capPositiveInt(options.maxContentBytes, DEFAULT_MAX_CONTENT_BYTES, DEFAULT_MAX_CONTENT_BYTES);
  }

  async read(rawRequest: WebReadExecutionRequest): Promise<WebReadEnvelope> {
    const request = ReadRequestSchema.parse(rawRequest);
    const retrievedAt = this.#now();

    if (!request.authorized) {
      return failureEnvelope(request, retrievedAt, "failure", failure("not_authorized", false, "Read authorization is required."));
    }
    if (request.signal?.aborted) {
      return failureEnvelope(request, retrievedAt, "cancelled", failure("cancelled", false, "Read was cancelled."));
    }

    const parsedInput = RawReadInputSchema.safeParse(request.input);
    if (!parsedInput.success) {
      return failureEnvelope(request, retrievedAt, "failure", failure("invalid_request", false, "Read input is invalid."));
    }

    if (!this.#isProviderCallable()) {
      return failureEnvelope(request, retrievedAt, "unavailable", failure("provider_unavailable", true, "Internet Search is unavailable."));
    }

    try {
      const requestedUrl = new URL(parsedInput.data.url);
      const firstTarget = await validatePublicReadTarget(requestedUrl, this.#resolver);
      if (!firstTarget.allowed) {
        return failureEnvelope(request, retrievedAt, "failure", failure("disallowed_target", false, firstTarget.message));
      }

      const fetchResult = await this.#fetchWithRedirects(requestedUrl, request.signal);
      if (!fetchResult.ok) {
        return failureEnvelope(request, retrievedAt, fetchResult.status, fetchResult.failure, fetchResult.readCall);
      }

      const normalized = await normalizeReadResponse(fetchResult.response, {
        requestedUrl: requestedUrl.toString(),
        canonicalUrl: fetchResult.finalUrl.toString(),
        retrievedAt,
        maxContentBytes: this.#maxContentBytes,
      });

      if (!normalized.ok) {
        return failureEnvelope(request, retrievedAt, "failure", normalized.failure, true);
      }

      return envelope({
        requestId: request.request_id,
        runId: request.run_id,
        status: normalized.truncated ? "partial" : "success",
        retrievedAt,
        result: normalized.result,
        failure: normalized.truncated
          ? failure("content_too_large", false, `Content exceeded the ${this.#maxContentBytes} byte limit; bounded content is returned.`, 1)
          : null,
        readCall: 1,
        bytesRead: normalized.bytesRead,
        includeProvider: true,
      });
    } catch (error) {
      if (isAbortLike(error) && request.signal?.aborted) {
        return failureEnvelope(request, retrievedAt, "cancelled", failure("cancelled", false, "Read was cancelled."), true);
      }
      return failureEnvelope(request, retrievedAt, "unavailable", failure("provider_unavailable", true, "Internet Search reader is unavailable."), true);
    }
  }

  #isProviderCallable(): boolean {
    const snapshot = this.#statusProvider?.snapshot();
    if (!snapshot) return true;
    return snapshot.installed && snapshot.enabled && snapshot.lifecycle_state === "available" && snapshot.health.state === "healthy";
  }

  async #fetchWithRedirects(
    startUrl: URL,
    outerSignal: AbortSignal | undefined,
  ): Promise<
    | { ok: true; response: Response; finalUrl: URL }
    | { ok: false; status: Extract<WebReadEnvelope["status"], "failure" | "unavailable" | "cancelled">; failure: InternetSearchFailure; readCall: boolean }
  > {
    let currentUrl = startUrl;
    const controller = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    const abort = () => {
      cancelled = true;
      controller.abort();
    };
    outerSignal?.addEventListener("abort", abort, { once: true });

    try {
      for (let redirectCount = 0; redirectCount <= this.#maxRedirects; redirectCount += 1) {
        const response = await this.#fetchImpl(currentUrl, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
          headers: {
            accept: "text/html,text/plain;q=0.9",
            "user-agent": "BrainDrive Internet Search web.read/1",
          },
        });

        if (isRedirectStatus(response.status)) {
          const location = response.headers.get("location");
          if (!location || redirectCount === this.#maxRedirects) {
            return { ok: false, status: "failure", failure: failure("disallowed_target", false, "Read redirect limit was exceeded."), readCall: true };
          }
          const redirectUrl = new URL(location, currentUrl);
          const redirectTarget = await validatePublicReadTarget(redirectUrl, this.#resolver);
          if (!redirectTarget.allowed) {
            return { ok: false, status: "failure", failure: failure("disallowed_target", false, redirectTarget.message), readCall: true };
          }
          currentUrl = redirectUrl;
          continue;
        }

        if (response.status === 401 || response.status === 403 || response.status === 407) {
          return { ok: false, status: "failure", failure: failure("authentication_required", false, "The page requires authentication or session state."), readCall: true };
        }
        if (response.status === 429) {
          return { ok: false, status: "failure", failure: failure("rate_limited", true, "Read source rate limit was reached."), readCall: true };
        }
        if (!response.ok) {
          return { ok: false, status: "failure", failure: failure("blocked", true, "The page could not be read under the static reader policy."), readCall: true };
        }
        return { ok: true, response, finalUrl: currentUrl };
      }
      return { ok: false, status: "failure", failure: failure("disallowed_target", false, "Read redirect limit was exceeded."), readCall: true };
    } catch (error) {
      if (cancelled || (isAbortLike(error) && outerSignal?.aborted)) {
        return { ok: false, status: "cancelled", failure: failure("cancelled", false, "Read was cancelled."), readCall: true };
      }
      if (timedOut || isAbortLike(error)) {
        return { ok: false, status: "failure", failure: failure("timeout", true, "Read timed out."), readCall: true };
      }
      return { ok: false, status: "unavailable", failure: failure("provider_unavailable", true, "Internet Search reader is unavailable."), readCall: true };
    } finally {
      clearTimeout(timeout);
      outerSignal?.removeEventListener("abort", abort);
    }
  }
}

export function createConfiguredStaticWebReadAdapter(
  options: {
    env?: NodeJS.ProcessEnv;
    statusProvider?: InternetSearchCapabilityStatusSnapshotProvider | null;
    fetchImpl?: typeof fetch;
    resolver?: WebReadTargetResolver;
    now?: () => string;
  } = {},
): StaticWebReadAdapter {
  const env = options.env ?? process.env;
  return new StaticWebReadAdapter({
    fetchImpl: options.fetchImpl,
    resolver: options.resolver,
    statusProvider: options.statusProvider ?? null,
    now: options.now,
    timeoutMs: readPositiveInt(env.BRAINDRIVE_INTERNET_SEARCH_READ_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxRedirects: readPositiveInt(env.BRAINDRIVE_INTERNET_SEARCH_READ_MAX_REDIRECTS, DEFAULT_MAX_REDIRECTS, DEFAULT_MAX_REDIRECTS),
    maxContentBytes: readPositiveInt(env.BRAINDRIVE_INTERNET_SEARCH_READ_MAX_CONTENT_BYTES, DEFAULT_MAX_CONTENT_BYTES, DEFAULT_MAX_CONTENT_BYTES),
  });
}

export async function validatePublicReadTarget(url: URL, resolver: WebReadTargetResolver): Promise<{ allowed: true } | { allowed: false; message: string }> {
  if (url.protocol !== "https:") {
    return { allowed: false, message: "Read target protocol is not supported." };
  }
  if (url.username || url.password) {
    return { allowed: false, message: "Read target URLs must not include credentials." };
  }
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || isMetadataHostname(hostname)) {
    return { allowed: false, message: "Read target is not a public web destination." };
  }

  const addresses = isIP(hostname) ? [hostname] : await resolver.resolve(hostname);
  if (addresses.length === 0 || addresses.some((address) => isDisallowedAddress(address))) {
    return { allowed: false, message: "Read target resolves to a prohibited network destination." };
  }
  return { allowed: true };
}

type NormalizedReadResponse =
  | {
      ok: true;
      result: NonNullable<WebReadEnvelope["result"]>;
      truncated: boolean;
      bytesRead: number;
    }
  | { ok: false; failure: InternetSearchFailure };

async function normalizeReadResponse(
  response: Response,
  options: { requestedUrl: string; canonicalUrl: string; retrievedAt: string; maxContentBytes: number },
): Promise<NormalizedReadResponse> {
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  if (/^\s*attachment\b/i.test(contentDisposition)) {
    return { ok: false, failure: failure("unsupported_content", false, "Download responses are not supported by web.read.") };
  }

  const contentType = normalizeContentType(response.headers.get("content-type"));
  if (contentType !== "text/html" && contentType !== "text/plain" && contentType !== "application/xhtml+xml") {
    return { ok: false, failure: failure("unsupported_content", false, "Read content type is not supported.") };
  }

  const body = await readBoundedText(response, options.maxContentBytes);
  const extracted = contentType === "text/plain"
    ? normalizePlainText(body.text)
    : extractHtmlText(body.text);
  const boundedContent = truncateUtf8(extracted, options.maxContentBytes);
  const truncated = body.truncated || boundedContent.truncated;

  return {
    ok: true,
    result: WebReadEnvelopeSchema.shape.result.unwrap().parse({
      requested_url: options.requestedUrl,
      canonical_url: options.canonicalUrl,
      title: contentType === "text/plain" ? null : extractHtmlTitle(body.text),
      content_type: contentType,
      content: boundedContent.text,
      truncated,
      trust: "external-untrusted",
      result_class: "outside-fact",
      published_at: contentType === "text/plain" ? null : extractHtmlMetaDate(body.text, ["article:published_time", "datePublished", "pubdate"]),
      updated_at: extractHtmlMetaDate(body.text, ["article:modified_time", "dateModified", "last-modified"]) ?? response.headers.get("last-modified"),
    }),
    truncated,
    bytesRead: Buffer.byteLength(boundedContent.text, "utf8"),
  };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const limit = maxBytes + 1;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return { text: new TextDecoder("utf-8").decode(buffer.subarray(0, maxBytes)), truncated: buffer.byteLength > maxBytes };
  }
  const reader = response.body.getReader();
  try {
    while (total <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const available = Math.max(0, limit - total);
      chunks.push(value.byteLength > available ? value.subarray(0, available) : value);
      total += value.byteLength;
      if (total > maxBytes) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks);
  return { text: new TextDecoder("utf-8").decode(buffer.subarray(0, maxBytes)), truncated };
}

function normalizeContentType(value: string | null): string {
  return (value ?? "application/octet-stream").split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
}

function extractHtmlTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match ? decodeHtmlEntities(stripTags(match[1] ?? "")).replace(/\s+/g, " ").trim() : "";
  return title.length > 0 ? title.slice(0, 512) : null;
}

function extractHtmlMetaDate(html: string, names: readonly string[]): string | null {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const metaPattern = /<meta\b[^>]*>/gi;
  for (const [tag] of html.matchAll(metaPattern)) {
    const name = getAttribute(tag, "name") ?? getAttribute(tag, "property") ?? getAttribute(tag, "itemprop");
    if (name && wanted.has(name.toLowerCase())) {
      const content = getAttribute(tag, "content");
      if (content && content.trim().length > 0) return content.trim().slice(0, 64);
    }
  }
  return null;
}

function getAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(tag);
  return match ? decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "").trim() : null;
}

function extractHtmlText(html: string): string {
  return decodeHtmlEntities(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizePlainText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function truncateUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return { text: value, truncated: false };
  let end = maxBytes;
  while (end > 0) {
    const text = new TextDecoder("utf-8").decode(buffer.subarray(0, end));
    if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: true };
    end -= 1;
  }
  return { text: "", truncated: true };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isMetadataHostname(hostname: string): boolean {
  return hostname === "metadata" || hostname === "metadata.google.internal" || hostname === "instance-data";
}

function isDisallowedAddress(address: string): boolean {
  const normalized = address.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  const ipv4Mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (ipv4Mapped) return isDisallowedIpv4(ipv4Mapped[1] ?? "");
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isDisallowedIpv4(normalized);
  if (ipVersion === 6) return isDisallowedIpv6(normalized);
  return true;
}

function isDisallowedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second, third] = parts as [number, number, number, number];
  return (
    first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 168 || second === 0 || (second === 0 && third === 2)))
    || (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100)))
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
  );
}

function isDisallowedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:")
  );
}

function envelope(input: {
  requestId: string;
  runId: string;
  status: WebReadEnvelope["status"];
  retrievedAt: string;
  result: WebReadEnvelope["result"];
  failure: InternetSearchFailure | null;
  readCall: 0 | 1;
  bytesRead: number;
  includeProvider: boolean;
}): WebReadEnvelope {
  return WebReadEnvelopeSchema.parse({
    capability: "web.read",
    version: 1,
    request_id: input.requestId,
    run_id: input.runId,
    status: input.status,
    retrieved_at: input.retrievedAt,
    provider: input.includeProvider ? { profile: PROVIDER_PROFILE, attribution: PROVIDER_ATTRIBUTION } : null,
    usage: { read_call: input.readCall, bytes_read: Math.min(input.bytesRead, DEFAULT_MAX_CONTENT_BYTES) },
    result: input.result,
    failure: input.failure,
  });
}

function failureEnvelope(
  request: z.infer<typeof ReadRequestSchema>,
  retrievedAt: string,
  status: WebReadEnvelope["status"],
  failureValue: InternetSearchFailure,
  includeProvider = false,
): WebReadEnvelope {
  return envelope({
    requestId: request.request_id,
    runId: request.run_id,
    status,
    retrievedAt,
    result: null,
    failure: failureValue,
    readCall: includeProvider ? 1 : 0,
    bytesRead: 0,
    includeProvider,
  });
}

function failure(
  code: InternetSearchFailureCode,
  retryable: boolean,
  message: string,
  completedItems = 0,
): InternetSearchFailure {
  return InternetSearchFailureSchema.parse({
    code,
    retryable,
    message,
    completed_items: completedItems,
  });
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function readPositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return capPositiveInt(parsed, fallback, max);
}

function capPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}
