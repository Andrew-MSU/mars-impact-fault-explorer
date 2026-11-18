function setup(canvas) {
  const width = canvas.clientWidth || 320;
  const height = canvas.clientHeight || 180;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(width * ratio));
  canvas.height = Math.max(1, Math.floor(height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(0, 0, width, height);
  return { ctx, width, height };
}

function formatDiameter(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
  return `${Math.round(meters)} m`;
}

function formatYears(years) {
  if (!Number.isFinite(years)) return "—";
  if (years >= 1e9) return `${(years / 1e9).toFixed(1)} Gyr`;
  if (years >= 1e6) return `${(years / 1e6).toFixed(1)} Myr`;
  if (years >= 1e3) return `${(years / 1e3).toFixed(0)} kyr`;
  return `${Math.round(years)} yr`;
}

export function drawSweep(canvas, rows, currentDiameter, onset) {
  const { ctx, width, height } = setup(canvas);
  const pad = { l: 46, r: 12, t: 22, b: 32 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  ctx.fillStyle = "#6d6458";
  ctx.font = "11px Segoe UI, sans-serif";
  if (!rows?.length) {
    ctx.fillText("Sweep unavailable", pad.l, pad.t + 16);
    return;
  }
  const immediateKey = rows.some((row) => row.fractionLocal != null) ? "fractionLocal" : "fractionRegime";
  const staticKey = rows.some((row) => row.fractionLocalStatic != null) ? "fractionLocalStatic" : "fractionRegimeStatic";
  const diameters = rows.map((row) => row.diameterM);
  const xmin = Math.log(Math.min(...diameters, currentDiameter || diameters[0]));
  const xmax = Math.log(Math.max(...diameters, currentDiameter || diameters[0]));
  const peak = Math.max(0, ...rows.map((row) => Math.max(row[immediateKey] || 0, row[staticKey] || 0)));
  const ymax = Math.min(1, Math.max(0.2, peak * 1.25));
  const xOf = (diameter) => pad.l + ((Math.log(diameter) - xmin) / (xmax - xmin || 1)) * plotW;
  const yOf = (fraction) => pad.t + (1 - Math.max(0, Math.min(ymax, fraction ?? 0)) / ymax) * plotH;

  ctx.strokeStyle = "#e4d9c6";
  ctx.lineWidth = 1;
  const yTicks = [0, ymax / 2, ymax];
  for (const tick of yTicks) {
    const y = yOf(tick);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.fillStyle = "#6d6458";
    ctx.fillText(`${Math.round(tick * 100)}%`, 2, y + 3);
  }

  const drawLine = (key, color) => {
    ctx.beginPath();
    let started = false;
    for (const row of rows) {
      if (row[key] == null) continue;
      const x = xOf(row.diameterM);
      const y = yOf(row[key]);
      if (!started) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      started = true;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  drawLine(staticKey, "#1f6a62");
  drawLine(immediateKey, "#b64022");

  if (onset) {
    const x = xOf(onset);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#8c2f18";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#8c2f18";
    ctx.fillText("onset", Math.min(Math.max(pad.l, x - 16), width - pad.r - 36), pad.t - 4);
  }
  if (currentDiameter) {
    const x = xOf(currentDiameter);
    ctx.strokeStyle = "#1d1914";
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + plotH);
    ctx.stroke();
  }

  ctx.fillStyle = "#6d6458";
  ctx.fillText("Impactor diameter", pad.l, height - 4);
  const ticks = [diameters[0], diameters[Math.floor(diameters.length / 2)], diameters[diameters.length - 1]];
  for (const tick of ticks) {
    ctx.fillText(formatDiameter(tick), Math.min(xOf(tick) - 12, width - pad.r - 28), height - 16);
  }
  ctx.save();
  ctx.translate(12, pad.t + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Failed area", 0, 0);
  ctx.restore();
  ctx.fillStyle = "#b64022";
  ctx.fillRect(pad.l, 6, 10, 3);
  ctx.fillStyle = "#1d1914";
  ctx.fillText("immediate", pad.l + 14, 10);
  ctx.fillStyle = "#1f6a62";
  ctx.fillRect(pad.l + 78, 6, 10, 3);
  ctx.fillStyle = "#1d1914";
  ctx.fillText("static only", pad.l + 92, 10);
}

export function drawSeries(canvas, history, fractions, onsetYears) {
  const { ctx, width, height } = setup(canvas);
  const pad = { l: 52, r: 44, t: 22, b: 32 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  ctx.font = "11px Segoe UI, sans-serif";
  if (!history?.points?.length) {
    ctx.fillStyle = "#6d6458";
    ctx.fillText("No regime-matching sample", pad.l, pad.t + 16);
    return;
  }
  const times = history.points.map((point) => point.tYears);
  const tmax = Math.max(...times, 1);
  const cfs = history.points.map((point) => point.cfsTotal / 1e6);
  const cmin = Math.min(0, ...cfs);
  const cmax = Math.max(0, ...cfs, 0.1);
  const xOf = (t) => pad.l + (t / tmax) * plotW;
  const yOf = (value) => pad.t + ((cmax - value) / (cmax - cmin || 1)) * plotH;
  const yFrac = (fraction) => pad.t + (1 - (fraction ?? 0)) * plotH;

  ctx.strokeStyle = "#e4d9c6";
  ctx.beginPath();
  ctx.moveTo(pad.l, yOf(0));
  ctx.lineTo(width - pad.r, yOf(0));
  ctx.stroke();
  ctx.fillStyle = "#6d6458";
  ctx.fillText("0", 28, yOf(0) + 3);
  ctx.fillText(cmax.toFixed(1), 16, pad.t + 4);
  ctx.save();
  ctx.translate(11, pad.t + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("CFS (MPa)", 0, 0);
  ctx.restore();

  ctx.beginPath();
  history.points.forEach((point, index) => {
    const x = xOf(point.tYears);
    const y = yOf(point.cfsTotal / 1e6);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#b64022";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  if (fractions?.points?.length) {
    ctx.beginPath();
    fractions.points.forEach((point, index) => {
      const x = xOf(point.tYears);
      const y = yFrac(point.fractionAtImpact);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#1f6a62";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = "#6d6458";
    ctx.fillText("100%", width - pad.r + 2, pad.t + 8);
    ctx.fillText("0%", width - pad.r + 2, pad.t + plotH);
  }

  if (onsetYears != null) {
    const x = xOf(onsetYears);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#8c2f18";
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = "#6d6458";
  ctx.fillText("0", pad.l, height - 16);
  ctx.fillText(formatYears(tmax), width - pad.r - 28, height - 16);
  ctx.fillText("Time", pad.l + plotW / 2 - 12, height - 4);
  ctx.fillStyle = "#b64022";
  ctx.fillRect(pad.l, 6, 10, 3);
  ctx.fillStyle = "#1d1914";
  ctx.fillText("CFS (MPa)", pad.l + 14, 10);
  ctx.fillStyle = "#1f6a62";
  ctx.fillRect(pad.l + 86, 6, 10, 3);
  ctx.fillStyle = "#1d1914";
  ctx.fillText("failed area", pad.l + 100, 10);
}

export function drawDepth(canvas, profile) {
  const { ctx, width, height } = setup(canvas);
  const pad = { l: 48, r: 14, t: 16, b: 32 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  ctx.font = "11px Segoe UI, sans-serif";
  if (!profile?.length) {
    ctx.fillStyle = "#6d6458";
    ctx.fillText("No depth profile", pad.l, pad.t + 16);
    return;
  }
  const cfs = profile.map((row) => row.cfs / 1e6);
  const min = Math.min(0, ...cfs);
  const max = Math.max(0, ...cfs);
  const span = max - min || 1;
  const zmax = profile[profile.length - 1].z;
  const xOf = (value) => pad.l + ((value - min) / span) * plotW;
  const yOf = (z) => pad.t + (z / zmax) * plotH;
  ctx.strokeStyle = "#8c2f18";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(xOf(0), pad.t);
  ctx.lineTo(xOf(0), pad.t + plotH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  profile.forEach((row, index) => {
    const x = xOf(row.cfs / 1e6);
    const y = yOf(row.z);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#1d1914";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const colors = { stable: "#2f6f9f", near: "#e0a117", reactivated: "#d23b32", excavated: "#7a3e86" };
  for (const row of profile) {
    ctx.fillStyle = colors[row.status] || "#1d1914";
    ctx.beginPath();
    ctx.arc(xOf(row.cfs / 1e6), yOf(row.z), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#6d6458";
  ctx.fillText("0 km", 8, pad.t + 10);
  ctx.fillText(`${(zmax / 1000).toFixed(0)} km`, 4, pad.t + plotH);
  ctx.save();
  ctx.translate(11, pad.t + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Depth", 0, 0);
  ctx.restore();
  const zeroX = Math.min(Math.max(xOf(0), pad.l), width - pad.r - 8);
  ctx.fillText(min.toFixed(1), pad.l, height - 16);
  ctx.fillText("0", zeroX - 4, height - 16);
  ctx.fillText("CFS (MPa)", Math.min(pad.l + plotW / 2 - 24, width - 70), height - 4);
}

const REGIME_COLOR = {
  none: "#d5cbb8",
  slip: "#2f6f9f",
  lid: "#b5811c",
  dynamo: "#b64022",
};

const REGIME_LABEL = {
  none: "No slip",
  slip: "Faults slip",
  lid: "Lid breaks",
  dynamo: "Protective dynamo",
};

/** Diameter–velocity regime map. Clicking a cell is handled by the page via canvas._regimeCells. */
export function drawRegime(canvas, rows, current) {
  const { ctx, width, height } = setup(canvas);
  const pad = { l: 58, r: 118, t: 18, b: 36 };
  ctx.fillStyle = "#6d6458";
  ctx.font = "11px Segoe UI, sans-serif";
  canvas._regimeCells = [];
  if (!rows?.length) {
    ctx.fillText("Regime map computes after the first result.", pad.l, pad.t + 16);
    return;
  }
  const diameters = [...new Set(rows.map((row) => row.diameterM))].sort((a, b) => a - b);
  const velocities = [...new Set(rows.map((row) => row.velocityMs))].sort((a, b) => a - b);
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const cellW = plotW / diameters.length;
  const cellH = plotH / velocities.length;
  const lookup = new Map(rows.map((row) => [`${row.diameterM}|${row.velocityMs}`, row]));
  let outline = null;
  if (current?.diameterM && current?.velocityMs) {
    outline = {
      dIndex: diameters.reduce((best, value, index) =>
        Math.abs(Math.log(value) - Math.log(current.diameterM)) < Math.abs(Math.log(diameters[best]) - Math.log(current.diameterM))
          ? index
          : best, 0),
      vIndex: velocities.reduce((best, value, index) =>
        Math.abs(value - current.velocityMs) < Math.abs(velocities[best] - current.velocityMs) ? index : best, 0),
    };
  }
  velocities.forEach((velocity, rowIndex) => {
    diameters.forEach((diameter, colIndex) => {
      const row = lookup.get(`${diameter}|${velocity}`);
      const x = pad.l + colIndex * cellW;
      const y = pad.t + (velocities.length - 1 - rowIndex) * cellH;
      ctx.fillStyle = REGIME_COLOR[row?.regime] || "#eee";
      ctx.fillRect(x, y, cellW - 1, cellH - 1);
      const outlined = outline && outline.dIndex === colIndex && outline.vIndex === rowIndex;
      canvas._regimeCells.push({
        x, y, w: cellW, h: cellH, diameterM: diameter, velocityMs: velocity, row, outlined,
      });
    });
  });
  if (outline) {
    ctx.strokeStyle = "#1d1914";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      pad.l + outline.dIndex * cellW + 1,
      pad.t + (velocities.length - 1 - outline.vIndex) * cellH + 1,
      cellW - 3,
      cellH - 3,
    );
  }
  ctx.fillStyle = "#6d6458";
  ctx.fillText("Impactor diameter", pad.l, height - 4);
  diameters.forEach((diameter, index) => {
    if (diameters.length > 8 && index % 2 && index !== diameters.length - 1) return;
    ctx.fillText(formatDiameter(diameter), pad.l + index * cellW, height - 18);
  });
  ctx.save();
  ctx.translate(14, pad.t + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("Impact velocity (km/s)", 0, 0);
  ctx.restore();
  velocities.forEach((velocity, rowIndex) => {
    const y = pad.t + (velocities.length - 1 - rowIndex) * cellH + cellH / 2 + 3;
    ctx.fillText(String(Math.round(velocity / 1000)), pad.l - 22, y);
  });
  const legend = [
    ["none", "Beige: no slip"],
    ["slip", "Blue: faults slip"],
    ["lid", "Gold: lid breaks"],
    ["dynamo", "Red: dynamo"],
  ];
  legend.forEach(([key, label], index) => {
    const y = pad.t + index * 16;
    ctx.fillStyle = REGIME_COLOR[key];
    ctx.fillRect(width - pad.r + 8, y, 12, 10);
    ctx.fillStyle = "#1d1914";
    ctx.fillText(label, width - pad.r + 24, y + 9);
  });
  ctx.fillStyle = "#6d6458";
  ctx.fillText("Outline: current", width - pad.r + 8, pad.t + 74);
  ctx.fillText("sliders. Click", width - pad.r + 8, pad.t + 86);
  ctx.fillText("a cell to set", width - pad.r + 8, pad.t + 98);
  ctx.fillText("them.", width - pad.r + 8, pad.t + 110);
  void REGIME_LABEL;
}
