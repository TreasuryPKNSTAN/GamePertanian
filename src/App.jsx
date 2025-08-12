import React, { useEffect, useMemo, useState } from "react";

/**
 * Kota Pangan Mandiri – Prototype (Single-file React)
 *
 * — What’s included —
 * • Grid map (20x12) with buildable tiles
 * • Buildings: CG (Community Garden), RG (Roof Garden), VF (Vertical Farm), Market, RainTank, ColdHub, Compost, Solar, EduCenter
 * • Crops: selada, kangkung, pakcoy, tomat, cabai, jamur
 * • Simulation tick (1 sec = 1 day) with weather events (Heatwave / Flood)
 * • Resources & KPIs: Budget, Water, Energy, PSI, Happiness, Emissions, Storage
 * • Distribution via Markets; ColdHub reduces postharvest losses
 * • Policies: Rooftop Incentive, Source Separation
 * • Tutorial flow (7 steps) with auto-check conditions
 * • Minimal charts (SVG sparkline) for PSI & Production history (no external libs)
 * • Save / Load via localStorage
 *
 * TailwindCSS assumed. No external UI libs to ensure preview works everywhere.
 */

// ---------- Helpers & Constants ----------
const W = 20; // grid width
const H = 12; // grid height
const TICK_MS = 1000; // 1 sec = 1 day
const START_BUDGET = 800_000_000; // IDR
const POPULATION = 10000;
const DEMAND_KG_PER_CAPITA_PER_DAY = 0.5; // target local fresh food
const WATER_COST_PER_M3 = 4500; // IDR
const ENERGY_COST_PER_KWH = 1600; // IDR
const EMISSION_FACTOR_KG_PER_KWH = 0.8 / 1000; // tCO2e per kWh
const START_PREF_LOCAL = 0.5; // starting preference for local food (0..1)

const CROPS = {
  selada: { name: "Selada", baseYield: 3.0, days: 30, water: 60, baseLoss: 0.10, price: 16000, kcal: 150 },
  kangkung: { name: "Kangkung", baseYield: 3.5, days: 21, water: 45, baseLoss: 0.08, price: 12000, kcal: 130 },
  pakcoy: { name: "Pakcoy", baseYield: 3.2, days: 28, water: 55, baseLoss: 0.09, price: 18000, kcal: 130 },
  tomat: { name: "Tomat", baseYield: 5.0, days: 70, water: 120, baseLoss: 0.12, price: 20000, kcal: 180 },
  cabai: { name: "Cabai", baseYield: 2.2, days: 90, water: 140, baseLoss: 0.12, price: 60000, kcal: 280 },
  jamur: { name: "Jamur", baseYield: 7.0, days: 30, water: 25, baseLoss: 0.07, price: 22000, kcal: 240 },
};

const BUILDINGS = {
  EMPTY: { id: "EMPTY", label: "Kosong", cost: 0, canPlant: false, category: "land" },
  CG: { id: "CG", label: "Kebun Komunitas", cost: 2_500_000, canPlant: true, method: "CG", category: "land" },
  RG: { id: "RG", label: "Roof Garden", cost: 4_000_000, canPlant: true, method: "RG", category: "roof" },
  VF: { id: "VF", label: "Vertical Farm", cost: 250_000_000, canPlant: true, method: "VF", category: "roof" },
  MARKET: { id: "MARKET", label: "Pasar Lokal", cost: 40_000_000, canPlant: false, category: "service" },
  RAIN: { id: "RAIN", label: "Rain Tank", cost: 10_000_000, canPlant: false, category: "infra" },
  COLD: { id: "COLD", label: "Cold Hub", cost: 75_000_000, canPlant: false, category: "infra" },
  COMPOST: { id: "COMPOST", label: "Komposter", cost: 20_000_000, canPlant: false, category: "infra" },
  SOLAR: { id: "SOLAR", label: "Solar + Battery", cost: 60_000_000, canPlant: false, category: "infra" },
  EDU: { id: "EDU", label: "Pusat Edukasi", cost: 30_000_000, canPlant: false, category: "service" },
};

