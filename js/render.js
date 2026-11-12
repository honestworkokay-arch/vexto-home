import {
  SCENE_LIST,
  actions,
  activeCamera,
  activeLoad,
  activeNetwork,
  currentRoom,
  formatEnergy,
  formatPower,
  ledeCopy,
  num,
  roomKelvin,
  roomLevel,
  state,
  voltageSafe,
} from "./model.js";
import { mountCameras, stopCameras } from "./cameras.js";
import { buttonsPage, energyPage, linksPage, overviewStrip, sensorsPage, vacuumPage } from "./places.js";

const TITLES = {
  overview: "Обзор",
  lights: "Свет",
  climate: "Климат",
  devices: "Розетки",
  energy: "Энергия",
  vacuum: "Робот",
  sensors: "Датчики",
  buttons: "Кнопки",
  cameras: "Камеры",
  network: "Сеть",
  watch: "Дозор",
  links: "Связь",
};

const NAV = [
  ["overview", "00", "Обзор"],
  ["lights", "01", "Свет"],
  ["climate", "02", "Климат"],
  ["devices", "03", "Розетки"],
  ["energy", "04", "Энергия"],
  ["vacuum", "05", "Робот"],
  ["sensors", "06", "Датчики"],
  ["buttons", "07", "Кнопки"],
  ["cameras", "08", "Камеры"],
  ["network", "09", "Сеть"],
  ["watch", "10", "Дозор"],
];

const MODES = [
  ["auto", "Авто"],
  ["heat", "Нагрев"],
  ["off", "Выкл"],
];

const FILTERS = [
  ["all", "Все"],
  ["wake", "Будить"],
  ["morning", "До утра"],
  ["quiet", "Тихие"],
];

const SEVERITY = {
  critical: "Критично",
  attention: "Внимание",
  quiet: "Тихо",
};

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));
}

