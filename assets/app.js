/* assets/app.js
   Requisitos: math.js y Chart.js cargados en el HTML.
   Provee: funciones globales calcularMarkov() y calcularColas()
   y maneja gráficas (Chart.js) con destrucción segura.
*/

/* --------------------- Helpers de parsing y utilidades --------------------- */

function expandFractionsInText(text) {
  if (!text || typeof text !== 'string') return text;
  // sustituye ocurrencias tipo 3/4 o  3.5/2  por su valor numérico usando math.evaluate si está disponible
  try {
    return text.replace(/(\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?)/g, (m) => {
      try {
        // math.evaluate devuelve número (si math.js cargado)
        if (typeof math !== 'undefined' && math && math.evaluate) {
          const val = math.evaluate(m);
          return String(+val);
        }
        // fallback simple
        const parts = m.split('/');
        return String(parseFloat(parts[0].trim()) / parseFloat(parts[1].trim()));
      } catch (e) {
        return m;
      }
    });
  } catch (e) {
    return text;
  }
}

function parseMatrixFlexible(text) {
  if (!text || !text.trim()) throw new Error("Matriz vacía");
  text = text.trim();

  // primero expandir fracciones (p.e. "3/4")
  const expanded = expandFractionsInText(text);

  // Intentar JSON (ej: [[0.75,0.25],[0.2,0.8]])
  try {
    if (expanded.startsWith("[") || expanded.startsWith("{")) {
      const parsed = JSON.parse(expanded);
      if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) throw new Error("Formato JSON inválido para matriz");
      parsed.forEach((row, i) => {
        if (!Array.isArray(row)) throw new Error(`Fila ${i+1} no es array`);
        row.forEach((v, j) => { if (typeof v !== 'number' || isNaN(v)) throw new Error(`Valor inválido en fila ${i+1}, col ${j+1}`); });
      });
      return math.matrix(parsed);
    }
  } catch (e) {
    // continuar a siguiente formato si JSON falla
  }

  // Formato "a,b;c,d" o con saltos de línea
  const rows = expanded.split(/[\r\n;]+/).map(r => r.trim()).filter(Boolean);
  if (!rows.length) throw new Error("Formato de matriz inválido");
  const mat = rows.map((r, i) => {
    const cols = r.split(",").map(c => {
      const num = parseFloat(c.trim());
      if (isNaN(num)) throw new Error(`Valor no numérico en fila ${i+1}`);
      return num;
    });
    return cols;
  });
  // chequear dimensiones
  const n = mat[0].length;
  if (!mat.every(row => row.length === n)) throw new Error("Filas con diferente número de columnas");
  return math.matrix(mat);
}

function parseVectorFlexible(text) {
  if (!text || !text.trim()) throw new Error("Vector vacío");
  text = text.trim();

  // expandir fracciones
  const expanded = expandFractionsInText(text);

  // JSON
  try {
    if (expanded.startsWith("[")) {
      const parsed = JSON.parse(expanded);
      if (!Array.isArray(parsed)) throw new Error("Vector JSON inválido");
      if (parsed.some(x => typeof x !== 'number' || isNaN(x))) throw new Error("Vector contiene valores inválidos");
      return math.matrix(parsed);
    }
  } catch (e) {
    // fallback
  }
  // "a,b,c" o con espacios
  const parts = expanded.split(",").map(x => parseFloat(x.trim()));
  if (parts.some(x => isNaN(x))) throw new Error("Vector contiene valores no numéricos");
  return math.matrix(parts);
}

function normalizeArray(arr) {
  const s = arr.reduce((a,b) => a + b, 0);
  if (s === 0) return arr.map(_ => 1/arr.length);
  return arr.map(x => x / s);
}

/* --------------------- MARKOV: evolución + gráfico + estado estacionario --------------------- */

let chartMarkov = null;

/**
 * calcularMarkov()
 * - Lee inputs: #matriz, #vector, #pasos
 * - Valida: matriz cuadrada, dimensiones coinciden
 * - Calcula secuencia desde paso 0..n (renormaliza numéricamente)
 * - Grafica líneas (Chart.js) y muestra estado estacionario (método de potencias)
 */
