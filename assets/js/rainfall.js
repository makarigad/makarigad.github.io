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

let allRainfallData = [];
let allHourlyLogs = [];
let apiWeatherData = {};
let rainChartInstance = null;
let tempChartInstance = null;
let isLoadingRainfall = false;

// Exact Makari Gad Coordinates & Elevations for Accurate Lapse Rates!
const INTAKE_LAT = 29.7891; const INTAKE_LON = 80.8700; const INTAKE_ELEV = 2387;
const POWERHOUSE_LAT = 29.8009; const POWERHOUSE_LON = 80.8430; const POWERHOUSE_ELEV = 1463;
const CATCHMENT_LAT = 29.7397; const CATCHMENT_LON = 80.9700; const CATCHMENT_ELEV = 4200;

document.addEventListener('click', (e) => {
    if (e.target.closest('#rf-download-btn')) generateExactExcelExport();
    
    if (e.target.closest('#rf-upload-btn')) {
        let fileInput = document.getElementById('rf-file-upload');
        if (!fileInput) {
            fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.id = 'rf-file-upload';
            fileInput.accept = '.xlsx, .xls, .csv';
            fileInput.style.display = 'none';
            document.body.appendChild(fileInput);
        }
        fileInput.click(); 
    }

    if (e.target.closest('#sync-api-btn')) syncFullYearApiData();
});

document.addEventListener('change', (e) => {
    if (e.target.id === 'rf-file-upload') handleFileUpload(e);
    if (e.target.id === 'grid-rf-year' || e.target.id === 'grid-rf-month') refreshDashboard();
});

function handleFileUpload(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    
    showNotification("Reading Excel File...", false);
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
            const jd = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
            if (jd.length === 0) return showNotification("File is empty", true);
            
            processAndUploadRainfall(jd);
        } catch (err) {
            showNotification("File parsing error: " + err.message, true);
        }
    };
    reader.readAsArrayBuffer(file);
    ev.target.value = ''; 
}

export function initRainfallEvents() { }

export async function loadRainfallData() {
    updateRainfallGridFilters();
    await refreshDashboard();
}

function updateRainfallGridFilters() {
    const ySelect = document.getElementById('grid-rf-year');
    const mSelect = document.getElementById('grid-rf-month');
    if(!ySelect || !mSelect) return;

    const currentNepYear = getNepDateObj().year;
    
    if (ySelect.options.length === 0) {
        ySelect.innerHTML = '';
        for (let y = currentNepYear + 1; y >= 2079; y--) ySelect.add(new Option(y, y));
        mSelect.innerHTML = nepaliMonths.map(m => `<option value="${m}">${m}</option>`).join('');
        ySelect.value = currentNepYear;
        mSelect.value = getNepDateObj().month;
    }
}

async function refreshDashboard() {
    if(isLoadingRainfall) return;
    isLoadingRainfall = true;
    try {
        await loadMonthlyData();
        renderMonthlyGrid();
        renderCharts();
    } catch (error) {
        console.error("Dashboard Load Error:", error);
    } finally {
        isLoadingRainfall = false; 
    }
}

function getFallbackEngDate(y, m, d) {
    const monthOffsets = [13, 14, 15, 16, 17, 17, 18, 16, 14, 13, 12, 14]; 
    const startYear = y - 57;
    const monthIdx = nepaliMonths.indexOf(m);
    let dateObj = new Date(startYear, 3 + monthIdx, monthOffsets[monthIdx] || 14);
    dateObj.setDate(dateObj.getDate() + (d - 1));
    return dateObj.toISOString().split('T')[0];
}

