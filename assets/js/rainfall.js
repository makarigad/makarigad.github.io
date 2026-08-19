import { supabase, safeUpsert } from './core-app.js';
import {
    showNotification,
    showConfirmation,
    nepaliMonths,
    getNepDateObj,
    getCurrentUser,
    getUserRole,
    calendarMap
} from './plant-data.js';

const MONTH_DAYS = {
    Baisakh: 31, Jestha: 31, Ashadh: 32, Shrawan: 31,
    Bhadra:  31, Ashoj:  31, Kartik: 30, Mangsir: 30,
    Poush:   29, Magh:   30, Falgun: 30, Chaitra: 30
};

const MONTH_ALIASES = new Map([
    ['bais', 'Baisakh'], ['baish', 'Baisakh'],
    ['jesh', 'Jestha'],  ['jest',  'Jestha'],
    ['ashad', 'Ashadh'], ['ashar', 'Ashadh'],
    ['shraw', 'Shrawan'], ['sawan', 'Shrawan'],
    ['bhad',  'Bhadra'],
    ['asho',  'Ashoj'],  ['asoj',  'Ashoj'], ['ashwin', 'Ashoj'],
    ['kart',  'Kartik'],
    ['mangs', 'Mangsir'], ['mangsh', 'Mangsir'],
    ['pous',  'Poush'],
    ['magh',  'Magh'],
    ['falg',  'Falgun'],  ['fagun', 'Falgun'],
    ['chai',  'Chaitra'],
]);

const IMPORT_FIELDS = [
    { offset: 1, key: 'heavy_rain_time', type: 'string' },
    { offset: 3, key: 'normal_rain_time', type: 'string' },
    { offset: 5, key: 'shower_rain_time', type: 'string' },
    { offset: 7, key: 'powerhouse',       type: 'number' },
    { offset: 8, key: 'headworks',        type: 'number' },
];

const INTAKE      = { lat: 29.7891, lon: 80.8700, elev: 2387 };
const POWERHOUSE  = { lat: 29.8009, lon: 80.8430, elev: 1463 };

let state = {
    rainfallIndex: new Map(),
    yearlyData: new Map(),
    waterLevelIndex: new Map(),
    yearlyWaterLevel: new Map(),
    apiWeatherData: {},
    rainChart: null,
    compareChart: null,
    historicalChart: null,
    isLoading: false,
    availableYears: [],
    selectedCompareYears: new Set()
};

function getEl(id) { return document.getElementById(id); }
function getSelectedYear()  { return parseInt(getEl('grid-rf-year')?.value); }
function getSelectedMonth() { return getEl('grid-rf-month')?.value; }
function getViewMode() { return getEl('rf-view-mode')?.value || 'monthly'; }
function showPrediction() { return getEl('rf-show-prediction')?.checked || false; }
function toFloat(val, fallback = 0) { const n = parseFloat(val); return isNaN(n) ? fallback : n; }

function getFallbackEngDate(y, m, d) {
    const monthOffsets = [13, 14, 15, 16, 17, 17, 18, 16, 14, 13, 12, 14];
    const startYear = y - 57;
    const monthIdx  = nepaliMonths.indexOf(m);
    const date = new Date(startYear, 3 + monthIdx, (monthOffsets[monthIdx] ?? 14) + (d - 1));
    return date.toISOString().split('T')[0];
}

function getEngDate(y, m, d) {
    const mIdx = nepaliMonths.indexOf(m) + 1;
    const nepStr = `${y}.${String(mIdx).padStart(2, '0')}.${String(d).padStart(2, '0')}`;
    if (calendarMap && Object.keys(calendarMap).length > 0) {
        const match = Object.keys(calendarMap).find(k => calendarMap[k].nep_date_str === nepStr);
        if (match) return match;
    }
    return getFallbackEngDate(y, m, d);
}

function getPrevDay(engDateStr) {
    const d = new Date(engDateStr);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#rf-download-btn'))  generateExcelExport();
    if (e.target.closest('#rf-upload-btn'))    triggerFileUpload();
    if (e.target.closest('#rf-compare-select-all')) {
        e.preventDefault();
        state.selectedCompareYears = new Set(state.availableYears.slice(-6));
        renderYearChips();
        refreshDashboard();
    }
    const chip = e.target.closest('[data-year-chip]');
    if (chip) {
        e.preventDefault();
        const y = parseInt(chip.dataset.yearChip);
        if (state.selectedCompareYears.has(y)) {
            if (state.selectedCompareYears.size > 1) state.selectedCompareYears.delete(y);
        } else {
            if (state.selectedCompareYears.size < 6) state.selectedCompareYears.add(y);
        }
        renderYearChips();
        refreshDashboard();
    }
});

document.addEventListener('change', (e) => {
    if (e.target.id === 'rf-file-upload') handleFileUpload(e);
    if (['grid-rf-year', 'grid-rf-month', 'rf-view-mode', 'rf-show-prediction'].includes(e.target.id)) {
        if (e.target.id === 'rf-view-mode') updateFilters();
        refreshDashboard();
    }
});

function triggerFileUpload() {
    let input = getEl('rf-file-upload');
    if (!input) {
        input = Object.assign(document.createElement('input'), {
            type: 'file', id: 'rf-file-upload', accept: '.xlsx,.xls,.csv'
        });
        input.style.display = 'none';
        document.body.appendChild(input);
    }
    input.click();
}

function handleFileUpload(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    showNotification('Reading file…', false);
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
            if (!rows.length) return showNotification('File is empty', true);
            processAndUploadRainfall(rows);
        } catch (err) {
            showNotification('File parsing error: ' + err.message, true);
        }
    };
    reader.readAsArrayBuffer(file);
    ev.target.value = '';
}

export function initRainfallEvents() { }

export async function loadRainfallData() {
    updateFilters();
    await refreshDashboard();
}

