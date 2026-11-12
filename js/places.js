import {
  sensorAlerts,
  state,
  vacuumLabel,
} from "./model.js";

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));
}

function page(kicker, index, title, text, body) {
  return `<div class="page">
    <header class="lede">
      <div class="kicker"><i></i><span>${index}</span> ${kicker}</div>
      <h1>${title}</h1>
      <p>${text}</p>
    </header>
    ${body}
  </div>`;
}

export function overviewStrip() {
  const eco = state.ecoflow;
  const hub = state.links.find((link) => link.id === "xiaomi-hub");
  const charge = Number.isFinite(Number(eco.soc)) && eco.live ? `${Math.round(eco.soc)}%` : "—";
  const cards = [
    ["energy", "DELTA 2", charge, eco.live ? "заряд из облака" : "нет ответа"],
    ["energy", "Вход", eco.live && eco.inputW != null ? `${eco.inputW} Вт` : "—", eco.live ? "из облака" : "нет ответа"],
    ["energy", "Отдача", eco.live && eco.outputW != null ? `${eco.outputW} Вт` : "—", eco.live ? "из облака" : "нет ответа"],
    ["links", "Hub 2", hub?.connected ? "на связи" : "нет ответа", hub?.connected ? "miIO" : "хаб не ответил"],
  ];
  return `<div class="strip">${cards.map(([view, label, value, note]) => `<button type="button" class="strip-card" data-action="view" data-view="${view}">
      <span>${label}</span>
      <strong>${esc(value)}</strong>
      <em>${esc(note)}</em>
    </button>`).join("")}</div>`;
}

export function energyPage() {
  const eco = state.ecoflow;
  const charge = eco.live && Number.isFinite(Number(eco.soc)) ? `${Math.round(eco.soc)}%` : "—";
  const output = eco.outputW;
  const hours = eco.remainMin == null ? null : Math.floor(eco.remainMin / 60);
  const minutes = eco.remainMin == null ? null : eco.remainMin % 60;
  return page(
    "Энергия",
    "04",
    charge,
    "Заряд DELTA 2 из облака. Расход за сегодня и напряжение сети панель не измеряет.",
    `<article class="card energy-live">
        <p class="field-label">EcoFlow · ${esc(eco.name)}</p>
        ${eco.note ? `<p class="quiet">${esc(eco.note)}</p>` : ""}
        <div class="metric"><b>${eco.live ? Math.round(eco.soc) : "—"}</b><small>%</small></div>
        <dl class="facts eco-facts">
          <div><dt>Вход</dt><dd>${eco.inputW == null ? "—" : `${eco.inputW} Вт`}</dd></div>
          <div><dt>Отдача</dt><dd>${output == null ? "—" : `${output} Вт`}</dd></div>
          <div><dt>Осталось</dt><dd>${eco.remainMin == null ? "—" : `${hours} ч ${minutes} мин`}</dd></div>
        </dl>
      </article>`,
  );
}

export function vacuumPage() {
  const robot = state.vacuum;
  const note = robot.error
    ? robot.error
    : "Команды уходят на сам пылесос: уборка, пауза и возврат на базу.";
  return page(
    "Робот",
    "05",
    vacuumLabel(),
    `${esc(robot.name)}. ${esc(note)}`,
    `<article class="card">
        <div class="metric"><b>${robot.battery == null ? "—" : Math.round(robot.battery)}</b><small>%</small></div>
        <p class="quiet">Батарея с робота</p>
        <div class="seg vacuum-actions">
          <button type="button" class="${robot.mode === "clean" ? "is-on" : ""}" data-action="vacuum" data-vacuum="clean" ${robot.pending ? "disabled" : ""}>Уборка</button>
          <button type="button" class="${robot.mode === "pause" ? "is-on" : ""}" data-action="vacuum" data-vacuum="pause" ${robot.pending ? "disabled" : ""}>Пауза</button>
          <button type="button" class="${robot.mode === "dock" || robot.mode === "returning" ? "is-on" : ""}" data-action="vacuum" data-vacuum="dock" ${robot.pending ? "disabled" : ""}>На базу</button>
        </div>
        ${robot.pending ? `<p class="quiet">Команда отправлена…</p>` : ""}
      </article>`,
  );
}

