import React, { useEffect, useMemo, useState } from "react";

/**
 * Kota Pangan Mandiri – App.jsx (patched)
 * - PSI dihitung rolling 60 hari (≈ 2 bulanan)
 * - Sparkline pakai sumbu-Y (angka terlihat)
 * - Ringkasan menampilkan rerata produksi 7 hari
 * - Ekonomi sedikit dilonggarkan (biaya turun wajar)
 */

// ---------- Helpers & Constants ----------
const W = 20; // grid width
const H = 12; // grid height
const TICK_MS = 1000; // 1 sec = 1 day
const START_BUDGET = 800_000_000; // IDR
const POPULATION = 10000;

const DEMAND_KG_PER_CAPITA_PER_DAY = 0.5; // target konsumsi segar per kapita
const PSI_WINDOW_DAYS = 60;               // PSI rolling 60 hari

// Ekonomi lebih ramah:
const WATER_COST_PER_M3 = 3000;           // was 4500
const ENERGY_COST_PER_KWH = 1400;         // was 1600
const EMISSION_FACTOR_KG_PER_KWH = 0.8 / 1000;
const START_PREF_LOCAL = 0.5;             // preferensi pangan lokal awal (0..1)

const CROPS = {
  selada:  { name: "Selada",  baseYield: 3.0, days: 30, water: 60,  baseLoss: 0.10, price: 16000 },
  kangkung:{ name: "Kangkung",baseYield: 3.5, days: 21, water: 45,  baseLoss: 0.08, price: 12000 },
  pakcoy:  { name: "Pakcoy",  baseYield: 3.2, days: 28, water: 55,  baseLoss: 0.09, price: 18000 },
  tomat:   { name: "Tomat",   baseYield: 5.0, days: 70, water: 120, baseLoss: 0.12, price: 20000 },
  cabai:   { name: "Cabai",   baseYield: 2.2, days: 90, water: 140, baseLoss: 0.12, price: 60000 },
  jamur:   { name: "Jamur",   baseYield: 7.0, days: 30, water: 25,  baseLoss: 0.07, price: 22000 },
};

const BUILDINGS = {
  EMPTY:   { id: "EMPTY",   label: "Kosong",          cost: 0,           canPlant: false, category: "land" },
  CG:      { id: "CG",      label: "Kebun Komunitas", cost: 2_500_000,   canPlant: true,  method: "CG", category: "land" },
  RG:      { id: "RG",      label: "Roof Garden",     cost: 4_000_000,   canPlant: true,  method: "RG", category: "roof" },
  VF:      { id: "VF",      label: "Vertical Farm",   cost: 250_000_000, canPlant: true,  method: "VF", category: "roof" },
  MARKET:  { id: "MARKET",  label: "Pasar Lokal",     cost: 40_000_000,  canPlant: false, category: "service" },
  RAIN:    { id: "RAIN",    label: "Rain Tank",       cost: 10_000_000,  canPlant: false, category: "infra" },
  COLD:    { id: "COLD",    label: "Cold Hub",        cost: 75_000_000,  canPlant: false, category: "infra" },
  COMPOST: { id: "COMPOST", label: "Komposter",       cost: 20_000_000,  canPlant: false, category: "infra" },
  SOLAR:   { id: "SOLAR",   label: "Solar + Battery", cost: 60_000_000,  canPlant: false, category: "infra" },
  EDU:     { id: "EDU",     label: "Pusat Edukasi",   cost: 30_000_000,  canPlant: false, category: "service" },
};

const METHOD_MULT = {
  CG: { yield: 1.0, water: 1.0, energy: 0.1 },
  RG: { yield: 1.1, water: 0.9, energy: 0.15 },
  VF: { yield: 3.0, water: 0.5, energy: 2.5 },
};

const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const fmt = (n)=>n.toLocaleString("id-ID");
const randInt = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;