function clockText(date = new Date()) {
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function dateText(date = new Date()) {
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
}

function glowColor(room) {
  const level = roomLevel(room);
  const kelvin = roomKelvin(room);
  const mix = Math.min(1, Math.max(0, (kelvin - 2700) / 2300));
  const hue = 36 - mix * 28;
  const alpha = 0.08 + (level / 100) * 0.7;
  return `hsla(${hue}, 78%, 68%, ${alpha})`;
}

function bars(level) {
  return `<span class="bars" data-level="${level}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
}

function switchControl({ on, label, action, extra = "", disabled = false }) {
  return `<button type="button" class="switch${on ? " is-on" : ""}" role="switch" aria-checked="${on ? "true" : "false"}" aria-label="${esc(label)}" ${disabled ? "disabled" : ""} ${disabled ? "" : `data-action="${action}"`} ${extra}>
    <span></span>
  </button>`;
}

function cardHead(index, label, note, view) {
  const open = view
    ? `<button type="button" class="text-btn" data-action="view" data-view="${view}">Открыть</button>`
    : "";
  return `<div class="card-head">
    <div class="kicker"><i></i><span>${index}</span> ${label}</div>
    <div class="card-tools">${note ? `<span class="aside-note">${note}</span>` : ""}${open}</div>
  </div>`;
}

function spark(values) {
  const width = 280;
  const height = 52;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * (width - 4) + 2;
    const y = height - ((value - min) / span) * (height - 10) - 5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [cx, cy] = points[points.length - 1].split(",");
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    <polyline points="${points.join(" ")}" />
    <circle cx="${cx}" cy="${cy}" r="2.4" />
  </svg>`;
}

function band(volts) {
  const left = ((volts - 200) / 50) * 100;
  const safeLeft = ((210 - 200) / 50) * 100;
  const safeWidth = ((240 - 210) / 50) * 100;
  return `<div class="band" aria-hidden="true">
    <div class="band-safe" style="left:${safeLeft}%;width:${safeWidth}%"></div>
    <div class="band-mark${voltageSafe() ? "" : " is-out"}" style="left:${left}%"></div>
  </div>
  <div class="band-scale"><span>200</span><span>210</span><span>240</span><span>250</span></div>`;
}

function slider(label, readout, input) {
  return `<div class="slider">
    <div class="slider-top"><span>${label}</span><span>${readout}</span></div>
    ${input}
  </div>`;
}

function lightBody(room, titled = true) {
  const level = roomLevel(room);
  const kelvin = Math.round(roomKelvin(room) / 50) * 50;
  const forgotten = state.watch.away && state.watch.killForgotten && room.lights.some((lamp) => lamp.on);
  const lamps = room.lights.map((lamp) => `<div class="lamp">
      <div>
        <p class="lamp-name"><i class="lamp-dot${lamp.on ? " is-on" : ""}"></i>${esc(lamp.name)}</p>
        ${lamp.hint ? `<p class="lamp-hint">${esc(lamp.hint)}</p>` : ""}
      </div>
      <input class="range-level" type="range" min="0" max="100" value="${lamp.brightness}" data-slider="lamp" data-light="${lamp.id}" aria-label="${esc(lamp.name)}, яркость" />
      <span class="lamp-read" data-lamp-readout>${lamp.brightness}%</span>
      ${switchControl({
        on: lamp.on,
        label: lamp.name,
        action: "light",
        extra: `data-light="${lamp.id}"`,
      })}
    </div>`).join("");

  return `<div class="light-body">
      <div>
        <div class="light-title">
          <h2 class="${titled ? "" : "is-quiet"}">${titled ? esc(room.name) : "Уровень"}</h2>
          <div class="metric"><b data-readout="level">${level}</b><small>%</small></div>
        </div>
        <div class="glow" style="--glow:${glowColor(room)}"></div>
        ${slider(
          "Яркость",
          `<span data-readout="level-label">${level}%</span>`,
          `<input class="range-level" type="range" min="0" max="100" value="${level}" data-slider="level" aria-label="Яркость комнаты" />`,
        )}
        ${slider(
          "Тепло",
          `<span data-readout="kelvin">${kelvin} K</span>`,
          `<input class="range-kelvin" type="range" min="2700" max="5000" step="50" value="${kelvin}" data-slider="kelvin" aria-label="Тепло света" />`,
        )}
        <p class="field-label">Сцены</p>
        <div class="seg">
          ${SCENE_LIST.map((scene) => `<button type="button" class="${room.scene === scene.id ? "is-on" : ""}" data-action="scene" data-scene="${scene.id}">${scene.name}</button>`).join("")}
        </div>
        ${forgotten ? `<p class="hint"><i></i>В режиме «Никого нет» свет ещё включён.</p>` : ""}
      </div>
      <div>
        <p class="field-label">Лампы</p>
        <div class="lamps">${lamps}</div>
      </div>
    </div>`;
}

function climateBody(room, detailed) {
  const others = state.rooms.map((item) => `<button type="button" class="room-temp${item.id === room.id ? " is-on" : ""}" data-action="room" data-room="${item.id}">
      <span>${esc(item.name)}</span><b>${num(item.temp)}°</b>
    </button>`).join("");
  return `<div class="climate-top">
      <div>
        <div class="metric"><b>${num(room.temp)}</b><small>°</small></div>
        <p class="quiet">${room.mode === "off" ? "Нагрев выключен, датчик работает" : `Цель ${num(room.target)}°`}</p>
      </div>
      <div class="stepper" aria-label="Целевая температура">
        <button type="button" data-action="temp" data-dir="-1" aria-label="Холоднее">−</button>
        <b>${num(room.target)}°</b>
        <button type="button" data-action="temp" data-dir="1" aria-label="Теплее">+</button>
      </div>
    </div>
    <div class="seg">
      ${MODES.map(([id, name]) => `<button type="button" class="${room.mode === id ? "is-on" : ""}" data-action="mode" data-mode="${id}">${name}</button>`).join("")}
    </div>
    ${spark(room.history)}
    ${detailed ? `<div class="room-temps">${others}</div>` : ""}`;
}

function voltageBody() {
  if (!state.voltage.measured) {
    return `<div class="metric"><b>—</b></div>
      <p class="quiet">Напряжение сети не измерено. Счётчика на хабе нет.</p>`;
  }
  const safe = voltageSafe();
  return `<div class="metric"><b>${num(state.voltage.volts)}</b><small>В</small></div>
    <p class="status ${safe ? "is-ok" : "is-bad"}">${safe ? "В норме" : "Вне полосы"} · фаза ${state.voltage.phase}</p>
    ${band(state.voltage.volts)}
    ${spark(state.voltage.history)}
    <p class="quiet">Рабочая полоса ${state.voltage.low}–${state.voltage.high} В</p>`;
}

function deviceState(device) {
  if (device.pending) return "команда…";
  if (device.error) return device.error;
  if (device.on == null) return "нет статуса";
  return device.on ? "включён" : "выключен";
}

function devicePower(device) {
  return device.powerError ? "—" : formatPower(device.watts);
}

function deviceDetail(device) {
  const base = device.socket || device.room;
  return device.powerError ? `${base} · ${device.powerError}` : base;
}

function deviceTile(device) {
  return `<article class="device${device.on === false ? " is-off" : ""}">
    <div class="device-top">
      <div>
        <strong>${esc(device.name)}</strong>
        <p>${esc(deviceDetail(device))}</p>
      </div>
      ${switchControl({
        on: Boolean(device.on),
        label: device.name,
        action: "device",
        extra: `data-device="${device.id}"`,
        disabled: device.protected || device.on == null || device.pending,
      })}
    </div>
    <div class="device-foot">
      <span>${devicePower(device)}</span>
      <em>${esc(deviceState(device))}</em>
    </div>
  </article>`;
}

function deviceLine(device) {
  return `<div class="device-line${device.on === false ? " is-off" : ""}">
    <div>
      <strong>${esc(device.name)}</strong>
      <p>${esc(device.socket)} · ${esc(device.model || device.room)}${device.powerError ? ` · ${esc(device.powerError)}` : ""}</p>
    </div>
    <span>${devicePower(device)}</span>
    <em>${esc(deviceState(device))}</em>
    ${switchControl({
      on: Boolean(device.on),
      label: device.name,
      action: "device",
      extra: `data-device="${device.id}"`,
      disabled: device.protected || device.on == null || device.pending,
    })}
  </div>`;
}

function viewport(camera, large) {
  if (!camera.online) {
    return `<div class="viewport${large ? " is-large" : ""} is-offline">
      <div class="offline"><b>Нет сигнала</b><span>${esc(camera.name)}</span></div>
    </div>`;
  }
  return `<div class="viewport${large ? " is-large" : ""}">
    <canvas data-feed="${esc(camera.id)}"></canvas>
    <div class="hud">
      <div class="hud-top"><span class="rec"><i></i>LIVE</span><span data-clock>${clockText()}</span></div>
      <div class="hud-bottom"><span>${esc(camera.name)}</span><span>${esc(camera.quality)}</span></div>
    </div>
  </div>`;
}

function camerasOverview() {
  const current = activeCamera();
  const thumbs = state.cameras.filter((camera) => camera.id !== current.id).slice(0, 3);
  return `<div class="cam-layout">
    ${viewport(current, false)}
    <div class="thumbs">
      ${thumbs.map((camera) => `<button type="button" class="thumb" data-action="camera" data-camera="${camera.id}" aria-label="${esc(camera.name)}">
        ${camera.online ? `<canvas data-feed="${camera.id}"></canvas>` : `<span class="thumb-off">Нет сигнала</span>`}
        <em>${esc(camera.name)}</em>
      </button>`).join("")}
    </div>
  </div>`;
}

function networkBody(detailed) {
  const current = activeNetwork();
  const rows = state.network.list.map((item) => `<button type="button" class="net-row${item.id === current.id ? " is-on" : ""}" data-action="network" data-network="${item.id}">
      <span><strong>${esc(item.name)}</strong><small>${esc(item.band)} · ${esc(item.security)}</small></span>
      ${bars(item.level)}
      <em>${item.id === current.id ? "текущая" : `ур. ${item.level}`}</em>
    </button>`).join("");
  return `<div class="net-hero">
      <div>
        <h2>${esc(current.name)}</h2>
        <p>${esc(current.band)} · канал ${current.channel} · ${esc(current.security)}</p>
      </div>
      ${bars(current.level)}
    </div>
    <div class="net-list">${rows}</div>
    ${detailed ? "" : `<p class="quiet">${state.network.clients.length} устройства в сети</p>`}`;
}

function clientsBlock() {
  const items = state.network.clients.map((client) => `<li>
      <span>${esc(client.name)}</span>
      <span>${esc(client.detail)}</span>
      <b>${client.rssi} дБм</b>
    </li>`).join("");
  return `<ul class="clients">${items}</ul>`;
}

function visibleIncidents() {
  return state.watch.incidents.filter((incident) => {
    if (state.watch.filter === "wake") return incident.severity === "critical";
    if (state.watch.filter === "morning") return incident.severity === "attention";
    if (state.watch.filter === "quiet") return incident.severity === "quiet";
    return true;
  });
}

function logRows(incidents, selectedId) {
  if (incidents.length === 0) {
    return `<p class="empty">Событий с хаба ещё нет.</p>`;
  }
  return `<div class="log">${incidents.map((incident) => `<button type="button" class="log-row sev-${incident.severity}${incident.id === selectedId ? " is-on" : ""}${incident.status === "closed" ? " is-closed" : ""}" data-action="incident" data-incident="${incident.id}">
      <span class="sev">${SEVERITY[incident.severity]}</span>
      <span class="time">${esc(incident.time)}</span>
      <strong>${esc(incident.title)}</strong>
      <span class="detail">${esc(incident.detail)}</span>
      <em>${incident.status === "open" ? "Открыто" : "Закрыто"}</em>
    </button>`).join("")}</div>`;
}

function watchRules() {
  return `<div class="presence">
      <button type="button" class="${state.watch.away ? "" : "is-on"}" data-action="away" data-away="0">Я дома</button>
      <button type="button" class="${state.watch.away ? "is-on" : ""}" data-action="away" data-away="1">Никого нет</button>
    </div>
    <div class="rule">
      <div>
        <strong>На охране</strong>
        <p>${state.watch.armed ? "Дозор решает, какие события будят." : "Журнал открыт, новые события не разбираются."}</p>
      </div>
      ${switchControl({ on: state.watch.armed, label: "На охране", action: "arm" })}
    </div>
    <div class="rule">
      <div>
        <strong>Беречь сеть</strong>
        <p>Если напряжение выйдет за ${state.voltage.low}–${state.voltage.high} В, тяжёлые приборы снимаются. Холодильник и камеры остаются.</p>
      </div>
      ${switchControl({ on: state.watch.guardGrid, label: "Беречь сеть", action: "rule", extra: 'data-rule="guardGrid"' })}
    </div>
    <div class="rule">
      <div>
        <strong>Гасить забытое</strong>
        <p>В режиме «Никого нет» Дозор отмечает свет и мощные приборы, которые остались включены.</p>
      </div>
      ${switchControl({ on: state.watch.killForgotten, label: "Гасить забытое", action: "rule", extra: 'data-rule="killForgotten"' })}
    </div>`;
}

function incidentDetail(incident) {
  if (!incident) return `<p class="empty">Выберите событие в журнале.</p>`;
  return `<p class="sev sev-${incident.severity}">${SEVERITY[incident.severity]} · ${incident.wake}</p>
    <h2>${esc(incident.title)}</h2>
    <p class="lead">${esc(incident.detail)}</p>
    <dl class="facts">
      <div><dt>Время</dt><dd>${esc(incident.time)}</dd></div>
      <div><dt>Статус</dt><dd>${incident.status === "open" ? "Открыто" : "Закрыто"}</dd></div>
      <div><dt>Дальше</dt><dd>${esc(incident.next)}</dd></div>
    </dl>`;
}

function overview() {
  const room = currentRoom();
  const copy = ledeCopy();
  const load = activeLoad();
  return `<div class="overview">
    <header class="lede">
      <div class="kicker"><i></i><span>00</span> Обзор <em>${dateText()}</em></div>
      <h1>${esc(copy.title)}</h1>
      <p>${esc(copy.sub)}</p>
    </header>
    ${overviewStrip()}
    <article class="card light">
      ${cardHead("01", "Свет", "", "lights")}
      ${lightBody(room)}
    </article>
    <div class="stack">
      <article class="card">
        ${cardHead("02", "Климат", "макет", "climate")}
        ${climateBody(room, false)}
      </article>
      <article class="card voltage">
        ${cardHead("03", "Напряжение", "", "energy")}
        ${voltageBody()}
      </article>
    </div>
    <article class="card devices">
      ${cardHead("03", "Розетки", state.devices.some((device) => device.on != null) ? "с розетки" : "нет ответа", "devices")}
      <div class="device-row">${state.devices.map(deviceTile).join("")}</div>
    </article>
    <article class="card cameras">
      ${cardHead("05", "Камеры", "макет", "cameras")}
      ${camerasOverview()}
    </article>
    <article class="card network">
      ${cardHead("06", "Сеть", "", "network")}
      ${networkBody(false)}
    </article>
    <article class="card watch">
      ${cardHead("07", "Дозор", state.watch.armed ? "на охране" : "снят", "watch")}
      ${logRows(state.watch.incidents, state.watch.selectedId)}
    </article>
  </div>`;
}

function lightsPage() {
  const room = currentRoom();
  return `<div class="page page-lights">
    <header class="lede">
      <div class="kicker"><i></i><span>01</span> Свет</div>
      <h1>${esc(room.name)}</h1>
      <p>Уровень, тепло и лампы этой комнаты. Сцена задаёт их вместе.</p>
    </header>
    <article class="card light">${lightBody(room, false)}</article>
  </div>`;
}

function climatePage() {
  const room = currentRoom();
  return `<div class="page page-climate">
    <header class="lede">
      <div class="kicker"><i></i><span>02</span> Климат</div>
      <h1>${esc(room.name)}</h1>
      <p>Цель и режим можно крутить. Градусы на экране не с датчика.</p>
    </header>
    <article class="card">${climateBody(room, true)}</article>
  </div>`;
}

function devicesPage() {
  return `<div class="page page-devices">
    <header class="lede">
      <div class="kicker"><i></i><span>03</span> Розетки</div>
      <h1>Розетки</h1>
      <p>Включение и мощность читаются с розетки. Если чтения нет, здесь ошибка.</p>
    </header>
    <article class="card">
      <div class="lines">${state.devices.map(deviceLine).join("")}</div>
    </article>
  </div>`;
}

function camerasPage() {
  const current = activeCamera();
  const list = state.cameras.map((camera) => `<button type="button" class="cam-item${camera.id === current.id ? " is-on" : ""}" data-action="camera" data-camera="${camera.id}">
      <i class="${camera.online ? "is-on" : ""}"></i>
      <span><strong>${esc(camera.name)}</strong><small>${camera.online ? "В эфире" : "Нет сигнала"}</small></span>
    </button>`).join("");
  return `<div class="page page-cameras">
    <header class="lede">
      <div class="kicker"><i></i><span>08</span> Камеры</div>
      <h1>${esc(current.name)}</h1>
      <p>${current.online ? "Живой кадр выбранной камеры." : "У этой камеры нет сигнала."}</p>
    </header>
    <div class="cam-page">
      <div class="cam-list">${list}</div>
      ${viewport(current, true)}
      <article class="card cam-meta">
        <p class="field-label">Кадр</p>
        <dl class="facts">
          <div><dt>Статус</dt><dd>${current.online ? "В эфире" : "Нет сигнала"}</dd></div>
          <div><dt>Комната</dt><dd>${esc(current.room)}</dd></div>
          <div><dt>Качество</dt><dd>${esc(current.quality)}</dd></div>
          <div><dt>Канал</dt><dd>${current.online ? "Wi-Fi" : "—"}</dd></div>
        </dl>
      </article>
    </div>
  </div>`;
}

function networkPage() {
  const network = activeNetwork();
  return `<div class="page page-network">
    <header class="lede">
      <div class="kicker"><i></i><span>09</span> Сеть</div>
      <h1>${esc(network.name)}</h1>
      <p>${esc(network.band)} · канал ${network.channel} · ${esc(network.security)}. Напряжение смотрится в энергии.</p>
    </header>
    <article class="card">${networkBody(true)}</article>
    <article class="card clients-card">
      ${cardHead("09", "В сети", `${state.network.clients.length}`, "")}
      ${clientsBlock()}
    </article>
  </div>`;
}

function watchPage() {
  const visible = visibleIncidents();
  const selected = visible.find((incident) => incident.id === state.watch.selectedId) ?? null;
  return `<div class="page page-watch">
    <header class="lede">
      <div class="kicker"><i></i><span>10</span> Дозор</div>
      <h1>${state.watch.armed ? "На охране." : "Снят."}</h1>
      <p>Дозор делит события на те, что будят, те, что ждут утра, и тихие.</p>
    </header>
    <div class="split">
      <article class="card">${watchRules()}</article>
      <article class="card incident">${incidentDetail(selected)}</article>
    </div>
    <article class="card">
      <div class="card-head">
        <div class="kicker"><i></i><span>07</span> Журнал</div>
        <div class="seg seg-sm">
          ${FILTERS.map(([id, name]) => `<button type="button" class="${state.watch.filter === id ? "is-on" : ""}" data-action="filter" data-filter="${id}">${name}</button>`).join("")}
        </div>
      </div>
      ${logRows(visible, selected?.id ?? "")}
    </article>
  </div>`;
}

function stage() {
  switch (state.view) {
    case "overview":
      return overview();
    case "lights":
      return lightsPage();
    case "climate":
      return climatePage();
    case "devices":
      return devicesPage();
    case "energy":
      return energyPage();
    case "vacuum":
      return vacuumPage();
    case "sensors":
      return sensorsPage();
    case "buttons":
      return buttonsPage();
    case "cameras":
      return camerasPage();
    case "network":
      return networkPage();
    case "watch":
      return watchPage();
    case "links":
      return linksPage();
    default:
      return overview();
  }
}

function rail() {
  return `<div class="brand">
      <div class="brand-mark" aria-hidden="true"><span></span></div>
      <div><strong>VEXTO</strong><em>Дом</em></div>
    </div>
    <nav class="nav" aria-label="Разделы">
      ${NAV.map(([view, index, label]) => `<button type="button" class="${state.view === view ? "is-on" : ""}" data-action="view" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ""}>
        <em>${index}</em><span>${label}</span>
      </button>`).join("")}
    </nav>
    <button type="button" class="hub" data-action="view" data-view="links">
      <span class="hub-dot${state.links.some((link) => link.id === "xiaomi-hub" && link.connected) ? " is-on" : ""}"></span>
      <div><strong>Hub 2</strong><em>${state.links.some((link) => link.id === "xiaomi-hub" && link.connected) ? "на связи" : "не подключён"}</em></div>
    </button>`;
}

