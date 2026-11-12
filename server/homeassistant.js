import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "./env.js";

const base = "http://127.0.0.1:8123";
const ownerFile = path.join(projectRoot(), "homeassistant", ".ha-owner");
let accessToken = "";
let expiresAt = 0;

// Home Assistant даёт короткий токен. Пароль владельца остаётся только на этом Mac.
async function token() {
  if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;
  const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
  const clientId = `${base}/`;
  const started = await fetch(`${base}/auth/login_flow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, handler: ["homeassistant", null], redirect_uri: clientId }),
    signal: AbortSignal.timeout(5000),
  });
  if (!started.ok) throw new Error("Home Assistant не открыл вход.");
  const flow = await started.json();
  const completed = await fetch(`${base}/auth/login_flow/${flow.flow_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, username: owner.username, password: owner.password }),
    signal: AbortSignal.timeout(5000),
  });
  if (!completed.ok) throw new Error("Home Assistant не принял вход.");
  const code = (await completed.json()).result;
  if (typeof code !== "string") throw new Error("Home Assistant не выдал код входа.");
  const exchanged = await fetch(`${base}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId }),
    signal: AbortSignal.timeout(5000),
  });
  const response = await exchanged.json();
  if (!exchanged.ok || !response.access_token) throw new Error("Home Assistant не выдал токен.");
  accessToken = response.access_token;
  expiresAt = Date.now() + Number(response.expires_in || 1800) * 1000;
  return accessToken;
}

const IDS = {
  motion: "binary_sensor.0x00158d0008834325_motion",
  motionBattery: "sensor.0x00158d0008834325_battery",
  button: "sensor.0x00158d000895ab04_action",
  buttonBattery: "sensor.0x00158d000895ab04_battery",
  temperature: "sensor.a4c138e824ec_temperature",
  humidity: "sensor.a4c138e824ec_humidity",
  door: "binary_sensor.1850730537d3_contact",
  doorLight: "binary_sensor.1850730537d3_light",
};

function valid(entity) {
  return entity && !["unknown", "unavailable", "none", ""].includes(entity.state);
}

function number(entity, min, max) {
  if (!valid(entity)) return null;
  const value = Number(entity.state);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function boolean(entity) {
  if (!valid(entity)) return null;
  return entity.state === "on" ? true : entity.state === "off" ? false : null;
}

function age(entity) {
  if (!valid(entity)) return null;
  const timestamp = Date.parse(entity.last_updated || entity.last_changed || "");
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 1000)) : null;
}

export async function homeAssistantStatus() {
  if (!fs.existsSync(ownerFile)) return { available: false, error: "Home Assistant ещё не настроен." };
  try {
    const authorization = await token();
    const response = await fetch(`${base}/api/states`, {
      headers: { Authorization: `Bearer ${authorization}` },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error("Home Assistant не отдал состояния датчиков.");
    const states = new Map((await response.json()).map((item) => [item.entity_id, item]));
    const get = (key) => states.get(IDS[key]);
    const door = boolean(get("door"));
    return {
      available: true,
      motion: { value: boolean(get("motion")), battery: number(get("motionBattery"), 0, 100), age_s: age(get("motion")) },
      button: { action: valid(get("button")) ? get("button").state : null, battery: number(get("buttonBattery"), 0, 100), age_s: age(get("button")) },
      thermometer: { temperature: number(get("temperature"), -40, 80), humidity: number(get("humidity"), 0, 100), age_s: age(get("temperature")) },
      door: { value: door === null ? null : door ? "открыто" : "закрыто", light: boolean(get("doorLight")), age_s: age(get("door")) },
    };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : "Home Assistant недоступен." };
  }
}
