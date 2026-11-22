/**
 * Model zdola: Agentové modelování (ABM) pro dispečink 24/7 UrbanFlow Mobility a.s.
 * Diskrétní simulace po 1 minutě s reprodukovatelným PRNG (Mulberry32).
 */

window.UrbanFlow = window.UrbanFlow || {};

const DEFAULT_ABM_PARAMS = {
  operators: 10,              // počet operátorů dispečinku [osoby]
  serviceTimeMin: 12,         // základní doba odbavení tiketu [min]
  baseArrivalRate: 35,        // základní přítok nových tiketů [tiketů/hod]
  demandMultiplier: 1.0,      // násobitel poptávky během špičky (12.–24. hod) [-]
  failureFactor: 1.0,         // faktor poruchovosti IoT závor [-]
  patienceMeanMin: 25,        // střední trpělivost řidiče [min]
  impatientShare: 0.35,       // podíl "spěchajících" řidičů (nižší trpělivost) [-]
  repeatCallProb: 0.28,       // pravděpodobnost opakovaného volání při čekání > 60 % trpělivosti [-]
  initialQueue: 2,            // počáteční tikety ve frontě [ks]
  horizonHours: 48,           // délka simulace [hod]
  seed: 42                    // seed pro generátor náhodných čísel
};

// Deterministický PRNG Mulberry32
function createRNG(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePoisson(lambda, rng) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function createTicket(id, minute, rng, p, isDuplicate = false) {
  const isImpatient = rng() < p.impatientShare;
  // Spěchající řidič má trpělivost ~45–75 % průměru, běžný ~85–160 % průměru
  const patienceFactor = isImpatient
    ? 0.45 + rng() * 0.30
    : 0.85 + rng() * 0.75;
  const patienceMin = Math.max(5, Math.round(p.patienceMeanMin * patienceFactor));
  const complexityFactor = isDuplicate ? 0.55 : (0.75 + rng() * 0.60);

  return {
    id,
    createdAtMin: minute,
    driverType: isImpatient ? 'spěchající' : 'běžný',
    patienceMin,
    complexityFactor,
    isDuplicate,
    repeatCalled: isDuplicate, // duplicitní tiket už sám další duplicitu nevyvolá
    waitedMin: 0,
    state: 'waiting', // 'waiting' | 'in_service' | 'resolved' | 'churned'
    assignedOperator: null,
    resolvedAtMin: null,
    churnedAtMin: null,
    log: [
      `Minuta ${minute} (${(minute / 60).toFixed(1)} h): Vznik tiketu #${id} (typ řidiče: ${isImpatient ? 'spěchající' : 'běžný'}, trpělivost ${patienceMin} min${isDuplicate ? ', opakované volání' : ''}).`
    ]
  };
}

function runABMModel(customParams = {}) {
  const p = { ...DEFAULT_ABM_PARAMS, ...customParams };
  const rng = createRNG(p.seed);
  const totalMinutes = p.horizonHours * 60;

  // Inicializace operátorů (mix seniorů a juniorů)
  const operators = Array.from({ length: p.operators }, (_, idx) => ({
    id: `OP-${idx + 1}`,
    level: idx % 3 === 0 ? 'senior' : 'standard',
    skillMultiplier: idx % 3 === 0 ? 0.85 : 1.05,
    state: 'idle',
    currentTicketId: null,
    remainingMin: 0
  }));

  const tickets = [];
  const waitingQueue = [];
  let nextTicketId = 1;

  for (let i = 0; i < p.initialQueue; i++) {
    const tk = createTicket(nextTicketId++, 0, rng, p, false);
    tickets.push(tk);
    waitingQueue.push(tk);
  }

  const series = [];
  let maxQueue = waitingQueue.length;
  let maxBusySeen = 0;
  let churnedCount = 0;
  let resolvedCount = 0;
  let repeatCallsCount = 0;
  let waitTimesResolved = [];

  for (let m = 0; m <= totalMinutes; m++) {
    const tHour = m / 60;
    const isPeak = tHour >= 12 && tHour < 24;

    // Uložení vzorku každých 15 minut (shodné rozlišení pro srovnání s SD)
    if (m % 15 === 0) {
      const avgWait = waitTimesResolved.length > 0
        ? waitTimesResolved.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, waitTimesResolved.length)
        : 0;
      series.push({
        t: Number(tHour.toFixed(2)),
        queue: waitingQueue.length,
        lostDrivers: churnedCount,
        avgWaitMin: Number(avgWait.toFixed(1))
      });
    }

    if (m === totalMinutes) break;

    // 1. PŘÍCHOD NOVÝCH TIKETŮ (Poisson)
    const arrivalPerMin = (p.baseArrivalRate * p.failureFactor * (isPeak ? p.demandMultiplier : 1.0)) / 60;
    const newArrivals = samplePoisson(arrivalPerMin, rng);
    for (let a = 0; a < newArrivals; a++) {
      const tk = createTicket(nextTicketId++, m, rng, p, false);
      tickets.push(tk);
      waitingQueue.push(tk);
    }

    // 2. POSUN ROZPRACOVANÝCH TIKETŮ U OPERÁTORŮ
    let busyNow = 0;
    for (const op of operators) {
      if (op.state === 'busy') {
        op.remainingMin -= 1;
        if (op.remainingMin <= 0) {
          const tk = tickets[op.currentTicketId - 1];
          tk.state = 'resolved';
          tk.resolvedAtMin = m;
          tk.log.push(`Minuta ${m}: Operátor ${op.id} (${op.level}) tiket vyřešil po ${tk.waitedMin} min čekání.`);
          resolvedCount++;
          waitTimesResolved.push(tk.waitedMin);

          op.state = 'idle';
          op.currentTicketId = null;
          op.remainingMin = 0;
        } else {
          busyNow++;
        }
      }
    }
    if (busyNow > maxBusySeen) maxBusySeen = busyNow;

    // 3. KONTROLA ČEKAJÍCÍCH ŘIDIČŮ (trpělivost, opakovaná volání, odchod)
    const stillWaiting = [];
    for (const tk of waitingQueue) {
      tk.waitedMin += 1;

      // Opakované volání při delším čekání
      if (!tk.repeatCalled && tk.waitedMin >= Math.round(tk.patienceMin * 0.6)) {
        const prob = tk.driverType === 'spěchající' ? p.repeatCallProb * 1.4 : p.repeatCallProb;
        if (rng() < prob * 0.15) {
          tk.repeatCalled = true;
          repeatCallsCount++;
          tk.log.push(`Minuta ${m}: Netrpělivé opakované volání po ${tk.waitedMin} min čekání (vytvořen duplicitní tiket #${nextTicketId}).`);
          const dup = createTicket(nextTicketId++, m, rng, p, true);
          tickets.push(dup);
          stillWaiting.push(dup);
        }
      }

      // Překročení trpělivosti -> odchod řidiče
      if (tk.waitedMin >= tk.patienceMin) {
        tk.state = 'churned';
        tk.churnedAtMin = m;
        tk.log.push(`Minuta ${m}: Překročena trpělivost (${tk.waitedMin}/${tk.patienceMin} min) → řidič opustil frontu a službu.`);
        churnedCount++;
      } else {
        stillWaiting.push(tk);
      }
    }
    waitingQueue.length = 0;
    for (const tk of stillWaiting) waitingQueue.push(tk);

    // 4. PŘIŘAZENÍ VOLNÝCH OPERÁTORŮ (FIFO)
    for (const op of operators) {
      if (op.state === 'idle' && waitingQueue.length > 0) {
        const tk = waitingQueue.shift();
        tk.state = 'in_service';
        tk.assignedOperator = op.id;
        const duration = Math.max(2, Math.round(p.serviceTimeMin * tk.complexityFactor * op.skillMultiplier));
        tk.log.push(`Minuta ${m}: Přiřazen operátor ${op.id} (${op.level}), odhad vyřízení ${duration} min.`);
        op.state = 'busy';
        op.currentTicketId = tk.id;
        op.remainingMin = duration;
      }
    }

    const currentBusy = operators.filter(o => o.state === 'busy').length;
    if (currentBusy > maxBusySeen) maxBusySeen = currentBusy;
    if (waitingQueue.length > maxQueue) maxQueue = waitingQueue.length;
  }

  const inServiceCount = operators.filter(o => o.state === 'busy').length;
  const avgWaitAll = waitTimesResolved.length > 0
    ? waitTimesResolved.reduce((a, b) => a + b, 0) / waitTimesResolved.length
    : 0;

  return {
    params: p,
    series,
    tickets,
    summary: {
      totalCreated: tickets.length,
      finalQueue: waitingQueue.length,
      inServiceCount,
      maxQueue,
      lostDrivers: churnedCount,
      totalResolved: resolvedCount,
      totalRepeatCalls: repeatCallsCount,
      avgWaitMin: avgWaitAll,
      maxBusyOperators: maxBusySeen
    }
  };
}