function calcularMarkov() {
  const outEl = document.getElementById("output");
  const steadyEl = document.getElementById("steadyState");
  const canvas = document.getElementById("graficoMarkov");

  if (!outEl || !steadyEl || !canvas) {
    alert("Elementos de resultado de Markov no encontrados en la página.");
    return;
  }

  outEl.textContent = "Calculando...";
  steadyEl.textContent = "";

  try {
    const matText = document.getElementById("matriz").value;
    const vecText = document.getElementById("vector").value;
    let pasos = parseInt(document.getElementById("pasos").value, 10);
    if (isNaN(pasos) || pasos < 0) pasos = 10;

    // parse
    const P = parseMatrixFlexible(matText);
    const v0 = parseVectorFlexible(vecText);

    // validar cuadrada
    const size = P.size()[0];
    if (!Array.isArray(P.size()) || P.size().length !== 2 || P.size()[1] !== size) {
      throw new Error("La matriz debe ser cuadrada (n x n).");
    }
    if (v0.size()[0] !== size) {
      throw new Error("El vector inicial debe tener la misma longitud que la matriz.");
    }

    // verificar filas suman ~1 (advertencia, no bloqueo)
    const rows = P.toArray();
    const rowWarnings = [];
    rows.forEach((row, i) => {
      const s = row.reduce((a,b) => a + b, 0);
      if (Math.abs(s - 1) > 1e-6) rowWarnings.push({ row: i + 1, sum: s });
    });

    // normalizar vector inicial (evita problemas numéricos)
    let current = math.matrix(normalizeArray(v0.toArray()));

    // secuencia
    const seq = [];
    for (let t = 0; t <= pasos; t++) {
      seq.push(current.toArray().map(x => +x)); // almacenar números puros
      current = math.multiply(current, P);     // v_{t+1} = v_t * P
      // renormalizar numéricamente
      current = math.matrix(normalizeArray(current.toArray()));
    }

    // salida textual
    const lines = seq.map((r, i) => `Paso ${i}: [${r.map(x => x.toFixed(6)).join(", ")}]`);
    outEl.textContent = lines.join("\n");

    // preparar datasets por estado
    const labels = seq.map((_, i) => `Paso ${i}`);
    const nEstados = seq[0].length;
    const palette = ["#0b6b3a","#16a085","#f6c84c","#ef7a2f","#6cbf84","#2e7d32"];
    const datasets = [];
    for (let e = 0; e < nEstados; e++) {
      datasets.push({
        label: `Estado ${e+1}`,
        data: seq.map(r => r[e]),
        borderColor: palette[e % palette.length],
        backgroundColor: "transparent",
        tension: 0.24,
        pointRadius: 3
      });
    }

    // crear/destroy Chart.js
    if (chartMarkov) { try { chartMarkov.destroy(); } catch(e){} }
    chartMarkov = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { min: 0, max: 1, title: { display: true, text: 'Probabilidad' } } }
      }
    });

    // Estado estacionario: método de potencias (iterar hasta convergencia)
    let est = math.matrix(normalizeArray(v0.toArray()));
    let prevArr = null;
    const TMAX = 1000;
    for (let k = 0; k < TMAX; k++) {
      est = math.multiply(est, P);
      est = math.matrix(normalizeArray(est.toArray()));
      const arr = est.toArray();
      if (prevArr) {
        const diffs = arr.map((v, i) => Math.abs(v - prevArr[i]));
        if (Math.max(...diffs) < 1e-10) break;
      }
      prevArr = arr;
    }
    const steadyArr = est.toArray().map(x => +x.toFixed(10));
    steadyEl.textContent = `≈ [${steadyArr.join(", ")}]`;

    // advertencia de filas que no suman 1
    if (rowWarnings.length) {
      outEl.textContent += `\n\nAdvertencia: algunas filas de P no suman 1. Ej: fila ${rowWarnings[0].row} suma ${rowWarnings[0].sum.toFixed(6)}`;
    }

    // microanimación si existe gsap
    if (window.gsap) {
      gsap.fromTo(outEl, {opacity:0, y:8}, {opacity:1, y:0, duration:0.45});
      gsap.fromTo(steadyEl, {opacity:0, y:8}, {opacity:1, y:0, duration:0.45, delay:0.08});
    }

    return { seq, steady: steadyArr };

  } catch (err) {
    outEl.textContent = "Error: " + err.message;
    steadyEl.textContent = "";
    if (chartMarkov) { try { chartMarkov.destroy(); chartMarkov = null; } catch(e){} }
    return null;
  }
}