function top() {
  const room = currentRoom();
  const network = activeNetwork();
  const rooms = state.rooms.map((item) => `<button type="button" class="${item.id === room.id ? "is-on" : ""}" data-action="room" data-room="${item.id}">${esc(item.name)}</button>`).join("");
  return `<div class="clock" data-clock>${clockText()}</div>
    <div class="rooms" aria-label="Комната">${rooms}</div>
    <div class="chips">
      <button type="button" class="chip" data-action="view" data-view="energy"><i class="dot ${state.ecoflow.live ? "is-ok" : "is-bad"}"></i>${state.ecoflow.live ? `${Math.round(state.ecoflow.soc)}%` : "нет станции"}</button>
      <button type="button" class="chip" data-action="view" data-view="network">${bars(network.level)}<span>${esc(network.name)}</span></button>
      <button type="button" class="chip" data-action="view" data-view="watch"><i class="dot ${state.watch.away ? "is-away" : "is-ok"}"></i>${state.watch.away ? "Никого нет" : "Я дома"}</button>
    </div>`;
}

function paintLive(room) {
  const level = roomLevel(room);
  const kelvin = roomKelvin(room);
  document.querySelectorAll('[data-readout="level"]').forEach((node) => {
    node.textContent = String(level);
  });
  document.querySelectorAll('[data-readout="level-label"]').forEach((node) => {
    node.textContent = `${level}%`;
  });
  document.querySelectorAll('[data-readout="kelvin"]').forEach((node) => {
    node.textContent = `${kelvin} K`;
  });
  const glow = glowColor(room);
  document.querySelectorAll(".glow").forEach((node) => node.style.setProperty("--glow", glow));
}

