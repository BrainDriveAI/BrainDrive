const ELEMENT_ID = "element-6066-11e4-a52e-4f735466cecf";

export class EmbeddedWebDriver {
  constructor(port) {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.sessionId = null;
  }

  async request(endpoint, { method = "GET", body, timeoutMs = 30_000 } = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json();
    if (!response.ok || payload?.value?.error) {
      const detail = payload?.value?.message ?? response.statusText;
      throw new Error(`WebDriver ${method} ${endpoint} failed (${response.status}): ${detail}`);
    }
    return payload.value;
  }

  async waitUntilReady(timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const status = await this.request("/status", { timeoutMs: 2_000 });
        if (status.ready) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`Embedded WebDriver did not become ready within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ""}`);
  }

  async createSession(windowLabel = "main") {
    const value = await this.request("/session", {
      method: "POST",
      body: {
        capabilities: {
          alwaysMatch: { "wdio:tauriServiceOptions": { windowLabel } },
          firstMatch: [{}],
        },
      },
    });
    this.sessionId = value.sessionId;
    if (!this.sessionId) throw new Error("WebDriver returned no session id.");
    return value.capabilities;
  }

  sessionPath(suffix = "") {
    if (!this.sessionId) throw new Error("WebDriver session has not been created.");
    return `/session/${encodeURIComponent(this.sessionId)}${suffix}`;
  }

  async title() {
    return this.request(this.sessionPath("/title"));
  }

  async findByXPath(xpath) {
    const value = await this.request(this.sessionPath("/element"), {
      method: "POST",
      body: { using: "xpath", value: xpath },
    });
    const id = value?.[ELEMENT_ID] ?? value?.ELEMENT;
    if (!id) throw new Error(`WebDriver returned no element id for XPath: ${xpath}`);
    return id;
  }

  async isDisplayed(elementId) {
    return this.request(this.sessionPath(`/element/${encodeURIComponent(elementId)}/displayed`));
  }

  async click(elementId) {
    await this.request(this.sessionPath(`/element/${encodeURIComponent(elementId)}/click`), { method: "POST", body: {} });
  }

  async text(elementId) {
    return this.request(this.sessionPath(`/element/${encodeURIComponent(elementId)}/text`));
  }

  async property(elementId, name) {
    return this.request(this.sessionPath(`/element/${encodeURIComponent(elementId)}/property/${encodeURIComponent(name)}`));
  }

  async sendKeys(elementId, text) {
    await this.request(this.sessionPath(`/element/${encodeURIComponent(elementId)}/value`), {
      method: "POST",
      body: { text },
    });
  }

  async clear(elementId) {
    await this.request(this.sessionPath(`/element/${encodeURIComponent(elementId)}/clear`), { method: "POST", body: {} });
  }

  async screenshot(filePath) {
    const base64 = await this.request(this.sessionPath("/screenshot"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, Buffer.from(base64, "base64"));
  }

  async closeWindow() {
    if (!this.sessionId) return;
    await this.request(this.sessionPath("/window"), { method: "DELETE" });
  }

  async deleteSession() {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = null;
    await this.request(`/session/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }
}
