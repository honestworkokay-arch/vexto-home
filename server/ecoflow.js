import crypto from "node:crypto";

const DEVICE_LIST = "/iot-open/sign/device/list";
const QUOTA_ALL = "/iot-open/sign/device/quota/all";

function nonce() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function processValue(prefix, value) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => processValue(`${prefix}[${index}]`, item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value).flatMap((key) => processValue(`${prefix}.${key}`, value[key]));
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [`${prefix}=${value}`];
  }
  return [];
}

function queryParams(parameters) {
  return Object.keys(parameters)
    .flatMap((key) => processValue(key, parameters[key]))
    .sort()
    .join("&");
}

function signature(parameters, accessKey, secretKey, requestNonce, timestamp) {
  const query = queryParams(parameters);
  const tail = `accessKey=${accessKey}&nonce=${requestNonce}&timestamp=${timestamp}`;
  const payload = query ? `${query}&${tail}` : tail;
  return crypto.createHmac("sha256", secretKey).update(payload).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function signedRequest(host, method, path, parameters, accessKey, secretKey) {
  const requestNonce = nonce();
  const timestamp = String(Date.now());
  const sign = signature(parameters, accessKey, secretKey, requestNonce, timestamp);
  const headers = {
    accessKey,
    nonce: requestNonce,
    timestamp,
    sign,
  };
  let url = `${host}${path}`;
  let body;
  if (method === "GET") {
    const query = queryParams(parameters);
    if (query) url = `${url}?${query}`;
  } else {
    body = stableJson(parameters);
    headers["Content-Type"] = "application/json;charset=UTF-8";
  }
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { message: text.slice(0, 180) };
  }
  if (!response.ok) {
    throw new Error(payload.message || `EcoFlow ответил ${response.status}`);
  }
  return payload;
}

function numberFrom(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function readStation(quota) {
  const data = quota?.data && typeof quota.data === "object" ? quota.data : {};
  return {
    soc: numberFrom(data, ["pd.soc", "bms_bmsStatus.soc", "soc"]),
    inputW: numberFrom(data, ["pd.wattsInSum", "inv.inputWatts", "mppt.inWatts"]),
    outputW: numberFrom(data, ["pd.wattsOutSum", "inv.outputWatts"]),
    remainMin: numberFrom(data, ["pd.remainTime", "bms_bmsStatus.remainTime"]),
    outputOn: numberFrom(data, ["inv.cfgAcEnabled", "mppt.cfgAcEnabled"]),
  };
}

function boundDevices(payload) {
  const bound = payload?.data?.bound;
  if (!bound || typeof bound !== "object") return [];
  return Object.entries(bound).map(([sn, info]) => ({ sn, ...(info && typeof info === "object" ? info : {}) }));
}

function deviceList(payload) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.device)) return data.device;
  if (Array.isArray(data?.devices)) return data.devices;
  return [];
}

function stationReading(station, quota) {
  const reading = readStation(quota);
  return {
    configured: true,
    ok: true,
    model: "DELTA 2",
    channel: "cloud",
    sn: String(station.sn),
    online: station.online === 1 || station.online === true || station.status === 1,
    soc: reading.soc,
    inputW: reading.inputW,
    outputW: reading.outputW,
    remainMin: reading.remainMin,
    outputOn: reading.outputOn == null ? null : reading.outputOn > 0,
  };
}

async function appRequest(host, token, path, parameters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) query.set(key, String(value));
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await fetch(`${host}${path}${suffix}`, {
    headers: {
      lang: "en_US",
      authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: String(response.status), message: text.slice(0, 160) };
  }
}

async function appLogin(host, email, password) {
  const response = await fetch(`${host}/auth/login`, {
    method: "POST",
    headers: { lang: "en_US", "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: Buffer.from(password).toString("base64"),
      scene: "IOT_APP",
      userType: "ECOFLOW",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const token = payload?.data?.token;
  const userId = payload?.data?.user?.userId;
  if (!token || !userId) {
    const message = payload?.message || "Вход в приложение EcoFlow не принят.";
    const error = new Error(message);
    error.code = payload?.code;
    throw error;
  }
  return { token, userId, host };
}

async function appStatus(config) {
  const hosts = [config.host || "https://api-e.ecoflow.com", "https://api.ecoflow.com"].filter(
    (host, index, list) => list.indexOf(host) === index,
  );
  let lastError = "Вход в приложение EcoFlow не принят.";
  for (const host of hosts) {
    try {
      const session = await appLogin(host, config.email, config.password);
      const list = await appRequest(session.host, session.token, "/iot-service/user/device");
      const devices = boundDevices(list);
      const station = devices.find((item) => item.sn === config.sn) || devices[0];
      if (!station?.sn) {
        return {
          configured: true,
          ok: false,
          model: "DELTA 2",
          channel: "cloud",
          reason: "Вход выполнен, но станция в аккаунте не найдена.",
        };
      }
      return {
        configured: true,
        ok: true,
        model: station.productType === 80 ? "DELTA 2" : "DELTA 2",
        channel: "cloud",
        sn: String(station.sn),
        online: station.online === 1 || station.online === true,
        soc: Number.isFinite(Number(station.soc)) ? Number(station.soc) : null,
        inputW: null,
        outputW: null,
        remainMin: null,
        outputOn: null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  return { configured: true, ok: false, model: "DELTA 2", channel: "cloud", reason: lastError };
}

export async function ecoflowStatus(config) {
  const model = "DELTA 2";
  if (config.email && config.password) return appStatus(config);
  if (!config.accessKey || !config.secretKey) {
    return {
      configured: false,
      ok: false,
      model,
      channel: "cloud",
      reason: "Кабинет разработчика не нужен. Для DELTA 2 достаточно почты и пароля приложения EcoFlow в файле .env.",
    };
  }

  const host = config.host || "https://api-e.ecoflow.com";
  try {
    const list = await signedRequest(host, "GET", DEVICE_LIST, {}, config.accessKey, config.secretKey);
    if (String(list.code ?? "0") !== "0") {
      return { configured: true, ok: false, model, channel: "cloud", reason: list.message || "Список станций отклонён." };
    }
    const devices = deviceList(list);
    const station = devices.find((item) => item.sn === config.sn) || devices[0];
    if (!station?.sn) {
      return { configured: true, ok: false, model, channel: "cloud", reason: "В аккаунте EcoFlow нет привязанной станции." };
    }
    const quota = await signedRequest(host, "POST", QUOTA_ALL, { sn: station.sn }, config.accessKey, config.secretKey);
    if (String(quota.code ?? "0") !== "0") {
      return {
        configured: true,
        ok: false,
        model,
        channel: "cloud",
        sn: String(station.sn),
        reason: quota.message || "Показания станции отклонены.",
      };
    }
    const reading = readStation(quota);
    return {
      configured: true,
      ok: true,
      model,
      channel: "cloud",
      sn: String(station.sn),
      online: station.online === 1 || station.online === true,
      soc: reading.soc,
      inputW: reading.inputW,
      outputW: reading.outputW,
      remainMin: reading.remainMin,
      outputOn: reading.outputOn == null ? null : reading.outputOn > 0,
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      model,
      channel: "cloud",
      reason: error instanceof Error ? error.message : "Облако EcoFlow недоступно.",
    };
  }
}
