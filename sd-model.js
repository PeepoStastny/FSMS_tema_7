/**
 * Model shora: Systémová dynamika (SD) pro dispečink 24/7 UrbanFlow Mobility a.s.
 * Numerická integrace Eulerovou metodou s volitelným časovým krokem dt.
 */

window.UrbanFlow = window.UrbanFlow || {};

const DEFAULT_SD_PARAMS = {
  operators: 10,              // počet operátorů dispečinku [osoby]
  serviceTimeMin: 12,         // průměrná doba odbavení 1 tiketu [min/tiket]
  baseArrivalRate: 35,        // základní přítok nových tiketů [tiketů/hod]
  demandMultiplier: 1.0,      // násobitel poptávky během špičky (12.–24. hod) [-]
  failureFactor: 1.0,         // faktor poruchovosti IoT závor [-]
  repeatCallThreshold: 20,    // práh fronty pro opakovaná volání [tikety]
  repeatCallRate: 0.35,       // míra opakovaných volání nad prahem [1/hod]
  patienceThresholdMin: 25,   // práh průměrné čekací doby pro odchod [min]
  churnRateMax: 0.40,         // max. intenzita odchodu z čekající fronty [1/hod]
  initialQueue: 2,            // počáteční stav fronty [tikety]
  initialDrivers: 280000,     // aktivní registrovaní řidiči [osoby]
  horizonHours: 48,           // délka simulace [hod]
  dt: 0.05                    // časový krok [hod] (0.05 h = 3 min)
};

function isPeakHour(tHours) {
  return tHours >= 12 && tHours < 24;
}

function runSDModel(customParams = {}) {
  const p = { ...DEFAULT_SD_PARAMS, ...customParams };
  const steps = Math.round(p.horizonHours / p.dt);

  let queue = p.initialQueue;
  let lostDrivers = 0;
  let totalInflow = 0;
  let totalResolved = 0;
  let totalRepeatCalls = 0;

  const series = [];
  let maxQueue = queue;
  let maxWaitMin = 0;
  let waitSum = 0;

  const maxCapacityPerHour = p.operators * (60 / p.serviceTimeMin);
  const serviceTimeHours = p.serviceTimeMin / 60;

  for (let i = 0; i <= steps; i++) {
    const t = Number((i * p.dt).toFixed(4));
    const peak = isPeakHour(t);

    const avgWaitMin = maxCapacityPerHour > 0
      ? (queue / maxCapacityPerHour) * 60
      : (queue > 0 ? 999 : 0);

    if (queue > maxQueue) maxQueue = queue;
    if (avgWaitMin > maxWaitMin && maxCapacityPerHour > 0) maxWaitMin = avgWaitMin;
    waitSum += avgWaitMin;

    series.push({
      t,
      queue,
      lostDrivers,
      activeDrivers: p.initialDrivers - lostDrivers,
      avgWaitMin: Math.min(avgWaitMin, 240)
    });

    if (i === steps) break;

    // Toky v kroku dt
    const baseInflowRate = p.baseArrivalRate * p.failureFactor * (peak ? p.demandMultiplier : 1.0);
    const repeatInflowRate = Math.max(0, queue - p.repeatCallThreshold) * p.repeatCallRate;
    const inflowRate = baseInflowRate + repeatInflowRate;

    const desiredOutflowRate = queue / serviceTimeHours;
    const resolvedRate = Math.min(desiredOutflowRate, maxCapacityPerHour);

    let churnRate = 0;
    if (avgWaitMin > p.patienceThresholdMin && queue > 0) {
      const overloadRatio = Math.min(1, (avgWaitMin - p.patienceThresholdMin) / p.patienceThresholdMin);
      churnRate = queue * p.churnRateMax * overloadRatio;
    }

    // Ochrana proti záporné zásobě při větším dt
    const availableWithInflow = queue + inflowRate * p.dt;
    const totalOutflow = (resolvedRate + churnRate) * p.dt;
    let actualResolved = resolvedRate * p.dt;
    let actualChurn = churnRate * p.dt;

    if (totalOutflow > availableWithInflow && totalOutflow > 0) {
      const scale = availableWithInflow / totalOutflow;
      actualResolved *= scale;
      actualChurn *= scale;
    }

    queue = Math.max(0, queue + inflowRate * p.dt - actualResolved - actualChurn);
    lostDrivers += actualChurn;

    totalInflow += inflowRate * p.dt;
    totalResolved += actualResolved;
    totalRepeatCalls += repeatInflowRate * p.dt;
  }

  return {
    params: p,
    series,
    summary: {
      finalQueue: queue,
      maxQueue,
      lostDrivers,
      totalInflow,
      totalResolved,
      totalRepeatCalls,
      avgWaitMin: waitSum / (steps + 1),
      maxWaitMin
    }
  };
}

window.UrbanFlow.DEFAULT_SD_PARAMS = DEFAULT_SD_PARAMS;
window.UrbanFlow.runSDModel = runSDModel;
