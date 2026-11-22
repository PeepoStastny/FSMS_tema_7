window.UrbanFlow = window.UrbanFlow || {};

function runAllTests() {
  const { runSDModel, runABMModel, runABMBatch } = window.UrbanFlow;
  const results = [];

  // --- TESTY SYSTÉMOVÉ DYNAMIKY (SD) ---

  // SD Test 1: Nezápornost zásob a přesnost hmotnostní bilance
  {
    const res = runSDModel({ demandMultiplier: 1.8, operators: 10 });
    const allNonNegative = res.series.every(pt => pt.queue >= 0 && pt.lostDrivers >= 0);
    const expectedTotal = res.params.initialQueue + res.summary.totalInflow;
    const actualAccounted = res.summary.finalQueue + res.summary.totalResolved + res.summary.lostDrivers;
    const balanceError = Math.abs(expectedTotal - actualAccounted);
    const passed = allNonNegative && balanceError < 1e-4;

    results.push({
      model: 'SD',
      name: 'Test 1: Nezápornost zásob a bilance toků',
      expected: 'Všechny zásoby >= 0 po celou dobu simulace a chyba bilance < 0,0001 tiketu.',
      actual: `Nezáporné zásoby: ${allNonNegative ? 'ANO' : 'NE'}; Přítok+počátek = ${expectedTotal.toFixed(2)}, Výstup+konec = ${actualAccounted.toFixed(2)} (odchylka ${balanceError.toExponential(2)}).`,
      conclusion: passed
        ? 'Model správně zachovává toky – žádný tiket nevzniká ani nemizí bez záznamu.'
        : 'Chyba v bilanci nebo záporná zásoba!',
      passed
    });
  }

  // SD Test 2: Citlivost na zmenšení časového kroku dt
  {
    const coarse = runSDModel({ demandMultiplier: 1.8, operators: 10, dt: 0.05 });
    const fine = runSDModel({ demandMultiplier: 1.8, operators: 10, dt: 0.01 });
    const diffLost = Math.abs(coarse.summary.lostDrivers - fine.summary.lostDrivers);
    const relDiff = (diffLost / Math.max(1, fine.summary.lostDrivers)) * 100;
    const passed = relDiff < 5;

    results.push({
      model: 'SD',
      name: 'Test 2: Citlivost na časový krok (dt = 0,05 h vs 0,01 h)',
      expected: 'Zjemnění kroku 5× nezpůsobí zásadní změnu výsledku (rozdíl ztracených řidičů < 5 %).',
      actual: `dt=0,05 h: ${coarse.summary.lostDrivers.toFixed(1)} ztracených; dt=0,01 h: ${fine.summary.lostDrivers.toFixed(1)} ztracených (rozdíl ${relDiff.toFixed(2)} %).`,
      conclusion: passed
        ? 'Numerická integrace je při dt = 0,05 h (3 min) stabilní a spolehlivá.'
        : 'Příliš velký krok dt zkresluje výsledek, je nutné dt zmenšit.',
      passed
    });
  }

  // SD Test 3: Extrémní vstup (0 operátorů dispečinku)
  {
    const res = runSDModel({ operators: 0, demandMultiplier: 1.0 });
    const passed = res.summary.totalResolved === 0 && res.summary.lostDrivers > 0;

    results.push({
      model: 'SD',
      name: 'Test 3: Extrémní vstup (0 operátorů)',
      expected: 'Při nulové kapacitě se nevyřídí žádný tiket (totalResolved = 0) a fronta/odchody rostou.',
      actual: `Vyřízeno: ${res.summary.totalResolved.toFixed(2)} tiketů, konečná fronta: ${res.summary.finalQueue.toFixed(1)}, odešlo řidičů: ${res.summary.lostDrivers.toFixed(1)}.`,
      conclusion: passed
        ? 'Hraniční podmínka kapacity funguje realisticky bez dělení nulou.'
        : 'Model při 0 operátorech selhal nebo vyřídil tikety bez kapacity.',
      passed
    });
  }

  // --- TESTY AGENTOVÉHO MODELU (ABM) ---

  // ABM Test 1: Reprodukovatelnost při stejném seedu
  {
    const runA = runABMModel({ demandMultiplier: 1.8, operators: 10, seed: 42 });
    const runB = runABMModel({ demandMultiplier: 1.8, operators: 10, seed: 42 });
    const identical =
      runA.summary.lostDrivers === runB.summary.lostDrivers &&
      runA.summary.totalResolved === runB.summary.totalResolved &&
      runA.summary.maxQueue === runB.summary.maxQueue;

    results.push({
      model: 'ABM',
      name: 'Test 1: Determinismus seedu (seed = 42)',
      expected: 'Dva nezávislé běhy se stejným seedem vrátí identické výsledky.',
      actual: `Běh A: ${runA.summary.lostDrivers} ztracených, ${runA.summary.totalResolved} vyřízených; Běh B: ${runB.summary.lostDrivers} ztracených, ${runB.summary.totalResolved} vyřízených.`,
      conclusion: identical
        ? 'PRNG Mulberry32 zaručuje plnou reprodukovatelnost experimentů.'
        : 'Detekována nekontrolovaná náhodnost mimo PRNG!',
      passed: identical
    });
  }

  // ABM Test 2: Nepřekročení kapacity operátorů
  {
    const res = runABMModel({ demandMultiplier: 1.8, operators: 10, seed: 101 });
    const withinCapacity = res.summary.maxBusyOperators <= res.params.operators;

    results.push({
      model: 'ABM',
      name: 'Test 2: Respektování kapacity operátorů',
      expected: 'Počet současně pracujících operátorů v žádné minutě nepřekročí 10.',
      actual: `Maximum současně vytížených operátorů během 48 h: ${res.summary.maxBusyOperators} / ${res.params.operators}.`,
      conclusion: withinCapacity
        ? 'Alokace agentů respektuje kapacitní strop dispečinku.'
        : 'Chyba: bylo obsazeno více operátorů, než je k dispozici!',
      passed: withinCapacity
    });
  }

  // ABM Test 3: Konzistence stavů agentů a rozptyl napříč 10 seedy
  {
    const batch = runABMBatch({ demandMultiplier: 1.8, operators: 10, seed: 42 }, 10);
    const sample = batch.sampleRun;
    const sumStates =
      sample.summary.totalResolved +
      sample.summary.lostDrivers +
      sample.summary.finalQueue +
      sample.summary.inServiceCount;
    const stateConservation = sumStates === sample.summary.totalCreated;
    const hasSpread = batch.stats.lostDrivers.max > batch.stats.lostDrivers.min;
    const passed = stateConservation && hasSpread;

    results.push({
      model: 'ABM',
      name: 'Test 3: Konzistence stavů agentů a rozptyl 10 seedů',
      expected: 'Součet stavů všech tiketů = celkový počet vzniklých tiketů; 10 seedů ukáže nenulový rozptyl.',
      actual: `Stavy: ${sumStates} / ${sample.summary.totalCreated} tiketů; Ztracení řidiči (10 seedů): průměr ${batch.stats.lostDrivers.mean.toFixed(1)}, rozpětí ${batch.stats.lostDrivers.min}–${batch.stats.lostDrivers.max}.`,
      conclusion: passed
        ? 'Žádný agent se neztratil ani nezdvojil; stochastika vytváří realistické rozpětí.'
        : 'Chyba v přechodech stavů nebo nulový rozptyl.',
      passed
    });
  }

  return results;
}

window.UrbanFlow.runAllTests = runAllTests;