// ---------- PSI rolling ----------
function rollingPSI(history, windowDays = PSI_WINDOW_DAYS) {
  if (!history.length) return 0;
  const slice = history.slice(-windowDays);
  const sd = slice.reduce((a,h)=> a + (h.dispatched || 0), 0);
  const dd = slice.reduce((a,h)=> a + (h.demand    || 0), 0);
  return dd > 0 ? sd / dd : 0;
}
function rollingPSISeries(history, windowDays = PSI_WINDOW_DAYS) {
  return history.map((_, i) => {
    const start = Math.max(0, i - windowDays + 1);
    const seg = history.slice(start, i + 1);
    const sd = seg.reduce((a,h)=> a + (h.dispatched || 0), 0);
    const dd = seg.reduce((a,h)=> a + (h.demand    || 0), 0);
    return dd > 0 ? sd / dd : 0;
  });
}

// ---------- Init Grid ----------
function initGrid(){
  const grid=[];
  for (let y=0;y<H;y++) for(let x=0;x<W;x++){
    const roof = Math.random()<0.3;
    grid.push({ x,y, category: roof?'roof':'land', b:'EMPTY', crop:null, progress:0, disabledDays:0 });
  }
  grid[2*W+3]  = { ...grid[2*W+3],  b:'CG',     crop:'pakcoy'  };
  grid[2*W+4]  = { ...grid[2*W+4],  b:'CG',     crop:'kangkung'};
  grid[1*W+15] = { ...grid[1*W+15], b:'MARKET'              };
  grid[3*W+5]  = { ...grid[3*W+5],  b:'RAIN'                };
  return grid;
}

