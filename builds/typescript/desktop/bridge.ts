import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const STRIPPED_CLIENT_HEADERS = new Set([
  "forwarded",
  "x-actor-id",
  "x-actor-permissions",
  "x-actor-type",
  "x-auth-mode",
  "x-braindrive-browser-access",
  "x-braindrive-browser-client-ip",
  "x-braindrive-desktop-token",
  "x-braindrive-internal-transport-token",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

const RESPONSE_HEADER_DENYLIST = new Set([
  ...HOP_BY_HOP_HEADERS,
  "content-encoding",
  "content-length",
]);

type BridgeConfig = {
  host: string;
  port: number;
  webRoot: string;
  gatewayBaseUrl: URL;
  transportToken: string;
};

function readConfig(): BridgeConfig {
  const host = process.env.BRAINDRIVE_BROWSER_BRIDGE_HOST?.trim() || "127.0.0.1";
  const port = readPort(process.env.BRAINDRIVE_BROWSER_BRIDGE_PORT, 18088);
  const webRoot = process.env.BRAINDRIVE_BROWSER_BRIDGE_WEB_ROOT?.trim();
  const gatewayBaseUrlRaw = process.env.BRAINDRIVE_BROWSER_BRIDGE_GATEWAY_URL?.trim();
  const transportToken = process.env.BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN?.trim();

  if (!webRoot) {
    throw new Error("BRAINDRIVE_BROWSER_BRIDGE_WEB_ROOT is required");
  }
  if (!gatewayBaseUrlRaw) {
    throw new Error("BRAINDRIVE_BROWSER_BRIDGE_GATEWAY_URL is required");
  }
  if (!transportToken) {
    throw new Error("BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN is required");
  }

  return {
    host,
    port,
    webRoot: path.resolve(webRoot),
    gatewayBaseUrl: new URL(gatewayBaseUrlRaw),
    transportToken,
  };
}

function readPort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function createServer(config: BridgeConfig): http.Server {
  return http.createServer((request, response) => {
    void handleRequest(config, request, response).catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      }
      response.end(JSON.stringify({ error: "bridge_request_failed" }));
    });
  });
}

async function handleRequest(
  config: BridgeConfig,
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (requestUrl.pathname === "/healthz") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
    await proxyApiRequest(config, request, response, requestUrl);
    return;
  }

  await serveStaticAsset(config.webRoot, request, requestUrl, response);
}

async function proxyApiRequest(
  config: BridgeConfig,
  clientRequest: http.IncomingMessage,
  clientResponse: http.ServerResponse,
  requestUrl: URL
): Promise<void> {
  const targetUrl = new URL(config.gatewayBaseUrl.toString());
  const apiPath = requestUrl.pathname.replace(/^\/api\/?/, "");
  targetUrl.pathname = joinUrlPath(targetUrl.pathname, apiPath);
  targetUrl.search = requestUrl.search;

  const headers = buildProxyHeaders(config, clientRequest);
  const requestOptions: http.RequestOptions = {
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    method: clientRequest.method,
    path: `${targetUrl.pathname}${targetUrl.search}`,
    headers,
  };

  await new Promise<void>((resolve, reject) => {
    const upstream = (targetUrl.protocol === "https:" ? https : http).request(requestOptions, (upstreamResponse) => {
      const responseHeaders = filterResponseHeaders(upstreamResponse.headers);
      clientResponse.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, responseHeaders);
      upstreamResponse.pipe(clientResponse);
      upstreamResponse.on("end", resolve);
      upstreamResponse.on("error", reject);
    });

    upstream.on("error", reject);
    clientRequest.pipe(upstream);
  });
}

function buildProxyHeaders(
  config: BridgeConfig,
  request: http.IncomingMessage
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};

  for (const [name, value] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName) || STRIPPED_CLIENT_HEADERS.has(lowerName)) {
      continue;
    }
    headers[name] = value;
  }

  const clientIp = normalizeRemoteAddress(request.socket.remoteAddress);
  headers.host = config.gatewayBaseUrl.host;
  headers["x-braindrive-internal-transport-token"] = config.transportToken;
  headers["x-braindrive-browser-access"] = "1";
  headers["x-braindrive-browser-client-ip"] = clientIp;
  headers["x-forwarded-for"] = clientIp;
  headers["x-forwarded-proto"] = "http";

  const forwardedHost = firstHeaderValue(request.headers.host);
  if (forwardedHost && forwardedHost.length <= 255 && !/[\r\n]/.test(forwardedHost)) {
    headers["x-forwarded-host"] = forwardedHost;
  }

  return headers;
}

function filterResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const filtered: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!RESPONSE_HEADER_DENYLIST.has(name.toLowerCase())) {
      filtered[name] = value;
    }
  }
  return filtered;
}

async function serveStaticAsset(
  webRoot: string,
  request: http.IncomingMessage,
  requestUrl: URL,
  response: http.ServerResponse
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  const candidatePath = resolveStaticPath(webRoot, requestUrl.pathname);
  const filePath = candidatePath && (await isFile(candidatePath)) ? candidatePath : path.join(webRoot, "index.html");

  if (!(await isFile(filePath))) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const stat = await fs.promises.stat(filePath);
  response.writeHead(200, {
    "content-length": stat.size,
    "content-type": contentTypeFor(filePath),
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  fs.createReadStream(filePath).pipe(response);
}

function resolveStaticPath(webRoot: string, pathname: string): string | null {
  let decodedPath = "/";
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const normalizedPath = decodedPath.replace(/\\/g, "/");
  const resolved = path.resolve(webRoot, `.${normalizedPath}`);
  const relative = path.relative(webRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function joinUrlPath(basePath: string, apiPath: string): string {
  const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const normalizedApi = apiPath.startsWith("/") ? apiPath.slice(1) : apiPath;
  if (!normalizedApi) {
    return normalizedBase || "/";
  }
  return `${normalizedBase}/${normalizedApi}`;
}

function normalizeRemoteAddress(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }
  return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".ttf":
      return "font/ttf";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function main(): void {
  const config = readConfig();
  const server = createServer(config);

  server.listen(config.port, config.host, () => {
    console.log(
      `BrainDrive browser bridge listening at http://${config.host}:${config.port} -> ${config.gatewayBaseUrl.toString()}`
    );
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
