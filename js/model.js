// View-model for the web panel.
// Screens read this snapshot and call the actions below.
// `links` is the seam for later connectors: Xiaomi Home, EcoFlow, and the hub.
// This layout is the home monitor. An Android tablet will host it as the main screen.
// The iOS app is a later phone companion and does not reuse this desktop frame.

const VIEWS = [
  "overview",
  "lights",
  "climate",
  "devices",
  "energy",
  "vacuum",
  "sensors",
  "buttons",
  "cameras",
  "network",
  "watch",
  "links",
];

const SCENES = {
  dawn: {
    ceiling: { on: true, brightness: 30, kelvin: 2700 },
    floor: { on: false, brightness: 0, kelvin: 2700 },
    sconce: { on: false, brightness: 0, kelvin: 2700 },
    strip: { on: false, brightness: 0, kelvin: 2700 },
    bedside: { on: false, brightness: 0, kelvin: 2700 },
    counter: { on: false, brightness: 0, kelvin: 2700 },
    hood: { on: false, brightness: 0, kelvin: 2700 },
    desk: { on: false, brightness: 0, kelvin: 2700 },
  },
  work: {
    ceiling: { on: true, brightness: 100, kelvin: 4300 },
    floor: { on: false, brightness: 0, kelvin: 3800 },
    sconce: { on: true, brightness: 35, kelvin: 4000 },
    strip: { on: true, brightness: 70, kelvin: 4000 },
    bedside: { on: false, brightness: 0, kelvin: 3200 },
    counter: { on: true, brightness: 85, kelvin: 4000 },
    hood: { on: false, brightness: 0, kelvin: 4000 },
    desk: { on: true, brightness: 90, kelvin: 4200 },
  },
  cinema: {
    ceiling: { on: false, brightness: 0, kelvin: 2700 },
    floor: { on: true, brightness: 22, kelvin: 2700 },
    sconce: { on: true, brightness: 14, kelvin: 2700 },
    strip: { on: true, brightness: 28, kelvin: 2700 },
    bedside: { on: true, brightness: 12, kelvin: 2700 },
    counter: { on: false, brightness: 0, kelvin: 2700 },
    hood: { on: false, brightness: 0, kelvin: 2700 },
    desk: { on: false, brightness: 0, kelvin: 2700 },
  },
  night: {
    ceiling: { on: false, brightness: 0, kelvin: 2700 },
    floor: { on: false, brightness: 0, kelvin: 2700 },
    sconce: { on: false, brightness: 0, kelvin: 2700 },
    strip: { on: false, brightness: 0, kelvin: 2700 },
    bedside: { on: false, brightness: 0, kelvin: 2700 },
    counter: { on: false, brightness: 0, kelvin: 2700 },
    hood: { on: false, brightness: 0, kelvin: 2700 },
    desk: { on: false, brightness: 0, kelvin: 2700 },
  },
};

export const SCENE_LIST = [
  { id: "dawn", name: "Рассвет" },
  { id: "work", name: "Работа" },
  { id: "cinema", name: "Кино" },
  { id: "night", name: "Ночь" },
];

function series(seed, base, amplitude, count = 32) {
  const values = [];
  let value = seed;
  for (let index = 0; index < count; index += 1) {
    value = (value * 48271) % 2147483647;
    const noise = (value / 2147483647 - 0.5) * amplitude;
    const wave = Math.sin(index / 4.2) * amplitude * 0.65;
    values.push(Math.round((base + wave + noise) * 10) / 10);
  }
  return values;
}

function light(id, name, role, on, brightness, kelvin, hint = "") {
  return { id, name, role, on, brightness, kelvin, hint };
}

const voltageHistory = series(91, 228, 2.4);
voltageHistory[voltageHistory.length - 1] = 228.4;

