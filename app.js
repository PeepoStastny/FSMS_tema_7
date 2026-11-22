(function () {
  const { DEFAULT_SD_PARAMS, runSDModel, DEFAULT_ABM_PARAMS, runABMBatch, runAllTests } = window.UrbanFlow;

const SCENARIOS = [
  {
    id: 'baseline',
    name: '1. Výchozí stav (běžný provoz)',
    operators: 10,
    demandMultiplier: 1.0,
    failureFactor: 1.0,
    serviceTimeMin: 12,
    patienceMin: 25
  },
  {
    id: 'shock',
    name: '2. Šoková poptávka (akce / virál 1,8×)',
    operators: 10,
    demandMultiplier: 1.8,
    failureFactor: 1.0,
    serviceTimeMin: 12,
    patienceMin: 25
  },
  {
    id: 'more_ops',
    name: '3. Zásah A: Posílení dispečinku (10 → 14 operátorů)',
    operators: 14,
    demandMultiplier: 1.8,
    failureFactor: 1.0,
    serviceTimeMin: 12,
    patienceMin: 25
  },
  {
    id: 'fix_iot',
    name: '4. Zásah B: Stabilizace IoT závor (−30 % poruch)',
    operators: 10,
    demandMultiplier: 1.8,
    failureFactor: 0.7,
    serviceTimeMin: 12,
    patienceMin: 25
  }
];

const els = {
  scenarioBar: document.getElementById('scenarioBar'),
  operators: document.getElementById('inpOperators'),
  demandMultiplier: document.getElementById('inpDemand'),
  failureFactor: document.getElementById('inpFailure'),
  serviceTimeMin: document.getElementById('inpServiceTime'),
  patienceMin: document.getElementById('inpPatience'),
  dt: document.getElementById('inpDt'),
  seed: document.getElementById('inpSeed'),
  runs: document.getElementById('inpRuns'),
  runBtn: document.getElementById('btnRun'),
  compareAllBtn: document.getElementById('btnCompareAll'),
  runTestsBtn: document.getElementById('btnRunTests'),
  kpiGrid: document.getElementById('kpiGrid'),
  chartQueue: document.getElementById('chartQueue'),
  chartLost: document.getElementById('chartLost'),
  agentSelect: document.getElementById('agentSelect'),
  agentTrace: document.getElementById('agentTrace'),
  compareTableBody: document.getElementById('compareTableBody'),
  testsTableBody: document.getElementById('testsTableBody')
};

function readParams() {
  return {
    operators: Number(els.operators.value),
    demandMultiplier: Number(els.demandMultiplier.value),
    failureFactor: Number(els.failureFactor.value),
    serviceTimeMin: Number(els.serviceTimeMin.value),
    patienceMin: Number(els.patienceMin.value),
    dt: Number(els.dt.value),
    seed: Number(els.seed.value),
    runs: Math.max(1, Math.min(30, Number(els.runs.value)))
  };
}

function applyScenario(sc) {
  els.operators.value = sc.operators;
  els.demandMultiplier.value = sc.demandMultiplier;
  els.failureFactor.value = sc.failureFactor;
  els.serviceTimeMin.value = sc.serviceTimeMin;
  els.patienceMin.value = sc.patienceMin;

  document.querySelectorAll('.scenario-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.id === sc.id);
  });
  runActiveSimulation();
}

function renderSVGChart(svgEl, sdSeries, abmBandSeries, valueKeySD, abmMeanKey, abmMinKey, abmMaxKey, yLabel) {
  const W = 640;
  const H = 290;
  const pad = { top: 20, right: 20, bottom: 36, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const maxX = 48;
  const maxYData = Math.max(
    10,
    ...sdSeries.map(d => d[valueKeySD]),
    ...abmBandSeries.map(d => d[abmMaxKey])
  );
  const maxY = Math.ceil(maxYData * 1.12);

  const xScale = t => pad.left + (t / maxX) * plotW;
  const yScale = v => pad.top + plotH - (v / maxY) * plotH;

  // Špička 12–24 h zvýraznění
  const peakX1 = xScale(12);
  const peakX2 = xScale(24);

  let html = '';
  html += `<rect x="${peakX1}" y="${pad.top}" width="${peakX2 - peakX1}" height="${plotH}" fill="rgba(239,68,68,0.06)" />`;
  html += `<text x="${(peakX1 + peakX2) / 2}" y="${pad.top + 14}" text-anchor="middle" font-size="11" fill="#b91c1c">Špička (12–24 h)</text>`;

  // Mřížka Y
  for (let i = 0; i <= 4; i++) {
    const val = (maxY / 4) * i;
    const y = yScale(val);
    html += `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="3,3" />`;
    html += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#475569">${Math.round(val)}</text>`;
  }

  // Osa X
  for (let h = 0; h <= 48; h += 12) {
    const x = xScale(h);
    html += `<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + plotH}" stroke="#f1f5f9" />`;
    html += `<text x="${x}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#475569">${h} h</text>`;
  }

  // Osy
  html += `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" stroke="#94a3b8" />`;
  html += `<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${W - pad.right}" y2="${pad.top + plotH}" stroke="#94a3b8" />`;
  html += `<text x="14" y="${pad.top + plotH / 2}" transform="rotate(-90 14 ${pad.top + plotH / 2})" text-anchor="middle" font-size="11" fill="#475569">${yLabel}</text>`;

  // ABM pásmo min-max
  const topPts = abmBandSeries.map(d => `${xScale(d.t).toFixed(1)},${yScale(d[abmMaxKey]).toFixed(1)}`);
  const botPts = [...abmBandSeries].reverse().map(d => `${xScale(d.t).toFixed(1)},${yScale(d[abmMinKey]).toFixed(1)}`);
  html += `<polygon points="${topPts.concat(botPts).join(' ')}" fill="rgba(217, 119, 6, 0.2)" />`;

  // ABM průměr
  const abmPath = abmBandSeries
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(d.t).toFixed(1)},${yScale(d[abmMeanKey]).toFixed(1)}`)
    .join(' ');
  html += `<path d="${abmPath}" fill="none" stroke="#d97706" stroke-width="2.2" />`;

  // SD křivka
  const sdPath = sdSeries
    .filter((_, idx) => idx % Math.max(1, Math.floor(sdSeries.length / 200)) === 0 || idx === sdSeries.length - 1)
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(d.t).toFixed(1)},${yScale(d[valueKeySD]).toFixed(1)}`)
    .join(' ');
  html += `<path d="${sdPath}" fill="none" stroke="#2563eb" stroke-width="2.5" />`;

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.innerHTML = html;
}

