import { readFile } from "node:fs/promises";
import path from "node:path";

type Options = {
  baseUrl: string;
  projectId: string;
  filePath: string | null;
  identifier: string;
  password: string;
  token: string | null;
};

type AuthResponse = {
  access_token?: string;
  error?: string;
};

type UploadResponse = {
  code?: string;
  error?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const token = options.token ?? await authenticate(options);
  await assertDocumentProcessingRetired(options, token);

  process.stdout.write("Document processing retirement smoke passed.\n");
  process.stdout.write(`Project: ${options.projectId}\n`);
}

async function authenticate(options: Options): Promise<string> {
  const signup = await authRequest(`${options.baseUrl}/auth/signup`, options);
  if (signup.access_token) {
    return signup.access_token;
  }

  const login = await authRequest(`${options.baseUrl}/auth/login`, options);
  if (login.access_token) {
    return login.access_token;
  }

  throw new Error(login.error ?? signup.error ?? "Authentication failed");
}

async function authRequest(url: string, options: Options): Promise<AuthResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      identifier: options.identifier,
      password: options.password,
    }),
  });

  return (await response.json().catch(() => ({}))) as AuthResponse;
}

async function assertDocumentProcessingRetired(options: Options, token: string): Promise<void> {
  const source = await readUploadSource(options.filePath);
  const response = await fetch(`${options.baseUrl}/projects/${encodeURIComponent(options.projectId)}/uploads`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      file_name: source.fileName,
      mime_type: source.mimeType,
      content_base64: source.data.toString("base64"),
      size: source.data.length,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as UploadResponse;
  if (response.status !== 410 || payload.code !== "document_processing_retired") {
    throw new Error(payload.error ?? `Expected retired upload response, received HTTP ${response.status}`);
  }
}

async function readUploadSource(filePath: string | null): Promise<{
  fileName: string;
  mimeType: string;
  data: Buffer;
}> {
  if (!filePath) {
    return {
      fileName: `retired-upload-smoke-${Date.now()}.txt`,
      mimeType: "text/plain",
      data: Buffer.from("# Retired Upload Smoke\n\nThis file must not be saved or processed.\n", "utf8"),
    };
  }

  const absolutePath = path.resolve(filePath);
  const data = await readFile(absolutePath);
  const fileName = path.basename(absolutePath);
  return {
    fileName,
    mimeType: mimeTypeFor(fileName),
    data,
  };
}

function mimeTypeFor(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  switch (extension) {
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    case ".csv":
      return "text/csv";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    baseUrl: "http://127.0.0.1:8787",
    projectId: "finance",
    filePath: null,
    identifier: "uploadtest",
    password: "password123",
    token: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--base-url":
        if (!value) throw new Error("Missing value for --base-url");
        options.baseUrl = value.replace(/\/+$/, "");
        index += 1;
        break;
      case "--project":
        if (!value) throw new Error("Missing value for --project");
        options.projectId = value;
        index += 1;
        break;
      case "--file":
        if (!value) throw new Error("Missing value for --file");
        options.filePath = value;
        index += 1;
        break;
      case "--identifier":
        if (!value) throw new Error("Missing value for --identifier");
        options.identifier = value;
        index += 1;
        break;
      case "--password":
        if (!value) throw new Error("Missing value for --password");
        options.password = value;
        index += 1;
        break;
      case "--token":
        if (!value) throw new Error("Missing value for --token");
        options.token = value;
        index += 1;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage:",
      "  tsx scripts/upload-smoke.ts [options]",
      "",
      "Options:",
      "  --base-url <url>       Gateway URL. Default: http://127.0.0.1:8787",
      "  --project <id>         Project id. Default: finance",
      "  --file <path>          Optional stale upload payload. Default: generated text file",
      "  --identifier <name>    Test login. Default: uploadtest",
      "  --password <password>  Test password. Default: password123",
      "  --token <jwt>          Use an existing access token instead of login/signup",
      "",
    ].join("\n")
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
