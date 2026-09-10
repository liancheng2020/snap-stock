import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";

test("deployment includes dynamically loaded public assets", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url)),
  );
  assert.equal(config.functions["server.js"].includeFiles, "public/**");
  assert.ok(config.functions["server.js"].maxDuration >= 65);
});

test(
  "HTTP entry serves health, assets and validation errors",
  { timeout: 15000 },
  async (t) => {
    const port = 20000 + Math.floor(Math.random() * 30000);
    const child = spawn(
      process.execPath,
      [new URL("../server.js", import.meta.url).pathname],
      {
        cwd: "/tmp",
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(async () => {
      if (child.exitCode !== null) return;
      const closed = once(child, "exit");
      child.kill("SIGTERM");
      await closed;
    });
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Server exited: ${code}`)));
    });
    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(base + "/health");
    assert.equal((await health.json()).status, "ok");
    for (const [path, type] of [
      ["/", "text/html"],
      ["/app.js", "text/javascript"],
      ["/style.css", "text/css"],
      ["/logo.svg", "image/svg+xml"],
    ]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.ok(response.headers.get("content-type").startsWith(type), path);
      assert.ok((await response.text()).length > 0, path);
    }
    assert.equal((await fetch(base + "/missing")).status, 404);
    assert.equal(
      (await fetch(base + "/api/analysis?market=invalid")).status,
      422,
    );
    assert.equal(
      (await fetch(base + "/health", { method: "POST" })).status,
      405,
    );
  },
);
