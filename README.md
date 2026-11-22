# UrbanFlow Mobility a.s. – Dispečink 24/7 (SD vs. ABM)

Interaktivní webová simulace pro **Domácí úkol 2 (FSMS – Systémové myšlení a simulace)**. Porovnává model shora (**systémová dynamika**) a model zdola (**agentové modelování – ABM**) na problému přetížení dispečinku 24/7 a odchodu nespokojených řidičů.

## Jak modely spustit
1. **Online přes GitHub Pages:** Otevřete nasazenou URL adresu repozitáře.
2. **Lokálně bez instalace a internetu:** Stačí otevřít soubor `index.html` v libovolném moderním prohlížeči (Chrome, Edge, Firefox).

## Kde změnit klíčové parametry a seed
* **Přímo v webovém rozhraní (sekce 2):**
  * `Počet operátorů [os.]` (výchozí `10`, v zásahu A `14`)
  * `Násobitel špičky (12–24 h)` (výchozí `1.0`, ve špičce `1.8`)
  * `Faktor poruchovosti závor` (výchozí `1.0`, v zásahu B `0.7`)
  * `Doba vyřízení tiketu [min]` (výchozí `12`)
  * `Střední trpělivost [min]` (výchozí `25`)
  * `Časový krok SD dt [hod]` (výchozí `0.05` h = 3 min)
  * `ABM počáteční Seed` (výchozí `42`) a `Počet ABM běhů` (výchozí `10`, spouští seedy `seed, seed+1, ..., seed+9`).
* **V kódu:**
  * Výchozí parametry SD modelu jsou v `sd-model.js` (`DEFAULT_SD_PARAMS`).
  * Výchozí parametry ABM modelu jsou v `abm-model.js` (`DEFAULT_ABM_PARAMS`).

## Jak zopakovat scénáře a testy
* V horní části sekce **2. Interaktivní simulace & Scénáře „Co kdyby…?“** klikněte na přednastavená tlačítka scénářů (1–4).
* Sekce **4** automaticky porovnává všechny 4 scénáře najednou (pro ABM počítá průměr a rozpětí min–max z nastaveného počtu běhů).
* Sekce **5** umožňuje vybrat konkrétního agenta (tiket) a zobrazit jeho minutové rozhodování.
* Sekce **6** spouští 6 automatických testů (3 pro SD, 3 pro ABM) definovaných v `tests.js`.

## Struktura souborů
* `index.html` – hlavní rozhraní a schémata modelů
* `styles.css` – styly aplikace
* `sd-model.js` – model systémové dynamiky (Eulerova metoda)
* `abm-model.js` – agentový model (diskrétní krok 1 min, deterministický PRNG Mulberry32)
* `tests.js` – automatické verifikační testy obou modelů
* `app.js` – vykreslování SVG grafů, tabulek a propojení UI
