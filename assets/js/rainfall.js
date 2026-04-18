import { supabase } from './core-app.js';
import {
    showNotification,
    showConfirmation,
    nepaliMonths,
    getNepDateObj,
    getCurrentUser,
    getUserRole,
    calendarMap
} from './plant-data.js';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const INTAKE      = { lat: 29.7891, lon: 80.8700, elev: 2387 };
const POWERHOUSE  = { lat: 29.8009, lon: 80.8430, elev: 1463 };
const CATCHMENT   = { lat: 29.7397, lon: 80.9700, elev: 4200 };

const MONTH_DAYS = {
    Baisakh: 31, Jestha: 31, Ashadh: 32, Shrawan: 31,
    Bhadra:  31, Ashoj:  31, Kartik: 30, Mangsir: 30,
    Poush:   29, Magh:   30, Falgun: 30, Chaitra: 30
};

// Fuzzy name → canonical month name
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

// Excel import: field positions relative to the "Day" column
const IMPORT_FIELDS = [
    { offset: 1, key: 'heavy_rain_time', type: 'string' },
    { offset: 3, key: 'normal_rain_time', type: 'string' },
    { offset: 5, key: 'shower_rain_time', type: 'string' },
    { offset: 7, key: 'powerhouse',       type: 'number' },
    { offset: 8, key: 'headworks',        type: 'number' },
];

// ─────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────
let rainfallIndex   = new Map();   // id → record, replaces allRainfallData array
let allHourlyLogs   = [];
let apiWeatherData  = {};
let rainChartInstance = null;
let tempChartInstance = null;
let isLoadingRainfall = false;

// ─────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────

/**
 * Approximate English date for a Nepali year/month/day.
 * Used only when the calendarMap has no entry.
 */
function getFallbackEngDate(y, m, d) {
    const monthOffsets = [13, 14, 15, 16, 17, 17, 18, 16, 14, 13, 12, 14];
    const startYear = y - 57;
    const monthIdx  = nepaliMonths.indexOf(m);
    const date = new Date(startYear, 3 + monthIdx, (monthOffsets[monthIdx] ?? 14) + (d - 1));
    return date.toISOString().split('T')[0];
}

/**
 * Returns the English date string for a Nepali date, preferring the calendarMap.
 * @param {number} y  Nepali year
 * @param {string} m  Nepali month name
 * @param {number} d  Nepali day
 */
function getEngDate(y, m, d) {
    const mIdx = nepaliMonths.indexOf(m) + 1;
    const nepStr = `${y}.${String(mIdx).padStart(2, '0')}.${String(d).padStart(2, '0')}`;

    if (calendarMap && Object.keys(calendarMap).length > 0) {
        const match = Object.keys(calendarMap).find(k => calendarMap[k].nep_date_str === nepStr);
        if (match) return match;
    }
    return getFallbackEngDate(y, m, d);
}

/**
 * Applies the 24-hour offset: returns the English date for the *previous* calendar day.
 * This aligns the API precipitation window (00:00–24:00 UTC-1) to the Nepali logging day.
 */