export default function App(){
  const [grid,setGrid]           = useState(()=>loadSavedGrid() || initGrid());
  const [day,setDay]             = useState(()=>loadSavedNumber("kpm_day",1));
  const [budget,setBudget]       = useState(()=>loadSavedNumber("kpm_budget", START_BUDGET));
  const [water,setWater]         = useState(()=>loadSavedNumber("kpm_water", 0));
  const [energy,setEnergy]       = useState(()=>loadSavedNumber("kpm_energy", 0));
  const [storage,setStorage]     = useState(()=>loadSavedStorage());
  const [psi,setPSI]             = useState(()=>loadSavedNumber("kpm_psi", 0)); // akan diisi PSI rolling
  const [happiness,setHappiness] = useState(()=>loadSavedNumber("kpm_happiness", 65));
  const [emissions,setEmissions] = useState(()=>loadSavedNumber("kpm_emissions", 0));
  const [speed,setSpeed]         = useState(1);
  const [mode,setMode]           = useState("build");
  const [buildSel,setBuildSel]   = useState("CG");
  const [plantSel,setPlantSel]   = useState("pakcoy");
  const [messages,setMessages]   = useState([{ d:0, t:"Selamat datang! Bangun kebun, panen, dan capai kemandirian pangan." }]);
  const [events,setEvents]       = useState([]);
  const [history,setHistory]     = useState(()=>loadSavedHistory());
  const [tutorial,setTutorial]   = useState(initTutorial());

  const city = useMemo(()=>computeCityModifiers(grid),[grid]);

  useEffect(()=>{
    if (speed===0) return;
    const id = setInterval(()=>stepDay(), TICK_MS/speed);
    return ()=>clearInterval(id);
  },[speed, grid, budget, events, storage, day]);

  function stepDay(){
    let newGrid=[...grid];
    let dayWater=0, dayEnergy=0;
    let dayProdByCrop={};
    let newEvents = events.map(ev=>({...ev,daysLeft:ev.daysLeft-1})).filter(ev=>ev.daysLeft>0);

    // random cuaca
    if (Math.random()<0.06){
      const ev = Math.random()<0.5 ? {type:'HEATWAVE',daysLeft:randInt(3,5)} : {type:'FLOOD',daysLeft:randInt(2,3)};
      newEvents.push(ev);
      setMessages(m=>[...m,{d:day,t:`Event: ${ev.type==='HEATWAVE'?'Gelombang Panas':'Banjir'} ${ev.daysLeft} hari!`}].slice(-6));
    }

    const heatwave = newEvents.some(e=>e.type==='HEATWAVE');
    const flood    = newEvents.some(e=>e.type==='FLOOD');

    newGrid = newGrid.map(tile=>{
      let t={...tile};
      if (t.disabledDays>0){ t.disabledDays-=1; return t; }
      if (flood && t.b==='CG' && t.category==='land'){ t.disabledDays=1; return t; }

      if (['CG','RG','VF'].includes(t.b) && t.crop){
        const crop=CROPS[t.crop];
        const m=METHOD_MULT[t.b];
        const growthPerDay=(1/crop.days)*m.yield*(heatwave?0.95:1);
        t.progress = clamp((t.progress||0)+growthPerDay,0,1);

        const waterUseL=crop.water*m.water*(heatwave?1.15:1)*(1 - city.irrigationEfficiency);
        dayWater += waterUseL/1000;
        const energyKwh = m.energy*(t.b==='VF'?(heatwave?1.2:1):1);
        dayEnergy += energyKwh;

        if (t.progress>=1){
          const baseYield=crop.baseYield*m.yield*(heatwave?0.95:1);
          let lossRate=crop.baseLoss*(heatwave?1.1:1)*(1 - city.coldChainQuality);
          lossRate=clamp(lossRate,0.02,0.20);
          const harvested=baseYield*(1-lossRate);
          dayProdByCrop[t.crop]=(dayProdByCrop[t.crop]||0)+harvested;
          t.progress=0;
        }
      }
      return t;
    });

    // biaya utilitas & emisi
    const netEnergy = Math.max(0, dayEnergy - city.solarKwhPerDay);
    const energyCost = netEnergy*ENERGY_COST_PER_KWH;
    const waterCost  = Math.max(0,(dayWater - city.rainwaterM3PerDay))*WATER_COST_PER_M3;
    const todayEmissions = netEnergy*EMISSION_FACTOR_KG_PER_KWH;

    // demand & kapasitas pasar
    const demand   = POPULATION*DEMAND_KG_PER_CAPITA_PER_DAY*(START_PREF_LOCAL+city.prefLocalBoost);
    const capacity = city.marketCapacityKgPerDay;

    // storage & distribusi
    const newStorage={...storage};
    let totalProduced = 0;
    for (const [cropId,kg] of Object.entries(dayProdByCrop)){ totalProduced+=kg; newStorage[cropId]=(newStorage[cropId]||0)+kg; }

    let remaining = Math.min(Object.values(newStorage).reduce((a,b)=>a+(b||0),0), capacity);
    let dispatched=0;
    for (const k of Object.keys(newStorage).sort()){
      if (remaining<=0) break;
      const take = Math.min(newStorage[k], remaining);
      newStorage[k]-=take; dispatched+=take; remaining-=take;
    }

    const psiToday = demand>0 ? clamp(dispatched/demand,0,2) : 0;

    // pendapatan vs biaya (ekonomi dilonggarkan)
    const avgPrice = (()=>{ const arr=Object.entries(dayProdByCrop);
      const tot=arr.reduce((a,[,v])=>a+v,0); if (!tot) return 17000;
      return arr.reduce((a,[k,v])=>a+v*CROPS[k].price,0)/tot; })();
    const revenue = dispatched*avgPrice;
    const wages   = 100_000*city.workerCount; // was 150k
    const opex    = energyCost + waterCost + wages + 1_200_000; // was +3,000,000
    const newBudget = budget + revenue - opex;

    // update history & hitung PSI rolling
    let nextHistory;
    setHistory(prev => {
      nextHistory = [...prev, { day: day + 1, psi: psiToday, prod: totalProduced, dispatched, demand }];
      return nextHistory.slice(-120);
    });
    const psiRolling = rollingPSI(nextHistory || history, PSI_WINDOW_DAYS);

    // kebahagiaan pakai PSI rolling
    let newHappiness = happiness;
    newHappiness += 0.05*city.greenTiles;
    newHappiness -= 10*Math.max(0,1-psiRolling);
    if (flood) newHappiness -= 2;
    if (heatwave) newHappiness -= 1;
    newHappiness = clamp(newHappiness,0,100);

    // commit state
    setGrid(newGrid);
    setWater(dayWater);
    setEnergy(dayEnergy);
    setEmissions(e=>e+todayEmissions);
    setBudget(newBudget);
    setStorage(newStorage);
    setDay(d=>d+1);
    setEvents(newEvents);
    setPSI(psiRolling); // tampilkan PSI rolling sebagai KPI
    setHappiness(newHappiness);

    // tutorial cek dengan PSI rolling agar lebih adil
    setTutorial(t=>checkTutorial(t,{grid:newGrid, psi:psiRolling, events:newEvents}));
  }

  // persist
  useEffect(()=>{
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
  },[grid,day,budget,water,energy,storage,psi,happiness,emissions,history]);

  function clearSave(){ localStorage.clear(); location.reload(); }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="w-full border-b border-slate-800 bg-slate-900/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-6">
          <div className="text-xl font-bold">Kota Pangan Mandiri – Prototype</div>
          <Kpi label="Hari" value={`D${day}`} />
          <Kpi label="PSI (60h)" value={`${(psi*100).toFixed(0)}%`} good={psi>=1} warn={psi<0.8} />
          <Kpi label="Kebahagiaan" value={`${happiness.toFixed(0)}/100`} good={happiness>=70} warn={happiness<50} />
          <Kpi label="Anggaran" value={`Rp ${fmt(Math.round(budget))}`} warn={budget<0} />
          <div className="ml-auto text-xs opacity-70">Simpan otomatis • Vite + React + Tailwind</div>
        </div>
      </div>

      <div className="flex gap-4 p-4">
        {/* Sidebar kiri */}
        <div className="w-80 flex flex-col gap-4">
          <Panel title="Mode">
            <div className="flex gap-2 flex-wrap">
              {["build","plant","bulldoze","info"].map(m=>(
                <Btn key={m} onClick={()=>setMode(m)} active={mode===m}>{m[0].toUpperCase()+m.slice(1)}</Btn>
              ))}
            </div>
          </Panel>

          <Panel title="Bangunan">
            <BuildPicker buildSel={buildSel} setBuildSel={setBuildSel} />
          </Panel>

          <Panel title="Kontrol">
            <div className="flex gap-2">
              <Btn onClick={()=>setSpeed(0)} active={speed===0}>⏸︎</Btn>
              <Btn onClick={()=>setSpeed(1)} active={speed===1}>▶︎x1</Btn>
              <Btn onClick={()=>setSpeed(3)} active={speed===3}>▶︎x3</Btn>
              <Btn onClick={clearSave}>Reset State</Btn>
            </div>
          </Panel>

          <Panel title="Tips">
            <div className="text-sm opacity-90">
              Tambah <b>Market</b> & <b>Cold Hub</b> untuk naikkan PSI; tanam cepat di RG & <i>stagger</i> biar panen harian lancar.
            </div>
          </Panel>
        </div>

        {/* Area utama */}
        <div className="flex-1">
          <Map grid={grid} onTileClick={(t)=>{
            const idx=t.y*W+t.x; const cur=grid[idx];
            if (mode==='build'){
              if (cur.b!=='EMPTY') return;
              const def = BUILDINGS[buildSel];
              if ((def.category==='roof') && cur.category!=='roof') return;
              const newTile={...cur,b:def.id,crop:def.canPlant?plantSel:null,progress:0};
              const g=[...grid]; g[idx]=newTile; setGrid(g);
              setBudget(b=>b - def.cost);
            } else if (mode==='plant'){
              if (!['CG','RG','VF'].includes(cur.b)) return;
              const g=[...grid]; g[idx]={...cur,crop:plantSel}; setGrid(g);
            } else if (mode==='bulldoze'){
              if (cur.b==='EMPTY') return;
              const g=[...grid]; g[idx]={...cur,b:'EMPTY',crop:null,progress:0}; setGrid(g);
            } else {
              alert(`${BUILDINGS[cur.b]?.label||'Kosong'}${cur.crop? ' – '+CROPS[cur.crop].name:''}`);
            }
          }} />

          {/* Charts & Summary */}
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Card title={`Produksi (kg/hari) — 60 hari`}>
              <Sparkline
                data={history.map(h => Math.round(h.prod || 0))}
                yFormatter={v => v.toLocaleString('id-ID')}
              />
            </Card>

            <Card title={`PSI (rolling ${PSI_WINDOW_DAYS}h) — %`}>
              <Sparkline
                data={rollingPSISeries(history, PSI_WINDOW_DAYS).map(v => Math.round((v || 0) * 100))}
                yTicks={[0, 25, 50, 75, 100]}
                yFormatter={v => `${v}%`}
              />
            </Card>

            <Card title="Ringkasan Kota">
              <Summary grid={grid} history={history} />
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

// ---------- UI bits ----------
function Kpi({ label, value, good, warn }){
  return (
    <div className={`px-3 py-1 rounded-xl text-sm bg-slate-800/60 ${good?'ring-1 ring-emerald-500/40':''} ${warn?'ring-1 ring-amber-500/40':''}`}>
      <div className="uppercase text-[10px] tracking-wider opacity-60">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
function Panel({ title, children }){
  return (
    <div className="bg-slate-800/50 rounded-2xl shadow p-3 border border-slate-700/50">
      <div className="font-semibold mb-2">{title}</div>
      {children}
    </div>
  );
}
function Card({ title, children }){
  return (
    <div className="bg-slate-800/50 rounded-2xl shadow p-4 border border-slate-700/50">
      <div className="font-semibold mb-2">{title}</div>
      {children}
    </div>
  );
}
function Btn({ children, onClick, active }){
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-xl border text-sm transition ${active?'bg-emerald-600/30 border-emerald-500/40':'bg-slate-700/40 border-slate-600/50 hover:bg-slate-700/60'}`}
    >
      {children}
    </button>
  );
}
function BuildPicker({ buildSel, setBuildSel }){
  const items = ["CG","RG","VF","MARKET","RAIN","COLD","COMPOST","SOLAR","EDU"];
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(id=>{
        const def = BUILDINGS[id];
        return (
          <Btn key={id} onClick={()=>setBuildSel(id)} active={buildSel===id}>
            <div className="text-left">
              <div className="font-semibold">{def.label}</div>
              <div className="text-xs opacity-70">Rp {fmt(def.cost)}</div>
              <div className="text-[10px] opacity-50">{def.category}</div>
            </div>
          </Btn>
        );
      })}
    </div>
  );
}
function Map({ grid, onTileClick }){
  return (
    <div className="bg-slate-800/40 rounded-2xl p-2 border border-slate-700/50">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${W}, 28px)` }}>
        {grid.map((t,i)=>(<Tile key={i} t={t} onClick={()=>onTileClick(t)} />))}
      </div>
      <div className="text-xs opacity-70 mt-1">
        Petunjuk: Mode “Bangun”, pilih bangunan, lalu klik petak. Mode “Tanam”, pilih tanaman, lalu klik kebun.
      </div>
    </div>
  );
}
function Tile({ t, onClick }){
  const disabled = t.disabledDays>0;
  const label = ({CG:'CG',RG:'RG',VF:'VF',MARKET:'P',RAIN:'R',COLD:'C',COMPOST:'K',SOLAR:'S',EDU:'E'})[t.b] || "";
  const color = (()=>{
    if (t.b==='EMPTY') return t.category==='roof' ? '#0f172a' : '#0b1220';
    if (['CG','RG','VF'].includes(t.b)){
      const prog = t.progress||0;
      const light = Math.floor(30 + prog*70);
      return `hsl(${t.b==='VF'?280:140} 70% ${light}%)`;
    }
    return {MARKET:'#9a3412',RAIN:'#0ea5e9',COLD:'#0369a1',COMPOST:'#854d0e',SOLAR:'#ca8a04',EDU:'#334155'}[t.b] || '#334155';
  })();
  const border = t.category==='roof' ? 'border-cyan-400/40' : 'border-slate-600/40';
  return (
    <button
      onClick={onClick}
      className={`w-7 h-7 m-[2px] rounded-md border ${border} text-[10px] flex items-center justify-center select-none ${disabled?'opacity-50':''}`}
      style={{background:color}}
      title={`${BUILDINGS[t.b]?.label||'Kosong'}${t.crop? ' – '+CROPS[t.crop].name:''}${disabled?' (tergenang)':''}`}
    >
      {label}
    </button>
  );
}