export function sensorsPage() {
  const alerts = sensorAlerts();
  const live = state.sensors.filter((sensor) => sensor.live).length;
  return page(
    "Датчики",
    "06",
    `${live} из ${state.sensors.length} читаются`,
    alerts ? `${alerts} датчик(а) пока без актуального значения. Показываем только измерения с устройств.` : "Показания получены с подключённых датчиков.",
    `<article class="card"><div class="lines">${state.sensors.map((sensor) => `<div class="device-line">
      <div><strong>${esc(sensor.name)}</strong><p>${esc(sensor.kind)} · ${esc(sensor.room)}</p></div>
      <span class="${sensor.ok ? "" : "is-alert"}">${esc(sensor.value)}</span>
      <em class="${sensor.live ? "sev-quiet" : sensor.ok ? "" : "sev-attention"}">${sensor.live ? "с датчика" : sensor.ok ? "нет чтения" : "ошибка"}</em>
    </div>`).join("")}</div></article>`,
  );
}

export function buttonsPage() {
  return page(
    "Кнопки",
    "07",
    `${state.buttons.length}`,
    "Кнопка Стол есть в списке хаба. Нажатия по miIO не приходят, поэтому отсюда её не нажать.",
    `<article class="card"><div class="lines">${state.buttons.map((button) => `<div class="device-line">
      <div>
        <strong>${esc(button.name)}</strong>
        <p>${esc(button.room)} · ${esc(button.gesture)}</p>
      </div>
      <span>${esc(button.action)}</span>
      <em>${esc(button.last)}</em>
      <button type="button" class="text-btn press" data-action="press" data-button="${button.id}" ${button.command ? "" : "disabled"}>Нажать</button>
    </div>`).join("")}</div></article>`,
  );
}

const ROLES = {
  hub: "Хаб",
  vacuum: "Пылесос",
  socket: "Розетка",
  button: "Кнопка",
  sensor: "Датчик",
  zigbee: "Zigbee",
  wifi: "Wi-Fi",
};

function xiaomiBlock() {
  const box = state.xiaomi;
  if (!box?.configured) {
    return `<article class="card"><p class="field-label">Устройства Mi Home</p><p class="quiet">Wi-Fi пылесосы и розетки, а также Zigbee-кнопки за Hub 2, приходят одним списком из облака Mi Home. В .env нужны XIAOMI_USERNAME и XIAOMI_PASSWORD. Для Европы оставьте XIAOMI_SERVER=de.</p></article>`;
  }
  if (!box.ok) {
    return `<article class="card"><p class="field-label">Устройства Mi Home</p><p class="quiet">${esc(box.reason || "Список не получен.")}</p></article>`;
  }
  const rows = box.devices.map((device) => `<div class="device-line">
      <div><strong>${esc(device.name)}</strong><p>${esc(device.model)}</p></div>
      <span>${ROLES[device.role] || esc(device.role)}</span>
      <em>${device.online ? "в сети" : "не в сети"}</em>
    </div>`).join("");
  return `<article class="card"><p class="field-label">Устройства Mi Home · ${box.devices.length}</p><div class="lines">${rows}</div></article>`;
}

export function linksPage() {
  const hub = state.links.find((link) => link.id === "xiaomi-hub");
  const waiting = state.links.filter((link) => !link.connected).length;
  const note = hub?.connected
    ? (waiting ? "Xiaomi Smart Home Hub 2 подключён. EcoFlow ещё ждёт свой модуль." : "Все контуры на связи.")
    : "Шлюз Xiaomi ещё не на связи.";
  return page(
    "Связь",
    "11",
    hub?.connected ? "Hub 2 на связи" : "Нет шлюза",
    note,
    `<div class="link-list">${state.links.map((link) => `<article class="card link-card">
      <div class="link-top">
        <h2>${esc(link.name)}</h2>
        <span class="status ${link.connected ? "is-ok" : ""}">${link.connected ? "подключён" : "не подключён"}</span>
      </div>
      <p>${esc(link.owns)}</p>
    </article>`).join("")}</div>${xiaomiBlock()}`,
  );
}
