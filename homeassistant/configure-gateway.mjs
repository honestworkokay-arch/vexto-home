#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, "..");
const base = "http://127.0.0.1:8123";
const ownerFile = path.join(here, ".ha-owner");
const keyFile = path.join(here, ".gateway-key");

function cache() {
  const file = path.join(project, ".xiaomi-devices.json");
  const devices = JSON.parse(fs.readFileSync(file, "utf8"));
  return devices.find((item) => item.model === "lumi.gateway.mgl001");
}

async function waitReady() {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      // После завершения первичной настройки /api/onboarding возвращает 404.
      const response = await fetch(`${base}/api/`);
      if (response.ok || response.status === 401) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error("Home Assistant не відкрився на 127.0.0.1:8123");
}

async function owner() {
  if (fs.existsSync(ownerFile)) return JSON.parse(fs.readFileSync(ownerFile, "utf8"));
  const password = crypto.randomBytes(18).toString("base64url");
  const created = { username: "owner", password };
  const response = await fetch(`${base}/api/onboarding/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: `${base}/`,
      name: "Owner",
      username: created.username,
      password: created.password,
      language: "uk",
    }),
  });
  if (!response.ok && response.status !== 403) {
    throw new Error(`Онбординг не створив користувача: ${response.status}`);
  }
  if (response.ok) fs.writeFileSync(ownerFile, JSON.stringify(created));
  await fetch(`${base}/api/onboarding/core_config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  await fetch(`${base}/api/onboarding/analytics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analytics: false }),
  });
  await fetch(`${base}/api/onboarding/integration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  return fs.existsSync(ownerFile) ? JSON.parse(fs.readFileSync(ownerFile, "utf8")) : created;
}

async function token(user) {
  const start = await fetch(`${base}/auth/login_flow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: `${base}/`,
      handler: ["homeassistant", null],
      redirect_uri: `${base}/`,
    }),
  });
  const flow = await start.json();
  const step = await fetch(`${base}/auth/login_flow/${flow.flow_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: `${base}/`,
      username: user.username,
      password: user.password,
    }),
  });
  const result = await step.json();
  const auth = await fetch(`${base}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: result.result,
      client_id: `${base}/`,
    }),
  });
  const body = await auth.json();
  if (!body.access_token) throw new Error("Не вдалося увійти в Home Assistant");
  return body.access_token;
}

async function main() {
  const hub = cache();
  if (!hub?.token || !hub.ip) throw new Error("У локальному кеші немає Hub 2");
  await waitReady();
  const user = await owner();
  const access = await token(user);
  const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };
  const opened = await fetch(`${base}/api/config/config_entries/flow`, {
    method: "POST",
    headers,
    body: JSON.stringify({ handler: "xiaomi_gateway3" }),
  });
  const first = await opened.json();
  const chosen = await fetch(`${base}/api/config/config_entries/flow/${first.flow_id}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "token" }),
  });
  const second = await chosen.json();
  const created = await fetch(`${base}/api/config/config_entries/flow/${second.flow_id || first.flow_id}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      host: hub.ip,
      token: hub.token,
      ...(fs.existsSync(keyFile) ? { key: fs.readFileSync(keyFile, "utf8").trim() } : {}),
    }),
  });
  const entry = await created.json();
  if (entry.type === "create_entry" || entry.result === "success" || entry.title) {
    process.stdout.write("XiaomiGateway3 додано для Hub 2.\n");
    return;
  }
  process.stdout.write(`XiaomiGateway3 не завершив майстер: ${entry.reason || entry.errors?.base || entry.type || "невідомо"}\n`);
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