// Sparkline with Y-axis
function Sparkline({ data = [], yTicks = null, yFormatter = v => String(v) }) {
  const n = data.length;
  const min = 0;
  const max = Math.max(1, ...data);
  const W = 140, H = 64;
  const ml = 26, mr = 8, mt = 6, mb = 14;
  const iw = W - ml - mr, ih = H - mt - mb;
  const x = i => (ml + (n <= 1 ? 0 : (i / (n - 1)) * iw));
  const y = v => (mt + (1 - (v - min) / (max - min)) * ih);
  const points = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const ticks = yTicks ?? [min, min + (max - min) * 0.33, min + (max - min) * 0.66, max];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20 bg-slate-900/40 rounded-lg">
      <line x1={ml} y1={mt} x2={ml} y2={mt + ih} stroke="currentColor" strokeWidth="1" opacity="0.5" />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={ml - 3} x2={ml} y1={y(t)} y2={y(t)} stroke="currentColor" strokeWidth="1" opacity="0.5" />
          <text x={ml - 5} y={y(t)} textAnchor="end" alignmentBaseline="middle" fontSize="9" opacity="0.8">
            {yFormatter(Math.round(t))}
          </text>
        </g>
      ))}
      {ticks.map((t, i) => (
        <line key={'g'+i} x1={ml} x2={ml + iw} y1={y(t)} y2={y(t)} stroke="currentColor" strokeWidth="0.5" opacity="0.15" />
      ))}
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
    </svg>
  );
}