function updateFilters() {
    const ySelect = getEl('grid-rf-year');
    const mSelect = getEl('grid-rf-month');
    if (!ySelect || !mSelect) return;
    
    const { year: currentYear, month: currentMonth } = getNepDateObj();
    
    if (!ySelect.options.length) {
        ySelect.innerHTML = Array.from(
            { length: currentYear + 2 - 2079 },
            (_, i) => `<option value="${currentYear + 1 - i}">${currentYear + 1 - i}</option>`
        ).join('');
        mSelect.innerHTML = nepaliMonths.map(m => `<option value="${m}">${m}</option>`).join('');
        ySelect.value = currentYear;
        mSelect.value = currentMonth;
    } else {
        if (!ySelect.value) ySelect.value = currentYear;
        if (!mSelect.value) mSelect.value = currentMonth;
    }
    
    const viewMode = getViewMode();
    const yearContainer = getEl('rf-year-container');
    const compareControls = getEl('rf-compare-controls');
    
    if (yearContainer) {
        yearContainer.style.display = (viewMode === 'compare') ? 'none' : 'flex';
    }
    if (compareControls) {
        compareControls.classList.toggle('hidden', viewMode !== 'compare');
    }
    
    if (viewMode === 'compare') {
        collectAvailableYears();
        if (state.selectedCompareYears.size === 0) {
            state.selectedCompareYears = new Set(state.availableYears.slice(-4));
        }
        renderYearChips();
    }
}

function collectAvailableYears() {
    const years = new Set();
    const curY = getSelectedYear();
    if (!isNaN(curY)) years.add(curY);
    state.yearlyData.forEach(v => years.add(parseInt(v.year)));
    state.availableYears = Array.from(years).sort();
    if (state.availableYears.length === 0) {
        const { year: cy } = getNepDateObj();
        state.availableYears = [cy - 2, cy - 1, cy].filter(y => y >= 2079);
    }
}

function renderYearChips() {
    const container = getEl('rf-year-chips');
    if (!container) return;
    collectAvailableYears();
    container.innerHTML = state.availableYears.map(y => {
        const selected = state.selectedCompareYears.has(y);
        return `<button type="button" data-year-chip="${y}" 
            class="px-3 py-1.5 rounded-full text-xs font-bold transition border-2 ${
                selected 
                    ? 'bg-indigo-600 text-white border-indigo-700 shadow' 
                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700'
            }">${y}${selected ? ' ✓' : ''}</button>`;
    }).join('');
}

async function refreshDashboard() {
    if (state.isLoading) return;
    state.isLoading = true;
    try {
        updateFilters();
        const mode = getViewMode();
        
        if (mode === 'monthly') {
            await loadMonthlyData();
            renderSummaryCards();
            renderMonthlyCharts();
            renderMonthlyGrid();
        } else if (mode === 'compare') {
            await loadAllYearData();
            renderCompareSummary();
            renderCompareChart();
            renderCompareGrid();
        } else {
            await loadAllYearData();
            renderHistoricalSummary();
            renderHistoricalChart();
            renderHistoricalGrid();
        }
    } catch (err) {
        console.error('Dashboard load error:', err);
        showNotification('Failed to load dashboard: ' + err.message, true);
    } finally {
        state.isLoading = false;
    }
}

async function loadMonthlyData() {
    const y = getSelectedYear();
    const m = getSelectedMonth();
    if (!y || !m) return;

    const mIdx = nepaliMonths.indexOf(m) + 1;
    const maxDay = MONTH_DAYS[m] ?? 30;
    
    const [{ data: rainData }, { data: hourlyLogs }] = await Promise.all([
        supabase.from('rainfall_data').select('*').eq('nepali_year', y).eq('nepali_month', m),
        supabase.from('hourly_logs').select('log_date, log_time, water_level')
            .gte('log_date', getEngDate(y, m, 1))
            .lte('log_date', getEngDate(y, m, maxDay))
            .like('log_time', '08:00%')
    ]);
    
    state.rainfallIndex = new Map((rainData ?? []).map(r => [parseInt(r.day), r]));
    
    state.waterLevelIndex = new Map();
    (hourlyLogs ?? []).forEach(log => {
        if (!log || log.water_level === null || log.water_level === undefined) return;
        const calEntry = Object.entries(calendarMap || {}).find(([eng]) => eng === log.log_date);
        if (calEntry) {
            const meta = calEntry[1];
            if (parseInt(meta.nep_year) === y && meta.nep_month === m) {
                state.waterLevelIndex.set(parseInt(meta.nep_day), toFloat(log.water_level, null));
            }
        }
    });
    
    if (showPrediction()) {
        const firstEngDate = getEngDate(y, m, 1);
        const lastEngDate  = getEngDate(y, m, maxDay);
        await fetchOpenMeteoData(getPrevDay(firstEngDate), lastEngDate);
    }
}

async function loadAllYearData() {
    state.yearlyData = new Map();
    state.yearlyWaterLevel = new Map();
    
    const [{ data: allData }, { data: allHourly }] = await Promise.all([
        supabase.from('rainfall_data').select('*'),
        supabase.from('hourly_logs').select('log_date, log_time, water_level').like('log_time', '08:00%')
    ]);
    
    (allData ?? []).forEach(r => {
        const key = `${r.nepali_year}_${r.nepali_month}`;
        if (!state.yearlyData.has(key)) {
            state.yearlyData.set(key, { year: r.nepali_year, month: r.nepali_month, days: new Map() });
        }
        state.yearlyData.get(key).days.set(parseInt(r.day), r);
    });
    
    (allHourly ?? []).forEach(log => {
        if (!log || log.water_level === null || log.water_level === undefined) return;
        const calEntry = Object.entries(calendarMap || {}).find(([eng]) => eng === log.log_date);
        if (calEntry) {
            const meta = calEntry[1];
            const y = parseInt(meta.nep_year);
            const m = meta.nep_month;
            const d = parseInt(meta.nep_day);
            const key = `${y}_${m}`;
            if (!state.yearlyWaterLevel.has(key)) state.yearlyWaterLevel.set(key, new Map());
            state.yearlyWaterLevel.get(key).set(d, toFloat(log.water_level, null));
        }
    });
    
    if (showPrediction()) {
        const m = getSelectedMonth();
        const years = [];
        state.yearlyData.forEach(v => {
            if (v.month === m && !years.includes(v.year)) years.push(v.year);
        });
        years.sort();
        
        if (years.length > 0) {
            const minY = years[0], maxY = years[years.length - 1];
            const firstEng = getEngDate(minY, m, 1);
            const lastEng  = getEngDate(maxY, m, MONTH_DAYS[m] ?? 30);
            await fetchOpenMeteoData(getPrevDay(firstEng), lastEng);
        }
    }
}