function focusKey(element) {
  if (!(element instanceof HTMLElement)) return "";
  if (element.dataset.slider) {
    const lightId = element.dataset.light ? `[data-light="${CSS.escape(element.dataset.light)}"]` : "";
    return `[data-slider="${CSS.escape(element.dataset.slider)}"]${lightId}`;
  }
  if (!element.dataset.action) return "";
  const parts = [`[data-action="${CSS.escape(element.dataset.action)}"]`];
  ["view", "room", "light", "scene", "dir", "mode", "device", "camera", "network", "away", "rule", "incident", "filter", "vacuum", "button"].forEach((name) => {
    if (element.dataset[name]) parts.push(`[data-${name}="${CSS.escape(element.dataset[name])}"]`);
  });
  return parts.join("");
}

function draw(options = {}) {
  stopCameras();
  document.querySelector("#rail").innerHTML = rail();
  document.querySelector("#top").innerHTML = top();
  document.querySelector("#stage").innerHTML = stage();
  document.title = `${TITLES[state.view] ?? "Дом"} · Vexto Дом`;
  mountCameras(document.querySelector("#stage"));
  if (options.scroll) document.querySelector("#main").scrollTo(0, 0);
  if (options.focus) {
    const next = document.querySelector(options.focus);
    next?.focus({ preventScroll: true });
  }
}