// ---------- Summary ----------
function Summary({ grid, history }) {
  const counts = countBuildings(grid);
  const marketCapacityKgPerDay = counts.MARKET * 1200 + counts.EDU * 100;
  const coldChainQuality = clamp(0.05 * counts.COLD, 0, 0.6);
  const solarKwhPerDay = counts.SOLAR * 60;
  const rainwaterM3PerDay = counts.RAIN * 3;
  const prefLocalBoost = clamp(0.05 * counts.EDU, 0, 0.4);

  const last7 = history.slice(-7);
  const avg7Prod = last7.length ? last7.reduce((a,h)=> a + (h.prod || 0), 0) / last7.length : 0;

  return (
    <ul className="text-sm space-y-1">
      <li>Pasar: <b>{counts.MARKET}</b> • Kapasitas distribusi: <b>{Math.round(marketCapacityKgPerDay).toLocaleString("id-ID")} kg/hari</b></li>
      <li>Cold Hub: <b>{counts.COLD}</b> • Kualitas rantai dingin: <b>{Math.round(coldChainQuality*100)}%</b></li>
      <li>Solar: <b>{counts.SOLAR}</b> • Offset energi: <b>{Math.round(solarKwhPerDay).toLocaleString("id-ID")} kWh</b></li>
      <li>Rain Tank: <b>{counts.RAIN}</b> • Air hujan: <b>{rainwaterM3PerDay.toLocaleString("id-ID")} m³/hari</b></li>
      <li>Pusat Edukasi: <b>{counts.EDU}</b> • Preferensi lokal: <b>{Math.round((START_PREF_LOCAL+prefLocalBoost)*100)}%</b></li>
      <li>Rata-rata produksi 7 hari: <b>{Math.round(avg7Prod).toLocaleString('id-ID')} kg/hari</b></li>
    </ul>
  );
}