export const state = {
  view: "overview",
  roomId: "living",
  cameraId: "hall",
  hubConnected: false,
  rooms: [
    {
      id: "living",
      name: "Гостиная",
      temp: 22.4,
      target: 22,
      mode: "auto",
      history: series(11, 22.2, 0.35),
      scene: null,
      lights: [
        light("ceiling", "Потолок", "ceiling", true, 72, 3400),
        light("floor", "Торшер", "floor", true, 48, 2700),
        light("sconce", "Бра", "sconce", false, 30, 2700),
        light("strip", "Лента", "strip", true, 36, 2700),
      ],
    },
    {
      id: "bed",
      name: "Спальня",
      temp: 20.8,
      target: 20,
      mode: "auto",
      history: series(21, 20.7, 0.28),
      scene: null,
      lights: [
        light("ceiling", "Потолок", "ceiling", false, 40, 3000),
        light("bed-l", "Слева", "bedside", true, 18, 2700, "Прикроватная"),
        light("bed-r", "Справа", "bedside", true, 18, 2700, "Прикроватная"),
      ],
    },
    {
      id: "kitchen",
      name: "Кухня",
      temp: 23.6,
      target: 22,
      mode: "auto",
      history: series(31, 23.3, 0.4),
      scene: null,
      lights: [
        light("ceiling", "Потолок", "ceiling", true, 70, 3800),
        light("counter", "Столешница", "counter", true, 55, 3500),
        light("hood", "Вытяжка", "hood", false, 40, 4000),
      ],
    },
    {
      id: "study",
      name: "Кабинет",
      temp: 21.5,
      target: 21.5,
      mode: "heat",
      history: series(41, 21.4, 0.3),
      scene: null,
      lights: [
        light("ceiling", "Потолок", "ceiling", true, 80, 4300),
        light("desk", "Стол", "desk", true, 90, 4200),
        light("sconce", "Бра", "sconce", false, 25, 3000),
      ],
    },
  ],
  devices: [
    { id: "plug-2", name: "Smart Plug 2 · 2", room: "Дом", socket: "192.168.0.219", watts: null, todayWh: null, on: null, protected: false, source: "xiaomi", model: "cuco.plug.v2eur", error: "", powerError: "", pending: false },
    { id: "plug-1", name: "Smart Plug 2", room: "Дом", socket: "192.168.0.146", watts: null, todayWh: null, on: null, protected: false, source: "xiaomi", model: "cuco.plug.v2eur", error: "", powerError: "", pending: false },
  ],
  sensors: [
    { id: "ht", kind: "Температура", name: "Датчик температуры и влажности", room: "Дом", value: "нет данных", ok: true, live: false, source: "xiaomi" },
    { id: "door", kind: "Открытие", name: "Датчик открытия окон и дверей", room: "Дом", value: "нет данных", ok: true, live: false, source: "xiaomi" },
    { id: "motion", kind: "Движение", name: "Датчик движения", room: "Дом", value: "нет данных", ok: true, live: false, source: "xiaomi" },
  ],
  buttons: [
    { id: "desk", name: "Стол", room: "Дом", gesture: "кнопка", command: "", action: "хаб не отдаёт нажатия", last: "нет событий", source: "xiaomi" },
  ],
  vacuum: {
    name: "Robot Vacuum S40",
    source: "xiaomi",
    mode: "unknown",
    label: "",
    error: "",
    pending: false,
    battery: null,
    rooms: [
      { id: "living", name: "Гостиная", selected: false },
      { id: "kitchen", name: "Кухня", selected: false },
      { id: "bed", name: "Спальня", selected: false },
      { id: "study", name: "Кабинет", selected: false },
    ],
  },
  ecoflow: {
    name: "DELTA 2",
    source: "ecoflow",
    soc: 76,
    inputW: 140,
    outputW: 90,
    outputOn: true,
    remainMin: 380,
    live: false,
    note: "Кабинет разработчика не нужен. Нужен пароль приложения EcoFlow в .env.",
  },
  xiaomi: {
    configured: false,
    ok: false,
    reason: "",
    devices: [],
  },
  links: [
    {
      id: "xiaomi-hub",
      name: "Xiaomi Smart Home Hub 2",
      short: "Hub 2",
      connected: false,
      owns: "Шлюз Zigbee. Розетки и робот отвечают по Wi-Fi сами.",
    },
    {
      id: "ecoflow",
      name: "EcoFlow",
      short: "EcoFlow",
      connected: false,
      owns: "DELTA 2 через облако EcoFlow",
    },
  ],
  cameras: [
    { id: "hall", name: "Прихожая", room: "Прихожая", online: true, quality: "1080p" },
    { id: "yard", name: "Двор", room: "Улица", online: true, quality: "1080p" },
    { id: "cabin", name: "Кабинет", room: "Кабинет", online: false, quality: "1080p" },
    { id: "kitchen", name: "Кухня", room: "Кухня", online: true, quality: "1080p" },
    { id: "living", name: "Гостиная", room: "Гостиная", online: true, quality: "1080p" },
  ],
  voltage: {
    volts: 228.4,
    phase: "L1",
    low: 210,
    high: 240,
    history: voltageHistory,
    measured: false,
  },
  network: {
    activeId: "home",
    list: [
      { id: "home", name: "Vexto-Home", band: "5 ГГц", channel: 36, security: "WPA3", level: 4 },
      { id: "iot", name: "Vexto-IoT", band: "2,4 ГГц", channel: 6, security: "WPA2", level: 3 },
      { id: "guest", name: "Vexto-Guest", band: "2,4 ГГц", channel: 6, security: "WPA2", level: 3 },
      { id: "neighbor", name: "MGTS-7741", band: "2,4 ГГц", channel: 11, security: "WPA2", level: 1 },
    ],
    clients: [
      { name: "Телефон", detail: "Мария", rssi: -48 },
      { name: "Ноутбук", detail: "Кабинет", rssi: -55 },
      { name: "Камеры", detail: "3 в эфире", rssi: -61 },
      { name: "Колонка", detail: "Гостиная", rssi: -52 },
    ],
  },
  watch: {
    armed: true,
    away: false,
    guardGrid: true,
    killForgotten: true,
    filter: "all",
    selectedId: "heater",
    incidents: [],
  },
};