function onClick(event) {
  const element = event.target instanceof Element ? event.target.closest("[data-action]") : null;
  if (!(element instanceof HTMLElement) || element.disabled) return;
  const previous = state.view;
  const room = currentRoom();
  switch (element.dataset.action) {
    case "view":
      actions.setView(element.dataset.view);
      break;
    case "room":
      actions.setRoom(element.dataset.room);
      break;
    case "light":
      actions.toggleLight(room.id, element.dataset.light);
      break;
    case "scene":
      actions.applyScene(room.id, element.dataset.scene);
      break;
    case "temp":
      actions.stepTarget(room.id, Number(element.dataset.dir));
      break;
    case "mode":
      actions.setMode(room.id, element.dataset.mode);
      break;
    case "device":
      commandPlug(element.dataset.device);
      return;
    case "camera":
      actions.setCamera(element.dataset.camera);
      break;
    case "network":
      actions.selectNetwork(element.dataset.network);
      break;
    case "arm":
      actions.toggleArmed();
      break;
    case "away":
      actions.setAway(element.dataset.away === "1");
      break;
    case "rule":
      actions.toggleRule(element.dataset.rule);
      break;
    case "incident":
      actions.selectIncident(element.dataset.incident);
      actions.setView("watch");
      break;
    case "filter":
      actions.setFilter(element.dataset.filter);
      break;
    case "vacuum":
      commandVacuum(element.dataset.vacuum);
      return;
    case "vacuum-room":
      actions.toggleVacuumRoom(element.dataset.room);
      break;
    case "press":
      actions.pressButton(element.dataset.button);
      break;
    case "eco":
      actions.toggleEcoOutput();
      break;
    default:
      return;
  }
  draw({ scroll: previous !== state.view, focus: focusKey(element) });
}

