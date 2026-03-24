import { z } from "zod";

export const ServerKindSchema = z.enum(["memory", "auth", "project"]);
export type ServerKind = z.infer<typeof ServerKindSchema>;

const DEFAULT_PORTS: Record<ServerKind, number> = {
  memory: 8911,
  auth: 8912,
  project: 8913,
};

const EnvSchema = z.object({
  SERVER_KIND: ServerKindSchema.default("memory"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined))
    .pipe(z.number().int().positive().max(65535).optional()),
  VERSION: z.string().min(1).default("1.0.0"),
  MEMORY_ROOT: z.string().min(1).default("/data/memory"),
});

export interface AppConfig {
  serverKind: ServerKind;
  host: string;
  port: number;
  version: string;
  memoryRoot: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const port = parsed.PORT ?? DEFAULT_PORTS[parsed.SERVER_KIND];

  return {
    serverKind: parsed.SERVER_KIND,
    host: parsed.HOST,
    port,
    version: parsed.VERSION,
    memoryRoot: parsed.MEMORY_ROOT,
  };
}