async function fetchOpenMeteoData(startStr, endStr) {
    state.apiWeatherData = {};
    try {
        const today   = new Date();
        const sDate   = new Date(startStr);
        const eDate   = new Date(endStr);
        const maxDate = new Date(today);
        maxDate.setDate(today.getDate() + 14);
        if (sDate > maxDate) return;
        const safeEnd = eDate > maxDate ? maxDate.toISOString().split('T')[0] : endStr;

        const daysAgo = (today - sDate) / 864e5;
        const base = daysAgo > 80
            ? 'https://archive-api.open-meteo.com/v1/archive'
            : 'https://api.open-meteo.com/v1/forecast';

        const lats = `${INTAKE.lat},${POWERHOUSE.lat}`;
        const lons = `${INTAKE.lon},${POWERHOUSE.lon}`;
        const elevs = `${INTAKE.elev},${POWERHOUSE.elev}`;
        const url = `${base}?latitude=${lats}&longitude=${lons}&elevation=${elevs}` +
            `&daily=precipitation_sum&start_date=${startStr}&end_date=${safeEnd}&timezone=auto`;

        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        if (!Array.isArray(json) || json.length < 2) return;

        const [intakeApi, phApi] = json.map(j => j.daily);
        intakeApi.time.forEach((t, i) => {
            state.apiWeatherData[t] = {
                headworks_pred: intakeApi.precipitation_sum[i],
                powerhouse_pred: phApi.precipitation_sum[i],
            };
        });
    } catch {
        console.warn('Open-Meteo fetch skipped.');
    }
}

function resolvePrediction(engDate, type) {
    const live = state.apiWeatherData[getPrevDay(engDate)] ?? {};
    return type === 'headworks' ? toFloat(live.headworks_pred, null) : toFloat(live.powerhouse_pred, null);
}

function renderSummaryCards() {
    const container = getEl('rf-summary-cards');
    if (!container) return;
    const y = getSelectedYear(), m = getSelectedMonth();
    const maxDay = MONTH_DAYS[m] ?? 30;
    
    let totalDamRain = 0, totalPHRain = 0, daysWithRain = 0, maxDayRain = 0, maxDayLabel = '';
    let damHigherDays = 0, phHigherDays = 0, matchDays = 0;
    
    for (let d = 1; d <= maxDay; d++) {
        const rec = state.rainfallIndex.get(d);
        const hw = toFloat(rec?.headworks, null);
        const ph = toFloat(rec?.powerhouse, null);
        const hwN = hw ?? 0, phN = ph ?? 0;
        totalDamRain += hwN;
        totalPHRain += phN;
        if (hwN > 0 || phN > 0) daysWithRain++;
        const total = hwN + phN;
        if (total > maxDayRain) { maxDayRain = total; maxDayLabel = `Day ${d}`; }
        if (hw !== null && ph !== null) {
            if (Math.abs(hw - ph) < 0.01) matchDays++;
            else if (hw > ph) damHigherDays++;
            else phHigherDays++;
        }
    }
    const diff = totalDamRain - totalPHRain;
    
    container.innerHTML = `
        <div class="bg-white rounded-xl shadow-sm border border-blue-200 p-4">
            <div class="text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1">🌧️ Dam / Headworks Rainfall</div>
            <div class="flex items-baseline gap-2">
                <span class="text-3xl font-black text-blue-800">${totalDamRain.toFixed(1)}</span>
                <span class="text-xs font-semibold text-slate-400">mm</span>
            </div>
            <div class="text-[10px] text-slate-500 mt-1">${m} ${y} Total (from 08:00 AM Daily Master)</div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-emerald-200 p-4">
            <div class="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1">🌧️ Powerhouse Rainfall</div>
            <div class="flex items-baseline gap-2">
                <span class="text-3xl font-black text-emerald-800">${totalPHRain.toFixed(1)}</span>
                <span class="text-xs font-semibold text-slate-400">mm</span>
            </div>
            <div class="text-[10px] text-slate-500 mt-1">${m} ${y} Total (from 08:00 AM Daily Master)</div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-indigo-200 p-4">
            <div class="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-1">📊 Location Comparison</div>
            <div class="grid grid-cols-2 gap-2 text-[11px]">
                <div><span class="text-blue-600 font-semibold">Dam Higher: </span><span class="font-bold text-blue-800">${damHigherDays}</span></div>
                <div><span class="text-emerald-600 font-semibold">PH Higher: </span><span class="font-bold text-emerald-800">${phHigherDays}</span></div>
                <div class="col-span-2"><span class="text-slate-500 font-semibold">Net Diff: </span><span class="font-bold ${diff >= 0 ? 'text-blue-700' : 'text-emerald-700'}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)} mm (Dam ${diff >= 0 ? '↑' : '↓'})</span></div>
            </div>
            <div class="text-[10px] text-slate-400 mt-1">Matching values: ${matchDays} days</div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-amber-200 p-4">
            <div class="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">☀️ Rainfall Summary</div>
            <div class="flex items-baseline gap-2">
                <span class="text-3xl font-black text-amber-800">${daysWithRain}</span>
                <span class="text-xs font-semibold text-slate-400">rainy / ${maxDay} days</span>
            </div>
            <div class="text-[10px] text-slate-500 mt-1">Heaviest: ${maxDayRain.toFixed(1)} mm on ${maxDayLabel || '-'}</div>
        </div>
    `;
}