function onInput(event) {
  const element = event.target;
  if (!(element instanceof HTMLInputElement) || !element.dataset.slider) return;
  const room = currentRoom();
  if (element.dataset.slider === "level") {
    actions.setLevel(room.id, Number(element.value));
  } else if (element.dataset.slider === "kelvin") {
    actions.setKelvin(room.id, Number(element.value));
  } else if (element.dataset.slider === "lamp") {
    actions.setLampBrightness(room.id, element.dataset.light, Number(element.value));
    const readout = element.closest(".lamp")?.querySelector("[data-lamp-readout]");
    if (readout) readout.textContent = `${element.value}%`;
  }
  paintLive(currentRoom());
}

function onChange(event) {
  const element = event.target;
  if (!(element instanceof HTMLInputElement) || !element.dataset.slider) return;
  draw({ focus: focusKey(element) });
}

export function start() {
  document.body.addEventListener("click", onClick);
  document.body.addEventListener("input", onInput);
  document.body.addEventListener("change", onChange);
  draw();
  window.setInterval(() => {
    const text = clockText();
    document.querySelectorAll("[data-clock]").forEach((node) => {
      node.textContent = text;
    });
  }, 10000);
  pullEcoflow();
  window.setInterval(pullEcoflow, 60000);
  pullXiaomi();
  window.setInterval(pullXiaomi, 120000);
  pullXiaomiStatus();
  window.setInterval(pullXiaomiStatus, 20000);
}

