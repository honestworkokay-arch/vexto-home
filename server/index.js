import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ecoflowStatus } from "./ecoflow.js";
import { dtekStatus } from "./dtek.js";
import { loadEnv, projectRoot } from "./env.js";
import { homeAssistantStatus } from "./homeassistant.js";

const root = projectRoot();
const env = loadEnv(path.join(root, ".env"));
if (env.DTEK_GROUP) process.env.DTEK_GROUP = env.DTEK_GROUP;
const port = Number(env.PORT || process.env.PORT || 4173);
const pythonBin = env.PYTHON_BIN || process.env.PYTHON_BIN || "/usr/bin/python3";
const panelPassword = env.PANEL_PASSWORD || process.env.PANEL_PASSWORD || "";
const passwordHash = panelPassword ? crypto.createHash("sha256").update(panelPassword).digest() : null;
const networkLabelsFile = path.join(root, ".network-labels.json");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(response, status, body, type) {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(body);
}

// Пароль проверяется до любого файла или API: домен даёт команды домашним устройствам.
function authorized(request) {
  if (!passwordHash) return false;
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon < 0 || decoded.slice(0, colon) !== "owner") return false;
    const candidate = crypto.createHash("sha256").update(decoded.slice(colon + 1)).digest();
    return crypto.timingSafeEqual(candidate, passwordHash);
  } catch {
    return false;
  }
}

function filePath(urlPath) {
  const requested = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath.split("?")[0]);
  const resolved = path.resolve(root, `.${requested}`);
  const relative = path.relative(root, resolved);
  if (
    !resolved.startsWith(root)
    || relative.startsWith("..")
    || relative.split(path.sep).some((part) => part.startsWith("."))
    || relative.startsWith(`server${path.sep}`)
    || relative.startsWith(`homeassistant${path.sep}`)
  ) return null;
  return resolved;
}

function runPython(script, args, stdin, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(pythonBin, [path.join(root, "server", script), ...args], { cwd: root });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: "Устройство не ответило вовремя." });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", () => {
      clearTimeout(timer);
      const line = output.trim().split("\n").filter((item) => item.startsWith("{")).pop();
      try {
        resolve(line ? JSON.parse(line) : { ok: false, error: "Не разобрал ответ устройства." });
      } catch {
        resolve({ ok: false, error: "Не разобрал ответ устройства." });
      }
    });
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8192) {
        reject(new Error("too big"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function xiaomiStatus() {
  return new Promise((resolve) => {
    const child = spawn(pythonBin, [path.join(root, "server", "xiaomi.py")], {
      cwd: root,
      env: {
        ...process.env,
        XIAOMI_USERNAME: env.XIAOMI_USERNAME || "",
        XIAOMI_PASSWORD: env.XIAOMI_PASSWORD || "",
        XIAOMI_SERVER: env.XIAOMI_SERVER || "de",
      },
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ configured: true, ok: false, reason: "Mi Home не ответил вовремя." });
    }, 30000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve({ configured: true, ok: false, reason: "Не разобрал ответ Mi Home." });
      }
    });
  });
}