export function currentRoom() {
  return state.rooms.find((room) => room.id === state.roomId) ?? state.rooms[0];
}

export function roomLevel(room) {
  const active = room.lights.filter((item) => item.on);
  if (active.length === 0) return 0;
  return Math.round(active.reduce((sum, item) => sum + item.brightness, 0) / active.length);
}

export function roomKelvin(room) {
  const active = room.lights.filter((item) => item.on);
  const source = active.length > 0 ? active : room.lights;
  return Math.round(source.reduce((sum, item) => sum + item.kelvin, 0) / source.length);
}

export function activeLoad() {
  return state.devices.reduce((sum, device) => sum + (Number.isFinite(device.watts) && device.on ? device.watts : 0), 0);
}

export function activeNetwork() {
  return state.network.list.find((item) => item.id === state.network.activeId) ?? state.network.list[0];
}

export function activeCamera() {
  return state.cameras.find((camera) => camera.id === state.cameraId) ?? state.cameras[0];
}

export function voltageSafe() {
  return state.voltage.volts >= state.voltage.low && state.voltage.volts <= state.voltage.high;
}

export function num(value, digits = 1) {
  return value.toFixed(digits).replace(".", ",");
}

export function formatPower(watts) {
  if (!Number.isFinite(watts)) return "—";
  if (watts >= 1000) {
    const value = Math.round(watts / 10) / 100;
    return `${String(value).replace(".", ",")} кВт`;
  }
  const rounded = Math.round(watts * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
  return `${text} Вт`;
}

export function formatEnergy(wh) {
  if (!Number.isFinite(wh)) return "—";
  if (wh >= 1000) {
    const value = Math.round(wh / 10) / 100;
    return `${String(value).replace(".", ",")} кВт·ч`;
  }
  return `${wh} Вт·ч`;
}

export function todayWh() {
  return state.devices.reduce((sum, device) => sum + device.todayWh, 0);
}

export function sensorAlerts() {
  return state.sensors.filter((sensor) => !sensor.ok).length;
}

export function vacuumLabel() {
  if (state.vacuum.label) return state.vacuum.label;
  if (state.vacuum.mode === "clean") return "Убирает";
  if (state.vacuum.mode === "pause") return "Пауза";
  if (state.vacuum.mode === "dock") return "На базе";
  if (state.vacuum.mode === "returning") return "Едет на базу";
  return "Нет статуса";
}

export function vacuumRoomsLabel() {
  const picked = state.vacuum.rooms.filter((room) => room.selected).map((room) => room.name);
  if (picked.length === 0) return "Комнаты не выбраны";
  return picked.join(", ");
}

export function ledeCopy() {
  if (state.ecoflow.live && Number.isFinite(state.ecoflow.soc)) {
    const charge = String(Math.round(state.ecoflow.soc)).replace(".", ",");
    return {
      title: `${charge}%`,
      sub: "DELTA 2 в сети. Розетки и робот читаются со своих адресов.",
    };
  }
  const room = currentRoom();
  const base = `${room.name} ${num(room.temp)}° · свет ${roomLevel(room)}%`;
  if (!state.watch.armed) {
    return {
      title: "Дозор снят.",
      sub: `${base}. События на месте, новые пока не разбираются.`,
    };
  }
  if (state.watch.away) {
    const lightsOn = room.lights.some((item) => item.on);
    const forgotten = state.watch.killForgotten && (lightsOn || state.devices.some((device) => device.on && !device.protected && device.watts >= 500));
    return {
      title: "Никого нет.",
      sub: forgotten ? `${base}. Дозор видит оставленный контур.` : `${base}. Дом на охране.`,
    };
  }
  const open = state.watch.incidents.filter((incident) => incident.status === "open");
  const critical = open.find((incident) => incident.severity === "critical");
  if (critical) {
    return { title: "Нужно внимание.", sub: `${base}. ${critical.title}.` };
  }
  const attention = open.find((incident) => incident.severity === "attention");
  if (attention) {
    return { title: "Дом спокоен.", sub: `${base}. Есть внимание — ${attention.title.toLowerCase()}.` };
  }
  if (open.some((incident) => incident.severity === "quiet")) {
    return { title: "Дом спокоен.", sub: `${base}. В Дозоре есть тихое событие.` };
  }
  return { title: "Дом спокоен.", sub: `${base}. Открытых событий нет.` };
}

function roomById(roomId) {
  return state.rooms.find((room) => room.id === roomId);
}

export const actions = {
  setView(view) {
    if (!VIEWS.includes(view)) return;
    state.view = view;
  },
  setRoom(roomId) {
    if (!roomById(roomId)) return;
    state.roomId = roomId;
  },
  toggleLight(roomId, lightId) {
    const room = roomById(roomId);
    const lamp = room?.lights.find((item) => item.id === lightId);
    if (!lamp) return;
    room.scene = null;
    lamp.on = !lamp.on;
    if (lamp.on && lamp.brightness === 0) lamp.brightness = 40;
  },
  setLevel(roomId, level) {
    const room = roomById(roomId);
    if (!room) return;
    const next = Math.max(0, Math.min(100, Math.round(level)));
    room.scene = null;
    if (next === 0) {
      room.lights.forEach((lamp) => {
        lamp.on = false;
      });
      return;
    }
    const active = room.lights.filter((lamp) => lamp.on);
    const targets = active.length > 0 ? active : room.lights;
    targets.forEach((lamp) => {
      lamp.on = true;
      lamp.brightness = next;
    });
  },
  setKelvin(roomId, kelvin) {
    const room = roomById(roomId);
    if (!room) return;
    const next = Math.max(2700, Math.min(5000, Math.round(kelvin)));
    room.scene = null;
    room.lights.forEach((lamp) => {
      lamp.kelvin = next;
    });
  },
  setLampBrightness(roomId, lightId, brightness) {
    const room = roomById(roomId);
    const lamp = room?.lights.find((item) => item.id === lightId);
    if (!lamp) return;
    const next = Math.max(0, Math.min(100, Math.round(brightness)));
    room.scene = null;
    lamp.brightness = next;
    lamp.on = next > 0;
  },
  applyScene(roomId, sceneId) {
    const room = roomById(roomId);
    const scene = SCENES[sceneId];
    if (!room || !scene) return;
    room.scene = sceneId;
    room.lights.forEach((lamp) => {
      const preset = scene[lamp.role];
      if (!preset) return;
      lamp.on = preset.on;
      lamp.brightness = preset.brightness;
      lamp.kelvin = preset.kelvin;
    });
  },
  stepTarget(roomId, direction) {
    const room = roomById(roomId);
    if (!room) return;
    const next = Math.round((room.target + direction * 0.5) * 10) / 10;
    room.target = Math.min(28, Math.max(16, next));
  },
  setMode(roomId, mode) {
    const room = roomById(roomId);
    if (!room || !["auto", "heat", "off"].includes(mode)) return;
    room.mode = mode;
  },
  toggleDevice(deviceId) {
    const device = state.devices.find((item) => item.id === deviceId);
    if (!device || device.protected || device.source === "xiaomi") return;
    device.on = !device.on;
    if (!device.on) {
      state.watch.incidents.forEach((incident) => {
        if (incident.deviceId === deviceId && incident.status === "open") {
          incident.status = "closed";
        }
      });
    }
  },
  setCamera(cameraId) {
    if (!state.cameras.some((camera) => camera.id === cameraId)) return;
    state.cameraId = cameraId;
  },
  selectNetwork(networkId) {
    if (!state.network.list.some((item) => item.id === networkId)) return;
    state.network.activeId = networkId;
  },
  toggleArmed() {
    state.watch.armed = !state.watch.armed;
  },
  setAway(away) {
    state.watch.away = away;
  },
  toggleRule(rule) {
    if (rule !== "guardGrid" && rule !== "killForgotten") return;
    state.watch[rule] = !state.watch[rule];
  },
  selectIncident(incidentId) {
    if (!state.watch.incidents.some((incident) => incident.id === incidentId)) return;
    state.watch.selectedId = incidentId;
  },
  setFilter(filter) {
    if (!["all", "wake", "morning", "quiet"].includes(filter)) return;
    state.watch.filter = filter;
  },
  setVacuum(mode) {
    if (!["clean", "pause", "dock"].includes(mode) || state.vacuum.source === "xiaomi") return;
    if (mode === "clean" && !state.vacuum.rooms.some((room) => room.selected)) {
      state.vacuum.rooms.forEach((room) => {
        room.selected = true;
      });
    }
    state.vacuum.mode = mode;
  },
  toggleVacuumRoom(roomId) {
    const room = state.vacuum.rooms.find((item) => item.id === roomId);
    if (!room) return;
    room.selected = !room.selected;
  },
  pressButton(buttonId) {
    const button = state.buttons.find((item) => item.id === buttonId);
    if (!button) return;
    button.last = "только что";
    if (button.command === "scene-night") {
      state.rooms.forEach((room) => actions.applyScene(room.id, "night"));
    }
    if (button.command === "vacuum-dock") state.vacuum.mode = "dock";
    if (button.command === "socket-kettle") {
      const kettle = state.devices.find((device) => device.id === "kettle");
      if (kettle && !kettle.protected) kettle.on = !kettle.on;
    }
  },
  toggleEcoOutput() {
    state.ecoflow.outputOn = !state.ecoflow.outputOn;
  },
};