// Exponer globalmente (si el HTML usa onclick inline)
window.calcularMarkov = calcularMarkov;

/* --------------------- COLAS: cálculos y gráfico --------------------- */

let chartColas = null;

/**
 * calcularColas()
 * - Lee inputs: #modelo, #lambda, #mu, #c, #K
 * - Calcula métricas según modelo y grafica barras con ρ, L, Lq, W, Wq si existen
 */
function calcularColas() {
  const outEl = document.getElementById("outputColas") || document.getElementById("output");
  const canvas = document.getElementById("graficoColas");

  if (!outEl || !canvas) {
    alert("Elementos de resultado de Colas no encontrados en la página.");
    return;
  }
  outEl.textContent = "Calculando...";

  try {
    const modelEl = document.getElementById("modelo");
    const modelo = modelEl ? modelEl.value : "MM1";
    const lambda = parseFloat(document.getElementById("lambda").value);
    const mu = parseFloat(document.getElementById("mu").value);
    const c = parseInt(document.getElementById("c") ? document.getElementById("c").value : "1", 10);
    const Kraw = document.getElementById("K") ? parseInt(document.getElementById("K").value, 10) : NaN;
    const K = (isNaN(Kraw) || !isFinite(Kraw) || Kraw <= 0) ? Infinity : Kraw;

    if (isNaN(lambda) || isNaN(mu) || lambda <= 0 || mu <= 0) {
      outEl.textContent = "Ingrese λ y μ válidos (positivos).";
      return;
    }

    let res = {};
    if (modelo === "MM1" || modelo === "M/M/1" || modelo === "M/M/1") {
      const rho = lambda / mu;
      if (rho >= 1) { outEl.textContent = "Sistema inestable (ρ ≥ 1) para M/M/1."; return; }
      const L = rho / (1 - rho);
      const Lq = Math.pow(rho, 2) / (1 - rho);
      const W = L / lambda;
      const Wq = Lq / lambda;
      res = { model: "M/M/1", rho, L, Lq, W, Wq };
    } else if (modelo === "MMc" || modelo === "M/M/c" || modelo === "M/M/c") {
      const a = lambda / mu;
      const rho = lambda / (c * mu);
      if (rho >= 1) {
        // sistema puede estar saturado pero no necesariamente inválido para cálculo (aún así warn)
      }
      // calcular P0
      let sum = 0;
      for (let n = 0; n <= c-1; n++) sum += Math.pow(a, n) / factorial(n);
      const term = Math.pow(a, c) / (factorial(c) * (1 - rho));
      const P0 = 1 / (sum + term);
      const Pc = term * P0;
      const Lq = (Pc * rho) / (1 - rho);
      const L = Lq + a / c;
      const Wq = Lq / lambda;
      const W = Wq + 1 / mu;
      res = { model: "M/M/c", rho, P0, L, Lq, W, Wq };
    } else if (modelo === "MM1K" || modelo === "M/M/1/K" || modelo === "M/M/1K") {
      const rho = lambda / mu;
      // P0
      let P0;
      if (Math.abs(rho - 1) < 1e-12) P0 = 1 / (K + 1);
      else P0 = (1 - rho) / (1 - Math.pow(rho, K + 1));
      // L
      let Lsum = 0;
      for (let n = 0; n <= K; n++) {
        const Pn = P0 * Math.pow(rho, n);
        Lsum += n * Pn;
      }
      const lambda_eff = lambda * (1 - P0 * Math.pow(rho, K));
      const W = Lsum / lambda_eff;
      res = { model: "M/M/1/K", rho, P0, L: Lsum, W, lambda_eff };
    } else if (modelo === "MMcK" || modelo === "M/M/c/K" || modelo === "M/M/cK") {
      const a = lambda / mu;
      // P0
      let sum1 = 0;
      for (let n = 0; n <= c-1; n++) sum1 += Math.pow(a, n) / factorial(n);
      let sum2 = 0;
      for (let n = c; n <= K; n++) sum2 += Math.pow(a, n) / (factorial(c) * Math.pow(c, n - c));
      const P0 = 1 / (sum1 + sum2);
      // L
      let Lsum = 0;
      for (let n = 0; n <= K; n++) {
        let Pn;
        if (n <= c) Pn = P0 * Math.pow(a, n) / factorial(n);
        else Pn = P0 * Math.pow(a, n) / (factorial(c) * Math.pow(c, n - c));
        Lsum += n * Pn;
      }
      const lastPn = (K <= c) ? P0 * Math.pow(a, K) / factorial(K) : P0 * Math.pow(a, K) / (factorial(c) * Math.pow(c, K - c));
      const lambda_eff = lambda * (1 - lastPn);
      const W = Lsum / lambda_eff;
      res = { model: "M/M/c/K", P0, L: Lsum, W, lambda_eff };
    } else {
      outEl.textContent = "Modelo no soportado.";
      return;
    }

    // mostrar resultados en texto
    outEl.textContent = JSON.stringify(res, null, 2);

    // construir gráfico de barras con métricas disponibles
    const labels = [];
    const data = [];
    const colors = [];
    if (res.rho !== undefined) { labels.push("ρ"); data.push(+res.rho.toFixed(4)); colors.push("#0b6b3a"); }
    if (res.L !== undefined) { labels.push("L"); data.push(+res.L.toFixed(4)); colors.push("#16a085"); }
    if (res.Lq !== undefined) { labels.push("Lq"); data.push(+res.Lq.toFixed(4)); colors.push("#f6c84c"); }
    if (res.W !== undefined) { labels.push("W"); data.push(+res.W.toFixed(4)); colors.push("#ef7a2f"); }
    if (res.Wq !== undefined) { labels.push("Wq"); data.push(+res.Wq.toFixed(4)); colors.push("#8fcf9b"); }
    if (res.lambda_eff !== undefined) { labels.push("λ_eff"); data.push(+res.lambda_eff.toFixed(4)); colors.push("#7fbfcd"); }

    if (chartColas) { try { chartColas.destroy(); } catch(e){} }
    chartColas = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels, datasets: [{ label: "Métricas", data, backgroundColor: colors }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    // microanim
    if (window.gsap) gsap.fromTo(outEl, {opacity:0, y:8}, {opacity:1, y:0, duration:0.45});

    return res;

  } catch (err) {
    outEl.textContent = "Error: " + err.message;
    if (chartColas) { try { chartColas.destroy(); chartColas = null; } catch(e){} }
    return null;
  }
}

// Exponer globalmente
window.calcularColas = calcularColas;

/* --------------------- Utilidades matemáticas --------------------- */

function factorial(n) {
  n = Math.floor(n);
  if (n <= 1) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

/* --------------------- Conectar botones si existen (listeners no-inline) --------------------- */

document.addEventListener("DOMContentLoaded", () => {
  const btnM = document.getElementById("btnMarkovRun");
  if (btnM) btnM.addEventListener("click", calcularMarkov);
  const btnQ = document.getElementById("btnQueueRun");
  if (btnQ) btnQ.addEventListener("click", calcularColas);

  // Si los HTML usan onclick inline (onclick="calcularMarkov()"), ya funcionarán porque las funciones
  // están definidas en window. Esta sección solo añade listeners si prefieres botones con id.
});