// ---------- Tutorial ----------
function TutorialPanel({ tutorial }){
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
      <div className="mt-3 text-xs opacity-70">Target: lulus semua langkah, lalu capai PSI ≥ 100% selama 3 hari berturut-turut tanpa defisit anggaran.</div>
    </div>
  );
}
function initTutorial(){
  return {
    steps: [
      { key: "build_cg",     title: "Bangun 1 Kebun Komunitas (CG)", desc: "Mode Bangun → Kebun Komunitas → klik petak tanah.", done: false },
      { key: "build_rain",   title: "Bangun 1 Rain Tank",            desc: "Air hujan menghemat biaya air.", done: false },
      { key: "plant_fast",   title: "Tanam sayur cepat (kangkung/pakcoy)", desc: "Mode Tanam → pilih → klik kebun.", done: false },
      { key: "market",       title: "Bangun 1 Pasar Lokal",          desc: "Agar panen tersalurkan.", done: false },
      { key: "psi25",        title: "Capai PSI ≥ 25% (rolling)",     desc: "Tingkatkan produksi dan kapasitas distribusi.", done: false },
      { key: "cold",         title: "Bangun 1 Cold Hub",             desc: "Turunkan food loss.", done: false },
      { key: "survive_event",title: "Lewati 1 event cuaca",          desc: "Banjir/Heatwave tidak menggagalkan target.", done: false },
    ]
  };
}
function checkTutorial(tut, { grid, psi, events }){
  const counts = countBuildings(grid);
  const hasCG = counts.CG>=1;
  const hasRain = counts.RAIN>=1;
  const plantedFast = grid.some(t=>['CG','RG','VF'].includes(t.b)&&['kangkung','pakcoy'].includes(t.crop));
  const hasMarket = counts.MARKET>=1;
  const hasCold = counts.COLD>=1;
  const hadEvent = events.length>0;
  const steps = tut.steps.map(s=>({...s}));
  steps.find(s=>s.key==='build_cg').done   = hasCG;
  steps.find(s=>s.key==='build_rain').done = hasRain;
  steps.find(s=>s.key==='plant_fast').done = plantedFast;
  steps.find(s=>s.key==='market').done     = hasMarket;
  steps.find(s=>s.key==='psi25').done      = psi>=0.25; // rolling PSI
  steps.find(s=>s.key==='cold').done       = hasCold;
  steps.find(s=>s.key==='survive_event').done = hadEvent;
  return { steps };
}