/**
 * Spustí dávku N běhů ABM s různými seedy (pro zadání min. 10 běhů)
 * a spočítá průměr, minimum a maximum v každém časovém bodě i v souhrnu.
 */
function runABMBatch(customParams = {}, runs = 10) {
  const baseSeed = customParams.seed ?? DEFAULT_ABM_PARAMS.seed;
  const results = [];

  for (let r = 0; r < runs; r++) {
    results.push(runABMModel({ ...customParams, seed: baseSeed + r }));
  }

  const len = results[0].series.length;
  const bandSeries = [];
  for (let i = 0; i < len; i++) {
    const queues = results.map(res => res.series[i].queue);
    const losts = results.map(res => res.series[i].lostDrivers);
    bandSeries.push({
      t: results[0].series[i].t,
      queueMean: queues.reduce((a, b) => a + b, 0) / runs,
      queueMin: Math.min(...queues),
      queueMax: Math.max(...queues),
      lostMean: losts.reduce((a, b) => a + b, 0) / runs,
      lostMin: Math.min(...losts),
      lostMax: Math.max(...losts)
    });
  }

  const stat = (fn) => {
    const vals = results.map(fn);
    return {
      mean: vals.reduce((a, b) => a + b, 0) / runs,
      min: Math.min(...vals),
      max: Math.max(...vals)
    };
  };

  return {
    runs,
    seeds: results.map(r => r.params.seed),
    bandSeries,
    stats: {
      maxQueue: stat(r => r.summary.maxQueue),
      finalQueue: stat(r => r.summary.finalQueue),
      lostDrivers: stat(r => r.summary.lostDrivers),
      totalResolved: stat(r => r.summary.totalResolved),
      avgWaitMin: stat(r => r.summary.avgWaitMin)
    },
    sampleRun: results[0]
  };
}

window.UrbanFlow.DEFAULT_ABM_PARAMS = DEFAULT_ABM_PARAMS;
window.UrbanFlow.runABMModel = runABMModel;
window.UrbanFlow.runABMBatch = runABMBatch;