function xiaomiSignature() {
  const plugs = state.devices.map((device) => [device.id, device.on, device.watts, device.error, device.powerError, device.pending].join(":")).join("|");
  const sensors = state.sensors.map((sensor) => [sensor.id, sensor.value, sensor.live, sensor.ok].join(":")).join("|");
  const button = state.buttons.map((item) => [item.action, item.last].join(":")).join("|");
  const hub = state.links.some((link) => link.id === "xiaomi-hub" && link.connected);
  const robot = state.vacuum;
  return `${plugs}|${sensors}|${button}|${hub}|${robot.mode}|${robot.label}|${robot.battery}|${robot.error}|${robot.pending}`;
}

function applyPlug(plug) {
  const device = state.devices.find((item) => item.id === plug.id);
  if (!device || device.pending) return;
  device.on = typeof plug.on === "boolean" ? plug.on : null;
  device.watts = Number.isFinite(plug.power_w) ? plug.power_w : null;
  device.error = plug.error || "";
  device.powerError = plug.power_error || "";
  if (plug.name) device.name = plug.name;
}

function applyVacuum(vacuum) {
  if (!vacuum || state.vacuum.pending) return;
  if (vacuum.name) state.vacuum.name = vacuum.name;
  state.vacuum.mode = vacuum.mode || "unknown";
  state.vacuum.label = vacuum.label || "";
  state.vacuum.battery = Number.isFinite(vacuum.battery) ? vacuum.battery : null;
  state.vacuum.error = vacuum.error || "";
}

function applySensor(id, value, live, ok) {
  const sensor = state.sensors.find((item) => item.id === id);
  if (!sensor) return;
  sensor.value = value;
  sensor.live = live;
  sensor.ok = ok;
}

function readingAge(seconds) {
  if (!Number.isFinite(seconds) || seconds < 60) return "";
  if (seconds < 3600) return ` · ${Math.floor(seconds / 60)} мин назад`;
  return ` · ${Math.floor(seconds / 3600)} ч назад`;
}

function applyXiaomiStatus(status) {
  if (!status || !Array.isArray(status.plugs)) {
    state.devices.forEach((device) => {
      if (device.pending) return;
      device.on = null;
      device.watts = null;
      device.powerError = "";
      device.error = (status && status.error) || "Нет ответа устройств.";
    });
    const link = state.links.find((item) => item.id === "xiaomi-hub");
    if (link) link.connected = false;
    return;
  }
  status.plugs.forEach(applyPlug);
  applyVacuum(status.vacuum);
  const ht = status.thermometer || {};
  if (Number.isFinite(ht.temperature)) {
    const hum = Number.isFinite(ht.humidity) ? `${Math.round(ht.humidity)}%` : "влажность не пришла";
    applySensor("ht", `${num(ht.temperature)}° · ${hum}${readingAge(ht.age_s)}`, true, true);
  } else {
    applySensor("ht", ht.error || "нет данных", false, false);
  }
  const door = status.door || {};
  if (typeof door.value === "string" && door.value) {
    const light = door.light === true ? " · светло" : door.light === false ? " · темно" : "";
    applySensor("door", `${door.value}${light}${readingAge(door.age_s)}`, true, true);
  } else {
    applySensor("door", door.error || "нет данных", false, false);
  }
  const motion = status.motion || {};
  if (typeof motion.value === "boolean") {
    const battery = Number.isFinite(motion.battery) ? ` · батарея ${Math.round(motion.battery)}%` : "";
    applySensor("motion", `${motion.value ? "движение" : "нет движения"}${battery}${readingAge(motion.age_s)}`, true, true);
  } else {
    applySensor("motion", motion.error || "нет данных", false, false);
  }
  const button = state.buttons.find((item) => item.id === "desk");
  if (button && status.button) {
    const press = status.button.action;
    const gestures = { single: "одно нажатие", double: "двойное нажатие", triple: "тройное нажатие", hold: "удержание" };
    button.action = typeof press === "string" && press ? (gestures[press] || press) : (status.button.error || "нет событий");
    const battery = Number.isFinite(status.button.battery) ? ` · батарея ${Math.round(status.button.battery)}%` : "";
    button.last = press ? `с хаба${readingAge(status.button.age_s)}${battery}` : status.button.listed ? `в списке хаба${battery}` : "хаб не видит";
    button.command = "";
  }
  const link = state.links.find((item) => item.id === "xiaomi-hub");
  if (link && status.hub) link.connected = Boolean(status.hub.online);
}