function renderMonthlyCharts() {
    const container = getEl('rf-charts-container');
    if (!container) return;
    
    const y = getSelectedYear(), m = getSelectedMonth();
    const maxDay = MONTH_DAYS[m] ?? 30;
    const labels = Array.from({ length: maxDay }, (_, i) => i + 1);
    
    const damRain = [], phRain = [], damPred = [], phPred = [];
    
    for (let d = 1; d <= maxDay; d++) {
        const rec = state.rainfallIndex.get(d);
        damRain.push(toFloat(rec?.headworks, 0));
        phRain.push(toFloat(rec?.powerhouse, 0));
        
        if (showPrediction()) {
            const engDate = getEngDate(y, m, d);
            damPred.push(resolvePrediction(engDate, 'headworks'));
            phPred.push(resolvePrediction(engDate, 'powerhouse'));
        }
    }
    
    const datasets = [
        { label: 'Dam / Headworks Rainfall (Measured)', data: damRain, backgroundColor: '#2563EB', borderRadius: 4 },
        { label: 'Powerhouse Rainfall (Measured)', data: phRain, backgroundColor: '#059669', borderRadius: 4 },
    ];
    
    if (showPrediction()) {
        datasets.push({
            label: 'Dam / Headworks Rainfall (Predicted)',
            data: damPred,
            backgroundColor: 'rgba(37, 99, 235, 0.3)',
            borderColor: '#2563EB',
            borderWidth: 2,
            borderDash: [4, 4],
            type: 'line',
            fill: false,
            tension: 0.3,
            spanGaps: true
        });
        datasets.push({
            label: 'Powerhouse Rainfall (Predicted)',
            data: phPred,
            backgroundColor: 'rgba(5, 150, 105, 0.3)',
            borderColor: '#059669',
            borderWidth: 2,
            borderDash: [4, 4],
            type: 'line',
            fill: false,
            tension: 0.3,
            spanGaps: true
        });
    }
    
    container.innerHTML = `
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h4 class="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">Daily Rainfall Comparison - Dam vs Powerhouse (${m} ${y})</h4>
            <div class="relative h-56 w-full"><canvas id="rainfall-trend-chart"></canvas></div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h4 class="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">Cumulative Rainfall Trend (${m} ${y})</h4>
            <div class="relative h-56 w-full"><canvas id="rainfall-cumulative-chart"></canvas></div>
        </div>
    `;
    
    state.rainChart?.destroy();
    state.rainChart = new Chart(getEl('rainfall-trend-chart').getContext('2d'), {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'mm' } } }
        }
    });
    
    const cumDam = [], cumPH = [];
    let s1 = 0, s2 = 0;
    for (let i = 0; i < damRain.length; i++) {
        s1 += damRain[i]; s2 += phRain[i];
        cumDam.push(s1); cumPH.push(s2);
    }
    
    new Chart(getEl('rainfall-cumulative-chart').getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Dam / Headworks Rainfall', data: cumDam, borderColor: '#2563EB', backgroundColor: 'rgba(37,99,235,0.1)', tension: 0.3, fill: true },
                { label: 'Powerhouse Rainfall', data: cumPH, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.1)', tension: 0.3, fill: true },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'mm (Cumulative)' } } }
        }
    });
}