async function handleRequest(request, response) {
  // Loopback остаётся доступен для локального планшета и Home Assistant.
  // Публичный туннель подключается только к отдельному защищённому порту.
  if (request.socket.localPort !== port && !authorized(request)) {
    response.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="Vexto Home", charset="UTF-8"',
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Требуется вход в панель.");
    return;
  }
  // Браузерные команды принимаются только со страницы этого же домена.
  if (request.method === "POST" && request.headers.origin) {
    try {
      if (new URL(request.headers.origin).host !== request.headers.host) {
        send(response, 403, "Чужой источник запроса.", "text/plain; charset=utf-8");
        return;
      }
    } catch {
      send(response, 403, "Неверный источник запроса.", "text/plain; charset=utf-8");
      return;
    }
  }
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/api/network" && request.method === "GET") {
    const status = await runPython("network_scan.py", [], "", 25000);
    send(response, status.ok ? 200 : 502, JSON.stringify(status), "application/json; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/network/label" && request.method === "POST") {
    try {
      const body = JSON.parse(await readBody(request));
      const key = String(body.key || "").toLowerCase();
      const name = String(body.name || "").trim();
      const person = String(body.person || "").trim();
      if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$|^ip:(?:\d{1,3}\.){3}\d{1,3}$/.test(key)
          || name.length > 60 || person.length > 60) throw new Error("Неверная метка.");
      const labels = fs.existsSync(networkLabelsFile)
        ? JSON.parse(fs.readFileSync(networkLabelsFile, "utf8")) : {};
      labels[key] = { name, person };
      const temp = `${networkLabelsFile}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(labels, null, 2), { mode: 0o600 });
      fs.renameSync(temp, networkLabelsFile);
      send(response, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
    } catch {
      send(response, 400, JSON.stringify({ ok: false, error: "Метка не сохранена." }), "application/json; charset=utf-8");
    }
    return;
  }
  if (url.pathname === "/api/xiaomi/status" && request.method === "GET") {
    const [status, ha] = await Promise.all([
      runPython("xiaomi_live.py", ["status"], "", 50000),
      homeAssistantStatus(),
    ]);
    if (ha.available) {
      // HA получает Zigbee и BLE через хаб; прямой miIO остаётся для розеток и робота.
      if (ha.thermometer.temperature !== null) {
        status.thermometer = { ...ha.thermometer, source: "hub", error: null };
      }
      if (ha.door.value !== null) status.door = { ...ha.door, source: "hub", error: null };
      status.motion = ha.motion.value === null
        ? { listed: true, value: null, battery: ha.motion.battery, error: "Хаб подключён, но датчик движения ещё не передал состояние." }
        : { ...ha.motion, listed: true, source: "hub", error: null };
      status.button = ha.button.action === null
        ? { listed: true, action: null, battery: ha.button.battery, error: "Кнопка ещё не передала нажатие." }
        : { ...ha.button, listed: true, source: "hub", error: null };
    }
    send(response, 200, JSON.stringify(status), "application/json; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/xiaomi/action" && request.method === "POST") {
    let raw = "";
    try {
      raw = await readBody(request);
    } catch {
      send(response, 400, JSON.stringify({ ok: false, error: "Не разобрал команду." }), "application/json; charset=utf-8");
      return;
    }
    const status = await runPython("xiaomi_live.py", ["action"], raw, 20000);
    send(response, 200, JSON.stringify(status), "application/json; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/xiaomi" && request.method === "GET") {
    const status = await xiaomiStatus();
    send(response, 200, JSON.stringify(status), "application/json; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/dtek") {
    try {
      const status = await dtekStatus();
      send(response, 200, JSON.stringify(status), "application/json; charset=utf-8");
    } catch (error) {
      send(response, 502, JSON.stringify({
        headline: "Графік ДТЕК зараз недоступний.",
        message: error instanceof Error ? error.message : "Помилка графіка.",
        mismatch: false,
        city_power: "unknown",
      }), "application/json; charset=utf-8");
    }
    return;
  }
  if (url.pathname === "/api/ecoflow") {
    const status = await ecoflowStatus({
      email: env.ECOFLOW_EMAIL || "",
      password: env.ECOFLOW_PASSWORD || "",
      accessKey: env.ECOFLOW_ACCESS_KEY || "",
      secretKey: env.ECOFLOW_SECRET_KEY || "",
      host: env.ECOFLOW_HOST || "https://api-e.ecoflow.com",
      sn: env.ECOFLOW_SN || "",
    });
    send(response, 200, JSON.stringify(status), "application/json; charset=utf-8");
    return;
  }

  const target = filePath(url.pathname);
  if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    send(response, 404, "Не найдено", "text/plain; charset=utf-8");
    return;
  }
  send(response, 200, fs.readFileSync(target), types[path.extname(target)] || "application/octet-stream");
}

const server = http.createServer(handleRequest);
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Vexto Дом: http://127.0.0.1:${port}\n`);
});

// Отдельный порт нужен, чтобы облачный туннель не обходил авторизацию через loopback.
if (passwordHash) {
  const publicPort = Number(env.PUBLIC_PORT || process.env.PUBLIC_PORT || 4174);
  if (publicPort === port) throw new Error("PUBLIC_PORT должен отличаться от PORT");
  const publicServer = http.createServer(handleRequest);
  publicServer.listen(publicPort, "127.0.0.1", () => {
    process.stdout.write(`Vexto Дом (с паролем): http://127.0.0.1:${publicPort}\n`);
  });
}