const METHOD_MULT = {
  CG: { yield: 1.0, water: 1.0, energy: 0.1 },
  RG: { yield: 1.1, water: 0.9, energy: 0.15 },
  VF: { yield: 3.0, water: 0.5, energy: 2.5 },
};

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function fmt(n) { return n.toLocaleString("id-ID"); }
function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function initGrid() {
  const grid = [];
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 20; x++) {
      const roof = Math.random() < 0.3;
      grid.push({ x, y, category: roof ? "roof" : "land", b: "EMPTY", crop: null, progress: 0, disabledDays: 0 });
    }
  }
  grid[2 * 20 + 3] = { ...grid[2 * 20 + 3], b: "CG", crop: "pakcoy" };
  grid[2 * 20 + 4] = { ...grid[2 * 20 + 4], b: "CG", crop: "kangkung" };
  grid[1 * 20 + 15] = { ...grid[1 * 20 + 15], b: "MARKET" };
  grid[3 * 20 + 5] = { ...grid[3 * 20 + 5], b: "RAIN" };
  return grid;
}

export default function App() {
  const [grid, setGrid] = useState(() => loadSavedGrid() || initGrid());
  const [day, setDay] = useState(() => loadSavedNumber("kpm_day", 1));
  const [budget, setBudget] = useState(() => loadSavedNumber("kpm_budget", 800_000_000));
  const [water, setWater] = useState(() => loadSavedNumber("kpm_water", 0));
  const [energy, setEnergy] = useState(() => loadSavedNumber("kpm_energy", 0));
  const [storage, setStorage] = useState(() => loadSavedStorage());
  const [psi, setPSI] = useState(() => loadSavedNumber("kpm_psi", 0));
  const [happiness, setHappiness] = useState(() => loadSavedNumber("kpm_happiness", 65));
  const [emissions, setEmissions] = useState(() => loadSavedNumber("kpm_emissions", 0));
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState("build");
  const [buildSel, setBuildSel] = useState("CG");
  const [plantSel, setPlantSel] = useState("pakcoy");
  const [messages, setMessages] = useState([{ d: 0, t: "Selamat datang! Bangun kebun, panen, dan capai kemandirian pangan." }]);
  const [policy, setPolicy] = useState({ rooftopIncentive: false, sourceSeparation: false });
  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState(() => loadSavedHistory());
  const [tutorial, setTutorial] = useState(initTutorial());

  const city = useMemo(() => computeCityModifiers(grid, policy), [grid, policy]);

  useEffect(() => {
    if (speed === 0) return;
    const id = setInterval(() => stepDay(), TICK_MS / speed);
    return () => clearInterval(id);
  }, [speed, grid, budget, policy, events, storage, day]);

  function stepDay() {
    let newGrid = [...grid];
    let dayWater = 0;
    let dayEnergy = 0;
    let dayProdByCrop = {};
    let messagesOut = [];

    let newEvents = events.map(ev => ({ ...ev, daysLeft: ev.daysLeft - 1 })).filter(ev => ev.daysLeft > 0);

    if (Math.random() < 0.06) {
      const ev = Math.random() < 0.5 ? { type: "HEATWAVE", daysLeft: randInt(3, 5) } : { type: "FLOOD", daysLeft: randInt(2, 3) };
      newEvents.push(ev);
      messagesOut.push(`Event: ${ev.type === "HEATWAVE" ? "Gelombang Panas" : "Banjir"} selama ${ev.daysLeft} hari!`);
    }

    const heatwave = newEvents.some(e => e.type === "HEATWAVE");
    const flood = newEvents.some(e => e.type === "FLOOD");

    newGrid = newGrid.map((tile) => {
      let t = { ...tile };
      if (t.disabledDays && t.disabledDays > 0) {
        t.disabledDays -= 1;
        return t;
      }
      if (flood && t.b === "CG" && t.category === "land") {
        t.disabledDays = 1;
        return t;
      }

      if (["CG", "RG", "VF"].includes(t.b) && t.crop) {
        const crop = CROPS[t.crop];
        const m = METHOD_MULT[t.b];
        const weatherYieldMult = heatwave ? 0.95 : 1.0;
        const growthPerDay = (1 / crop.days) * m.yield * weatherYieldMult;
        t.progress = clamp((t.progress || 0) + growthPerDay, 0, 1);

        const waterUseL = crop.water * m.water * (heatwave ? 1.15 : 1.0) * (1 - city.irrigationEfficiency);
        dayWater += waterUseL / 1000;
        const energyKwh = m.energy * (t.b === "VF" ? (heatwave ? 1.2 : 1.0) : 1.0);
        dayEnergy += energyKwh;

        if (t.progress >= 1) {
          const baseYield = crop.baseYield * m.yield * (heatwave ? 0.95 : 1.0);
          const coldQuality = city.coldChainQuality;
          let lossRate = crop.baseLoss * (heatwave ? 1.1 : 1.0) * (1 - coldQuality);
          lossRate = clamp(lossRate, 0.02, 0.20);
          const harvested = baseYield * (1 - lossRate);
          dayProdByCrop[t.crop] = (dayProdByCrop[t.crop] || 0) + harvested;
          if (policy.sourceSeparation) { /* compost bonus could be tracked */ }
          t.progress = 0;
        }
      }
      return t;
    });

    const solarKwh = city.solarKwhPerDay;
    const netEnergy = Math.max(0, dayEnergy - solarKwh);
    const energyCost = netEnergy * ENERGY_COST_PER_KWH;
    const waterCost = Math.max(0, (dayWater - city.rainwaterM3PerDay)) * WATER_COST_PER_M3;
    const todayEmissions = netEnergy * EMISSION_FACTOR_KG_PER_KWH;

    const demandToday = POPULATION * DEMAND_KG_PER_CAPITA_PER_DAY * (START_PREF_LOCAL + city.prefLocalBoost);
    const capacity = city.marketCapacityKgPerDay;

    const newStorage = { ...storage };
    let totalProduced = 0;
    Object.entries(dayProdByCrop).forEach(([cropId, kg]) => {
      totalProduced += kg;
      newStorage[cropId] = (newStorage[cropId] || 0) + kg;
    });

    let toDispatch = Math.min(Object.values(newStorage).reduce((a,b)=>a+(b||0),0), capacity);
    let dispatched = 0;
    const cropKeys = Object.keys(newStorage).sort();
    for (const c of cropKeys) {
      if (toDispatch <= 0) break;
      const take = Math.min(newStorage[c], toDispatch);
      newStorage[c] -= take;
      dispatched += take;
      toDispatch -= take;
    }

    const psiToday = clamp(dispatched / demandToday, 0, 2);

    const avgPrice = (() => {
      const entries = Object.entries(dayProdByCrop);
      const tot = entries.reduce((a,[,v])=>a+v,0);
      if (!tot) return 17000;
      const sum = entries.reduce((a,[k,v])=> a + v * CROPS[k].price, 0);
      return sum / tot;
    })();
    const revenue = dispatched * avgPrice;
    const wages = 150_000 * city.workerCount;
    const opex = energyCost + waterCost + wages + 3_000_000;
    const newBudget = budget + revenue - opex;

    let newHappiness = happiness;
    newHappiness += 0.05 * city.greenTiles;
    newHappiness -= 10 * Math.max(0, 1 - psiToday);
    if (flood) newHappiness -= 2;
    if (heatwave) newHappiness -= 1;
    newHappiness = clamp(newHappiness, 0, 100);

    setGrid(newGrid);
    setWater(dayWater);
    setEnergy(dayEnergy);
    setPSI(psiToday);
    setEmissions(prev => prev + todayEmissions);
    setBudget(newBudget);
    setStorage(newStorage);
    setDay(day + 1);
    setEvents(newEvents);

    setHistory(prev => {
      const next = [...prev, { day: day + 1, psi: psiToday, prod: totalProduced }];
      return next.slice(-120);
    });

    setTutorial(tut => checkTutorial(tut, { grid: newGrid, psi: psiToday, events: newEvents }));
  }

  useEffect(() => {
    localStorage.setItem("kpm_grid", JSON.stringify(grid));
    localStorage.setItem("kpm_day", String(day));
    localStorage.setItem("kpm_budget", String(budget));
    localStorage.setItem("kpm_water", String(water));
    localStorage.setItem("kpm_energy", String(energy));
    localStorage.setItem("kpm_storage", JSON.stringify(storage));
    localStorage.setItem("kpm_psi", String(psi));
    localStorage.setItem("kpm_happiness", String(happiness));
    localStorage.setItem("kpm_emissions", String(emissions));
    localStorage.setItem("kpm_history", JSON.stringify(history));
  }, [grid, day, budget, water, energy, storage, psi, happiness, emissions, history]);

  function addMsgs(arr) {
    setMessages(prev => {
      const next = [...prev, ...arr.map(t => ({ d: day, t }))];
      return next.slice(-6);
    });
  }

  function handleTileClick(tile) {
    const idx = tile.y * 20 + tile.x;
    const t = grid[idx];

    if (mode === "build") {
      if (buildSel === "EMPTY") return;
      const def = BUILDINGS[buildSel];
      if (!def) return;
      if (t.b !== "EMPTY") return;
      if (budget < buildCost(def, policy, t)) { addMsgs(["Anggaran tidak cukup!"]); return; }
      if ((def.category === "roof") && t.category !== "roof") { addMsgs(["Butuh atap untuk RG/VF!"]); return; }
      const newTile = { ...t, b: def.id, crop: def.canPlant ? plantSel : null, progress: 0 };
      const newGrid = [...grid]; newGrid[idx] = newTile; setGrid(newGrid);
      setBudget(budget - buildCost(def, policy, t));
      addMsgs([`Bangun ${def.label}`]);
    } else if (mode === "plant") {
      if (!["CG", "RG", "VF"].includes(t.b)) { addMsgs(["Tanam hanya di CG/RG/VF"]); return; }
      if (t.b === "VF" && plantSel === "cabai") { addMsgs(["Cabai kurang efisien di VF, tapi ok…"]); }
      const newTile = { ...t, crop: plantSel };
      const newGrid = [...grid]; newGrid[idx] = newTile; setGrid(newGrid);
    } else if (mode === "bulldoze") {
      if (t.b === "EMPTY") return;
      const refund = Math.floor(buildCost(BUILDINGS[t.b], policy, t) * 0.4);
      const newTile = { ...t, b: "EMPTY", crop: null, progress: 0 };
      const newGrid = [...grid]; newGrid[idx] = newTile; setGrid(newGrid);
      setBudget(budget + refund);
    } else if (mode === "info") {
      /* could show a modal; log for now */
      const label = BUILDINGS[t.b]?.label || "Kosong";
      addMsgs([`Tile (${t.x},${t.y}) – ${label}${t.crop ? ", tanam " + CROPS[t.crop].name : ""}`]);
    }
  }

  function clearSave() {
    if (confirm("Hapus save & reset prototipe?")) {
      localStorage.clear();
      window.location.reload();
    }
  }

  return (
    <div className="w-full h-full min-h-screen bg-slate-900 text-slate-100">
      <TopBar day={day} psi={psi} happiness={happiness} emissions={emissions} budget={budget} water={water} energy={energy} history={history} />

      <div className="flex gap-4 p-4">
        {/* Sidebar */}
        <div className="w-80 flex flex-col gap-4">
          <Panel title="Mode">
            <div className="flex gap-2 flex-wrap">
              {[
                { id: "build", label: "Bangun" },
                { id: "plant", label: "Tanam" },
                { id: "bulldoze", label: "Bongkar" },
                { id: "info", label: "Info" },
              ].map(m => (
                <Btn key={m.id} onClick={() => setMode(m.id)} active={mode === m.id}>{m.label}</Btn>
              ))}
            </div>
          </Panel>

          {mode === "build" && (
            <Panel title="Bangunan">
              <BuildPicker buildSel={buildSel} setBuildSel={setBuildSel} policy={policy} />
            </Panel>
          )}

          {mode === "plant" && (
            <Panel title="Pilih Tanaman">
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(CROPS).map(([id, c]) => (
                  <Btn key={id} onClick={() => setPlantSel(id)} active={plantSel === id}>
                    <div className="text-left">
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-xs opacity-75">{c.days}h • {c.baseYield} kg/m²</div>
                    </div>
                  </Btn>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Kebijakan">
            <ToggleRow
              label="Insentif Rooftop (–20% biaya RG/VF)"
              checked={policy.rooftopIncentive}
              onChange={v => setPolicy(s => ({ ...s, rooftopIncentive: v }))}
            />
            <ToggleRow
              label="Pemilahan Organik (kompos naik, losses ↓)"
              checked={policy.sourceSeparation}
              onChange={v => setPolicy(s => ({ ...s, sourceSeparation: v }))}
            />
          </Panel>

          <Panel title="Kontrol">
            <div className="flex gap-2">
              <Btn onClick={() => setSpeed(0)} active={speed === 0}>⏸︎</Btn>
              <Btn onClick={() => setSpeed(1)} active={speed === 1}>▶︎x1</Btn>
              <Btn onClick={() => setSpeed(3)} active={speed === 3}>▶︎x3</Btn>
            </div>
            <div className="mt-3 flex gap-2">
              <Btn onClick={clearSave}>Reset</Btn>
              <Btn onClick={() => setMessages(m => [...m, { d: day, t: "Tips: Bangun Cold Hub untuk turunkan food loss!" }])}>Tips</Btn>
            </div>
          </Panel>

          <Panel title="Log">
            <div className="h-28 overflow-auto space-y-1 text-sm pr-1">
              {messages.map((m, i) => (
                <div key={i} className="opacity-90">D{m.d}: {m.t}</div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Main Map */}
        <div className="flex-1">
          <Map grid={grid} onTileClick={handleTileClick} mode={mode} buildSel={buildSel} />
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Card title="Produksi (kg/hari) – sparkline">
              <Sparkline data={history.map(h => h.prod)} />
            </Card>
            <Card title="PSI – sparkline">
              <Sparkline data={history.map(h => Math.round(h.psi * 100))} />
            </Card>
            <Card title="Ringkasan Kota">
              <Summary grid={grid} policy={policy} />
            </Card>
          </div>
        </div>

        {/* Tutorial */}
        <div className="w-96">
          <TutorialPanel tutorial={tutorial} />
        </div>
      </div>
    </div>
  );
}

function TopBar({ day, psi, happiness, emissions, budget, water, energy }) {
  return (
    <div className="w-full border-b border-slate-800 bg-slate-900/70 backdrop-blur sticky top-0 z-10">
      <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-6">
        <div className="text-xl font-bold">Kota Pangan Mandiri – Prototype</div>
        <Kpi label="Hari" value={`D${day}`} />
        <Kpi label="PSI" value={`${(psi*100).toFixed(0)}%`} good={psi>=1} warn={psi<0.8} />
        <Kpi label="Kebahagiaan" value={`${happiness.toFixed(0)}/100`} good={happiness>=70} warn={happiness<50} />
        <Kpi label="Emisi" value={`${emissions.toFixed(2)} tCO₂e`} />
        <Kpi label="Anggaran" value={`Rp ${fmt(Math.round(budget))}`} warn={budget<0} />
        <Kpi label="Air" value={`${water.toFixed(1)} m³/hari`} />
        <Kpi label="Energi" value={`${energy.toFixed(1)} kWh/hari`} />
        <div className="ml-auto text-xs opacity-70">Simpan otomatis • Single-file prototype</div>
      </div>
    </div>
  );
}

function Kpi({ label, value, good, warn }) {
  return (
    <div className={`px-3 py-1 rounded-xl text-sm bg-slate-800/60 ${good?"ring-1 ring-emerald-500/40":""} ${warn?"ring-1 ring-amber-500/40":""}`}>
      <div className="uppercase text-[10px] tracking-wider opacity-60">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="bg-slate-800/50 rounded-2xl shadow p-3 border border-slate-700/50">
      <div className="font-semibold mb-2">{title}</div>
      {children}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-slate-800/50 rounded-2xl shadow p-4 border border-slate-700/50">
      <div className="font-semibold mb-2">{title}</div>
      {children}
    </div>
  );
}

function Btn({ children, onClick, active }) {
  return (
    <button onClick={onClick} className={`px-3 py-2 rounded-xl border text-sm transition ${active?"bg-emerald-600/30 border-emerald-500/40":"bg-slate-700/40 border-slate-600/50 hover:bg-slate-700/60"}`}>
      {children}
    </button>
  );
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm">{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}

function BuildPicker({ buildSel, setBuildSel, policy }) {
  const items = ["CG", "RG", "VF", "MARKET", "RAIN", "COLD", "COMPOST", "SOLAR", "EDU"];
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(id => {
        const def = BUILDINGS[id];
        return (
          <Btn key={id} onClick={() => setBuildSel(id)} active={buildSel===id}>
            <div className="text-left">
              <div className="font-semibold">{def.label}</div>
              <div className="text-xs opacity-70">Rp {fmt(buildCost(def, policy))}</div>
              <div className="text-[10px] opacity-50">{def.category}</div>
            </div>
          </Btn>
        );
      })}
    </div>
  );
}

function Map({ grid, onTileClick }) {
  return (
    <div className="bg-slate-800/40 rounded-2xl p-2 border border-slate-700/50">
      <div className="grid" style={{ gridTemplateColumns: `repeat(20, 28px)` }}>
        {grid.map((t, idx) => (
          <Tile key={idx} t={t} onClick={() => onTileClick(t)} />
        ))}
      </div>
      <div className="text-xs opacity-70 mt-1">Petunjuk: Mode “Bangun”, pilih bangunan, lalu klik petak. Mode “Tanam”, pilih tanaman, lalu klik kebun.</div>
    </div>
  );
}

function Tile({ t, onClick }) {
  const border = t.category === "roof" ? "border-cyan-400/40" : "border-slate-600/40";
  const disabled = t.disabledDays && t.disabledDays>0;
  const label = shortLabel(t);

  return (
    <button
      onClick={onClick}
      className={`w-7 h-7 m-[2px] rounded-md border ${border} text-[10px] flex items-center justify-center select-none ${disabled?"opacity-50":""}`}
      style={{ background: tileColor(t) }}
      title={`${BUILDINGS[t.b]?.label || "Kosong"}${t.crop?" – "+CROPS[t.crop].name:""}${disabled?" (tergenang)":""}"`}
    >
      {label}
    </button>
  );
}

function shortLabel(t) {
  if (t.b === "EMPTY") return "";
  const map = { CG: "CG", RG: "RG", VF: "VF", MARKET: "P", RAIN: "R", COLD: "C", COMPOST: "K", SOLAR: "S", EDU: "E" };
  return map[t.b] || "?";
}

function tileColor(t) {
  if (t.b === "EMPTY") return t.category === "roof" ? "#0f172a" : "#0b1220";
  if (["CG","RG","VF"].includes(t.b)) {
    const prog = t.progress || 0;
    const light = Math.floor(30 + prog * 70);
    return `hsl(${t.b==="VF"?280:140} 70% ${light}%)`;
  }
  const base = {
    MARKET: "#9a3412", RAIN: "#0ea5e9", COLD: "#0369a1",
    COMPOST: "#854d0e", SOLAR: "#ca8a04", EDU: "#334155",
  }[t.b];
  return base || "#334155";
}

function Sparkline({ data = [] }) {
  const max = Math.max(1, ...data);
  const points = data.map((v, i) => `${(i/(data.length-1||1))*100},${100 - (v/max)*100}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" className="w-full h-16 bg-slate-900/40 rounded-lg">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
    </svg>
  );
}

function Summary({ grid, policy }) {
  const counts = countBuildings(grid);
  const marketCapacityKgPerDay = counts.MARKET * 1200 + counts.EDU * 100;
  const coldChainQuality = clamp(0.05 * counts.COLD, 0, 0.6);
  const solarKwhPerDay = counts.SOLAR * 60;
  const rainwaterM3PerDay = counts.RAIN * 3;
  const prefLocalBoost = clamp(0.05 * counts.EDU, 0, 0.4);
  return (
    <ul className="text-sm space-y-1">
      <li>Pasar: <b>{counts.MARKET}</b> • Kapasitas distribusi: <b>{Math.round(marketCapacityKgPerDay).toLocaleString("id-ID")} kg/hari</b></li>
      <li>Cold Hub: <b>{counts.COLD}</b> • Kualitas rantai dingin: <b>{Math.round(coldChainQuality*100)}%</b></li>
      <li>Solar: <b>{counts.SOLAR}</b> • Offset energi: <b>{Math.round(solarKwhPerDay).toLocaleString("id-ID")} kWh</b></li>
      <li>Rain Tank: <b>{counts.RAIN}</b> • Air hujan: <b>{rainwaterM3PerDay.toLocaleString("id-ID")} m³/hari</b></li>
      <li>Pusat Edukasi: <b>{counts.EDU}</b> • Preferensi lokal: <b>{Math.round((0.5+prefLocalBoost)*100)}%</b></li>
    </ul>
  );
}

function TutorialPanel({ tutorial }) {
  return (
    <div className="bg-slate-800/50 rounded-2xl shadow p-4 border border-slate-700/50 sticky top-16">
      <div className="font-semibold text-lg mb-2">Tutorial – 15 Menit Pertama</div>
      <ol className="space-y-2 text-sm list-decimal list-inside">
        {tutorial.steps.map((s, i) => (
          <li key={i} className={`p-2 rounded-md ${s.done?"bg-emerald-800/30 border border-emerald-700/40":"bg-slate-900/40"}`}>
            <div className="font-semibold">{s.title} {s.done?"✓":""}</div>
            <div className="opacity-80">{s.desc}</div>
          </li>
        ))}
      </ol>
      <div className="mt-3 text-xs opacity-70">Selesaikan semua langkah untuk “lulus” tutorial. Setelah itu, coba capai PSI ≥ 100% selama 3 hari berturut-turut tanpa defisit anggaran.</div>
    </div>
  );
}

// ---------- City Modifiers & Utils ----------
function computeCityModifiers(grid, policy) {
  const counts = countBuildings(grid);
  const marketCapacityKgPerDay = counts.MARKET * 1200 + counts.EDU * 100;
  const coldChainQuality = clamp(0.05 * counts.COLD, 0, 0.6);
  const solarKwhPerDay = counts.SOLAR * 60;
  const rainwaterM3PerDay = counts.RAIN * 3;
  const prefLocalBoost = clamp(0.05 * counts.EDU, 0, 0.4);
  const irrigationEfficiency = Math.min(0.5, 0.1 + 0.05 * counts.RAIN);
  const greenTiles = grid.filter(t => ["CG","RG","VF"].includes(t.b)).length;
  const workerCount = counts.CG*1 + counts.RG*1 + counts.VF*3 + counts.MARKET*2 + counts.COLD*2 + counts.COMPOST*1 + counts.EDU*1;
  return {
    marketCount: counts.MARKET,
    coldCount: counts.COLD,
    solarCount: counts.SOLAR,
    rainCount: counts.RAIN,
    eduCount: counts.EDU,
    marketCapacityKgPerDay,
    coldChainQuality,
    solarKwhPerDay,
    rainwaterM3PerDay,
    prefLocalBoost,
    irrigationEfficiency,
    greenTiles,
    workerCount,
  };
}

function countBuildings(grid) {
  const out = { CG:0, RG:0, VF:0, MARKET:0, RAIN:0, COLD:0, COMPOST:0, SOLAR:0, EDU:0 };
  grid.forEach(t => { if (out[t.b] !== undefined) out[t.b]++; });
  return out;
}

function buildCost(def, policy) {
  let c = def.cost;
  if (policy.rooftopIncentive && ["RG","VF"].includes(def.id)) c *= 0.8;
  return Math.round(c);
}

// ---------- Tutorial Logic ----------
function initTutorial() {
  return {
    steps: [
      { key: "build_cg", title: "Bangun 1 Kebun Komunitas (CG)", desc: "Mode Bangun → Kebun Komunitas → klik petak tanah.", done: false },
      { key: "build_rain", title: "Bangun 1 Rain Tank", desc: "Air hujan menghemat biaya air.", done: false },
      { key: "plant_fast", title: "Tanam sayur cepat (kangkung/pakcoy)", desc: "Mode Tanam → pilih → klik kebun.", done: false },
      { key: "market", title: "Bangun 1 Pasar Lokal", desc: "Agar panen tersalurkan.", done: false },
      { key: "psi25", title: "Capai PSI ≥ 25%", desc: "Tingkatkan produksi dan kapasitas distribusi.", done: false },
      { key: "cold", title: "Bangun 1 Cold Hub", desc: "Turunkan food loss.", done: false },
      { key: "survive_event", title: "Lewati 1 event cuaca", desc: "Banjir/Heatwave tidak menggagalkan target.", done: false },
    ]
  };
}

function checkTutorial(tut, { grid, psi, events }) {
  const counts = countBuildings(grid);
  const hasCG = counts.CG >= 1;
  const hasRain = counts.RAIN >= 1;
  const plantedFast = grid.some(t => ["CG","RG","VF"].includes(t.b) && ["kangkung","pakcoy"].includes(t.crop));
  const hasMarket = counts.MARKET >= 1;
  const hasCold = counts.COLD >= 1;
  const hadEvent = events.length > 0;

  const steps = tut.steps.map(s => ({ ...s }));
  steps.find(s => s.key === "build_cg").done = hasCG;
  steps.find(s => s.key === "build_rain").done = hasRain;
  steps.find(s => s.key === "plant_fast").done = plantedFast;
  steps.find(s => s.key === "market").done = hasMarket;
  steps.find(s => s.key === "psi25").done = psi >= 0.25;
  steps.find(s => s.key === "cold").done = hasCold;
  steps.find(s => s.key === "survive_event").done = hadEvent;
  return { steps };
}

function loadSavedGrid() { try { const s = localStorage.getItem("kpm_grid"); return s? JSON.parse(s) : null; } catch { return null; } }
function loadSavedStorage() { try { const s = localStorage.getItem("kpm_storage"); return s? JSON.parse(s) : {}; } catch { return {}; } }
function loadSavedNumber(key, fallback) { try { const s = localStorage.getItem(key); return s? Number(s) : fallback; } catch { return fallback; } }
function loadSavedHistory() { try { const s = localStorage.getItem("kpm_history"); return s? JSON.parse(s) : []; } catch { return []; } }
