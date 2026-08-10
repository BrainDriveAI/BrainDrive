import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const TAURI_ROOT = path.resolve(process.cwd(), "src-tauri");

describe("Spec 05 M6 packaged-desktop supervisor boundary", () => {
  it("stages packaged Node and compiled gateway JavaScript and selects the Windows loopback adapter", async () => {
    const [configuration, main, stage] = await Promise.all([
      readFile(path.join(TAURI_ROOT, "tauri.conf.json"), "utf8"),
      readFile(path.join(TAURI_ROOT, "src", "main.rs"), "utf8"),
      readFile(path.resolve(process.cwd(), "scripts", "desktop-stage-runtime.mjs"), "utf8"),
    ]);

    expect(configuration).toContain('"desktop-runtime/": "desktop-runtime"');
    expect(main).toContain('format!("desktop-runtime/node/{node_file}")');
    expect(main).toContain('PathBuf::from("dist").join("gateway").join("server.js")');
    expect(main).toContain('.env("BRAINDRIVE_APP_PLATFORM_TARGET", "desktop_windows_x64")');
    expect(main).toContain('format!("http://127.0.0.1:{gateway_port}")');
    expect(stage).toMatch(/node|desktop-runtime/);
    expect(stage).toMatch(/dist|typescript/);
  });

  it("contains descendants in the Tauri-owned Windows job while granting no iframe shell/process authority", async () => {
    const [containment, capability, main] = await Promise.all([
      readFile(path.join(TAURI_ROOT, "src", "process_containment.rs"), "utf8"),
      readFile(path.join(TAURI_ROOT, "capabilities", "default.json"), "utf8"),
      readFile(path.join(TAURI_ROOT, "src", "main.rs"), "utf8"),
    ]);

    expect(containment).toContain("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE");
    expect(containment).toContain("JOB_OBJECT_LIMIT_PROCESS_MEMORY");
    expect(containment).toContain("JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP");
    expect(containment).toContain("TerminateJobObject");
    expect(containment).toContain("512 * 1024 * 1024");
    expect(capability).toMatch(/"windows": \["main"\]/);
    expect(capability).toMatch(/"permissions": \["core:default"\]/);
    expect(capability).not.toMatch(/shell|process|command|http/i);
    expect(main).not.toMatch(/installed_app_(?:start|stop)|invoke.*app.*process/i);
  });
});