// 24-HOUR OFFSET HELPER: Returns the English Date for the PREVIOUS day
function getApiTargetDate(engDateStr) {
    const d = new Date(engDateStr);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

async function loadMonthlyData() {
    const y = parseInt(document.getElementById('grid-rf-year')?.value);
    const m = document.getElementById('grid-rf-month')?.value;
    if (!y || !m) return;
    const mIdx = nepaliMonths.indexOf(m) + 1;

    const { data: rainData } = await supabase.from('rainfall_data')
        .select('*').eq('nepali_year', y).eq('nepali_month', m);
    allRainfallData = rainData || [];

    const { data: hourData } = await supabase.from('hourly_logs')
        .select('nepali_date, t_temp_out, t_temp_in, t_temp_intake')
        .like('nepali_date', `${y}.${String(mIdx).padStart(2,'0')}%`);
    allHourlyLogs = hourData || [];

    let startEngDate = getFallbackEngDate(y, m, 1);
    let endEngDate = getFallbackEngDate(y, m, 32);

    if (calendarMap && Object.keys(calendarMap).length > 0) {
        let datesFound = Object.keys(calendarMap).filter(k => {
            if (!calendarMap[k].nep_date_str) return false;
            const parts = calendarMap[k].nep_date_str.split('.');
            return parseInt(parts[0]) === y && parseInt(parts[1]) === mIdx;
        });
        if (datesFound.length > 0) {
            startEngDate = datesFound.sort()[0];
            endEngDate = datesFound.sort()[datesFound.length - 1];
        }
    }

    // Because of the 24h offset, we need to fetch starting 1 day earlier!
    const apiStart = getApiTargetDate(startEngDate);
    await fetchOpenMeteoData(apiStart, endEngDate);
}

// Fetches data using Exact Elevations to fix the Catchment Temperature!
async function fetchOpenMeteoData(startStr, endStr) {
    apiWeatherData = {}; 
    try {
        const sDate = new Date(startStr);
        const eDate = new Date(endStr);
        const today = new Date();
        
        const maxForecastDate = new Date();
        maxForecastDate.setDate(today.getDate() + 14); 

        if (sDate > maxForecastDate) return; 

        let safeEndStr = endStr;
        if (eDate > maxForecastDate) safeEndStr = maxForecastDate.toISOString().split('T')[0];

        const daysAgo = (today - sDate) / (1000 * 60 * 60 * 24);
        const baseUrl = daysAgo > 80 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
        
        // Added &elevation= parameter to force adiabatic cooling at 4200m
        const url = `${baseUrl}?latitude=${INTAKE_LAT},${POWERHOUSE_LAT},${CATCHMENT_LAT}&longitude=${INTAKE_LON},${POWERHOUSE_LON},${CATCHMENT_LON}&elevation=${INTAKE_ELEV},${POWERHOUSE_ELEV},${CATCHMENT_ELEV}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&start_date=${startStr}&end_date=${safeEndStr}&timezone=auto`;
        
        const res = await fetch(url);
        if (!res.ok) return; 
        
        const json = await res.json();
        if (Array.isArray(json) && json.length === 3) {
            const intakeApi = json[0].daily;
            const phApi = json[1].daily;
            const catchApi = json[2].daily;

            intakeApi.time.forEach((t, i) => {
                apiWeatherData[t] = {
                    in_precip: intakeApi.precipitation_sum[i],
                    in_temp: ((intakeApi.temperature_2m_max[i] + intakeApi.temperature_2m_min[i]) / 2).toFixed(1),
                    ph_precip: phApi.precipitation_sum[i],
                    ph_temp: ((phApi.temperature_2m_max[i] + phApi.temperature_2m_min[i]) / 2).toFixed(1),
                    cat_precip: catchApi.precipitation_sum[i],
                    cat_temp: ((catchApi.temperature_2m_max[i] + catchApi.temperature_2m_min[i]) / 2).toFixed(1)
                };
            });
        }
    } catch (e) {
        console.warn("Satellite fetch bypassed.");
    }
}

// --- NEW: BULK YEAR SYNC FOR API DATA ---
async function syncFullYearApiData() {
    const y = parseInt(document.getElementById('grid-rf-year')?.value);
    if (!y) return showNotification("Select a year first.", true);

    if (!confirm(`This will download and save Open-Meteo satellite data for the entire year of ${y}. Proceed?`)) return;

    showNotification(`Fetching 365 days of Satellite Data for ${y}...`, false);

    // Get DB records so we don't erase manual logs
    const { data: existingYearData } = await supabase.from('rainfall_data').select('*').eq('nepali_year', y);
    const existingData = existingYearData || [];

    // Calculate absolute start and end of the Nepali Year in English dates
    let startEng = getFallbackEngDate(y, nepaliMonths[0], 1);
    let endEng = getFallbackEngDate(y, nepaliMonths[11], 30);
    
    if (calendarMap && Object.keys(calendarMap).length > 0) {
        const dates = Object.keys(calendarMap).filter(k => calendarMap[k].nep_date_str && calendarMap[k].nep_date_str.startsWith(`${y}.`));
        if (dates.length > 0) {
            startEng = dates.sort()[0];
            endEng = dates.sort()[dates.length - 1];
        }
    }

    // Offset the fetch by -1 day
    await fetchOpenMeteoData(getApiTargetDate(startEng), endEng);

    const payloadMap = new Map();

    // Loop through all 12 months and their days
    nepaliMonths.forEach((m, mIdx) => {
        const monthDays = { Baisakh:31, Jestha:31, Ashadh:32, Shrawan:31, Bhadra:31, Ashoj:31, Kartik:30, Mangsir:30, Poush:29, Magh:30, Falgun:30, Chaitra:30 };
        const maxDay = monthDays[m] || 30;

        for (let day = 1; day <= maxDay; day++) {
            let engDate = getFallbackEngDate(y, m, day);
            if (calendarMap && Object.keys(calendarMap).length > 0) {
                const mapped = Object.keys(calendarMap).find(k => calendarMap[k].nep_date_str === `${y}.${String(mIdx+1).padStart(2,'0')}.${String(day).padStart(2,'0')}`);
                if (mapped) engDate = mapped;
            }

            // Apply the -1 offset to grab the previous 24h of rain/temp
            const targetApiDate = getApiTargetDate(engDate);
            const api = apiWeatherData[targetApiDate];
            if (!api) continue;

            const id = `${y}_${m}_${String(day).padStart(2,'0')}`;
            const existingRow = existingData.find(d => d.id === id) || {};

            payloadMap.set(id, {
                ...existingRow, 
                id: id,
                nepali_year: y,
                nepali_month: m,
                day: day,
                api_cat_precip: api.cat_precip !== '-' ? parseFloat(api.cat_precip) : null,
                api_cat_temp: api.cat_temp !== '-' ? parseFloat(api.cat_temp) : null,
                api_in_precip: api.in_precip !== '-' ? parseFloat(api.in_precip) : null,
                api_ph_precip: api.ph_precip !== '-' ? parseFloat(api.ph_precip) : null,
                // Add the two new Temp columns
                api_in_temp: api.in_temp !== '-' ? parseFloat(api.in_temp) : null,
                api_ph_temp: api.ph_temp !== '-' ? parseFloat(api.ph_temp) : null,
                operator_email: getCurrentUser()?.email || '',
                updated_at: new Date().toISOString()
            });
        }
    });

    const payload = Array.from(payloadMap.values());
    if (payload.length === 0) return showNotification("No API data retrieved. Check date limits.", true);

    showNotification(`Saving ${payload.length} days to Supabase...`, false);

    try {
        for(let i = 0; i < payload.length; i += 500) {
            const chunk = payload.slice(i, i + 500);
            const { error } = await supabase.from('rainfall_data').upsert(chunk);
            if (error) throw error;
        }
        showNotification(`✅ Successfully backed up entire ${y} API data!`);
        refreshDashboard();
    } catch (e) {
        showNotification("Error saving API data: " + e.message, true);
    }
}

function renderMonthlyGrid() {
    const y = parseInt(document.getElementById('grid-rf-year')?.value);
    const m = document.getElementById('grid-rf-month')?.value;
    const gridTable = document.getElementById('rainfall-grid-table');
    if(!gridTable || !y || !m) return;

    const monthDays = { Baisakh:31, Jestha:31, Ashadh:32, Shrawan:31, Bhadra:31, Ashoj:31, Kartik:30, Mangsir:30, Poush:29, Magh:30, Falgun:30, Chaitra:30 };
    const maxDay = monthDays[m] || 32;
    const mIdx = nepaliMonths.indexOf(m) + 1;

    // Added the new Temp Pred columns
    let thead = `
        <thead class="bg-slate-200 sticky top-0 z-40 shadow-sm">
            <tr>
                <th rowspan="2" class="p-2 border font-black text-slate-700 bg-slate-200 z-50 left-0 sticky outline outline-1 outline-slate-300">Day</th>
                <th colspan="3" class="p-2 border font-bold text-indigo-900 bg-indigo-100">Physical Rain Log (Time)</th>
                <th colspan="2" class="p-2 border font-bold text-amber-900 bg-amber-100">Catchment (4200m API)</th>
                <th colspan="4" class="p-2 border font-bold text-emerald-900 bg-emerald-100">Intake / Headworks</th>
                <th colspan="5" class="p-2 border font-bold text-sky-900 bg-sky-100">Powerhouse / Dam</th>
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

    let tbodyStr = '';
    const formatTimeText = (txt) => txt ? txt.split(',').map(t => `<div class="bg-white border border-slate-200 rounded px-1 my-0.5 text-[10px] text-slate-700 w-full">${t.trim()}</div>`).join('') : '<span class="text-slate-300">-</span>';

    for(let day=1; day<=maxDay; day++) {
        const rec = allRainfallData.find(d => d.day === day) || {};
        
        let engDate = getFallbackEngDate(y, m, day);
        let nepDateStrSearch = null;
        if (calendarMap && Object.keys(calendarMap).length > 0) {
            const mapped = Object.keys(calendarMap).find(k => calendarMap[k].nep_date_str === `${y}.${String(mIdx).padStart(2,'0')}.${String(day).padStart(2,'0')}`);
            if (mapped) {
                engDate = mapped;
                nepDateStrSearch = calendarMap[mapped].nep_date_str;
            }
        }
        
        const searchDateStr = nepDateStrSearch || `${y}.${String(mIdx).padStart(2,'0')}.${String(day).padStart(2,'0')}`;
        
        // 24H OFFSET LOGIC: Pull the API prediction from Day - 1 !
        const targetApiDate = getApiTargetDate(engDate);
        const api = apiWeatherData[targetApiDate] || { in_precip: '-', in_temp: '-', ph_precip: '-', ph_temp: '-', cat_precip: '-', cat_temp: '-' };

        // Prefer Database API values if saved, otherwise live fetch
        const dbCatPrecip = rec.api_cat_precip != null ? rec.api_cat_precip : api.cat_precip;
        const dbCatTemp = rec.api_cat_temp != null ? rec.api_cat_temp : api.cat_temp;
        const dbInPrecip = rec.api_in_precip != null ? rec.api_in_precip : api.in_precip;
        const dbPhPrecip = rec.api_ph_precip != null ? rec.api_ph_precip : api.ph_precip;
        const dbInTemp = rec.api_in_temp != null ? rec.api_in_temp : api.in_temp;
        const dbPhTemp = rec.api_ph_temp != null ? rec.api_ph_temp : api.ph_temp;

        const dayLogs = allHourlyLogs.filter(l => l.nepali_date === searchDateStr);
        let tIn=0, tOut=0, tInt=0, count=0;
        dayLogs.forEach(l => { if(l.t_temp_in != null) { tIn+=l.t_temp_in; tOut+=l.t_temp_out; tInt+=l.t_temp_intake; count++; }});
        
        const avgIn = count ? (tIn/count).toFixed(1) : '-';
        const avgOut = count ? (tOut/count).toFixed(1) : '-';
        const avgInt = count ? (tInt/count).toFixed(1) : '-';

        const hw_val = rec.headworks != null ? rec.headworks : '-';
        const dam_val = rec.powerhouse != null ? rec.powerhouse : '-';

        tbodyStr += `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-2 border font-bold text-slate-600 bg-slate-50 z-30 left-0 sticky outline outline-1 outline-slate-200">${day}</td>
                <td class="p-1 border cursor-pointer hover:bg-indigo-50 align-top" onclick="editRainfallTextCell('${y}','${m}',${day},'heavy_rain_time','${rec.heavy_rain_time || ''}')">${formatTimeText(rec.heavy_rain_time)}</td>
                <td class="p-1 border cursor-pointer hover:bg-indigo-50 align-top" onclick="editRainfallTextCell('${y}','${m}',${day},'normal_rain_time','${rec.normal_rain_time || ''}')">${formatTimeText(rec.normal_rain_time)}</td>
                <td class="p-1 border cursor-pointer hover:bg-indigo-50 align-top" onclick="editRainfallTextCell('${y}','${m}',${day},'shower_rain_time','${rec.shower_rain_time || ''}')">${formatTimeText(rec.shower_rain_time)}</td>
                
                <td class="p-2 border text-amber-700 font-bold bg-amber-50/40">${dbCatPrecip}</td>
                <td class="p-2 border text-amber-700 font-bold bg-amber-50/40">${dbCatTemp}</td>
                
                <td class="p-2 border cursor-pointer hover:bg-emerald-50 font-bold ${hw_val !== '-' && hw_val > 0 ? 'text-indigo-700 bg-indigo-50' : 'text-slate-400'}" onclick="editRainfallNumberCell('${y}','${m}',${day},'headworks',${rec.headworks || 0})">${hw_val}</td>
                <td class="p-2 border text-emerald-700 font-bold bg-emerald-50/40">${dbInPrecip}</td>
                <td class="p-2 border text-emerald-700 font-medium">${avgInt}</td>
                <td class="p-2 border text-emerald-700 font-bold bg-emerald-50/40">${dbInTemp}</td>
                
                <td class="p-2 border cursor-pointer hover:bg-sky-50 font-bold ${dam_val !== '-' && dam_val > 0 ? 'text-emerald-700 bg-emerald-50' : 'text-slate-400'}" onclick="editRainfallNumberCell('${y}','${m}',${day},'powerhouse',${rec.powerhouse || 0})">${dam_val}</td>
                <td class="p-2 border text-sky-700 font-bold bg-sky-50/40">${dbPhPrecip}</td>
                <td class="p-2 border text-sky-700 font-medium">${avgIn}</td>
                <td class="p-2 border text-sky-700 font-medium">${avgOut}</td>
                <td class="p-2 border text-sky-700 font-bold bg-sky-50/40">${dbPhTemp}</td>
            </tr>`;
    }

    gridTable.innerHTML = `${thead}<tbody>${tbodyStr}</tbody>`;
}

function renderCharts() {
    const y = parseInt(document.getElementById('grid-rf-year')?.value);
    const m = document.getElementById('grid-rf-month')?.value;
    const mIdx = nepaliMonths.indexOf(m) + 1;

    const labels = Array.from({length: 31}, (_, i) => i + 1);
    const chartData = { rIntakeM: [], rIntakeP: [], rDamM: [], rDamP: [], tIn: [], tOut: [], tCatch: [] };

    labels.forEach(day => {
        const rec = allRainfallData.find(d => d.day === day) || {};
        chartData.rIntakeM.push(rec.headworks != null ? rec.headworks : 0);
        chartData.rDamM.push(rec.powerhouse != null ? rec.powerhouse : 0);

        let engDate = getFallbackEngDate(y, m, day);
        if (calendarMap && Object.keys(calendarMap).length > 0) {
            const mapped = Object.keys(calendarMap).find(k => calendarMap[k].nep_date_str === `${y}.${String(mIdx).padStart(2,'0')}.${String(day).padStart(2,'0')}`);
            if (mapped) engDate = mapped;
        }

        const api = apiWeatherData[getApiTargetDate(engDate)] || {};
        const pIn = rec.api_in_precip != null ? rec.api_in_precip : api.in_precip;
        const pPh = rec.api_ph_precip != null ? rec.api_ph_precip : api.ph_precip;
        const tCat = rec.api_cat_temp != null ? rec.api_cat_temp : api.cat_temp;

        chartData.rIntakeP.push(pIn && pIn !== '-' ? parseFloat(pIn) : 0);
        chartData.rDamP.push(pPh && pPh !== '-' ? parseFloat(pPh) : 0);
        chartData.tCatch.push(tCat && tCat !== '-' ? parseFloat(tCat) : null);

        const searchDateStr = `${y}.${String(mIdx).padStart(2,'0')}.${String(day).padStart(2,'0')}`;
        const dLogs = allHourlyLogs.filter(l => l.nepali_date === searchDateStr);
        let tI=0, tO=0, c=0;
        dLogs.forEach(l => { if(l.t_temp_in != null){ tI+=l.t_temp_in; tO+=l.t_temp_out; c++; } });
        chartData.tIn.push(c ? tI/c : null);
        chartData.tOut.push(c ? tO/c : null);
    });

    if (rainChartInstance) rainChartInstance.destroy();
    rainChartInstance = new Chart(document.getElementById('rainfall-trend-chart').getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Intake (Meas)', data: chartData.rIntakeM, backgroundColor: '#10B981', stack: 'Stack 0' },
                { label: 'Intake (Pred, -24h)', data: chartData.rIntakeP, backgroundColor: '#A7F3D0', stack: 'Stack 0' },
                { label: 'Dam (Meas)', data: chartData.rDamM, backgroundColor: '#3B82F6', stack: 'Stack 1' },
                { label: 'Dam (Pred, -24h)', data: chartData.rDamP, backgroundColor: '#BFDBFE', stack: 'Stack 1' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index' } }
    });

    if (tempChartInstance) tempChartInstance.destroy();
    tempChartInstance = new Chart(document.getElementById('temp-trend-chart').getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Room IN', data: chartData.tIn, borderColor: '#F59E0B', tension: 0.3, spanGaps: true },
                { label: 'Room OUT', data: chartData.tOut, borderColor: '#EF4444', tension: 0.3, spanGaps: true },
                { label: 'Catchment (Pred)', data: chartData.tCatch, borderColor: '#6366F1', borderDash: [5,5], tension: 0.3, spanGaps: true }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function getStandardMonth(mStr) {
    if (!mStr) return null;
    const norm = mStr.toLowerCase().replace(/[^a-z]/g, '');
    if (norm.includes('bais') || norm.includes('baish')) return 'Baisakh';
    if (norm.includes('jesh') || norm.includes('jest')) return 'Jestha';
    if (norm.includes('ashad') || norm.includes('ashar')) return 'Ashadh';
    if (norm.includes('shraw') || norm.includes('sawan')) return 'Shrawan';
    if (norm.includes('bhad')) return 'Bhadra';
    if (norm.includes('asho') || norm.includes('asoj') || norm.includes('ashwin')) return 'Ashoj';
    if (norm.includes('kart')) return 'Kartik';
    if (norm.includes('mangs') || norm.includes('mangsh')) return 'Mangsir';
    if (norm.includes('pous')) return 'Poush';
    if (norm.includes('magh')) return 'Magh';
    if (norm.includes('falg') || norm.includes('fagun')) return 'Falgun';
    if (norm.includes('chai')) return 'Chaitra';
    return null;
}

// --- MULTI-MONTH VERTICAL SCANNER ---
async function processAndUploadRainfall(jd) {
    let currentYear = parseInt(document.getElementById('grid-rf-year')?.value);
    let currentMonth = document.getElementById('grid-rf-month')?.value;
    let dayColIdx = -1;

    showNotification("Fetching existing database context to protect data...", false);
    const { data: existingYearData } = await supabase.from('rainfall_data').select('*').eq('nepali_year', currentYear);
    const existingData = existingYearData || [];
    
    const payloadMap = new Map();

    for(let i = 0; i < jd.length; i++) {
        const row = jd[i];
        if(!row) continue;

        const rowStr = row.join(' ').toLowerCase();

        if (rowStr.includes('year')) {
            const yrMatch = rowStr.match(/\d{4}/);
            if (yrMatch) currentYear = parseInt(yrMatch[0]);
        }
        if (rowStr.includes('month')) {
            const parsed = getStandardMonth(rowStr);
            if (parsed) currentMonth = parsed; 
        }

        let dIdx = row.findIndex(c => String(c).trim().toLowerCase() === 'day');
        if (dIdx !== -1) {
            dayColIdx = dIdx;
            continue; 
        }

        if(dayColIdx !== -1 && currentYear && currentMonth) {
            let dayVal = parseInt(row[dayColIdx]);
            if(!isNaN(dayVal) && dayVal >= 1 && dayVal <= 32) {
                
                const heavyTime = row[dayColIdx + 1] ? String(row[dayColIdx + 1]).trim() : null;
                const normTime  = row[dayColIdx + 3] ? String(row[dayColIdx + 3]).trim() : null;
                const showerTime= row[dayColIdx + 5] ? String(row[dayColIdx + 5]).trim() : null;
                const ph = row[dayColIdx + 7] != null && String(row[dayColIdx + 7]).trim() !== '' ? parseFloat(row[dayColIdx + 7]) : null;
                const intake = row[dayColIdx + 8] != null && String(row[dayColIdx + 8]).trim() !== '' ? parseFloat(row[dayColIdx + 8]) : null;

                if (heavyTime || normTime || showerTime || (ph !== null && !isNaN(ph)) || (intake !== null && !isNaN(intake))) {
                    const id = `${currentYear}_${currentMonth}_${String(dayVal).padStart(2,'0')}`;
                    const existingRow = existingData.find(d => d.id === id) || {};

                    payloadMap.set(id, {
                        ...existingRow,
                        id: id,
                        nepali_year: currentYear,
                        nepali_month: currentMonth,
                        day: dayVal,
                        heavy_rain_time: heavyTime,
                        normal_rain_time: normTime,
                        shower_rain_time: showerTime,
                        powerhouse: ph !== null && !isNaN(ph) ? ph : 0,
                        headworks: intake !== null && !isNaN(intake) ? intake : 0,
                        operator_email: getCurrentUser()?.email || '',
                        updated_at: new Date().toISOString()
                    });
                }
            }
        }
    }

    const payload = Array.from(payloadMap.values());
    if (!payload.length) return showNotification("Import Error: No valid data found in rows.", true);

    showNotification(`Uploading ${payload.length} rows across multiple months...`, false);

    try {
        for(let i = 0; i < payload.length; i += 500) {
            const chunk = payload.slice(i, i + 500);
            const { error } = await supabase.from('rainfall_data').upsert(chunk);
            if (error) throw error;
        }
        
        showNotification(`✅ Successfully uploaded ${payload.length} records!`);
        refreshDashboard();
    } catch (e) {
        showNotification("Upload Error: " + e.message, true);
    }
}

// Remains perfectly aligned with your uploaded template format
function generateExactExcelExport() {
    try {
        const y = parseInt(document.getElementById('grid-rf-year')?.value);
        const m = document.getElementById('grid-rf-month')?.value;
        if (!y || !m) return showNotification("Select a year and month first.", true);

        const ws_data = [
            ["MAKARI GAD HYDROELECTRIC PROJECT"],
            ["Daily Rainfall Measurement "],
            [`Year : ${y}`],
            [`Month : ${m}`],
            ["Location : Power house and Intake"],
            ["Day", "Heavy Rain (Hrs)", "", "Rain (Hrs)", "", "Shower (Hrs)", "", "Rainfall (mm)"],
            ["", "Time", "Hours", "Time", "Hours", "Time", "Hours", "Power house", "Intake"]
        ];
        
        for (let day = 1; day <= 32; day++) {
            const rec = allRainfallData.find(d => d.day === day);
            if(rec || day <= 31) {
                ws_data.push([
                    day,
                    rec?.heavy_rain_time || "", "", 
                    rec?.normal_rain_time || "", "",
                    rec?.shower_rain_time || "", "",
                    rec?.powerhouse ?? "", 
                    rec?.headworks ?? ""
                ]);
            }
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        ws['!cols'] = [{wch: 6}, {wch: 20}, {wch: 8}, {wch: 20}, {wch: 8}, {wch: 20}, {wch: 8}, {wch: 15}, {wch: 15}];
        XLSX.utils.book_append_sheet(wb, ws, `Rainfall_${m}_${y}`);
        XLSX.writeFile(wb, `Daily_Rainfall_${m}_${y}.xlsx`);
    } catch (err) {
        showNotification("Export Error: " + err.message, true);
    }
}

window.editRainfallTextCell = async function(y, m, d, field, currentVal) {
    if (getUserRole() === 'normal') return;
    const newVal = prompt(`Enter times (Separate with comma, e.g., "01:00-03:00"):`, currentVal === 'undefined' ? '' : currentVal);
    if (newVal !== null) saveCellData(y, m, d, field, newVal.trim() || null);
};

window.editRainfallNumberCell = async function(y, m, d, field, currentVal) {
    if (getUserRole() === 'normal') return;
    const newVal = prompt(`Enter measured amount (mm) for Day ${d}:`, currentVal);
    if (newVal === null) return;
    const floatVal = parseFloat(newVal);
    if (newVal.trim() !== '' && isNaN(floatVal)) return showNotification("Invalid number", true);
    saveCellData(y, m, d, field, isNaN(floatVal) ? null : floatVal);
};

async function saveCellData(y, m, d, field, value) {
    const payload = {
        id: `${y}_${m}_${String(d).padStart(2, '0')}`,
        nepali_year: parseInt(y), nepali_month: m, day: parseInt(d),
        [field]: value,
        operator_email: getCurrentUser()?.email || '', updated_at: new Date().toISOString()
    };
    try {
        await supabase.from('rainfall_data').upsert(payload);
        await refreshDashboard();
    } catch (e) { showNotification("Error: " + e.message, true); }
}