function renderKPIs(sd, abmBatch) {
  const st = abmBatch.stats;
  els.kpiGrid.innerHTML = `
    <div class="kpi">
      <div class="label">SD: Max. fronta tiketů</div>
      <div class="val" style="color: var(--sd-color)">${sd.summary.maxQueue.toFixed(1)} ks</div>
      <div class="sub">Konečná fronta: ${sd.summary.finalQueue.toFixed(1)} ks</div>
    </div>
    <div class="kpi">
      <div class="label">ABM (${abmBatch.runs}×): Max. fronta</div>
      <div class="val" style="color: var(--abm-color)">${st.maxQueue.mean.toFixed(1)} ks</div>
      <div class="sub">Rozpětí min–max: ${st.maxQueue.min} – ${st.maxQueue.max} ks</div>
    </div>
    <div class="kpi">
      <div class="label">SD: Ztracení řidiči (48 h)</div>
      <div class="val" style="color: var(--sd-color)">${sd.summary.lostDrivers.toFixed(1)}</div>
      <div class="sub">Prům. čekání: ${sd.summary.avgWaitMin.toFixed(1)} min</div>
    </div>
    <div class="kpi">
      <div class="label">ABM (${abmBatch.runs}×): Ztracení řidiči</div>
      <div class="val" style="color: var(--abm-color)">${st.lostDrivers.mean.toFixed(1)}</div>
      <div class="sub">Rozpětí: ${st.lostDrivers.min} – ${st.lostDrivers.max} | Čekání: ${st.avgWaitMin.mean.toFixed(1)} min</div>
    </div>
  `;
}

let lastSampleRun = null;

function populateAgentSelector(sampleRun) {
  lastSampleRun = sampleRun;
  // Vybereme zajímavé agenty (přednostně odešlé nebo s opakovaným voláním, plus pár vyřešených)
  const interesting = [
    ...sampleRun.tickets.filter(t => t.state === 'churned').slice(0, 10),
    ...sampleRun.tickets.filter(t => t.repeatCalled && !t.isDuplicate && t.state === 'resolved').slice(0, 5),
    ...sampleRun.tickets.filter(t => t.state === 'resolved').slice(0, 5)
  ];

  const unique = [];
  const seen = new Set();
  for (const t of interesting) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      unique.push(t);
    }
  }

  els.agentSelect.innerHTML = unique
    .map(t => `<option value="${t.id}">Tiket #${t.id} (${t.driverType}, trpělivost ${t.patienceMin} min) – ${t.state}</option>`)
    .join('');

  if (unique.length > 0) {
    showAgentTrace(unique[0].id);
  } else {
    els.agentTrace.innerHTML = '<div>Žádní agenti k zobrazení.</div>';
  }
}

