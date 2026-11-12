import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "./env.js";

const SCHEDULE_URL = "https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/3/dsos/301/planned-outages";
const OFF_TYPES = new Set(["Definite"]);

function kyivMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

function clock(minutes) {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function windows(slots, shift = 0) {
  return (slots || []).map((slot) => ({
    from: clock(slot.start + shift),
    to: clock(slot.end + shift),
    off: OFF_TYPES.has(slot.type),
    type: slot.type,
    shift,
  }));
}

function slotAt(slots, minute) {
  return (slots || []).find((slot) => minute >= slot.start && minute < slot.end) || null;
}

function readLag(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { samples: [] };
  }
}

function writeLag(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function mains() {
  return new Promise((resolve) => {
    const child = spawn("python3", [path.join(projectRoot(), "server", "mains.py")], {
      cwd: projectRoot(),
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ state: "unknown", detail: "Перевірка розеток не встигла завершитися.", plugs: [] });
    }, 12000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve({ state: "unknown", detail: "Не вдалося прочитати розетки.", plugs: [] });
      }
    });
  });
}

export async function dtekStatus() {
  const groupId = process.env.DTEK_GROUP || "3.2";
  const shiftMinutes = 40;
  const root = projectRoot();
  const lagFile = path.join(root, "homeassistant", "data", "dtek-lag.json");
  const response = await fetch(SCHEDULE_URL);
  if (!response.ok) {
    throw new Error(`Графік ДТЕК не відкрився: ${response.status}`);
  }
  const body = await response.json();
  const group = body[groupId];
  const today = group?.today;
  const slots = today?.slots || [];
  const minute = kyivMinutes();
  const current = slotAt(slots, minute);
  const scheduled = !current ? "unknown" : OFF_TYPES.has(current.type) ? "off" : "on";
  const power = await mains();
  const mismatch = scheduled === "off" && power.state === "on";
  const lag = readLag(lagFile);
  if (current && scheduled === "off" && power.state === "on") {
    const sample = {
      at: new Date().toISOString(),
      slotFrom: clock(current.start),
      slotTo: clock(current.end),
      minutesIntoSlot: minute - current.start,
      power: "on",
    };
    const last = lag.samples[lag.samples.length - 1];
    if (!last || last.slotFrom !== sample.slotFrom || sample.minutesIntoSlot - last.minutesIntoSlot >= 5) {
      lag.samples.push(sample);
      lag.samples = lag.samples.slice(-200);
      writeLag(lagFile, lag);
    }
  }
  const measured = lag.samples.filter((item) => item.power === "on").map((item) => item.minutesIntoSlot);
  const latest = measured.length ? measured[measured.length - 1] : null;
  const offWindows = windows(slots).filter((item) => item.off);
  const onWindows = windows(slots).filter((item) => !item.off);
  let headline = "Графік 3.2 не розібрано.";
  if (today?.status === "NoOutages") headline = "Графік 3.2: відключень немає.";
  else if (today?.status === "WaitingForSchedule") headline = "Графік 3.2 на сьогодні ще не опублікований.";
  else if (scheduled === "off" && current) {
    headline = `Графік: немає світла ${clock(current.start)}–${clock(current.end)}.`;
  } else if (scheduled === "on" && current) {
    headline = `Графік: світло є до ${clock(current.end)}.`;
  }
  const tomorrow = group?.tomorrow;
  const tomorrowSlots = tomorrow?.slots || [];
  const message = mismatch
    ? "По графику света нет, а по факту свет есть"
    : power.state === "unknown"
      ? `${headline} Живе живлення зараз не перевірене.`
      : power.state === "on"
        ? `${headline} Розетка відповідає, міське живлення є.`
        : headline;
  return {
    headline,
    message,
    alert: mismatch ? "По графику света нет, а по факту свет есть" : null,
    group: groupId,
    operator: "ДТЕК Дніпровські електромережі",
    source: SCHEDULE_URL,
    scheduleStatus: today?.status || "unknown",
    scheduled,
    city_power: power.state,
    mismatch,
    windows: windows(slots),
    offWindows,
    onWindows,
    adjustedOffWindows: windows(slots, shiftMinutes).filter((item) => item.off),
    tomorrowOffWindows: windows(tomorrowSlots).filter((item) => item.off),
    tomorrowAdjustedOffWindows: windows(tomorrowSlots, shiftMinutes).filter((item) => item.off),
    tomorrowStatus: tomorrow?.status || "unknown",
    power,
    lag: {
      measuredMinutes: latest,
      samples: measured.length,
      priorMinutes: 40,
      priorLabel: "Ваш орієнтир, не вимір: світло зазвичай зникає приблизно на 40 хвилин пізніше за графік.",
    },
  };
}