function renderMonthlyGrid() {
    const y = getSelectedYear(), m = getSelectedMonth();
    const gridTable = getEl('rainfall-grid-table');
    if (!gridTable || !y || !m) return;
    
    getEl('rf-table-title').textContent = `Daily Rainfall Data (from 08:00 AM Daily Master) - ${m} ${y}`;
    
    const maxDay = MONTH_DAYS[m] ?? 30;
    const mIdx = nepaliMonths.indexOf(m) + 1;
    const showPred = showPrediction();
    
    let thead = `
    <thead class="bg-slate-200 sticky top-0 z-40 shadow-sm">
        <tr>
            <th class="p-2 border font-black text-slate-700 bg-slate-200 z-50 left-0 sticky outline outline-1 outline-slate-300">Day</th>
            <th colspan="2" class="p-2 border font-bold text-blue-900 bg-blue-100">🌧️ Dam / Headworks Rainfall</th>
            <th colspan="2" class="p-2 border font-bold text-emerald-900 bg-emerald-100">🌧️ Powerhouse Rainfall</th>
            ${showPred ? '<th colspan="2" class="p-2 border font-bold text-amber-900 bg-amber-100">🤖 Predicted Rainfall (API)</th>' : ''}
        </tr>
        <tr class="sticky top-[35px] z-40">
            <th class="p-2 border font-semibold text-slate-600 bg-slate-50">-</th>
            <th class="p-2 border font-semibold text-slate-600 bg-blue-50">Total (mm)</th>
            <th class="p-2 border font-semibold text-slate-600 bg-blue-50">Rain Events</th>
            <th class="p-2 border font-semibold text-slate-600 bg-emerald-50">Total (mm)</th>
            <th class="p-2 border font-semibold text-slate-600 bg-emerald-50">Diff vs Dam</th>
            ${showPred ? '<th class="p-2 border font-semibold text-slate-600 bg-amber-50">Dam (mm)</th><th class="p-2 border font-semibold text-slate-600 bg-amber-50">PH (mm)</th>' : ''}
        </tr>
    </thead>`;
    
    let tbody = '';
    for (let day = 1; day <= maxDay; day++) {
        const rec = state.rainfallIndex.get(day) ?? {};
        const hw = toFloat(rec.headworks, null);
        const ph = toFloat(rec.powerhouse, null);
        const diff = (hw !== null && ph !== null) ? (hw - ph) : null;
        
        const nepDateStr = `${y}.${String(mIdx).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
        const engDate = getEngDate(y, m, day);
        
        const events = [rec.heavy_rain_time, rec.normal_rain_time, rec.shower_rain_time].filter(Boolean).length;
        const hasRain = (hw ?? 0) > 0 || (ph ?? 0) > 0;
        
        let hwPred = '', phPred = '';
        if (showPred) {
            const hwP = resolvePrediction(engDate, 'headworks');
            const phP = resolvePrediction(engDate, 'powerhouse');
            hwPred = hwP !== null ? hwP.toFixed(1) : '<span class="text-slate-300">-</span>';
            phPred = phP !== null ? phP.toFixed(1) : '<span class="text-slate-300">-</span>';
        }
        
        tbody += `
        <tr class="hover:bg-slate-50 transition ${hasRain ? 'bg-slate-50/50' : ''}">
            <td class="p-2 border font-bold text-slate-600 bg-slate-50 z-30 left-0 sticky outline outline-1 outline-slate-200">${day}</td>
            <td class="p-2 border cursor-pointer hover:bg-blue-50 font-bold ${hw ? 'text-blue-700' : 'text-slate-400'}"
                onclick="editRainfallNumberCell('${y}','${m}',${day},'headworks',${hw ?? 0})">${hw ?? '<span class="text-slate-300">-</span>'}</td>
            <td class="p-2 border text-xs text-slate-600 ${events > 0 ? 'font-semibold text-amber-700 bg-amber-50/50' : 'text-slate-300'}">${events > 0 ? `📋 ${events}` : '-'}</td>
            <td class="p-2 border cursor-pointer hover:bg-emerald-50 font-bold ${ph ? 'text-emerald-700' : 'text-slate-400'}"
                onclick="editRainfallNumberCell('${y}','${m}',${day},'powerhouse',${ph ?? 0})">${ph ?? '<span class="text-slate-300">-</span>'}</td>
            <td class="p-2 border font-semibold ${diff === null ? 'text-slate-300' : (diff > 0.1 ? 'text-blue-700' : (diff < -0.1 ? 'text-emerald-700' : 'text-slate-400'))}">
                ${diff === null ? '-' : (diff > 0 ? '+' : '') + diff.toFixed(1)}
            </td>
            ${showPred ? `<td class="p-2 border text-amber-700 font-medium bg-amber-50/30">${hwPred}</td><td class="p-2 border text-amber-700 font-medium bg-amber-50/30">${phPred}</td>` : ''}
        </tr>`;
    }
    
    gridTable.innerHTML = `${thead}<tbody>${tbody}</tbody>`;
}

function getMonthTotals(year, month) {
    const key = `${year}_${month}`;
    const entry = state.yearlyData.get(key);
    if (!entry) return { hw: 0, ph: 0, hwPred: 0, phPred: 0, days: 0, rainyDays: 0 };
    
    const maxDay = MONTH_DAYS[month] ?? 30;
    let hw = 0, ph = 0, days = 0, rainyDays = 0, hwPred = 0, phPred = 0;
    
    for (let d = 1; d <= maxDay; d++) {
        const rec = entry.days.get(d);
        if (rec) {
            days++;
            const hwv = toFloat(rec.headworks, 0);
            const phv = toFloat(rec.powerhouse, 0);
            hw += hwv;
            ph += phv;
            if (hwv > 0 || phv > 0) rainyDays++;
        }
        if (showPrediction()) {
            const engDate = getEngDate(year, month, d);
            const hp = resolvePrediction(engDate, 'headworks');
            const pp = resolvePrediction(engDate, 'powerhouse');
            if (hp !== null) hwPred += hp;
            if (pp !== null) phPred += pp;
        }
    }
    return { hw, ph, hwPred, phPred, days, rainyDays };
}

function renderCompareSummary() {
    const container = getEl('rf-summary-cards');
    if (!container) return;
    const m = getSelectedMonth();
    const years = [];
    state.yearlyData.forEach(v => { if (v.month === m && !years.includes(v.year)) years.push(v.year); });
    years.sort();
    
    let cards = '';
    years.slice(-4).forEach(y => {
        const t = getMonthTotals(y, m);
        const avg = t.days > 0 ? ((t.hw + t.ph) / 2) : 0;
        cards += `
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div class="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-1">${m} ${y} Rainfall</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
                <div>
                    <span class="text-[9px] text-blue-500 block">Dam / Headworks</span>
                    <span class="font-black text-blue-700">${t.hw.toFixed(0)}<span class="text-[9px] text-slate-400">mm</span></span>
                </div>
                <div>
                    <span class="text-[9px] text-emerald-500 block">Powerhouse</span>
                    <span class="font-black text-emerald-700">${t.ph.toFixed(0)}<span class="text-[9px] text-slate-400">mm</span></span>
                </div>
            </div>
            <div class="border-t border-slate-100 mt-2 pt-2">
                <span class="text-[9px] text-slate-400">Rainy Days: </span>
                <span class="font-bold text-indigo-600 text-xs">${t.rainyDays}</span>
                <span class="text-[9px] text-slate-400 ml-2">Avg: </span>
                <span class="font-bold text-amber-600 text-xs">${avg.toFixed(1)}mm</span>
            </div>
        </div>`;
    });
    
    container.innerHTML = cards || '<div class="text-center text-slate-400 p-4 col-span-full">No multi-year data available.</div>';
}

function renderCompareChart() {
    const container = getEl('rf-charts-container');
    if (!container) return;
    const m = getSelectedMonth();
    const years = [];
    state.yearlyData.forEach(v => { if (v.month === m && !years.includes(v.year)) years.push(v.year); });
    years.sort();
    
    if (years.length === 0) {
        container.innerHTML = '<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-10 text-center text-slate-400 col-span-full">No data available for year comparison.</div>';
        return;
    }
    
    const maxDay = MONTH_DAYS[m] ?? 30;
    const labels = Array.from({ length: maxDay }, (_, i) => i + 1);
    const datasets = [];
    const colors = [
        { hw: '#2563EB', ph: '#059669' },
        { hw: '#7C3AED', ph: '#0891B2' },
        { hw: '#DB2777', ph: '#CA8A04' },
        { hw: '#DC2626', ph: '#0D9488' }
    ];
    
    years.slice(-4).forEach((y, i) => {
        const key = `${y}_${m}`;
        const entry = state.yearlyData.get(key);
        const hwArr = [], phArr = [];
        for (let d = 1; d <= maxDay; d++) {
            const rec = entry?.days.get(d);
            hwArr.push(toFloat(rec?.headworks, 0));
            phArr.push(toFloat(rec?.powerhouse, 0));
        }
        const c = colors[i % colors.length];
        datasets.push({ label: `Dam Rainfall ${y}`, data: hwArr, borderColor: c.hw, backgroundColor: `${c.hw}20`, tension: 0.3, spanGaps: true });
        datasets.push({ label: `PH Rainfall ${y}`, data: phArr, borderColor: c.ph, backgroundColor: `${c.ph}20`, tension: 0.3, spanGaps: true, borderDash: [3, 3] });
    });
    
    const monthLabels = years.map(y => `${y}`);
    const monthlyHW = [], monthlyPH = [];
    years.forEach(y => {
        const t = getMonthTotals(y, m);
        monthlyHW.push(t.hw);
        monthlyPH.push(t.ph);
    });
    
    container.innerHTML = `
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h4 class="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">Daily Rainfall Trends - ${m} Year-over-Year</h4>
            <div class="relative h-56 w-full"><canvas id="compare-trend-chart"></canvas></div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h4 class="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">Total Rainfall - ${m} Year-over-Year</h4>
            <div class="relative h-56 w-full"><canvas id="compare-total-chart"></canvas></div>
        </div>
    `;
    
    new Chart(getEl('compare-trend-chart').getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Rainfall (mm)' } } }
        }
    });
    
    new Chart(getEl('compare-total-chart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: monthLabels,
            datasets: [
                { label: 'Dam / Headworks Rainfall (mm)', data: monthlyHW, backgroundColor: '#2563EB', borderRadius: 6 },
                { label: 'Powerhouse Rainfall (mm)', data: monthlyPH, backgroundColor: '#059669', borderRadius: 6 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Total Rainfall (mm)' } } }
        }
    });
}

function renderCompareGrid() {
    const gridTable = getEl('rainfall-grid-table');
    if (!gridTable) return;
    const m = getSelectedMonth();
    getEl('rf-table-title').textContent = `Year-over-Year Rainfall Comparison (${m}) - Dam vs Powerhouse`;
    
    const years = [];
    state.yearlyData.forEach(v => { if (v.month === m && !years.includes(v.year)) years.push(v.year); });
    years.sort();
    
    const showPred = showPrediction();
    const maxDay = MONTH_DAYS[m] ?? 30;
    
    let head1 = '<tr><th class="p-2 border font-black text-slate-700 bg-slate-200 z-50 left-0 sticky outline outline-1 outline-slate-300">Day</th>';
    let head2 = '<tr><th class="p-2 border font-semibold text-slate-600 bg-slate-50 sticky left-0 outline outline-1 outline-slate-200 z-40">-</th>';
    
    years.slice(-6).forEach(y => {
        head1 += `<th colspan="${showPred ? 3 : 2}" class="p-2 border font-bold bg-indigo-50 text-indigo-900">🌧️ ${y}</th>`;
        head2 += '<th class="p-2 border font-semibold bg-blue-50 text-blue-800 text-[10px]">Dam Rain (mm)</th>';
        head2 += '<th class="p-2 border font-semibold bg-emerald-50 text-emerald-800 text-[10px]">PH Rain (mm)</th>';
        if (showPred) head2 += '<th class="p-2 border font-semibold bg-amber-50 text-amber-800 text-[10px]">Pred Avg</th>';
    });
    head1 += '</tr>'; head2 += '</tr>';
    
    let tbody = '';
    for (let day = 1; day <= maxDay; day++) {
        tbody += `<tr class="hover:bg-slate-50 transition"><td class="p-2 border font-bold text-slate-600 bg-slate-50 sticky left-0 outline outline-1 outline-slate-200 z-30">${day}</td>`;
        years.slice(-6).forEach(y => {
            const key = `${y}_${m}`;
            const entry = state.yearlyData.get(key);
            const rec = entry?.days.get(day);
            const hw = toFloat(rec?.headworks, null);
            const ph = toFloat(rec?.powerhouse, null);
            const engDate = getEngDate(y, m, day);
            const hp = resolvePrediction(engDate, 'headworks');
            const pp = resolvePrediction(engDate, 'powerhouse');
            const avgPred = (hp !== null || pp !== null) ? (((hp ?? 0) + (pp ?? 0)) / 2).toFixed(1) : '-';
            
            tbody += `<td class="p-2 border font-semibold ${hw ? 'text-blue-700' : 'text-slate-300'}">${hw ?? '-'}</td>`;
            tbody += `<td class="p-2 border font-semibold ${ph ? 'text-emerald-700' : 'text-slate-300'}">${ph ?? '-'}</td>`;
            if (showPred) tbody += `<td class="p-2 border text-amber-700 font-medium bg-amber-50/30">${avgPred}</td>`;
        });
        tbody += '</tr>';
    }
    
    const thead = `<thead class="bg-slate-200 sticky top-0 z-40 shadow-sm">${head1}${head2}</thead>`;
    gridTable.innerHTML = `${thead}<tbody>${tbody}</tbody>`;
}

function renderHistoricalSummary() {
    const container = getEl('rf-summary-cards');
    if (!container) return;
    
    const yearlyTotals = new Map();
    state.yearlyData.forEach((v) => {
        if (!yearlyTotals.has(v.year)) yearlyTotals.set(v.year, { hw: 0, ph: 0, rainy: 0, days: 0 });
        const maxDay = MONTH_DAYS[v.month] ?? 30;
        let hw = 0, ph = 0, rainy = 0, days = 0;
        for (let d = 1; d <= maxDay; d++) {
            const rec = v.days.get(d);
            if (rec) {
                days++;
                const hwv = toFloat(rec.headworks, 0);
                const phv = toFloat(rec.powerhouse, 0);
                hw += hwv; ph += phv;
                if (hwv > 0 || phv > 0) rainy++;
            }
        }
        const cur = yearlyTotals.get(v.year);
        cur.hw += hw; cur.ph += ph; cur.rainy += rainy; cur.days += days;
    });
    
    const years = Array.from(yearlyTotals.keys()).sort();
    let cards = '';
    years.slice(-4).forEach(y => {
        const t = yearlyTotals.get(y);
        cards += `
        <div class="bg-white rounded-xl shadow-sm border border-indigo-100 p-4">
            <div class="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-1">📅 Year ${y} Rainfall</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
                <div>
                    <span class="text-[9px] text-blue-500 block">Dam / Headworks</span>
                    <span class="font-black text-blue-700">${t.hw.toFixed(0)}<span class="text-[9px] text-slate-400">mm</span></span>
                </div>
                <div>
                    <span class="text-[9px] text-emerald-500 block">Powerhouse</span>
                    <span class="font-black text-emerald-700">${t.ph.toFixed(0)}<span class="text-[9px] text-slate-400">mm</span></span>
                </div>
            </div>
            <div class="border-t border-slate-100 mt-2 pt-2">
                <span class="text-[9px] text-slate-400">Rainy Days: </span>
                <span class="font-bold text-indigo-600 text-xs">${t.rainy}</span>
            </div>
        </div>`;
    });
    
    container.innerHTML = cards || '<div class="text-center text-slate-400 p-4 col-span-full">No historical data available.</div>';
}

function renderHistoricalChart() {
    const container = getEl('rf-charts-container');
    if (!container) return;
    
    const yearlyTotals = new Map();
    state.yearlyData.forEach((v) => {
        if (!yearlyTotals.has(v.year)) yearlyTotals.set(v.year, { hw: 0, ph: 0, months: new Map() });
        const maxDay = MONTH_DAYS[v.month] ?? 30;
        let hw = 0, ph = 0;
        for (let d = 1; d <= maxDay; d++) {
            const rec = v.days.get(d);
            hw += toFloat(rec?.headworks, 0);
            ph += toFloat(rec?.powerhouse, 0);
        }
        const cur = yearlyTotals.get(v.year);
        cur.hw += hw; cur.ph += ph;
        cur.months.set(v.month, { hw, ph });
    });
    
    const years = Array.from(yearlyTotals.keys()).sort();
    if (years.length === 0) {
        container.innerHTML = '<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-10 text-center text-slate-400 col-span-full">No historical data available.</div>';
        return;
    }
    
    const datasets = [];
    const colors = ['#2563EB', '#7C3AED', '#DB2777', '#DC2626'];
    years.slice(-4).forEach((y, i) => {
        const hwArr = nepaliMonths.map(m => yearlyTotals.get(y).months.get(m)?.hw ?? 0);
        datasets.push({ label: `${y} - Dam Rainfall`, data: hwArr, borderColor: colors[i], backgroundColor: `${colors[i]}30`, tension: 0.3, fill: true });
    });
    
    const labels = years.map(y => `${y}`);
    const yearTotalsHW = [], yearTotalsPH = [];
    years.forEach(y => {
        yearTotalsHW.push(yearlyTotals.get(y).hw);
        yearTotalsPH.push(yearlyTotals.get(y).ph);
    });
    
    container.innerHTML = `
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h4 class="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">12-Month Rainfall Pattern - Dam / Headworks (Last 4 Years)</h4>
            <div class="relative h-56 w-full"><canvas id="historical-trend-chart"></canvas></div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h4 class="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">Annual Rainfall Totals - Dam vs Powerhouse</h4>
            <div class="relative h-56 w-full"><canvas id="historical-annual-chart"></canvas></div>
        </div>
    `;
    
    new Chart(getEl('historical-trend-chart').getContext('2d'), {
        type: 'line',
        data: { labels: nepaliMonths, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Rainfall (mm)' } } }
        }
    });
    
    new Chart(getEl('historical-annual-chart').getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Dam / Headworks Rainfall (mm)', data: yearTotalsHW, backgroundColor: '#2563EB', borderRadius: 6 },
                { label: 'Powerhouse Rainfall (mm)', data: yearTotalsPH, backgroundColor: '#059669', borderRadius: 6 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Annual Total Rainfall (mm)' } } }
        }
    });
}

function renderHistoricalGrid() {
    const gridTable = getEl('rainfall-grid-table');
    if (!gridTable) return;
    
    getEl('rf-table-title').textContent = 'Historical Rainfall Summary - Annual by Month (Dam vs Powerhouse)';
    
    const yearlyMonth = new Map();
    state.yearlyData.forEach((v) => {
        const maxDay = MONTH_DAYS[v.month] ?? 30;
        let hw = 0, ph = 0;
        for (let d = 1; d <= maxDay; d++) {
            const rec = v.days.get(d);
            hw += toFloat(rec?.headworks, 0);
            ph += toFloat(rec?.powerhouse, 0);
        }
        if (!yearlyMonth.has(v.year)) yearlyMonth.set(v.year, new Map());
        yearlyMonth.get(v.year).set(v.month, { hw, ph });
    });
    
    const years = Array.from(yearlyMonth.keys()).sort();
    const cols = years.slice(-6);
    
    let head1 = '<tr><th rowspan="2" class="p-2 border font-black text-slate-700 bg-slate-200 z-50 left-0 sticky outline outline-1 outline-slate-300">🌧️ Month</th>';
    cols.forEach(y => { head1 += `<th colspan="2" class="p-2 border font-bold bg-indigo-50 text-indigo-900">${y} Rainfall</th>`; });
    head1 += '</tr>';
    let head2 = '<tr>';
    cols.forEach(y => {
        head2 += '<th class="p-2 border font-semibold bg-blue-50 text-blue-800 text-[10px]">Dam (mm)</th>';
        head2 += '<th class="p-2 border font-semibold bg-emerald-50 text-emerald-800 text-[10px]">PH (mm)</th>';
    });
    head2 += '</tr>';
    
    let tbody = '';
    nepaliMonths.forEach(m => {
        tbody += `<tr class="hover:bg-slate-50 transition"><td class="p-2 border font-bold text-slate-600 bg-slate-50 sticky left-0 outline outline-1 outline-slate-200 z-30">${m}</td>`;
        cols.forEach(y => {
            const data = yearlyMonth.get(y)?.get(m);
            tbody += `<td class="p-2 border font-semibold ${data?.hw > 0 ? 'text-blue-700' : 'text-slate-300'}">${data?.hw > 0 ? data.hw.toFixed(0) : '-'}</td>`;
            tbody += `<td class="p-2 border font-semibold ${data?.ph > 0 ? 'text-emerald-700' : 'text-slate-300'}">${data?.ph > 0 ? data.ph.toFixed(0) : '-'}</td>`;
        });
        tbody += '</tr>';
    });
    
    tbody += `<tr class="bg-slate-100 font-black sticky bottom-0 z-40"><td class="p-2 border text-slate-900 bg-slate-200 sticky left-0 z-50 outline outline-1 outline-slate-400">ANNUAL TOTAL</td>`;
    cols.forEach(y => {
        const totalHW = nepaliMonths.reduce((s, m2) => s + (yearlyMonth.get(y)?.get(m2)?.hw ?? 0), 0);
        const totalPH = nepaliMonths.reduce((s, m2) => s + (yearlyMonth.get(y)?.get(m2)?.ph ?? 0), 0);
        tbody += `<td class="p-2 border text-blue-900 bg-blue-50">${totalHW.toFixed(0)}</td>`;
        tbody += `<td class="p-2 border text-emerald-900 bg-emerald-50">${totalPH.toFixed(0)}</td>`;
    });
    tbody += '</tr>';
    
    const thead = `<thead class="bg-slate-200 sticky top-0 z-40 shadow-sm">${head1}${head2}</thead>`;
    gridTable.innerHTML = `${thead}<tbody>${tbody}</tbody>`;
}

window.editRainfallNumberCell = async function (y, m, d, field, currentVal) {
    if (getUserRole() === 'normal') return;
    const newVal = prompt(`Enter rainfall (mm) for ${m} ${y}, Day ${d} (${field === 'headworks' ? 'Dam / Headworks' : 'Powerhouse'}):`, currentVal);
    if (newVal === null) return;
    const floatVal = parseFloat(newVal);
    if (newVal.trim() !== '' && isNaN(floatVal)) return showNotification('Invalid number', true);
    saveCellData(y, m, d, field, isNaN(floatVal) ? null : floatVal);
};

async function saveCellData(y, m, d, field, value) {
    const payload = {
        id: buildId(y, m, d),
        nepali_year: parseInt(y),
        nepali_month: m,
        day: parseInt(d),
        [field]: value,
        operator_email: getCurrentUser()?.email ?? '',
        updated_at: new Date().toISOString(),
    };
    try {
        await safeUpsert('rainfall_data', payload);
        await refreshDashboard();
    } catch (err) {
        showNotification('Save error: ' + err.message, true);
    }
}

function buildId(y, m, d) {
    return `${y}_${m}_${String(d).padStart(2, '0')}`;
}

async function upsertInChunks(rows, chunkSize = 500) {
    for (let i = 0; i < rows.length; i += chunkSize) {
        await safeUpsert('rainfall_data', rows.slice(i, i + chunkSize));
    }
}

function getStandardMonth(rawStr) {
    if (!rawStr) return null;
    const norm = rawStr.toLowerCase().replace(/[^a-z]/g, '');
    for (const [alias, canonical] of MONTH_ALIASES) {
        if (norm.includes(alias)) return canonical;
    }
    return null;
}

async function processAndUploadRainfall(jd) {
    let currentYear  = getSelectedYear();
    let currentMonth = getSelectedMonth();
    let dayColIdx    = -1;
    showNotification('Fetching existing records…', false);
    const { data: existing } = await supabase.from('rainfall_data').select('*').eq('nepali_year', currentYear);
    const existingIndex = new Map((existing ?? []).map(r => [r.id, r]));
    const payloadMap    = new Map();
    for (const row of jd) {
        if (!row) continue;
        const rowStr = row.join(' ').toLowerCase();
        const yrMatch = rowStr.includes('year') && rowStr.match(/\d{4}/);
        if (yrMatch) currentYear = parseInt(yrMatch[0]);
        if (rowStr.includes('month')) {
            const parsed = getStandardMonth(rowStr);
            if (parsed) currentMonth = parsed;
        }
        const dIdx = row.findIndex(c => String(c).trim().toLowerCase() === 'day');
        if (dIdx !== -1) { dayColIdx = dIdx; continue; }
        if (dayColIdx === -1 || !currentYear || !currentMonth) continue;
        const dayVal = parseInt(row[dayColIdx]);
        if (isNaN(dayVal) || dayVal < 1 || dayVal > 32) continue;
        const fields = {};
        for (const { offset, key, type } of IMPORT_FIELDS) {
            const raw = row[dayColIdx + offset];
            if (raw == null || String(raw).trim() === '') continue;
            fields[key] = type === 'number' ? parseFloat(raw) : String(raw).trim();
        }
        const hasContent = Object.keys(fields).some(k =>
            fields[k] != null && fields[k] !== '' && !isNaN(Number(fields[k]) || 1)
        );
        if (!hasContent) continue;
        const id  = buildId(currentYear, currentMonth, dayVal);
        const rec = existingIndex.get(id) ?? {};
        payloadMap.set(id, {
            ...rec, id,
            nepali_year:    currentYear, nepali_month:   currentMonth, day: dayVal,
            powerhouse:     fields.powerhouse   ?? 0, headworks:      fields.headworks     ?? 0,
            heavy_rain_time: fields.heavy_rain_time ?? null, normal_rain_time: fields.normal_rain_time ?? null,
            shower_rain_time: fields.shower_rain_time ?? null,
            operator_email: getCurrentUser()?.email ?? '', updated_at: new Date().toISOString(),
        });
    }
    const payload = [...payloadMap.values()];
    if (!payload.length) return showNotification('Import error: no valid rows found.', true);
    showNotification(`Uploading ${payload.length} records…`, false);
    try {
        await upsertInChunks(payload);
        showNotification(`✅ Imported ${payload.length} records.`);
        refreshDashboard();
    } catch (err) {
        showNotification('Upload error: ' + err.message, true);
    }
}

function generateExcelExport() {
    const mode = getViewMode();
    const y = getSelectedYear();
    const m = getSelectedMonth();
    try {
        if (mode === 'monthly') {
            const maxDay = MONTH_DAYS[m] ?? 31;
            const header = [
                ['MAKARI GAD HYDROELECTRIC PROJECT'],
                ['Daily Rainfall Measurement'],
                [`Year : ${y}`, `Month : ${m}`],
                ['Day', 'Dam / Headworks (mm)', 'Powerhouse (mm)'],
            ];
            const rows = Array.from({ length: maxDay }, (_, i) => {
                const day = i + 1;
                const rec = state.rainfallIndex.get(day) ?? {};
                return [day, rec.headworks ?? '', rec.powerhouse ?? ''];
            });
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([...header, ...rows]);
            ws['!cols'] = [6, 18, 18].map(wch => ({ wch }));
            XLSX.utils.book_append_sheet(wb, ws, `Rainfall_${m}_${y}`);
            XLSX.writeFile(wb, `Rainfall_${m}_${y}.xlsx`);
        } else {
            const exportData = [];
            if (mode === 'compare') {
                exportData.push(['Month:', m, '', 'Year-over-Year Comparison']);
                exportData.push(['Day', ...nepaliMonths.map(() => '')]);
                const years = [];
                state.yearlyData.forEach(v => { if (v.month === m && !years.includes(v.year)) years.push(v.year); });
                years.sort();
                const header = ['Day'];
                years.slice(-6).forEach(y => { header.push(`${y} - Dam`, `${y} - PH`); });
                exportData.length = 0;
                exportData.push(header);
                const maxDay = MONTH_DAYS[m] ?? 30;
                for (let d = 1; d <= maxDay; d++) {
                    const row = [d];
                    years.slice(-6).forEach(y2 => {
                        const key = `${y2}_${m}`;
                        const entry = state.yearlyData.get(key);
                        const rec = entry?.days.get(d);
                        row.push(toFloat(rec?.headworks, ''), toFloat(rec?.powerhouse, ''));
                    });
                    exportData.push(row);
                }
            } else {
                const years = [];
                state.yearlyData.forEach(v => { if (!years.includes(v.year)) years.push(v.year); });
                years.sort();
                const cols = years.slice(-6);
                const header = ['Month'];
                cols.forEach(y3 => header.push(`${y3} - Dam`, `${y3} - PH`));
                exportData.push(header);
                const yearlyMonth = new Map();
                state.yearlyData.forEach((v) => {
                    const maxDay = MONTH_DAYS[v.month] ?? 30;
                    let hw = 0, ph = 0;
                    for (let d = 1; d <= maxDay; d++) {
                        const rec = v.days.get(d);
                        hw += toFloat(rec?.headworks, 0);
                        ph += toFloat(rec?.powerhouse, 0);
                    }
                    if (!yearlyMonth.has(v.year)) yearlyMonth.set(v.year, new Map());
                    yearlyMonth.get(v.year).set(v.month, { hw, ph });
                });
                nepaliMonths.forEach(m2 => {
                    const row = [m2];
                    cols.forEach(y3 => {
                        const data = yearlyMonth.get(y3)?.get(m2);
                        row.push(data?.hw ?? '', data?.ph ?? '');
                    });
                    exportData.push(row);
                });
            }
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(exportData);
            XLSX.utils.book_append_sheet(wb, ws, `Rainfall_${mode}`);
            XLSX.writeFile(wb, `Rainfall_${mode}_${Date.now()}.xlsx`);
        }
    } catch (err) {
        showNotification('Export error: ' + err.message, true);
    }
}