function showAgentTrace(ticketId) {
  if (!lastSampleRun) return;
  const tk = lastSampleRun.tickets.find(t => t.id === Number(ticketId));
  if (!tk) return;
  els.agentTrace.innerHTML = tk.log.map(line => `<div>${line}</div>`).join('');
}

function runActiveSimulation() {
  const inp = readParams();
  const sd = runSDModel({
    ...DEFAULT_SD_PARAMS,
    operators: inp.operators,
    demandMultiplier: inp.demandMultiplier,
    failureFactor: inp.failureFactor,
    serviceTimeMin: inp.serviceTimeMin,
    patienceThresholdMin: inp.patienceMin,
    dt: inp.dt
  });

  const abmBatch = runABMBatch({
    ...DEFAULT_ABM_PARAMS,
    operators: inp.operators,
    demandMultiplier: inp.demandMultiplier,
    failureFactor: inp.failureFactor,
    serviceTimeMin: inp.serviceTimeMin,
    patienceMeanMin: inp.patienceMin,
    seed: inp.seed
  }, inp.runs);

  renderKPIs(sd, abmBatch);
  renderSVGChart(els.chartQueue, sd.series, abmBatch.bandSeries, 'queue', 'queueMean', 'queueMin', 'queueMax', 'Fronta (ks tiketů)');
  renderSVGChart(els.chartLost, sd.series, abmBatch.bandSeries, 'lostDrivers', 'lostMean', 'lostMin', 'lostMax', 'Ztracení řidiči (os.)');
  populateAgentSelector(abmBatch.sampleRun);
}

function runScenarioComparisonTable() {
  const inp = readParams();
  els.compareTableBody.innerHTML = SCENARIOS.map(sc => {
    const sd = runSDModel({
      operators: sc.operators,
      demandMultiplier: sc.demandMultiplier,
      failureFactor: sc.failureFactor,
      serviceTimeMin: sc.serviceTimeMin,
      patienceThresholdMin: sc.patienceMin,
      dt: inp.dt
    });
    const abm = runABMBatch({
      operators: sc.operators,
      demandMultiplier: sc.demandMultiplier,
      failureFactor: sc.failureFactor,
      serviceTimeMin: sc.serviceTimeMin,
      patienceMeanMin: sc.patienceMin,
      seed: inp.seed
    }, inp.runs);

    return `
      <tr>
        <td><strong>${sc.name}</strong></td>
        <td>${sd.summary.maxQueue.toFixed(1)} ks</td>
        <td>${sd.summary.lostDrivers.toFixed(1)}</td>
        <td>${abm.stats.maxQueue.mean.toFixed(1)} ks (${abm.stats.maxQueue.min}–${abm.stats.maxQueue.max})</td>
        <td>${abm.stats.lostDrivers.mean.toFixed(1)} (${abm.stats.lostDrivers.min}–${abm.stats.lostDrivers.max})</td>
        <td>${abm.stats.avgWaitMin.mean.toFixed(1)} min</td>
      </tr>
    `;
  }).join('');
}

function renderTests() {
  const results = runAllTests();
  els.testsTableBody.innerHTML = results.map(r => `
    <tr>
      <td><strong>${r.model}</strong></td>
      <td>${r.name}</td>
      <td>${r.expected}</td>
      <td>${r.actual}</td>
      <td>${r.conclusion}</td>
      <td class="${r.passed ? 'status-pass' : 'status-fail'}">${r.passed ? 'PASS' : 'FAIL'}</td>
    </tr>
  `).join('');
}

// Inicializace UI
SCENARIOS.forEach((sc, idx) => {
  const btn = document.createElement('button');
  btn.className = `scenario-btn${idx === 0 ? ' active' : ''}`;
  btn.dataset.id = sc.id;
  btn.textContent = sc.name;
  btn.addEventListener('click', () => applyScenario(sc));
  els.scenarioBar.appendChild(btn);
});

els.runBtn.addEventListener('click', runActiveSimulation);
els.compareAllBtn.addEventListener('click', runScenarioComparisonTable);
els.runTestsBtn.addEventListener('click', renderTests);
els.agentSelect.addEventListener('change', e => showAgentTrace(e.target.value));

// První spuštění po načtení
runActiveSimulation();
runScenarioComparisonTable();
renderTests();

})();