// ---------- City Modifiers ----------
function countBuildings(grid){
  const out = { CG:0, RG:0, VF:0, MARKET:0, RAIN:0, COLD:0, COMPOST:0, SOLAR:0, EDU:0 };
  grid.forEach(t=>{ if(out[t.b]!==undefined) out[t.b]++; });
  return out;
}
function computeCityModifiers(grid){
  const counts = countBuildings(grid);
  const marketCapacityKgPerDay = counts.MARKET*1200 + counts.EDU*100;
  const coldChainQuality = Math.min(0.6, 0.05*counts.COLD);
  const solarKwhPerDay = counts.SOLAR*60;
  const rainwaterM3PerDay = counts.RAIN*3;
  const prefLocalBoost = Math.min(0.4, 0.05*counts.EDU);
  const irrigationEfficiency = Math.min(0.5, 0.1 + 0.05*counts.RAIN);
  const greenTiles = grid.filter(t=>['CG','RG','VF'].includes(t.b)).length;
  const workerCount = counts.CG*1 + counts.RG*1 + counts.VF*3 + counts.MARKET*2 + counts.COLD*2 + counts.COMPOST*1 + counts.EDU*1;
  return { marketCapacityKgPerDay, coldChainQuality, solarKwhPerDay, rainwaterM3PerDay, prefLocalBoost, irrigationEfficiency, greenTiles, workerCount };
}

// ---------- Persistence ----------
function loadSavedGrid(){ try{ const s=localStorage.getItem("kpm_grid"); return s? JSON.parse(s) : null; }catch{ return null; } }
function loadSavedStorage(){ try{ const s=localStorage.getItem("kpm_storage"); return s? JSON.parse(s) : {}; }catch{ return {}; } }
function loadSavedNumber(key, fallback){ try{ const s=localStorage.getItem(key); return s? Number(s) : fallback; }catch{ return fallback; } }
function loadSavedHistory(){ try{ const s=localStorage.getItem("kpm_history"); return s? JSON.parse(s) : []; }catch{ return []; } }