function getPrevDay(engDateStr) {
    const d = new Date(engDateStr);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────
function getEl(id) { return document.getElementById(id); }

function getSelectedYear()  { return parseInt(getEl('grid-rf-year')?.value); }
function getSelectedMonth() { return getEl('grid-rf-month')?.value; }

// ─────────────────────────────────────────────
// Event wiring
// ─────────────────────────────────────────────
document.addEventListener('click', (e) => {
    if (e.target.closest('#rf-download-btn'))  generateExactExcelExport();
    if (e.target.closest('#rf-upload-btn'))    triggerFileUpload();
    if (e.target.closest('#sync-api-btn'))     syncFullYearApiData();
});

document.addEventListener('change', (e) => {
    if (e.target.id === 'rf-file-upload')                   handleFileUpload(e);
    if (e.target.id === 'grid-rf-year' || e.target.id === 'grid-rf-month') refreshDashboard();
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

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────
export function initRainfallEvents() { /* event wiring is done at module load */ }

export async function loadRainfallData() {
    updateRainfallGridFilters();
    await refreshDashboard();
}

// ─────────────────────────────────────────────
// Filter initialisation
// ─────────────────────────────────────────────
function updateRainfallGridFilters() {
    const ySelect = getEl('grid-rf-year');
    const mSelect = getEl('grid-rf-month');
    if (!ySelect || !mSelect || ySelect.options.length) return;

    const { year, month } = getNepDateObj();
    ySelect.innerHTML = Array.from(
        { length: year + 2 - 2079 },
        (_, i) => `<option value="${year + 1 - i}">${year + 1 - i}</option>`
    ).join('');
    mSelect.innerHTML = nepaliMonths.map(m => `<option value="${m}">${m}</option>`).join('');
    ySelect.value = year;
    mSelect.value = month;
}

// ─────────────────────────────────────────────
// Dashboard orchestration
// ─────────────────────────────────────────────
async function refreshDashboard() {
    if (isLoadingRainfall) return;
    isLoadingRainfall = true;
    try {
        await loadMonthlyData();
        renderMonthlyGrid();
        renderCharts();
    } catch (err) {
        console.error('Dashboard load error:', err);
        showNotification('Failed to load dashboard: ' + err.message, true);
    } finally {
        isLoadingRainfall = false;
    }
}

// ─────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────
async function loadMonthlyData() {
    const y = getSelectedYear();
    const m = getSelectedMonth();
    if (!y || !m) return;

    const mIdx = nepaliMonths.indexOf(m) + 1;

    const [{ data: rainData }, { data: hourData }] = await Promise.all([
        supabase.from('rainfall_data').select('*').eq('nepali_year', y).eq('nepali_month', m),
        supabase.from('hourly_logs')
            .select('nepali_date, t_temp_out, t_temp_in, t_temp_intake')
            .like('nepali_date', `${y}.${String(mIdx).padStart(2, '0')}%`)
    ]);

    // Index rainfall records by day for O(1) lookups
    rainfallIndex = new Map((rainData ?? []).map(r => [r.day, r]));
    allHourlyLogs = hourData ?? [];

    // Determine English date window for API fetch
    const firstEngDate = getEngDate(y, m, 1);
    const lastEngDate  = getEngDate(y, m, MONTH_DAYS[m] ?? 30);
    await fetchOpenMeteoData(getPrevDay(firstEngDate), lastEngDate);
}

// ─────────────────────────────────────────────
// Open-Meteo fetch
// ─────────────────────────────────────────────
async function fetchOpenMeteoData(startStr, endStr) {
    apiWeatherData = {};
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

        const lats = `${INTAKE.lat},${POWERHOUSE.lat},${CATCHMENT.lat}`;
        const lons = `${INTAKE.lon},${POWERHOUSE.lon},${CATCHMENT.lon}`;
        const elevs = `${INTAKE.elev},${POWERHOUSE.elev},${CATCHMENT.elev}`;
        const url = `${base}?latitude=${lats}&longitude=${lons}&elevation=${elevs}` +
            `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
            `&start_date=${startStr}&end_date=${safeEnd}&timezone=auto`;

        const res = await fetch(url);
        if (!res.ok) return;

        const json = await res.json();
        if (!Array.isArray(json) || json.length < 3) return;

        const [intakeApi, phApi, catchApi] = json.map(j => j.daily);
        const avgTemp = (api, i) =>
            ((api.temperature_2m_max[i] + api.temperature_2m_min[i]) / 2).toFixed(1);

        intakeApi.time.forEach((t, i) => {
            apiWeatherData[t] = {
                in_precip:  intakeApi.precipitation_sum[i],
                in_temp:    avgTemp(intakeApi, i),
                ph_precip:  phApi.precipitation_sum[i],
                ph_temp:    avgTemp(phApi, i),
                cat_precip: catchApi.precipitation_sum[i],
                cat_temp:   avgTemp(catchApi, i),
            };
        });
    } catch {
        console.warn('Open-Meteo fetch skipped.');
    }
}

// ─────────────────────────────────────────────
// Resolve a value: prefer DB-saved API column, fall back to live fetch
// ─────────────────────────────────────────────
function resolveApiValue(dbVal, liveVal) {
    return dbVal != null ? dbVal : (liveVal ?? '-');
}

/**
 * Build the combined API data object for a single day,
 * merging saved DB columns with live-fetched values.
 */
function getDayApiData(rec, engDate) {
    const live = apiWeatherData[getPrevDay(engDate)] ?? {};
    return {
        catPrecip: resolveApiValue(rec?.api_cat_precip, live.cat_precip),
        catTemp:   resolveApiValue(rec?.api_cat_temp,   live.cat_temp),
        inPrecip:  resolveApiValue(rec?.api_in_precip,  live.in_precip),
        inTemp:    resolveApiValue(rec?.api_in_temp,    live.in_temp),
        phPrecip:  resolveApiValue(rec?.api_ph_precip,  live.ph_precip),
        phTemp:    resolveApiValue(rec?.api_ph_temp,    live.ph_temp),
    };
}

/**
 * Average a temperature field from hourly logs for one day.
 * Returns '-' when no logs exist.
 */
function avgHourlyTemp(nepDateStr, field) {
    const logs = allHourlyLogs.filter(l => l.nepali_date === nepDateStr && l[field] != null);
    if (!logs.length) return '-';
    return (logs.reduce((s, l) => s + l[field], 0) / logs.length).toFixed(1);
}

// ─────────────────────────────────────────────
// Grid rendering
// ─────────────────────────────────────────────
const GRID_THEAD = `
<thead class="bg-slate-200 sticky top-0 z-40 shadow-sm">
    <tr>
        <th rowspan="2" class="p-2 border font-black text-slate-700 bg-slate-200 z-50 left-0 sticky outline outline-1 outline-slate-300">Day</th>
        <th colspan="3" class="p-2 border font-bold text-indigo-900 bg-indigo-100">Physical Rain Log (Time)</th>
        <th colspan="2" class="p-2 border font-bold text-amber-900 bg-amber-100">Catchment (4200m API)</th>
        <th colspan="4" class="p-2 border font-bold text-emerald-900 bg-emerald-100">Intake / Headworks</th>
        <th colspan="5" class="p-2 border font-bold text-sky-900 bg-sky-100">Powerhouse</th>
    </tr>
    <tr class="sticky top-[35px] z-40">
        <th class="p-2 border font-semibold text-slate-600 bg-indigo-50 w-24">Heavy</th>
        <th class="p-2 border font-semibold text-slate-600 bg-indigo-50 w-24">Normal</th>
        <th class="p-2 border font-semibold text-slate-600 bg-indigo-50 w-24">Shower</th>
        <th class="p-2 border font-semibold text-slate-600 bg-amber-50 text-[10px]">Precip Pred.</th>
        <th class="p-2 border font-semibold text-slate-600 bg-amber-50 text-[10px]">Temp Pred.</th>
        <th class="p-2 border font-semibold text-slate-600 bg-emerald-50 text-[10px]">Rain Meas.</th>
        <th class="p-2 border font-semibold text-slate-600 bg-emerald-50 text-[10px]">Rain Pred.</th>
        <th class="p-2 border font-semibold text-slate-600 bg-emerald-50 text-[10px]">Temp Meas.</th>
        <th class="p-2 border font-semibold text-slate-600 bg-emerald-50 text-[10px]">Temp Pred.</th>
        <th class="p-2 border font-semibold text-slate-600 bg-sky-50 text-[10px]">Rain Meas.</th>
        <th class="p-2 border font-semibold text-slate-600 bg-sky-50 text-[10px]">Rain Pred.</th>
        <th class="p-2 border font-semibold text-slate-600 bg-sky-50 text-[10px]">Temp IN</th>
        <th class="p-2 border font-semibold text-slate-600 bg-sky-50 text-[10px]">Temp OUT</th>
        <th class="p-2 border font-semibold text-slate-600 bg-sky-50 text-[10px]">Temp Pred.</th>
    </tr>
</thead>`;

function formatTimeCell(txt) {
    if (!txt) return '<span class="text-slate-300">-</span>';
    return txt.split(',')
        .map(t => `<div class="bg-white border border-slate-200 rounded px-1 my-0.5 text-[10px] text-slate-700 w-full">${t.trim()}</div>`)
        .join('');
}

function measCell(val, colorClass, y, m, day, field) {
    const display = val ?? '-';
    const hasData = val != null && val > 0;
    return `<td class="p-2 border cursor-pointer hover:bg-${colorClass}-50 font-bold ${hasData ? `text-${colorClass}-700 bg-${colorClass}-50` : 'text-slate-400'}"
               onclick="editRainfallNumberCell('${y}','${m}',${day},'${field}',${val ?? 0})">${display}</td>`;
}

function buildDayRow(y, m, day) {
    const rec  = rainfallIndex.get(day) ?? {};
    const mIdx = nepaliMonths.indexOf(m) + 1;
    const nepDateStr = `${y}.${String(mIdx).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
    const engDate    = getEngDate(y, m, day);
    const api        = getDayApiData(rec, engDate);

    const avgIn  = avgHourlyTemp(nepDateStr, 't_temp_in');
    const avgOut = avgHourlyTemp(nepDateStr, 't_temp_out');
    const avgInt = avgHourlyTemp(nepDateStr, 't_temp_intake');

    return `
    <tr class="hover:bg-slate-50 transition">
        <td class="p-2 border font-bold text-slate-600 bg-slate-50 z-30 left-0 sticky outline outline-1 outline-slate-200">${day}</td>
        <td class="p-1 border cursor-pointer hover:bg-indigo-50 align-top"
            onclick="editRainfallTextCell('${y}','${m}',${day},'heavy_rain_time','${rec.heavy_rain_time ?? ''}')">${formatTimeCell(rec.heavy_rain_time)}</td>
        <td class="p-1 border cursor-pointer hover:bg-indigo-50 align-top"
            onclick="editRainfallTextCell('${y}','${m}',${day},'normal_rain_time','${rec.normal_rain_time ?? ''}')">${formatTimeCell(rec.normal_rain_time)}</td>
        <td class="p-1 border cursor-pointer hover:bg-indigo-50 align-top"
            onclick="editRainfallTextCell('${y}','${m}',${day},'shower_rain_time','${rec.shower_rain_time ?? ''}')">${formatTimeCell(rec.shower_rain_time)}</td>
        <td class="p-2 border text-amber-700 font-bold bg-amber-50/40">${api.catPrecip}</td>
        <td class="p-2 border text-amber-700 font-bold bg-amber-50/40">${api.catTemp}</td>
        ${measCell(rec.headworks, 'indigo', y, m, day, 'headworks')}
        <td class="p-2 border text-emerald-700 font-bold bg-emerald-50/40">${api.inPrecip}</td>
        <td class="p-2 border text-emerald-700 font-medium">${avgInt}</td>
        <td class="p-2 border text-emerald-700 font-bold bg-emerald-50/40">${api.inTemp}</td>
        ${measCell(rec.powerhouse, 'emerald', y, m, day, 'powerhouse')}
        <td class="p-2 border text-sky-700 font-bold bg-sky-50/40">${api.phPrecip}</td>
        <td class="p-2 border text-sky-700 font-medium">${avgIn}</td>
        <td class="p-2 border text-sky-700 font-medium">${avgOut}</td>
        <td class="p-2 border text-sky-700 font-bold bg-sky-50/40">${api.phTemp}</td>
    </tr>`;
}

function renderMonthlyGrid() {
    const y = getSelectedYear();
    const m = getSelectedMonth();
    const gridTable = getEl('rainfall-grid-table');
    if (!gridTable || !y || !m) return;

    const maxDay = MONTH_DAYS[m] ?? 32;
    const rows = Array.from({ length: maxDay }, (_, i) => buildDayRow(y, m, i + 1)).join('');
    gridTable.innerHTML = `${GRID_THEAD}<tbody>${rows}</tbody>`;
}

// ─────────────────────────────────────────────
// Charts
// ─────────────────────────────────────────────
function renderCharts() {
    const y = getSelectedYear();
    const m = getSelectedMonth();
    if (!y || !m) return;

    const mIdx   = nepaliMonths.indexOf(m) + 1;
    const labels = Array.from({ length: 31 }, (_, i) => i + 1);

    const series = { rIntakeM: [], rIntakeP: [], rDamM: [], rDamP: [], tIn: [], tOut: [], tCatch: [] };

    labels.forEach(day => {
        const rec        = rainfallIndex.get(day) ?? {};
        const engDate    = getEngDate(y, m, day);
        const api        = getDayApiData(rec, engDate);
        const nepDateStr = `${y}.${String(mIdx).padStart(2, '0')}.${String(day).padStart(2, '0')}`;

        series.rIntakeM.push(rec.headworks  ?? 0);
        series.rDamM.push(rec.powerhouse ?? 0);
        series.rIntakeP.push(toFloat(api.inPrecip));
        series.rDamP.push(toFloat(api.phPrecip));
        series.tCatch.push(toFloat(api.catTemp, null));

        const avgIn  = avgHourlyTemp(nepDateStr, 't_temp_in');
        const avgOut = avgHourlyTemp(nepDateStr, 't_temp_out');
        series.tIn.push(avgIn  === '-' ? null : parseFloat(avgIn));
        series.tOut.push(avgOut === '-' ? null : parseFloat(avgOut));
    });

    rainChartInstance?.destroy();
    rainChartInstance = new Chart(getEl('rainfall-trend-chart').getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Intake (Meas)',      data: series.rIntakeM, backgroundColor: '#10B981', stack: 'Stack 0' },
                { label: 'Intake (Pred, -24h)', data: series.rIntakeP, backgroundColor: '#A7F3D0', stack: 'Stack 0' },
                { label: 'Powerhouse (Meas)',          data: series.rDamM,    backgroundColor: '#3B82F6', stack: 'Stack 1' },
                { label: 'Powerhouse (Pred, -24h)',    data: series.rDamP,    backgroundColor: '#BFDBFE', stack: 'Stack 1' },
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index' } }
    });

    tempChartInstance?.destroy();
    tempChartInstance = new Chart(getEl('temp-trend-chart').getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Room IN',         data: series.tIn,     borderColor: '#F59E0B', tension: 0.3, spanGaps: true },
                { label: 'Room OUT',        data: series.tOut,    borderColor: '#EF4444', tension: 0.3, spanGaps: true },
                { label: 'Catchment (Pred)', data: series.tCatch, borderColor: '#6366F1', borderDash: [5, 5], tension: 0.3, spanGaps: true },
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function toFloat(val, fallback = 0) {
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
}

// ─────────────────────────────────────────────
// Month name normaliser
// ─────────────────────────────────────────────
function getStandardMonth(rawStr) {
    if (!rawStr) return null;
    const norm = rawStr.toLowerCase().replace(/[^a-z]/g, '');
    for (const [alias, canonical] of MONTH_ALIASES) {
        if (norm.includes(alias)) return canonical;
    }
    return null;
}

// ─────────────────────────────────────────────
// Bulk year API sync
// ─────────────────────────────────────────────
async function syncFullYearApiData() {
    const y = getSelectedYear();
    if (!y) return showNotification('Select a year first.', true);

    const confirmed = await showConfirmation(
        `Download and save Open-Meteo satellite data for the entire year of ${y}?`
    );
    if (!confirmed) return;

    showNotification(`Fetching satellite data for ${y}…`, false);

    const { data: existing } = await supabase.from('rainfall_data').select('*').eq('nepali_year', y);
    const existingIndex = new Map((existing ?? []).map(r => [r.id, r]));

    const firstEngDate = getEngDate(y, nepaliMonths[0], 1);
    const lastEngDate  = getEngDate(y, nepaliMonths[11], 30);
    await fetchOpenMeteoData(getPrevDay(firstEngDate), lastEngDate);

    const payload = [];
    nepaliMonths.forEach((m, mIdx) => {
        const maxDay = MONTH_DAYS[m] ?? 30;
        for (let day = 1; day <= maxDay; day++) {
            const engDate = getEngDate(y, m, day);
            const api     = apiWeatherData[getPrevDay(engDate)];
            if (!api) continue;

            const id  = buildId(y, m, day);
            const rec = existingIndex.get(id) ?? {};
            payload.push({
                ...rec,
                id,
                nepali_year:    y,
                nepali_month:   m,
                day,
                api_cat_precip: toFloat(api.cat_precip, null),
                api_cat_temp:   toFloat(api.cat_temp,   null),
                api_in_precip:  toFloat(api.in_precip,  null),
                api_in_temp:    toFloat(api.in_temp,    null),
                api_ph_precip:  toFloat(api.ph_precip,  null),
                api_ph_temp:    toFloat(api.ph_temp,    null),
                operator_email: getCurrentUser()?.email ?? '',
                updated_at:     new Date().toISOString(),
            });
        }
    });

    if (!payload.length) return showNotification('No API data retrieved. Check date limits.', true);

    showNotification(`Saving ${payload.length} days to database…`, false);
    try {
        await upsertInChunks(payload);
        showNotification(`✅ Synced full ${y} satellite data (${payload.length} days).`);
        refreshDashboard();
    } catch (err) {
        showNotification('Save error: ' + err.message, true);
    }
}

// ─────────────────────────────────────────────
// Excel import
// ─────────────────────────────────────────────
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

        // Detect year/month headers
        const yrMatch = rowStr.includes('year') && rowStr.match(/\d{4}/);
        if (yrMatch) currentYear = parseInt(yrMatch[0]);

        if (rowStr.includes('month')) {
            const parsed = getStandardMonth(rowStr);
            if (parsed) currentMonth = parsed;
        }

        // Detect column header row
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
            ...rec,
            id,
            nepali_year:    currentYear,
            nepali_month:   currentMonth,
            day:            dayVal,
            powerhouse:     fields.powerhouse   ?? 0,
            headworks:      fields.headworks     ?? 0,
            heavy_rain_time: fields.heavy_rain_time ?? null,
            normal_rain_time: fields.normal_rain_time ?? null,
            shower_rain_time: fields.shower_rain_time ?? null,
            operator_email: getCurrentUser()?.email ?? '',
            updated_at:     new Date().toISOString(),
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

// ─────────────────────────────────────────────
// Excel export
// ─────────────────────────────────────────────
function generateExactExcelExport() {
    const y = getSelectedYear();
    const m = getSelectedMonth();
    if (!y || !m) return showNotification('Select a year and month first.', true);

    try {
        const header = [
            ['MAKARI GAD HYDROELECTRIC PROJECT'],
            ['Daily Rainfall Measurement'],
            [`Year : ${y}`],
            [`Month : ${m}`],
            ['Location : Power house and Intake'],
            ['Day', 'Heavy Rain (Hrs)', '', 'Rain (Hrs)', '', 'Shower (Hrs)', '', 'Rainfall (mm)'],
            ['',    'Time', 'Hours', 'Time', 'Hours', 'Time', 'Hours', 'Power house', 'Intake'],
        ];

        const maxDay = MONTH_DAYS[m] ?? 31;
        const rows = Array.from({ length: maxDay }, (_, i) => {
            const day = i + 1;
            const rec = rainfallIndex.get(day) ?? {};
            return [
                day,
                rec.heavy_rain_time  ?? '', '',
                rec.normal_rain_time ?? '', '',
                rec.shower_rain_time ?? '', '',
                rec.powerhouse ?? '',
                rec.headworks  ?? '',
            ];
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...header, ...rows]);
        ws['!cols'] = [6, 20, 8, 20, 8, 20, 8, 15, 15].map(wch => ({ wch }));
        XLSX.utils.book_append_sheet(wb, ws, `Rainfall_${m}_${y}`);
        XLSX.writeFile(wb, `Daily_Rainfall_${m}_${y}.xlsx`);
    } catch (err) {
        showNotification('Export error: ' + err.message, true);
    }
}

// ─────────────────────────────────────────────
// Cell editing (called from inline onclick)
// ─────────────────────────────────────────────
window.editRainfallTextCell = async function (y, m, d, field, currentVal) {
    if (getUserRole() === 'normal') return;
    const newVal = prompt('Enter times (comma-separated, e.g. "01:00-03:00, 14:30-15:00"):', currentVal === 'undefined' ? '' : currentVal);
    if (newVal !== null) saveCellData(y, m, d, field, newVal.trim() || null);
};

window.editRainfallNumberCell = async function (y, m, d, field, currentVal) {
    if (getUserRole() === 'normal') return;
    const newVal = prompt(`Enter measured amount (mm) for Day ${d}:`, currentVal);
    if (newVal === null) return;
    const floatVal = parseFloat(newVal);
    if (newVal.trim() !== '' && isNaN(floatVal)) return showNotification('Invalid number', true);
    saveCellData(y, m, d, field, isNaN(floatVal) ? null : floatVal);
};

async function saveCellData(y, m, d, field, value) {
    const payload = {
        id:             buildId(y, m, d),
        nepali_year:    parseInt(y),
        nepali_month:   m,
        day:            parseInt(d),
        [field]:        value,
        operator_email: getCurrentUser()?.email ?? '',
        updated_at:     new Date().toISOString(),
    };
    try {
        const { error } = await supabase.from('rainfall_data').upsert(payload);
        if (error) throw error;
        await refreshDashboard();
    } catch (err) {
        showNotification('Save error: ' + err.message, true);
    }
}

// ─────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────
function buildId(y, m, d) {
    return `${y}_${m}_${String(d).padStart(2, '0')}`;
}

async function upsertInChunks(rows, chunkSize = 500) {
    for (let i = 0; i < rows.length; i += chunkSize) {
        const { error } = await supabase.from('rainfall_data').upsert(rows.slice(i, i + chunkSize));
        if (error) throw error;
    }
}