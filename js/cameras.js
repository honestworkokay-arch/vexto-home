let frame = 0;
let onResize = null;

const painters = {
  hall(ctx, width, height) {
    ctx.strokeStyle = "rgba(244,244,242,0.28)";
    ctx.lineWidth = 1.25;
    ctx.strokeRect(width * 0.36, height * 0.16, width * 0.26, height * 0.66);
    ctx.beginPath();
    ctx.arc(width * 0.57, height * 0.5, Math.max(2, width * 0.008), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(244,244,242,0.8)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(width * 0.12, height * 0.82);
    ctx.lineTo(width * 0.88, height * 0.82);
    ctx.strokeStyle = "rgba(244,244,242,0.16)";
    ctx.stroke();
  },
  yard(ctx, width, height, time) {
    ctx.beginPath();
    ctx.moveTo(0, height * 0.64);
    ctx.lineTo(width, height * 0.58);
    ctx.strokeStyle = "rgba(244,244,242,0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
    const x = (Math.sin(time / 1700) * 0.5 + 0.5) * width;
    const glow = ctx.createRadialGradient(x, height * 0.72, 2, x, height * 0.72, width * 0.26);
    glow.addColorStop(0, "rgba(244,244,242,0.16)");
    glow.addColorStop(1, "rgba(244,244,242,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.beginPath();
    ctx.moveTo(width * 0.74, height * 0.6);
    ctx.quadraticCurveTo(width * 0.78, height * 0.34, width * 0.7, height * 0.22);
    ctx.strokeStyle = "rgba(244,244,242,0.38)";
    ctx.stroke();
  },
  kitchen(ctx, width, height, time) {
    ctx.fillStyle = "rgba(244,244,242,0.05)";
    ctx.fillRect(0, height * 0.62, width, height * 0.07);
    const pulse = 0.05 + Math.sin(time / 900) * 0.02;
    ctx.fillStyle = `rgba(214, 228, 244, ${pulse})`;
    ctx.fillRect(width * 0.08, height * 0.18, width * 0.13, height * 0.44);
    ctx.strokeStyle = "rgba(244,244,242,0.18)";
    ctx.strokeRect(width * 0.08, height * 0.18, width * 0.13, height * 0.44);
  },
  living(ctx, width, height, time) {
    ctx.strokeStyle = "rgba(244,244,242,0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(width * 0.16, height * 0.2, width * 0.3, height * 0.2);
    ctx.beginPath();
    ctx.moveTo(width * 0.58, height * 0.74);
    ctx.lineTo(width * 0.9, height * 0.74);
    ctx.lineTo(width * 0.84, height * 0.5);
    ctx.lineTo(width * 0.64, height * 0.5);
    ctx.closePath();
    ctx.stroke();
    const alpha = 0.08 + Math.sin(time / 1400) * 0.03;
    ctx.fillStyle = `rgba(230, 177, 90, ${alpha})`;
    ctx.beginPath();
    ctx.arc(width * 0.78, height * 0.42, width * 0.04, 0, Math.PI * 2);
    ctx.fill();
  },
};

function fit(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.floor(width * ratio);
  const pixelHeight = Math.floor(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function paint(canvas, time) {
  const { ctx, width, height } = fit(canvas);
  const scene = canvas.dataset.feed;
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#17191d");
  background.addColorStop(1, "#090a0c");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const horizon = height * 0.46;
  ctx.beginPath();
  ctx.strokeStyle = "rgba(244,244,242,0.09)";
  ctx.lineWidth = 1;
  for (let line = 1; line <= 3; line += 1) {
    const y = horizon + ((height - horizon) * line) / 4;
    ctx.moveTo(width * 0.08, y);
    ctx.lineTo(width * 0.92, y);
  }
  ctx.moveTo(width * 0.5, horizon);
  ctx.lineTo(width * 0.12, height);
  ctx.moveTo(width * 0.5, horizon);
  ctx.lineTo(width * 0.88, height);
  ctx.stroke();

  const painter = painters[scene];
  if (painter) painter(ctx, width, height, time);

  const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.2, width / 2, height / 2, width * 0.72);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.045)";
  const band = ((time / 28) % (height + 30)) - 15;
  ctx.fillRect(0, band, width, 2);

  ctx.fillStyle = "rgba(255,255,255,0.18)";
  for (let index = 0; index < 40; index += 1) {
    const x = Math.abs(Math.sin(time * 0.001 + index * 12.3)) * width;
    const y = Math.abs(Math.cos(time * 0.0013 + index * 7.1)) * height;
    ctx.fillRect(x, y, 1, 1);
  }
}

export function stopCameras() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  if (onResize) {
    window.removeEventListener("resize", onResize);
    onResize = null;
  }
}

export function mountCameras(root) {
  stopCameras();
  const canvases = [...root.querySelectorAll("canvas[data-feed]")];
  if (canvases.length === 0) return;

  const draw = (time) => {
    canvases.forEach((canvas) => paint(canvas, time));
    frame = requestAnimationFrame(draw);
  };

  canvases.forEach((canvas) => paint(canvas, performance.now()));
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!motion) frame = requestAnimationFrame(draw);
  onResize = () => canvases.forEach((canvas) => paint(canvas, performance.now()));
  window.addEventListener("resize", onResize);
}