async function commandPlug(id) {
  const device = state.devices.find((item) => item.id === id);
  if (!device || device.pending || typeof device.on !== "boolean") return;
  const action = device.on ? "off" : "on";
  device.pending = true;
  draw();
  let payload;
  try {
    const response = await fetch("/api/xiaomi/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: id, action }),
    });
    payload = await response.json();
  } catch {
    payload = { ok: false, error: "Панель не достучалась до сервера." };
  }
  device.pending = false;
  if (payload && payload.plug) applyPlug(payload.plug);
  if (!payload || payload.ok === false) device.error = (payload && payload.error) || "Команда не выполнена.";
  pullXiaomiStatus.last = xiaomiSignature();
  draw();
}

async function commandVacuum(mode) {
  if (!["clean", "pause", "dock"].includes(mode) || state.vacuum.pending) return;
  const action = mode === "clean" ? "start" : mode;
  state.vacuum.pending = true;
  draw();
  let payload;
  try {
    const response = await fetch("/api/xiaomi/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "vacuum", action }),
    });
    payload = await response.json();
  } catch {
    payload = { ok: false, error: "Панель не достучалась до сервера." };
  }
  state.vacuum.pending = false;
  if (payload && payload.vacuum) applyVacuum(payload.vacuum);
  if (!payload || payload.ok === false) state.vacuum.error = (payload && payload.error) || "Команда не выполнена.";
  pullXiaomiStatus.last = xiaomiSignature();
  draw();
}

async function pullXiaomiStatus() {
  if (pullXiaomiStatus.busy) return;
  pullXiaomiStatus.busy = true;
  try {
    const response = await fetch("/api/xiaomi/status");
    if (response.ok) applyXiaomiStatus(await response.json());
  } catch {
    state.devices.forEach((device) => {
      if (device.pending) return;
      device.on = null;
      device.watts = null;
      device.powerError = "";
      device.error = "Панель не достучалась до сервера.";
    });
  } finally {
    pullXiaomiStatus.busy = false;
  }
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.dataset.slider) return;
  const signature = xiaomiSignature();
  if (signature === pullXiaomiStatus.last) return;
  pullXiaomiStatus.last = signature;
  draw();
}

async function pullXiaomi() {
  let status;
  try {
    const response = await fetch("/api/xiaomi");
    if (!response.ok) return;
    status = await response.json();
  } catch {
    return;
  }
  const next = `${status.configured}|${status.ok}|${status.reason}|${(status.devices || []).length}`;
  if (next === pullXiaomi.last) return;
  pullXiaomi.last = next;
  state.xiaomi = {
    configured: Boolean(status.configured),
    ok: Boolean(status.ok),
    reason: status.reason || "",
    devices: Array.isArray(status.devices) ? status.devices : [],
  };
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.dataset.slider) return;
  draw();
}

async function pullEcoflow() {
  let status;
  try {
    const response = await fetch("/api/ecoflow");
    if (!response.ok) return;
    status = await response.json();
  } catch {
    return;
  }
  const link = state.links.find((item) => item.id === "ecoflow");
  if (!status.configured) {
    state.ecoflow.live = false;
    state.ecoflow.note = status.reason || state.ecoflow.note;
    if (link) link.connected = false;
  } else if (!status.ok) {
    state.ecoflow.live = false;
    state.ecoflow.note = status.reason || "EcoFlow не ответил.";
    if (link) link.connected = false;
  } else {
    state.ecoflow.name = status.model || "DELTA 2";
    if (Number.isFinite(status.soc)) state.ecoflow.soc = status.soc;
    state.ecoflow.inputW = Number.isFinite(status.inputW) ? status.inputW : null;
    state.ecoflow.outputW = Number.isFinite(status.outputW) ? status.outputW : null;
    state.ecoflow.remainMin = Number.isFinite(status.remainMin) ? status.remainMin : null;
    if (typeof status.outputOn === "boolean") state.ecoflow.outputOn = status.outputOn;
    state.ecoflow.live = true;
    state.ecoflow.note = status.online === false ? "Станция не в сети" : "Заряд из облака EcoFlow";
    if (link) link.connected = true;
  }
  const previous = `${state.ecoflow.note}|${state.ecoflow.soc}|${state.ecoflow.inputW}|${state.ecoflow.outputW}|${state.ecoflow.remainMin}|${state.ecoflow.live}|${link?.connected}`;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.dataset.slider) return;
  if (previous === pullEcoflow.last) return;
  pullEcoflow.last = previous;
  draw();
}
