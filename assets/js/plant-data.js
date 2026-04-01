import { supabase } from './core-app.js';   // note: we don't need parseToUTCDate here, but showNotification is used

// --- Global Variables ---
let trendChartInstance = null;
let currentUser = null;
let userRole = 'normal';

let allData = [];
let editingRowId = null;
let allOutages = [];
let editingOutageId = null;
let allMCE = [];
let editingMCEId = null;
let allBalanchData = [];
let editingBalanchId = null;

// 🔥 OPTIMIZATION: loading flags to prevent concurrent calls
let isLoadingData = false;
let isLoadingBalanch = false;
let isLoadingOutages = false;
let isLoadingMCE = false;
let isLoadingRainfall = false;
let isLoadingExpenses = false;

const nepaliMonths = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashoj", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];

// Universal Date Parser to fix Javascript UTC Timezone drift issues from Excel
function parseExcelDate(dv) {
    if (dv == null || dv === '') return null;
    let cd;
    if (typeof dv === 'number') {
        const ex = XLSX.SSF.parse_date_code(dv, { date1904: false });
        if (ex) cd = new Date(ex.y, ex.m - 1, ex.d);
    } else if (dv instanceof Date) {
        cd = new Date(dv.getUTCFullYear(), dv.getUTCMonth(), dv.getUTCDate());
    } else if (typeof dv === 'string') {
        cd = new Date(dv);
    }
    if (!cd || isNaN(cd.getTime())) return null;
    return `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
}

// --- UI Helpers ---
const notificationModal = document.getElementById('notification-modal');
const notificationMessage = document.getElementById('notification-message');

function showNotification(msg, isError = false) {
    if(!notificationModal || !notificationMessage) return;
    notificationMessage.textContent = msg;
    notificationModal.classList.remove('opacity-0', '-translate-y-4');
    notificationModal.style.borderLeftColor = isError ? '#dc2626' : '#10b981';
    notificationModal.classList.add('opacity-100');
    setTimeout(() => {
        notificationModal.classList.remove('opacity-100');
        notificationModal.classList.add('opacity-0', '-translate-y-4');
    }, 4500);
}

const confirmModalBackdrop = document.getElementById('confirm-modal-backdrop');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const confirmActionBtn = document.getElementById('confirm-action-btn');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

function showConfirmation(title, message, onConfirm) {
    if(!confirmModalBackdrop) return;
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmModalBackdrop.classList.remove('hidden');
    document.getElementById('confirm-modal')?.classList.remove('opacity-0', 'scale-95');
    confirmActionBtn.onclick = () => {
        onConfirm();
        hideConfirmation();
    };
}

function hideConfirmation() {
    if(!confirmModalBackdrop) return;
    confirmModalBackdrop.classList.add('hidden');
    document.getElementById('confirm-modal')?.classList.add('opacity-0', 'scale-95');
}

confirmCancelBtn?.addEventListener('click', hideConfirmation);
confirmModalBackdrop?.addEventListener('click', (e) => {
    if (e.target === confirmModalBackdrop) hideConfirmation();
});

// --- Tab Navigation ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.classList.contains('role-hidden')) return;
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.remove('active');
            b.classList.remove('border-indigo-600');
        });
        btn.classList.add('active');
        btn.classList.add('border-indigo-600');
        document.querySelectorAll('section').forEach(c => c.classList.add('hidden-tab'));
        document.getElementById(btn.dataset.target)?.classList.remove('hidden-tab');
    });
});

// --- Trend Data Handling (deprecated, replaced by updateTrendChart) ---
async function loadTrendData() {
    // consolidated into updateTrendChart
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (e.target.dataset.target === 'trends-tab') {
            setTimeout(() => {
                syncDatesFromNepaliSelection();
                document.getElementById('view-trend-btn')?.click();
            }, 250);
        }
    });
});

function formatNumber(num, decimals = 3) {
    if (num === null || typeof num === 'undefined' || isNaN(parseFloat(num))) return '';
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
}

function getTodayStr() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

const getUserName = () => currentUser ? currentUser.email.split('@')[0] : '';

// =====================================
// 7. RAINFALL & FLOW DATA
// =====================================
let allRainfallData = [];
let editingRainfallId = null;
const rainfallBody = document.getElementById("rainfall-body");
let rainfallChartInstance = null;
let cumulativeChartInstance = null;

document.getElementById('quick-fill-zero')?.addEventListener('click', fillMissingDaysZero);
document.getElementById('show-both-metrics')?.addEventListener('change', updateRainfallChart);

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize the Chart Month Dropdown
    const rfChartMonthSelect = document.getElementById('rf-chart-month');
    if (rfChartMonthSelect) {
        rfChartMonthSelect.innerHTML = nepaliMonths.map(m => `<option value="${m}">${m}</option>`).join('');
        rfChartMonthSelect.addEventListener('change', updateRainfallChart);
    }
    
    // 2. Sync Grid Month changes to the Chart Month
    document.getElementById('grid-rf-month')?.addEventListener('change', (e) => {
        renderRainfallGrid(); // Keep the existing grid update
        if (rfChartMonthSelect) {
            rfChartMonthSelect.value = e.target.value;
            updateRainfallChart();
        }
    });

  
});


function updateRainfallChart() {
    const canvas = document.getElementById('rainfall-chart');
    if (!canvas) return;
    // Wait until canvas has dimensions
    if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
        setTimeout(updateRainfallChart, 200);
        return;
    }

        try {
        const ctx = canvas.getContext('2d');

        const monthDropdown = document.getElementById('rf-chart-month');
        
        const selectedMonth = monthDropdown && monthDropdown.value ? monthDropdown.value : 'Baisakh';
        const selectedMetric = document.getElementById('rf-chart-metric')?.value || 'headworks';
        const showBoth = document.getElementById('show-both-metrics')?.checked || false;
        
        const checkboxes = document.querySelectorAll('.rf-year-cb:checked');
        const selectedYears = Array.from(checkboxes).map(cb => parseInt(cb.value));

        const datasets = [];
        const colors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#3B82F6', '#EC4899'];
        const labels = Array.from({length: 32}, (_, i) => i + 1);

        selectedYears.forEach((year, idx) => {
            const yearData = allRainfallData.filter(d => 
                parseInt(d.nepali_year) === year && 
                String(d.nepali_month).trim().toLowerCase() === String(selectedMonth).trim().toLowerCase()
            );

            if (showBoth) {
                const headData = labels.map(day => {
                    const rec = yearData.find(d => parseInt(d.day) === day);
                    return rec && rec.headworks !== null ? parseFloat(rec.headworks) : null;
                });
                const damData = labels.map(day => {
                    const rec = yearData.find(d => parseInt(d.day) === day);
                    return rec && rec.powerhouse !== null ? parseFloat(rec.powerhouse) : null;
                });
                datasets.push({
                    label: `${year} - Headworks`, data: headData,
                    borderColor: colors[idx % colors.length], backgroundColor: colors[idx % colors.length],
                    borderWidth: 2, tension: 0.3, spanGaps: true, yAxisID: 'y-headworks'
                });
                datasets.push({
                    label: `${year} - Dam`, data: damData,
                    borderColor: colors[(idx+1) % colors.length], backgroundColor: colors[(idx+1) % colors.length],
                    borderWidth: 2, tension: 0.3, spanGaps: true, yAxisID: 'y-dam'
                });
            } else {
                const dataPoints = labels.map(day => {
                    const rec = yearData.find(d => parseInt(d.day) === day);
                    return rec && rec[selectedMetric] !== null ? parseFloat(rec[selectedMetric]) : null;
                });
                datasets.push({
                    label: `${year} - ${selectedMetric === 'headworks' ? 'Headworks' : 'Dam'}`, data: dataPoints,
                    borderColor: colors[idx % colors.length], backgroundColor: colors[idx % colors.length],
                    borderWidth: 2, tension: 0.3, spanGaps: true, yAxisID: 'y'
                });
            }
        });

        const config = {
            type: 'line', data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: { x: { title: { display: true, text: 'Day of the Month', font: { weight: 'bold' } }, grid: { display: false } } }
            }
        };

        if (showBoth) {
            config.options.scales['y-headworks'] = { type: 'linear', position: 'left', title: { display: true, text: 'Headworks (mm)', color: '#4F46E5' } };
            config.options.scales['y-dam'] = { type: 'linear', position: 'right', title: { display: true, text: 'Dam (mm)', color: '#10B981' }, grid: { drawOnChartArea: false } };
        } else {
            config.options.scales.y = { type: 'linear', position: 'left', title: { display: true, text: selectedMetric === 'headworks' ? 'Headworks (mm)' : 'Dam (mm)', font: { weight: 'bold' } }, beginAtZero: true };
        }

        if (rainfallChartInstance) rainfallChartInstance.destroy();
        rainfallChartInstance = new Chart(ctx, config);

    } catch (err) { console.error("Chart Error: ", err); }
}

    function updateMonthlySummary() {
    const y = parseInt(document.getElementById('grid-rf-year')?.value);
    const m = document.getElementById('grid-rf-month')?.value;
    if (!y || !m) return;

    const monthData = allRainfallData.filter(d => d.nepali_year === y && d.nepali_month === m);
    
    let sumHead = 0, sumDam = 0, rainy = 0;
    monthData.forEach(d => {
        if (d.headworks) sumHead += d.headworks;
        if (d.powerhouse) sumDam += d.powerhouse;
        if ((d.headworks && d.headworks > 0) || (d.powerhouse && d.powerhouse > 0)) rainy++;
    });

    const days = monthData.length;
    const avgHead = days ? sumHead / days : 0;

    if(document.getElementById('sum-headworks')) document.getElementById('sum-headworks').textContent = sumHead.toFixed(1);
    if(document.getElementById('sum-dam')) document.getElementById('sum-dam').textContent = sumDam.toFixed(1);
    if(document.getElementById('avg-headworks')) document.getElementById('avg-headworks').textContent = avgHead.toFixed(1);
    if(document.getElementById('rainy-days')) document.getElementById('rainy-days').textContent = rainy;

    const canvas = document.getElementById('cumulative-rainfall-chart');
    if (!canvas || canvas.parentElement.clientWidth === 0) return;

    const ctx = canvas.getContext('2d');
    const sorted = [...monthData].sort((a, b) => a.day - b.day);
    const cumulativeHead = [];
    const cumulativeDam = [];
    let runningHead = 0, runningDam = 0;
    const labels = sorted.map(d => d.day);

    sorted.forEach(d => {
        runningHead += d.headworks || 0;
        runningDam += d.powerhouse || 0;
        cumulativeHead.push(runningHead);
        cumulativeDam.push(runningDam);
    });

    if (cumulativeChartInstance) cumulativeChartInstance.destroy();
    
    cumulativeChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Cumulative Headworks (mm)', data: cumulativeHead, borderColor: '#4f46e5', backgroundColor: 'rgba(79, 70, 229, 0.1)', fill: true, tension: 0.2 },
                { label: 'Cumulative Dam (mm)', data: cumulativeDam, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.2 }
            ]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { tooltip: { mode: 'index', intersect: false } }, 
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Cumulative Rainfall (mm)' } } } 
        }
    });
}

// ==========================================
// THE FIX: Intersection Observer
// This perfectly tracks when the tab becomes visible on the screen, 
// bypassing all timeout and click errors.
// ==========================================
const rainfallTabObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            console.log("Rainfall tab is now visible! Drawing charts...");
            if (typeof updateRainfallChart === 'function') updateRainfallChart();
            if (typeof updateMonthlySummary === 'function') updateMonthlySummary();
        }
        updateRainfallChart();
    });
});

const rainTabEl = document.getElementById('rainfall-tab');
if (rainTabEl) {
    rainfallTabObserver.observe(rainTabEl);
}

// Helper to calculate the current Nepali Date for defaults
function getNepDateObj() {
    const d = new Date();
    let y = d.getFullYear() + 56;
    const m = d.getMonth(); 
    const date = d.getDate();
    if (m > 3 || (m === 3 && date > 13)) y += 1;
    const engToNepMap = [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    let nepMonthIdx = engToNepMap[m];
    if (date > 14) nepMonthIdx = (nepMonthIdx + 1) % 12;
    return { year: y, month: nepaliMonths[nepMonthIdx] };
}

function updateRainfallGridFilters() {
    const ySelect = document.getElementById('grid-rf-year');
    const mSelect = document.getElementById('grid-rf-month');
    const chartMonthSelect = document.getElementById('rf-chart-month');
    if(!ySelect || !mSelect) return;

    const years = [...new Set(allRainfallData.map(d => d.nepali_year))].sort((a,b) => b-a);
    const nd = getNepDateObj();
    if(!years.includes(nd.year)) years.unshift(nd.year);

    ySelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
    mSelect.innerHTML = nepaliMonths.map(m => `<option value="${m}">${m}</option>`).join('');

    // SMART DEFAULT: Auto-select the most recent data you have, or the current month
    let defaultYear = nd.year;
    let defaultMonth = nd.month;
    if (allRainfallData.length > 0) {
        defaultYear = allRainfallData[0].nepali_year;
        defaultMonth = allRainfallData[0].nepali_month;
    }

    ySelect.value = defaultYear;
    mSelect.value = defaultMonth;
    if (chartMonthSelect) chartMonthSelect.value = defaultMonth;

    renderRainfallGrid();
}

function updateRainfallYearsCheckboxes() {
    
    const container = document.getElementById('rf-year-checkboxes');
    if (!container) return;
    
    const years = [...new Set(allRainfallData.map(d => d.nepali_year))].sort((a, b) => b - a);
    let checkedBoxes = Array.from(container.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
    
    // Fix: If no years are checked, default to the most recent year
    if (checkedBoxes.length === 0 && years.length > 0) {
        checkedBoxes.push(years[0]);
    }
    
    container.innerHTML = years.map(y => `
        <label class="flex items-center space-x-1 text-sm font-semibold text-slate-700 cursor-pointer hover:text-indigo-600 transition">
            <input type="checkbox" value="${y}" class="rf-year-cb w-4 h-4 accent-indigo-600" ${checkedBoxes.includes(y) ? 'checked' : ''}>
            <span>${y}</span>
        </label>
    `).join('');
    
    container.querySelectorAll('.rf-year-cb').forEach(cb => cb.addEventListener('change', updateRainfallChart));
    updateRainfallChart();
}

// FIX FOR CHART.JS HIDDEN TAB BUG: Forces charts to draw when you click the Rainfall tab
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (e.target.dataset.target === 'rainfall-tab') {
            setTimeout(() => {
                if (typeof updateRainfallChart === 'function') updateRainfallChart();
                if (typeof updateMonthlySummary === 'function') updateMonthlySummary();
            }, 100);
        }
    });
});

async function loadRainfallData() {
    if (isLoadingRainfall) return;
    isLoadingRainfall = true;
    let data = [], page = 0, more = true;
    
    while (more) {
        const { data: chunk, error } = await supabase.from('rainfall_data')
            .select('*')
            .order('nepali_year', { ascending: false })
            .order('day', { ascending: true })
            .range(page * 1000, (page + 1) * 1000 - 1);
            
        if (error) {
            console.warn("Error fetching rainfall:", error);
            break;
        }
        if (chunk && chunk.length > 0) data = data.concat(chunk);
        if (!chunk || chunk.length < 1000) more = false; else page++;
    }
    
    if (data) {
        const getMonthIdx = (m) => {
            if (!m) return 99;
            const map = { baisakh: 0, jestha: 1, ashadh: 2, ashar: 2, shrawan: 3, sawan: 3, bhadra: 4, ashoj: 5, asoj: 5, kartik: 6, mangsir: 7, mangshir: 7, poush: 8, magh: 9, falgun: 10, fagun: 10, chaitra: 11, chait: 11 };
            return map[m.toLowerCase().trim()] ?? 99;
        };

        // FIX: Ensure the absolute newest data is at the very top of the list
        allRainfallData = data.sort((a, b) => 
            b.nepali_year - a.nepali_year || 
            getMonthIdx(b.nepali_month) - getMonthIdx(a.nepali_month) || 
            a.day - b.day
        );
        
        // Proper execution sequence
        renderRainfallTable();
        updateRainfallGridFilters(); 
        updateRainfallYearsCheckboxes();
    }
    isLoadingRainfall = false;
}

function renderRainfallGrid() {
    const y = parseInt(document.getElementById('grid-rf-year')?.value);
    const m = document.getElementById('grid-rf-month')?.value;
    const gridTable = document.getElementById('rainfall-grid-table');
    if(!gridTable || !y || !m) return;

    const monthData = allRainfallData.filter(d => d.nepali_year === y && d.nepali_month === m);
    let maxDay = 32; 

    let trDay = `<tr class="bg-slate-100"><th class="p-2 border font-bold text-left sticky left-0 bg-slate-100 min-w-[100px] z-10">Day</th>`;
    let trDam = `<tr><th class="p-2 border font-bold text-left sticky left-0 bg-white shadow-[1px_0_0_#e2e8f0] z-10">Dam</th>`;
    let trHead = `<tr><th class="p-2 border font-bold text-left sticky left-0 bg-white shadow-[1px_0_0_#e2e8f0] z-10">Headworks</th>`;

    let sumDam = 0;
    let sumHead = 0;

    const getCellColor = (val) => {
        if (val === '' || val === null) return '';
        const v = parseFloat(val);
        if (v === 0) return 'bg-slate-50 text-slate-400';
        if (v > 0 && v <= 5) return 'bg-green-100 text-green-800';
        if (v > 5 && v <= 20) return 'bg-green-200 text-green-900';
        if (v > 20) return 'bg-green-300 text-green-900 font-bold';
        return '';
    };

    for(let i=1; i<=maxDay; i++) {
        const rec = monthData.find(d => d.day === i);
        const damVal = rec && rec.powerhouse !== null ? rec.powerhouse : '';
        const headVal = rec && rec.headworks !== null ? rec.headworks : '';

        if(damVal !== '') sumDam += parseFloat(damVal);
        if(headVal !== '') sumHead += parseFloat(headVal);

        trDay += `<th class="p-2 border font-semibold text-slate-600 min-w-[50px]">${i}</th>`;
        trDam += `<td class="p-2 border ${getCellColor(damVal)} cursor-pointer hover:bg-indigo-50" onclick="editRainfallCell('${y}','${m}',${i},'powerhouse',${damVal || 0})">${damVal}</td>`;
        trHead += `<td class="p-2 border ${getCellColor(headVal)} cursor-pointer hover:bg-indigo-50" onclick="editRainfallCell('${y}','${m}',${i},'headworks',${headVal || 0})">${headVal}</td>`;
    }

    trDay += `<th class="p-2 border font-bold bg-indigo-50 text-indigo-800 min-w-[60px]">Total</th>`;
    trDam += `<th class="p-2 border font-bold bg-indigo-50 text-indigo-800">${formatNumber(sumDam,2) || 0}</th>`;
    trHead += `<th class="p-2 border font-bold bg-indigo-50 text-indigo-800">${formatNumber(sumHead,2) || 0}</th>`;

    gridTable.innerHTML = `<tbody>${trDay}${trDam}${trHead}</tbody>`;
    
    if (typeof updateMonthlySummary === 'function') {
        updateMonthlySummary();
    }
}

window.editRainfallCell = async function(y, m, d, field, currentVal) {
    if (userRole === 'normal') return;
    const newVal = prompt(`Enter new value for Day ${d} (${field}):`, currentVal);
    if (newVal === null) return;
    
    const floatVal = parseFloat(newVal);
    if (isNaN(floatVal)) return showNotification("Invalid number", true);

    const id = `${y}_${m}_${String(d).padStart(2, '0')}`;
    const payload = {
        id: id,
        nepali_year: parseInt(y),
        nepali_month: m,
        day: d,
        [field]: floatVal,
        operator_email: currentUser?.email || '',
        updated_at: new Date().toISOString()
    };

    try {
        const { error } = await supabase.from('rainfall_data').upsert(payload);
        if (error) throw error;
        showNotification("Data updated!");
        loadRainfallData();
    } catch (e) {
        showNotification("Error: " + e.message, true);
    }
};

document.getElementById('grid-rf-year')?.addEventListener('change', () => {
    renderRainfallGrid();
    updateRainfallChart();  // Sync comparison chart when year changes
});
// NOTE: grid-rf-month is already handled inside DOMContentLoaded — do not re-add it here

async function fillMissingDaysZero() {
    if (!currentUser) return showNotification("You must be logged in.", true);
    
    const y = parseInt(document.getElementById('grid-rf-year')?.value);
    const m = document.getElementById('grid-rf-month')?.value;
    if (!y || !m) return;

    const monthData = allRainfallData.filter(d => d.nepali_year === y && d.nepali_month === m);
    const daysPresent = new Set(monthData.map(d => d.day));
    
    const monthDays = { Baisakh:31, Jestha:31, Ashadh:32, Shrawan:31, Bhadra:31, Ashoj:31, Kartik:30, Mangsir:30, Poush:29, Magh:30, Falgun:30, Chaitra:30 };
    const daysInMonth = monthDays[m] || 30;
    
    const updates = [];
    for (let d = 1; d <= daysInMonth; d++) {
        if (!daysPresent.has(d)) {
            updates.push({
                id: `${y}_${m}_${d}`,
                nepali_year: y,
                nepali_month: m,
                day: d,
                headworks: 0,
                powerhouse: 0,
                operator_email: currentUser?.email || '',
                operator_uid: currentUser?.id || '',
                updated_at: new Date().toISOString()
            });
        }
    }

    if (updates.length === 0) {
        alert('No missing days to fill. Month is complete!');
        return;
    }

    if (confirm(`Fill ${updates.length} missing days in ${m} ${y} with zero?`)) {
        try {
            const { error } = await supabase.from('rainfall_data').upsert(updates);
            if (error) throw error;
            showNotification(`Filled ${updates.length} days with zero.`);
            loadRainfallData();
        } catch (e) {
            showNotification('Error: ' + e.message, true);
        }
    }
}

function createRainfallInputRow() {
    if (['staff', 'normal'].includes(userRole)) return '';
    const currentYear = new Date().getFullYear() + 57;
    const years = Array.from({length: 5}, (_, i) => currentYear - 2 + i);
    const yearOpts = years.map(y => `<option value="${y}">${y}</option>`).join('');
    const monthOpts = nepaliMonths.map(m => `<option value="${m}">${m}</option>`).join('');

    return `<tr class="bg-indigo-50/60 sticky top-0 z-20 shadow-sm border-b-2 border-indigo-200">
        <td><select id="new-rf-year" class="input-cell font-bold">${yearOpts}</select></td>
        <td><select id="new-rf-month" class="input-cell font-bold">${monthOpts}</select></td>
        <td><input type="number" id="new-rf-day" min="1" max="32" class="input-cell" placeholder="Day" required /></td>
        <td><input type="number" id="new-rf-headworks" step="any" class="input-cell" /></td>
        <td><input type="number" id="new-rf-powerhouse" step="any" class="input-cell" /></td>
        <td class="truncate-text text-xs text-slate-500">${getUserName()}</td>
        <td class="col-actions"><button id="add-rf-btn" class="w-full bg-indigo-600 text-white font-bold py-1 px-3 rounded shadow hover:bg-indigo-700 transition">Save</button></td>
    </tr>`;
}

function createRainfallDisplayRow(d) {
    const canEdit = ['admin'].includes(userRole);
    const docStr = JSON.stringify(d).replace(/'/g, "&apos;");
    return `<td class="font-bold text-slate-900">${d.nepali_year}</td>
        <td class="font-medium text-slate-700">${d.nepali_month}</td>
        <td class="text-slate-600">${d.day}</td>
        <td class="text-slate-600">${formatNumber(d.headworks)}</td>
        <td class="text-slate-600">${formatNumber(d.powerhouse)}</td>
        <td class="truncate-text text-xs text-slate-500">${(d.operator_email || '').split('@')[0]}</td>
        <td class="col-actions space-x-2 whitespace-nowrap ${canEdit ? '' : 'hidden'}">
            <button class="edit-rf-btn text-indigo-600 font-bold hover:underline" data-doc='${docStr}'>Edit</button>
            ${userRole === 'admin' ? `<button class="delete-rf-btn text-red-600 font-bold hover:underline" data-id="${d.id}">Del</button>` : ''}
        </td>`;
}

function createRainfallEditRow(d) {
    return `<td><input class="input-cell bg-slate-100" value="${d.nepali_year}" disabled></td>
        <td><input class="input-cell bg-slate-100" value="${d.nepali_month}" disabled></td>
        <td><input class="input-cell bg-slate-100" value="${d.day}" disabled></td>
        <td><input type="number" id="edit-rf-headworks" step="any" class="input-cell" value="${d.headworks ?? ''}" /></td>
        <td><input type="number" id="edit-rf-powerhouse" step="any" class="input-cell" value="${d.powerhouse ?? ''}" /></td>
        <td class="truncate-text text-xs text-slate-500">${getUserName()}</td>
        <td class="flex space-x-2">
            <button class="update-rf-btn bg-emerald-600 text-white font-bold py-1 px-3 rounded hover:bg-emerald-700" data-id="${d.id}">Save</button>
            <button class="cancel-rf-btn bg-slate-200 text-slate-700 font-bold py-1 px-3 rounded hover:bg-slate-300">X</button>
        </td>`;
}

function renderRainfallTable() {
    if(!rainfallBody) return;
    rainfallBody.innerHTML = '';
    if (!['staff', 'normal'].includes(userRole)) rainfallBody.innerHTML = createRainfallInputRow();

    allRainfallData.forEach(d => {
        const row = document.createElement('tr');
        row.innerHTML = d.id === editingRainfallId ? createRainfallEditRow(d) : createRainfallDisplayRow(d);
        row.className = d.id === editingRainfallId ? 'bg-indigo-50' : 'hover:bg-slate-50';
        rainfallBody.appendChild(row);
    });
}

async function handleAddOrUpdateRainfall(docId, isUpd = false) {
    if (!currentUser) return showNotification("You must be logged in.", true);

    const pre = isUpd ? 'edit-rf-' : 'new-rf-';

    let y = isUpd ? docId.split('_')[0] : document.getElementById('new-rf-year')?.value;
    let m = isUpd ? docId.split('_')[1] : document.getElementById('new-rf-month')?.value;
    let d = isUpd ? docId.split('_')[2] : document.getElementById('new-rf-day')?.value;

    if (!d || d.trim() === '') {
        alert("⚠️ Please enter a Day!");
        return showNotification("Day is required", true);
    }

    const payload = {
        id: `${y}_${m}_${d}`,
        nepali_year: parseInt(y),
        nepali_month: m,
        day: parseInt(d),
        headworks: parseFloat(document.getElementById(`${pre}headworks`)?.value) || null,
        powerhouse: parseFloat(document.getElementById(`${pre}powerhouse`)?.value) || null,
        operator_email: currentUser?.email || '',
        operator_uid: currentUser?.id || '',
        updated_at: new Date().toISOString()
    };

    try {
        const { error } = await supabase.from('rainfall_data').upsert(payload);
        if (error) throw error; 

        showNotification("✅ Rainfall data saved!");
        editingRainfallId = null;
        loadRainfallData();
        
        if (!isUpd) {
            if (document.getElementById('new-rf-day')) document.getElementById('new-rf-day').value = '';
            if (document.getElementById('new-rf-headworks')) document.getElementById('new-rf-headworks').value = '';
            if (document.getElementById('new-rf-powerhouse')) document.getElementById('new-rf-powerhouse').value = '';
        }
    } catch (e) {
        alert("CRITICAL DATABASE ERROR:\n\n" + e.message); 
        showNotification("Error saving data: " + e.message, true);
    }
}

rainfallBody?.addEventListener('click', (e) => {
    if (e.target.id === 'add-rf-btn' || e.target.closest('#add-rf-btn')) {
        handleAddOrUpdateRainfall(null, false);
    } 
    else if (e.target.classList.contains('edit-rf-btn')) {
        editingRainfallId = JSON.parse(e.target.dataset.doc).id;
        renderRainfallTable();
    } 
    else if (e.target.classList.contains('update-rf-btn')) {
        handleAddOrUpdateRainfall(e.target.dataset.id, true);
    } 
    else if (e.target.classList.contains('cancel-rf-btn')) {
        editingRainfallId = null;
        renderRainfallTable();
    } 
    else if (e.target.classList.contains('delete-rf-btn')) {
        showConfirmation('Confirm', `Delete this record?`, async () => {
            const { error } = await supabase.from('rainfall_data').delete().eq('id', e.target.dataset.id);
            if (error) {
                alert("Delete Error: " + error.message);
            } else {
                showNotification("Deleted");
                loadRainfallData();
            }
        });
    }
});

document.getElementById('rf-download-btn')?.addEventListener('click', () => {
    const exportData = allRainfallData.map(d => ({
        'Year': d.nepali_year, 'Month': d.nepali_month, 'Day': d.day,
        'Headworks': d.headworks, 'Dam': d.powerhouse, 'Operator': d.operator_email
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportData), "Rainfall");
    XLSX.writeFile(wb, "Rainfall_Data.xlsx");
});

document.getElementById('rf-upload-btn')?.addEventListener('click', () => document.getElementById('rf-file-upload')?.click());

document.getElementById('rf-file-upload')?.addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
            const jd = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
            if (jd.length === 0) return showNotification("File is empty", true);
            showConfirmation('Confirm', `Upload file?`, () => processAndUploadRainfall(jd));
        } catch (err) {
            showNotification("File error", true);
        }
    };
    reader.readAsArrayBuffer(file);
    ev.target.value = '';
});

async function processAndUploadRainfall(jd) {
    if (jd.length < 3) return showNotification("File is too small or empty.", true);

    // 1. Locate the "Year" row
    let yearRowIdx = -1;
    for (let i = 0; i < 10; i++) {
        if (jd[i] && jd[i].some(cell => String(cell).toLowerCase().includes('year'))) {
            yearRowIdx = i;
            break;
        }
    }

    if (yearRowIdx === -1) return showNotification("Could not find the 'Year' header row.", true);

    const yearRow = jd[yearRowIdx];
    const headerRow = jd[yearRowIdx + 1];
    const yearCols = []; 
    let currentYearNum = null;

    // 2. Map the transposed columns to specific years
    for (let c = 1; c < headerRow.length; c++) {
        if (yearRow[c]) {
            const yMatch = String(yearRow[c]).match(/\d{4}/);
            if (yMatch) currentYearNum = parseInt(yMatch[0]);
        }

        const hText = String(headerRow[c] || '').toLowerCase();
        if (currentYearNum && (hText.includes('head') || hText.includes('power') || hText.includes('dam'))) {
            let existing = yearCols.find(yc => yc.year === currentYearNum);
            if (!existing) {
                existing = { year: currentYearNum, headCol: -1, powCol: -1 };
                yearCols.push(existing);
            }
            if (hText.includes('head')) existing.headCol = c;
            if (hText.includes('power') || hText.includes('dam')) existing.powCol = c;
        }
    }

    if (yearCols.length === 0) return showNotification("Could not detect any years/columns in the header.", true);

    let currentMonth = null;
    const payloadMap = new Map();
    
    // Internal Helper to secure the month name
    const getMonthName = (m) => {
        if (!m) return null;
        const map = { baisakh: "Baisakh", jestha: "Jestha", ashadh: "Ashadh", ashar: "Ashadh", shrawan: "Shrawan", sawan: "Shrawan", bhadra: "Bhadra", ashoj: "Ashoj", asoj: "Ashoj", kartik: "Kartik", mangsir: "Mangsir", mangshir: "Mangsir", poush: "Poush", magh: "Magh", falgun: "Falgun", fagun: "Falgun", chaitra: "Chaitra", chait: "Chaitra" };
        return map[String(m).toLowerCase().trim()] || null;
    };

    // 3. Scan the grid rows
    for (let r = yearRowIdx + 2; r < jd.length; r++) {
        const row = jd[r];
        if (!row || row.length === 0) continue;

        const mVal = String(row[0] || '').trim();
        if (mVal && isNaN(parseInt(mVal))) { 
            const parsedM = getMonthName(mVal);
            if (parsedM) currentMonth = parsedM;
        }

        const dVal = parseInt(row[1]);
        if (!currentMonth || isNaN(dVal)) continue;

        yearCols.forEach(yc => {
            let headVal = null;
            let powVal = null;

            if (yc.headCol !== -1 && row[yc.headCol] != null && String(row[yc.headCol]).trim() !== '') {
                headVal = parseFloat(row[yc.headCol]);
            }
            if (yc.powCol !== -1 && row[yc.powCol] != null && String(row[yc.powCol]).trim() !== '') {
                powVal = parseFloat(row[yc.powCol]);
            }

            if ((headVal !== null && !isNaN(headVal)) || (powVal !== null && !isNaN(powVal))) {
                const safeDayStr = String(dVal).padStart(2, '0');
                const ds = `${yc.year}_${currentMonth}_${safeDayStr}`;
                payloadMap.set(ds, {
                    id: ds,
                    nepali_year: yc.year,
                    nepali_month: currentMonth,
                    day: dVal,
                    headworks: headVal !== null && !isNaN(headVal) ? headVal : 0, 
                    powerhouse: powVal !== null && !isNaN(powVal) ? powVal : 0,
                    operator_email: window.currentUser?.email || '',
                    operator_uid: window.currentUser?.id || '',
                    updated_at: new Date().toISOString()
                });
            }
        });
    }

    const payload = Array.from(payloadMap.values());
    if (!payload.length) return showNotification("No valid rainfall data found to upload.", true);

    showNotification(`Found ${payload.length} records. Uploading...`);

    try {
        for (let i = 0; i < payload.length; i += 500) {
            const chunk = payload.slice(i, i + 500);
            const { error } = await supabase.from('rainfall_data').upsert(chunk);
            if (error) throw error;
        }
        showNotification(`✅ Successfully uploaded ${payload.length} rows of data!`);
        loadRainfallData();
    } catch (e) {
        showNotification("Upload Error: " + e.message, true);
    }
}

// =====================================
// 8. DETAILED SITE EXPENSES (unchanged)
// =====================================
let allExpensesData = [];
const expensesContainer = document.getElementById("expenses-tables-container");

const numFmt = (val) => {
    const n = parseFloat(val);
    return !isNaN(n) ? n.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-';
};

function getStandardMonth(m) {
    if (!m) return '';
    const norm = m.toLowerCase().trim();
    if (norm.includes('bais')) return 'Baisakh';
    if (norm.includes('jesh') || norm.includes('jest')) return 'Jestha';
    if (norm.includes('ashad') || norm.includes('ashar')) return 'Ashadh';
    if (norm.includes('shraw') || norm.includes('sawan')) return 'Shrawan';
    if (norm.includes('bhad')) return 'Bhadra';
    if (norm.includes('asho') || norm.includes('asoj')) return 'Ashoj';
    if (norm.includes('kart')) return 'Kartik';
    if (norm.includes('mangs') || norm.includes('mangsh')) return 'Mangsir';
    if (norm.includes('pous')) return 'Poush';
    if (norm.includes('magh')) return 'Magh';
    if (norm.includes('falg') || norm.includes('fagun')) return 'Falgun';
    if (norm.includes('chai')) return 'Chaitra';
    return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
}

window.toggleExpInputFields = function() {
    const cat = document.getElementById(`new-exp-category`)?.value;
    const isFuel = (cat === 'Diesel' || cat === 'Petrol');
    if(document.getElementById(`new-exp-unit`)) document.getElementById(`new-exp-unit`).disabled = !isFuel;
    if(document.getElementById(`new-exp-rate`)) document.getElementById(`new-exp-rate`).disabled = !isFuel;
    if(document.getElementById(`new-exp-qty`)) document.getElementById(`new-exp-qty`).disabled = !isFuel;
    
    if(!isFuel) {
        if(document.getElementById(`new-exp-unit`)) document.getElementById(`new-exp-unit`).value = '';
        if(document.getElementById(`new-exp-rate`)) document.getElementById(`new-exp-rate`).value = '';
        if(document.getElementById(`new-exp-qty`)) document.getElementById(`new-exp-qty`).value = '';
    }
    calculateExpItemTotal();
};

window.calculateExpItemTotal = function() {
    const cat = document.getElementById(`new-exp-category`)?.value;
    if(cat === 'Diesel' || cat === 'Petrol') {
        const r = parseFloat(document.getElementById(`new-exp-rate`)?.value) || 0;
        const q = parseFloat(document.getElementById(`new-exp-qty`)?.value) || 0;
        if(document.getElementById(`new-exp-amount`)) document.getElementById(`new-exp-amount`).value = (r * q).toFixed(2);
    }
};

function updateExpenseFilters() {
    const ySelect = document.getElementById('filter-exp-year');
    const mSelect = document.getElementById('filter-exp-month');
    if(!ySelect || !mSelect) return;

    const years = [...new Set(allExpensesData.map(d => d.nepali_year))];
    years.sort((a,b) => b-a);

    let defaultY = getNepDateObj().year;
    let defaultM = getNepDateObj().month;
    
    if (allExpensesData.length > 0) {
        const getMonthIdx = (m) => nepaliMonths.indexOf(getStandardMonth(m)) !== -1 ? nepaliMonths.indexOf(getStandardMonth(m)) : 99;
        const sortedData = [...allExpensesData].sort((a, b) => b.nepali_year - a.nepali_year || getMonthIdx(b.nepali_month) - getMonthIdx(a.nepali_month));
        defaultY = sortedData[0].nepali_year;
        defaultM = getStandardMonth(sortedData[0].nepali_month);
    }

    const currentY = ySelect.value;
    const currentM = mSelect.value;

    ySelect.innerHTML = '<option value="All">All Years</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
    mSelect.innerHTML = '<option value="All">All Months</option>' + nepaliMonths.map(m => `<option value="${m}">${m}</option>`).join('');

    if(currentY && currentY !== 'All' && ySelect.querySelector(`option[value="${currentY}"]`)) ySelect.value = currentY;
    else ySelect.value = defaultY;

    if(currentM && currentM !== 'All' && mSelect.querySelector(`option[value="${currentM}"]`)) mSelect.value = currentM;
    else mSelect.value = defaultM;
}

function generateManualInputHTML() {
    if (['staff', 'normal'].includes(userRole)) return '';
    return `
    <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-2 mb-4 shrink-0 flex items-center gap-2">
        <span class="text-[10px] font-black text-indigo-600 uppercase whitespace-nowrap ml-2">➕ Quick Add:</span>
        <select id="new-exp-category" class="input-cell w-28 text-[11px] font-bold" onchange="toggleExpInputFields()"><option value="Petty Cash">Petty Cash</option><option value="Diesel">Diesel</option><option value="Petrol">Petrol</option><option value="Salary">Salary</option><option value="Vehicle">Vehicle</option></select>
        <input type="text" id="new-exp-description" class="input-cell flex-grow text-[11px]" placeholder="Title / Purpose..." />
        <input type="text" id="new-exp-unit" class="input-cell w-16 text-[11px] text-center" placeholder="Unit" disabled />
        <input type="number" id="new-exp-rate" step="any" class="input-cell w-20 text-[11px] text-center" placeholder="Rate" disabled oninput="calculateExpItemTotal()" />
        <input type="number" id="new-exp-qty" step="any" class="input-cell w-20 text-[11px] text-center" placeholder="Qty" disabled oninput="calculateExpItemTotal()" />
        <input type="number" id="new-exp-amount" step="any" class="input-cell w-24 text-[11px] font-bold text-indigo-700 bg-indigo-50" placeholder="Amt (NRs)" />
        <input type="text" id="new-exp-remarks" class="input-cell w-32 text-[11px]" placeholder="Remarks" />
        <button id="add-exp-btn" class="bg-indigo-600 text-white font-bold py-1 px-3 rounded shadow hover:bg-indigo-700 transition text-[11px] whitespace-nowrap">Save</button>
    </div>`;
}

function renderExpensesTables() {
    if (!expensesContainer) return;
    
    const fm = document.getElementById('filter-exp-month')?.value;
    const fy = document.getElementById('filter-exp-year')?.value;
    const fc = document.getElementById('filter-exp-category')?.value;
    const canEdit = ['admin', 'operator'].includes(userRole);

    let html = generateManualInputHTML();

    if(fm === 'All' || fy === 'All') {
        expensesContainer.innerHTML = html + `<div class="p-8 text-center text-slate-500 font-bold mt-10">Please select a specific Year and Month to view the separated tables.</div>`;
        return;
    }

    let monthData = allExpensesData.filter(d => {
        const matchY = fy === 'All' || String(d.nepali_year) === fy;
        const matchM = fm === 'All' || getStandardMonth(d.nepali_month) === getStandardMonth(fm);
        return matchY && matchM;
    });

    const categories = ['Petty Cash', 'Diesel', 'Petrol', 'Salary', 'Vehicle'];
    let summaryTotals = { 'Petty Cash':0, 'Diesel':0, 'Petrol':0, 'Salary':0, 'Vehicle':0, 'Grand Total':0 };

    html += `<div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 items-start pb-6">`;

    categories.forEach(cat => {
        const catData = monthData.filter(d => d.category === cat);
        let catSum = 0;
        catData.forEach(d => { catSum += parseFloat(d.amount) || 0; });
        summaryTotals[cat] = catSum;
        summaryTotals['Grand Total'] += catSum;

        if((fc !== 'All' && fc !== cat) || (catData.length === 0 && fc === 'All')) return;

        const isFuel = (cat === 'Diesel' || cat === 'Petrol');
        
        let tableHtml = `
        <div class="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            <div class="bg-slate-100 text-slate-700 text-[11px] font-black py-2 px-3 border-b border-slate-200 uppercase tracking-widest flex justify-between items-center">
                <span>${cat}</span>
                <span class="text-[10px] font-bold text-slate-500">${getStandardMonth(fm)} ${fy}</span>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full border-collapse text-[11px]">
                    <thead class="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th class="py-1.5 px-2 text-center text-slate-500 font-semibold w-8">SN</th>
                            <th class="py-1.5 px-2 text-left text-slate-500 font-semibold">${isFuel ? 'Purpose' : 'Title'}</th>
                            ${isFuel ? '<th class="py-1.5 px-2 text-center text-slate-500 font-semibold">Unit</th><th class="py-1.5 px-2 text-right text-slate-500 font-semibold">Rate</th><th class="py-1.5 px-2 text-right text-slate-500 font-semibold">Qty</th>' : ''}
                            <th class="py-1.5 px-2 text-right text-slate-500 font-semibold">Amount</th>
                            <th class="py-1.5 px-2 text-left text-slate-500 font-semibold">Remarks</th>
                            <th class="py-1.5 px-1 text-center text-slate-500 w-8 ${canEdit ? '' : 'hidden'}">Del</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">`;

        catData.forEach((d, idx) => {
            tableHtml += `
            <tr class="hover:bg-indigo-50/30 group">
                <td class="py-1.5 px-2 text-center text-slate-400">${idx + 1}<\/td>
                <td class="py-1.5 px-2 text-slate-700 font-medium">${d.description || '-'}<\/td>
                ${isFuel ? `<td class="py-1.5 px-2 text-center text-slate-500">${d.unit||'-'}<\/td><td class="py-1.5 px-2 text-right text-slate-500">${d.rate?numFmt(d.rate):'-'}<\/td><td class="py-1.5 px-2 text-right text-slate-600 font-bold">${d.quantity!==null?d.quantity:'-'}<\/td>` : ''}
                <td class="py-1.5 px-2 text-right font-bold text-slate-800">${numFmt(d.amount)}<\/td>
                <td class="py-1.5 px-2 text-slate-500 truncate max-w-[80px]" title="${d.remarks||''}">${d.remarks || ''}<\/td>
                <td class="py-1.5 px-1 text-center ${canEdit ? '' : 'hidden'}"><button class="delete-exp-btn text-red-600 font-black hover:text-red-800 bg-red-100 px-2 py-0.5 rounded" data-id="${d.id}">X<\/button><\/td>
            <\/tr>`;
        });

        tableHtml += `
                <tr class="bg-slate-50 border-t-2 border-slate-200">
                    <td colspan="${isFuel ? 5 : 2}" class="py-1.5 px-2 text-right font-black text-slate-600 uppercase">Total<\/td>
                    <td class="py-1.5 px-2 text-right font-black text-indigo-700">${numFmt(catSum)}<\/td>
                    <td><\/td><td class="${canEdit ? '' : 'hidden'}"><\/td>
                <\/tr>
            <\/tbody>
        <\/table><\/div><\/div>`;
        
        html += tableHtml;
    });

    if(fc === 'All' && monthData.length > 0) {
        let summaryHtml = `
        <div class="bg-white rounded-lg shadow-sm border border-indigo-200 overflow-hidden flex flex-col row-span-2">
            <div class="bg-indigo-50 text-indigo-900 text-[11px] font-black py-2 px-3 border-b border-indigo-200 uppercase tracking-widest text-center">Overall Summary</div>
            <div class="overflow-x-auto">
                <table class="w-full border-collapse text-[11px]">
                    <thead class="bg-white border-b border-slate-200"><tr><th class="py-1.5 px-2 text-center text-slate-500 font-semibold w-8">SN</th><th class="py-1.5 px-2 text-left text-slate-500 font-semibold">Description</th><th class="py-1.5 px-2 text-right text-slate-500 font-semibold">Amount</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">`;
        
        let sn = 1;
        categories.forEach(cat => {
            summaryHtml += `<tr class="hover:bg-slate-50"><td class="py-2 px-2 text-center text-slate-400">${sn++}<\/td><td class="py-2 px-2 text-slate-700 font-medium">To ${cat} ${cat==='Petty Cash'?'':'Consumption'}<\/td><td class="py-2 px-2 text-right text-slate-700 font-bold">${summaryTotals[cat] > 0 ? numFmt(summaryTotals[cat]) : '-'}<\/td><\/tr>`;
        });
        
        summaryHtml += `<tr class="bg-indigo-600 border-t-2 border-indigo-700 text-white"><td colspan="2" class="py-2 px-2 text-right font-black uppercase tracking-widest">Grand Total<\/td><td class="py-2 px-2 text-right font-black text-sm">${numFmt(summaryTotals['Grand Total'])}<\/td><\/tr>
                    </tbody>
                <\/table>
            <\/div>
        <\/div>`;
        
        html += summaryHtml;
    }

    html += `<\/div>`;

    if(monthData.length === 0) html += `<div class="p-8 text-center text-slate-500 font-bold border-2 border-dashed border-slate-300 rounded-xl mt-4">No expenses recorded for ${getStandardMonth(fm)} ${fy}.</div>`;

    expensesContainer.innerHTML = html;
}

document.getElementById('filter-exp-year')?.addEventListener('change', renderExpensesTables);
document.getElementById('filter-exp-month')?.addEventListener('change', renderExpensesTables);
document.getElementById('filter-exp-category')?.addEventListener('change', renderExpensesTables);

async function loadExpensesData() {
    if (isLoadingExpenses) return;
    isLoadingExpenses = true;
    try {
        const { data, error } = await supabase.from('site_expense_items').select('*');
        if (error) throw error;
        if (data) {
            allExpensesData = data;
            updateExpenseFilters();
            renderExpensesTables();
        }
    } catch(err) {
    console.error("Expenses load error:", err.message, err);
    showNotification(`Expenses error: ${err.message}`, true);
}
    isLoadingExpenses = false;
}

expensesContainer?.addEventListener('click', async (e) => {
    if (e.target.id === 'add-exp-btn') {
        const fy = document.getElementById('filter-exp-year')?.value;
        const fm = document.getElementById('filter-exp-month')?.value;
        
        const payload = {
            nepali_year: parseInt(fy === 'All' ? getCurrentNepaliDate().year : fy),
            nepali_month: fm === 'All' ? getCurrentNepaliDate().month : fm,
            category: document.getElementById('new-exp-category')?.value,
            description: document.getElementById('new-exp-description')?.value || null,
            unit: document.getElementById('new-exp-unit')?.value || null,
            rate: parseFloat(document.getElementById('new-exp-rate')?.value) || null,
            quantity: parseFloat(document.getElementById('new-exp-qty')?.value) || null,
            amount: parseFloat(document.getElementById('new-exp-amount')?.value) || null,
            remarks: document.getElementById('new-exp-remarks')?.value || null,
            operator_email: currentUser?.email || '',
            operator_uid: currentUser?.id || '',
            updated_at: new Date().toISOString()
        };

        try {
            const { error } = await supabase.from('site_expense_items').insert([payload]);
            if (error) throw error;
            showNotification("Expense added!"); 
            loadExpensesData();
        } catch(err) {
            showNotification("Error saving: " + err.message, true);
        }
    }
    else if (e.target.classList.contains('delete-exp-btn')) {
        showConfirmation('Confirm Delete', `Delete this specific item?`, async () => {
            await supabase.from('site_expense_items').delete().eq('id', e.target.dataset.id);
            showNotification("Record deleted.");
            loadExpensesData();
        });
    }
});

document.getElementById('exp-download-btn')?.addEventListener('click', () => {
    const exportData = allExpensesData.map(d => ({
        'Year': d.nepali_year, 'Month': d.nepali_month, 'Category': d.category,
        'Description': d.description, 'Unit': d.unit, 'Rate': d.rate, 'Quantity': d.quantity,
        'Amount': d.amount, 'Remarks': d.remarks, 'Operator': d.operator_email
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportData), "Ledger");
    XLSX.writeFile(wb, "Detailed_Site_Expenses.xlsx");
});

document.getElementById('exp-upload-btn')?.addEventListener('click', () => document.getElementById('exp-file-upload')?.click());
document.getElementById('exp-file-upload')?.addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
            processAndUploadWorkbookExpenses(workbook);
        } catch (err) {
            showNotification("Invalid Excel file", true);
        }
    };
    reader.readAsArrayBuffer(file);
    ev.target.value = '';
});

async function processAndUploadWorkbookExpenses(workbook) {
    let allPayloads = [];
    let monthsToPurge = [];

    const extractAmt = (val) => {
        if(val === undefined || val === null || val === '' || val === '-') return 0;
        let num = parseFloat(String(val).replace(/,/g, ''));
        return isNaN(num) ? 0 : num;
    };

    for (const sheetName of workbook.SheetNames) {
        const jd = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
        if (!jd || jd.length === 0) continue;

        let year = null, month = null, rawMonthUploaded = null;

        for(let r=0; r<jd.length; r++) {
            if(!jd[r]) continue;
            for(let c=0; c<jd[r].length; c++) {
                let val = String(jd[r][c] || '').toLowerCase().trim();
                const dateMatch = val.match(/(?:for the|month of)\s+([a-z]+)\s+(\d{4})/i);
                if(!year && dateMatch) {
                    rawMonthUploaded = dateMatch[1].charAt(0).toUpperCase() + dateMatch[1].slice(1).toLowerCase();
                    month = getStandardMonth(rawMonthUploaded);
                    year = parseInt(dateMatch[2]);
                }
            }
        }

        if(!year || !month) continue; 
        monthsToPurge.push({ year, month, rawMonthUploaded });

        for(let r=1; r<jd.length; r++) { 
            if(!jd[r]) continue;
            for(let c=0; c<jd[r].length; c++) {
                let cellVal = String(jd[r][c] || '').toLowerCase().replace(/[^a-z]/g, '');
                
                if (cellVal === 'sn' || cellVal === 'sno') {
                    let c_sn = c, rHdr = r;
                    let category = null, searchStr = '';
                    
                    for(let lookR = rHdr - 1; lookR >= Math.max(0, rHdr - 2); lookR--) {
                        if(!jd[lookR]) continue;
                        for(let lookC = Math.max(0, c_sn - 2); lookC <= c_sn + 5; lookC++) {
                            searchStr += String(jd[lookR][lookC] || '').toLowerCase() + ' ';
                        }
                    }

                    if(searchStr.includes('petty cash')) category = 'Petty Cash';
                    else if(searchStr.includes('diesel')) category = 'Diesel';
                    else if(searchStr.includes('petrol')) category = 'Petrol';
                    else if(searchStr.includes('salary')) category = 'Salary';
                    else if(searchStr.includes('vehicle')) category = 'Vehicle';
                    else continue; 

                    let c_desc = -1, c_amt = -1, c_rem = -1;
                    let c_unit = -1, c_rate = -1, c_qty = -1;
                    
                    for(let i = c_sn; i < jd[rHdr].length; i++) {
                        let text = String(jd[rHdr][i] || '').toLowerCase().replace(/[^a-z]/g, '');
                        if (!text && i > c_sn + 3) break; 
                        if ((text === 'sn' || text === 'sno') && i > c_sn) break; 
                        
                        if (text.includes('title') || text.includes('purpose')) c_desc = i;
                        else if (text.includes('unit')) c_unit = i;
                        else if (text.includes('rate')) c_rate = i;
                        else if (text.includes('quantit') || text.includes('qty')) c_qty = i; 
                        else if (text.includes('amount') || text.includes('amt') || text === 'amountnpr' || text === 'amountnrs') c_amt = i;
                        else if (text.includes('description') || text.includes('remark')) c_rem = i;
                    }

                    if (c_amt === -1) continue; 

                    let emptyCount = 0;
                    
                    for(let dataR = rHdr + 1; dataR < jd.length; dataR++) {
                        if(!jd[dataR]) {
                            emptyCount++;
                            if(emptyCount > 2) break; 
                            continue;
                        }
                        
                        let snVal = String(jd[dataR][c_sn] || '').toLowerCase().trim();
                        let descVal = c_desc !== -1 ? String(jd[dataR][c_desc] || '').toLowerCase().trim() : '';
                        
                        if(snVal.includes('total') || descVal.includes('total') || snVal.includes('summary')) break;
                        
                        let amt = extractAmt(jd[dataR][c_amt]);
                        let qty = c_qty !== -1 ? extractAmt(jd[dataR][c_qty]) : 0;
                        let rate = c_rate !== -1 ? extractAmt(jd[dataR][c_rate]) : 0;

                        let item = {
                            nepali_year: year, nepali_month: month, category: category,
                            operator_email: currentUser?.email || '',
                            operator_uid: currentUser?.id || '',
                            updated_at: new Date().toISOString()
                        };

                        item.description = c_desc !== -1 ? (jd[dataR][c_desc] || null) : null;
                        item.amount = amt;
                        item.remarks = c_rem !== -1 ? (jd[dataR][c_rem] || null) : null;

                        if(category === 'Diesel' || category === 'Petrol') {
                            item.unit = c_unit !== -1 ? (jd[dataR][c_unit] || null) : null;
                            item.rate = rate;
                            item.quantity = qty;
                        }

                        let hasData = false;
                        if (item.description && item.description.trim() !== '') hasData = true;
                        if (item.remarks && item.remarks.trim() !== '') hasData = true;
                        if (item.amount !== 0 || item.quantity !== 0 || item.rate !== 0) hasData = true;

                        if (hasData) {
                            allPayloads.push(item);
                            emptyCount = 0;
                        } else {
                            emptyCount++;
                            if(emptyCount > 2) break;
                        }
                    }
                }
            }
        }
    }

    if(allPayloads.length === 0) return showNotification("No detailed items found in any sheet.", true);

    try {
        showNotification(`Processing ${workbook.SheetNames.length} sheets...`);
        
        for (const p of monthsToPurge) {
            await supabase.from('site_expense_items')
                .delete()
                .eq('nepali_year', p.year)
                .in('nepali_month', [p.month, p.rawMonthUploaded, 'Mangshir']);
        }

        let totalInserted = 0;
        for (let i = 0; i < allPayloads.length; i += 500) {
            const chunk = allPayloads.slice(i, i + 500);
            const { error } = await supabase.from('site_expense_items').insert(chunk);
            if (error) throw error;
            totalInserted += chunk.length;
        }

        showNotification(`Successfully extracted ${totalInserted} items across ${monthsToPurge.length} months!`);
        loadExpensesData();
    } catch (e) {
        showNotification("Upload Error: " + e.message, true);
    }
}

// ==========================================
// 1. POWERHOUSE METERING (unchanged, but added loading flag)
// ==========================================
const dataBody = document.getElementById("data-body");

function createInputRow() {
    if (['staff', 'normal'].includes(userRole)) return '';
    const today = new Date();
    const localToday = new Date(today.getTime() - (today.getTimezoneOffset() * 60 * 1000));
    const dateString = localToday.toISOString().split('T')[0];

    return `<tr id="add-new-row" class="bg-indigo-50/60 sticky top-0 z-20 shadow-sm border-b-2 border-indigo-200">
        <td><input type="date" id="new-date" class="input-cell" value="${dateString}" required /></td>
        <td><input type="text" id="new-nepali_date" class="input-cell" placeholder="YYYY.MM.DD" /></td>
        <td><input type="number" id="new-unit1_gen" step="any" class="input-cell" /></td>
        <td><input type="number" id="new-unit2_gen" step="any" class="input-cell" /></td>
        <td><input type="number" id="new-unit1_trans" step="any" class="input-cell" /></td>
        <td><input type="number" id="new-unit2_trans" step="any" class="input-cell" /></td>
        <td><input type="number" id="new-station_trans" step="any" class="input-cell" /></td>
        
        <td><input type="number" id="new-import_outgoing" step="any" class="input-cell text-emerald-700" /></td>
        <td><input type="number" id="new-import_substation" step="any" class="input-cell text-emerald-700" /></td>
        <td><input type="number" id="new-export_plant" step="any" class="input-cell font-bold text-indigo-700 bg-indigo-50" /></td>
        <td><input type="number" id="new-export_substation" step="any" class="input-cell text-indigo-700" /></td>
        
        <td><input type="number" id="new-unit1_counter" step="any" class="input-cell" /></td>
        <td><input type="number" id="new-unit2_counter" step="any" class="input-cell" /></td>
        <td class="truncate-text text-slate-500 text-xs" title="${currentUser?.email || ''}">${getUserName()}</td>
        <td class="col-actions"><button id="add-entry-btn" class="w-full bg-indigo-600 text-white font-bold py-1 px-3 rounded shadow hover:bg-indigo-700 transition">Save Row</button></td>
    </tr>`;
}

function createDisplayRowHtml(d) {
    const canEdit = ['admin'].includes(userRole);
    const docStr = JSON.stringify(d).replace(/'/g, "&apos;");
    return `<td class="font-bold text-slate-900">${d.id}</td>
        <td class="font-medium text-slate-700">${d.nepali_date || '—'}</td>
        <td class="text-slate-600">${formatNumber(d.unit1_gen)}</td>
        <td class="text-slate-600">${formatNumber(d.unit2_gen)}</td>
        <td class="text-slate-600">${formatNumber(d.unit1_trans)}</td>
        <td class="text-slate-600">${formatNumber(d.unit2_trans)}</td>
        <td class="text-slate-600">${formatNumber(d.station_trans)}</td>
        
        <td class="text-emerald-700">${formatNumber(d.import_outgoing)}</td>
        <td class="text-emerald-700">${formatNumber(d.import_substation)}</td>
        <td class="font-bold text-indigo-700 bg-indigo-50/50">${formatNumber(d.export_plant)}</td>
        <td class="text-indigo-700">${formatNumber(d.export_substation)}</td>
        
        <td class="text-slate-600">${formatNumber(d.unit1_counter)}</td>
        <td class="text-slate-600">${formatNumber(d.unit2_counter)}</td>
        <td class="truncate-text text-xs text-slate-500" title="${d.operator_email}">${d.operator_email}</td>
        <td class="col-actions space-x-2 whitespace-nowrap ${canEdit ? '' : 'hidden'}">
            <button class="edit-btn text-indigo-600 font-bold hover:underline" data-doc='${docStr}'>Edit</button>
            ${userRole === 'admin' ? `<button class="delete-btn text-red-600 font-bold hover:underline" data-id="${d.id}">Del</button>` : ''}
        </td>`;
}

function createEditRowHtml(docData) {
    return `<td><input type="date" class="input-cell bg-slate-100" value="${docData.id}" disabled /></td>
        <td><input type="text" id="edit-nepali_date" class="input-cell" value="${docData.nepali_date || ''}" /></td>
        <td><input type="number" id="edit-unit1_gen" step="any" class="input-cell" value="${docData.unit1_gen ?? ''}" /></td>
        <td><input type="number" id="edit-unit2_gen" step="any" class="input-cell" value="${docData.unit2_gen ?? ''}" /></td>
        <td><input type="number" id="edit-unit1_trans" step="any" class="input-cell" value="${docData.unit1_trans ?? ''}" /></td>
        <td><input type="number" id="edit-unit2_trans" step="any" class="input-cell" value="${docData.unit2_trans ?? ''}" /></td>
        <td><input type="number" id="edit-station_trans" step="any" class="input-cell" value="${docData.station_trans ?? ''}" /></td>
        
        <td><input type="number" id="edit-import_outgoing" step="any" class="input-cell text-emerald-700" value="${docData.import_outgoing ?? ''}" /></td>
        <td><input type="number" id="edit-import_substation" step="any" class="input-cell text-emerald-700" value="${docData.import_substation ?? ''}" /></td>
        <td><input type="number" id="edit-export_plant" step="any" class="input-cell font-bold text-indigo-700" value="${docData.export_plant ?? ''}" /></td>
        <td><input type="number" id="edit-export_substation" step="any" class="input-cell text-indigo-700" value="${docData.export_substation ?? ''}" /></td>
        
        <td><input type="number" id="edit-unit1_counter" step="any" class="input-cell" value="${docData.unit1_counter ?? ''}" /></td>
        <td><input type="number" id="edit-unit2_counter" step="any" class="input-cell" value="${docData.unit2_counter ?? ''}" /></td>
        <td class="truncate-text text-xs text-slate-500" title="${currentUser?.email}">${getUserName()}</td>
        <td class="flex space-x-2 whitespace-nowrap">
            <button class="update-btn bg-emerald-600 text-white font-bold py-1 px-3 rounded hover:bg-emerald-700" data-id="${docData.id}">Save</button>
            <button class="cancel-btn bg-slate-200 text-slate-700 font-bold py-1 px-3 rounded hover:bg-slate-300">X</button>
        </td>`;
}

function renderTable(data) {
    if(!dataBody) return;
    dataBody.innerHTML = createInputRow();
    data.forEach(d => {
        const row = document.createElement('tr');
        row.id = `row-${d.id}`;
        row.innerHTML = (d.id === editingRowId) ? createEditRowHtml(d) : createDisplayRowHtml(d);
        if (d.id === editingRowId) {
            row.classList.add('bg-indigo-50');
        } else {
            row.classList.add('hover:bg-slate-50');
        }
        dataBody.appendChild(row);
    });
}

async function handleAddOrUpdateEntry(docId, isUpdate = false) {
    const prefix = isUpdate ? 'edit-' : 'new-';
    const dateVal = isUpdate ? docId : document.getElementById(`${prefix}date`)?.value;
    if (!dateVal) return showNotification("Please select an English date.", true);

    const data = {
        id: dateVal,
        operator_email: currentUser?.email || '',
        updated_at: new Date().toISOString(),
        nepali_date: document.getElementById(`${prefix}nepali_date`)?.value || null,
        unit1_gen: parseFloat(document.getElementById(`${prefix}unit1_gen`)?.value) || null,
        unit2_gen: parseFloat(document.getElementById(`${prefix}unit2_gen`)?.value) || null,
        unit1_trans: parseFloat(document.getElementById(`${prefix}unit1_trans`)?.value) || null,
        unit2_trans: parseFloat(document.getElementById(`${prefix}unit2_trans`)?.value) || null,
        station_trans: parseFloat(document.getElementById(`${prefix}station_trans`)?.value) || null,
        export_plant: parseFloat(document.getElementById(`${prefix}export_plant`)?.value) || null,
        export_substation: parseFloat(document.getElementById(`${prefix}export_substation`)?.value) || null,
        import_outgoing: parseFloat(document.getElementById(`${prefix}import_outgoing`)?.value) || null,
        import_substation: parseFloat(document.getElementById(`${prefix}import_substation`)?.value) || null,
        unit1_counter: parseFloat(document.getElementById(`${prefix}unit1_counter`)?.value) || null,
        unit2_counter: parseFloat(document.getElementById(`${prefix}unit2_counter`)?.value) || null,
    };

    try {
        const { error: pErr } = await supabase.from('plant_data').upsert(data);
        if (pErr) throw pErr;

        const { data: currentBalanch } = await supabase.from('balanch_readings').select('*').eq('eng_date', dateVal).maybeSingle();
        const balanchSync = { eng_date: dateVal, updated_at: new Date().toISOString() };
        let needsSync = false;

        if (!currentBalanch || currentBalanch.main_export == null) { 
            balanchSync.main_export = data.export_plant; needsSync = true; 
        }
        if (!currentBalanch || currentBalanch.main_import == null) { 
            balanchSync.main_import = data.import_substation; needsSync = true; 
        }
        // 👉 SYNC NEPALI DATE TO SUBSTATION
        if (data.nepali_date && (!currentBalanch || !currentBalanch.nep_date)) {
            balanchSync.nep_date = data.nepali_date; needsSync = true;
        }

        if (needsSync) {
            await supabase.from('balanch_readings').upsert({ ...(currentBalanch || {}), ...balanchSync });
        }

        showNotification(`✅ Daily Data saved & Substation smart-synced!`);
        editingRowId = null;
        loadAndListenData();
        loadBalanchData();
    } catch (error) {
        showNotification("Error: " + error.message, true);
    }
}

dataBody?.addEventListener('click', e => {
    if (e.target.id === 'add-entry-btn') {
        handleAddOrUpdateEntry(null, false);
    }
    if (e.target.classList.contains('edit-btn')) {
        editingRowId = JSON.parse(e.target.dataset.doc).id;
        renderTable([...allData].reverse());
    }
    if (e.target.classList.contains('delete-btn')) {
        showConfirmation('Confirm Deletion', `Delete entry for ${e.target.dataset.id}?`, async () => {
            await supabase.from('plant_data').delete().eq('id', e.target.dataset.id);
            showNotification("Entry deleted.");
            loadAndListenData();
        });
    }
    if (e.target.classList.contains('update-btn')) {
        handleAddOrUpdateEntry(e.target.dataset.id, true);
    }
    if (e.target.classList.contains('cancel-btn')) {
        editingRowId = null;
        renderTable([...allData].reverse());
    }
});

async function loadAndListenData() {
    if (isLoadingData) return;
    isLoadingData = true;
    let data = [], page = 0, more = true;
    const todayStr = getTodayStr(); // <-- FIX: Calculate today's exact date

    while (more) {
        try {
            const { data: chunk, error } = await supabase.from('plant_data')
                .select('*')
                .lte('id', todayStr) // <-- FIX: Stop fetching at today's date!
                .order('id', { ascending: true })
                .range(page * 1000, (page + 1) * 1000 - 1);
            if (error) throw error;
            if (chunk && chunk.length > 0) data = data.concat(chunk);
            if (!chunk || chunk.length < 1000) more = false; else page++;
        } catch(err) {
            console.warn("Failed to load powerhouse data");
            break;
        }
    }
    if (data) {
        allData = data;
        renderTable([...allData].reverse());
        populateHistoricalYearsFromAllData();
        setDefaultTrendToLastNepaliMonth();
    }
    isLoadingData = false;
}

// ==========================================
// 1. POWERHOUSE METERING - UPLOAD FIX (unchanged)
// ==========================================
document.getElementById('daily-upload-btn')?.addEventListener('click', () => {
    document.getElementById('file-upload')?.click();
});
document.getElementById('file-upload')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            // raw: true ensures we get pure numbers from Excel, bypassing Javascript's timezone logic
            const workbook = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
            showConfirmation('Confirm Upload', `Upload Powerhouse Daily Data?`, () => processAndUploadData(workbook));
        } catch (err) {
            showNotification("Invalid Excel file.", true);
        }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
});

async function processAndUploadData(workbook) {
    showNotification("Starting upload processing...");

    let targetSheet = null;
    let headerRowIndex = -1;

    // Smart Scanner: Search for the sheet containing Daily Meter Data
    for (const sheetName of workbook.SheetNames) {
        const jd = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
        for (let i = 0; i < Math.min(10, jd.length); i++) {
            const rowStr = (jd[i] || []).map(c => String(c||'').toLowerCase()).join('');
            if (rowStr.includes('english date') || rowStr.includes('unit 1 generator')) {
                targetSheet = jd;
                headerRowIndex = i;
                break;
            }
        }
        if (targetSheet) break;
    }

    if (!targetSheet || headerRowIndex === -1) return showNotification("Missing 'English Date' column or header row.", true);

    const header = targetSheet[headerRowIndex].map(h => String(h ?? "").toLowerCase().trim());
    
    const colMap = {
        englishDate: header.findIndex(h => h.includes('english date')),
        nepaliDate: header.findIndex(h => h.includes('nepali date')),
        unit1Gen: header.findIndex(h => h.includes('unit 1') && h.includes('generator')),
        unit2Gen: header.findIndex(h => h.includes('unit 2') && h.includes('generator')),
        unit1Trans: header.findIndex(h => h.includes('unit 1') && h.includes('transformer')),
        unit2Trans: header.findIndex(h => h.includes('unit 2') && h.includes('transformer')),
        stationTrans: header.findIndex(h => h.includes('station transformer')),
        exportPlant: header.findIndex(h => h.includes('export') && h.includes('plant')),
        exportSubstation: header.findIndex(h => h.includes('export') && h.includes('substation')),
        importOutgoing: header.findIndex(h => h.includes('import') && h.includes('outgoing')),
        importSubstation: header.findIndex(h => h.includes('import') && h.includes('substation')),
        unit1Counter: header.findIndex(h => h.includes('unit 1') && h.includes('hour')),
        unit2Counter: header.findIndex(h => h.includes('unit 2') && h.includes('hour'))
    };

    if (colMap.englishDate === -1) colMap.englishDate = 1; 
    if (colMap.nepaliDate === -1) colMap.nepaliDate = 0;

    const payloadMap = new Map(); // Uses Map to PREVENT duplicate date conflicts

    for (let r = headerRowIndex + 1; r < targetSheet.length; r++) {
        const row = targetSheet[r];
        if (!row || row.length === 0) continue;

        const dv = row[colMap.englishDate];
        if (dv == null || dv === '') continue;

        // BULLETPROOF DATE PARSER: Completely bypasses Timezone Shifts
        let ds = null;
        if (typeof dv === 'number') {
            const ex = XLSX.SSF.parse_date_code(dv, { date1904: false });
            if (ex) {
                ds = `${ex.y}-${String(ex.m).padStart(2, '0')}-${String(ex.d).padStart(2, '0')}`;
            }
        } else if (typeof dv === 'string') {
            const cleanStr = dv.trim();
            // Priority 1: Strict text match for YYYY-MM-DD
            const isoMatch = cleanStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
            if (isoMatch) {
                ds = `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
            } else {
                // Priority 2: Strict text match for DD-MM-YYYY
                const ukMatch = cleanStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
                if (ukMatch) {
                    ds = `${ukMatch[3]}-${String(ukMatch[2]).padStart(2, '0')}-${String(ukMatch[1]).padStart(2, '0')}`;
                } else {
                    // Priority 3: Fallback using LOCAL getters (NOT UTC) to prevent Nepal -1 Day shift
                    const dt = new Date(cleanStr.replace(/-/g, '/'));
                    if (!isNaN(dt.getTime())) {
                        ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
                    }
                }
            }
        }

        if (!ds || ds.includes("NaN")) continue;

        // Number parser: strips commas and handles empty dashes safely
        const parseNum = (idx) => {
            if (idx === -1 || row[idx] == null || String(row[idx]).trim() === '' || String(row[idx]).trim() === '-') return null;
            const cleanVal = String(row[idx]).replace(/,/g, '').trim();
            const num = parseFloat(cleanVal);
            return isNaN(num) ? null : num;
        };

        payloadMap.set(ds, {
            id: ds,
            operator_email: currentUser?.email || '',
            operator_uid: currentUser?.id || '',
            nepali_date: row[colMap.nepaliDate] ? String(row[colMap.nepaliDate]).trim() : null,
            unit1_gen: parseNum(colMap.unit1Gen),
            unit2_gen: parseNum(colMap.unit2Gen),
            unit1_trans: parseNum(colMap.unit1Trans),
            unit2_trans: parseNum(colMap.unit2Trans),
            station_trans: parseNum(colMap.stationTrans),
            export_plant: parseNum(colMap.exportPlant),
            export_substation: parseNum(colMap.exportSubstation),
            import_outgoing: parseNum(colMap.importOutgoing),
            import_substation: parseNum(colMap.importSubstation),
            unit1_counter: parseNum(colMap.unit1Counter),
            unit2_counter: parseNum(colMap.unit2Counter)
        });
    }

    const payload = Array.from(payloadMap.values());
    if (payload.length === 0) return showNotification("No valid rows found to upload.", true);

    try {
        // EXPLICIT CONFLICT RESOLUTION: Ensures existing dates are updated rather than throwing silent errors
        const { error } = await supabase.from('plant_data').upsert(payload, { onConflict: 'id' });
        if (error) throw error;
        showNotification(`Successfully uploaded ${payload.length} rows.`);
        loadAndListenData();
    } catch (err) {
        showNotification("Upload error: " + err.message, true);
    }
}

// ==========================================
// 2. SUBSTATION METERING (BALANCH) – unchanged, added loading flag
// ==========================================
const balanchBody = document.getElementById("balanch-body");
const balanchCols = ['main_import', 'main_export', 'check_import', 'check_export'];

function createBalanchInputRow() {
    return `<tr class="bg-indigo-50/60 sticky top-0 shadow-sm border-b-2 border-indigo-200 z-10">
        <td class="tight-cell-input"><input type="date" id="new-balanch-date" class="input-cell font-bold" value="${getTodayStr()}" required /><\/td>
        <td class="tight-cell-input"><input type="text" id="new-balanch-nep" class="input-cell" placeholder="YYYY.MM.DD" /><\/td>
        ${balanchCols.map(c => `<td class="tight-cell-input"><input type="number" id="new-balanch-${c}" step="any" class="input-cell font-bold ${c.includes('export') ? 'text-indigo-700' : 'text-emerald-700'}" /><\/td>`).join('')}
        <td class="tight-cell-input"><input type="text" id="new-balanch-rem" class="input-cell" placeholder="Notes..." /><\/td>
        <td class="tight-cell text-xs text-gray-500 truncate max-w-[100px]">${getUserName()}<\/td>
        <td class="tight-cell-input"><button id="add-balanch-btn" class="w-full bg-indigo-600 text-white font-bold py-1 px-3 rounded shadow hover:bg-indigo-700 transition">Add<\/button><\/td>
    <\/tr>`;
}

function createBalanchDisplayRow(d) {
    const canEdit = ['admin'].includes(userRole);
    const docDataString = JSON.stringify(d).replace(/'/g, "&apos;");
    return `<td class="tight-cell text-sm font-bold text-gray-900 border-r border-gray-200">${d.eng_date}<\/td>
        <td class="tight-cell text-sm font-medium text-gray-600 border-r border-gray-200">${d.nep_date || ''}<\/td>
        ${balanchCols.map((c, i) => `<td class="tight-cell text-sm font-bold border-r ${i < 2 ? 'text-indigo-800 bg-indigo-50/50 border-indigo-100' : 'text-emerald-800 bg-emerald-50/50 border-emerald-100'}">${formatNumber(d[c])}<\/td>`).join('')}
        <td class="tight-cell text-xs text-gray-600 truncate max-w-[200px] border-r border-gray-200" title="${d.remarks || ''}">${d.remarks || ''}<\/td>
        <td class="tight-cell text-xs text-gray-500 truncate max-w-[100px] border-r border-gray-200" title="${d.operator_email}">${(d.operator_email || '').split('@')[0]}<\/td>
        <td class="tight-cell text-sm font-medium space-x-2 whitespace-nowrap col-actions ${canEdit ? '' : 'hidden'}">
            <button class="edit-balanch-btn text-indigo-600 font-bold hover:underline" data-doc='${docDataString}'>Edit<\/button>
            ${userRole === 'admin' ? `<button class="delete-balanch-btn text-red-600 font-bold hover:underline" data-id="${d.eng_date}">Del<\/button>` : ''}
        <\/td>`;
}

function createBalanchEditRow(d) {
    return `<td class="tight-cell-input border-r border-gray-200"><input type="date" class="input-cell bg-gray-200 font-bold" value="${d.eng_date}" disabled /><\/td>
        <td class="tight-cell-input border-r border-gray-200"><input type="text" id="edit-balanch-nep" class="input-cell" value="${d.nep_date || ''}" /><\/td>
        ${balanchCols.map((c, i) => `<td class="tight-cell-input border-r ${i < 2 ? 'bg-indigo-50' : 'bg-emerald-50'}"><input type="number" id="edit-balanch-${c}" step="any" class="input-cell font-bold" value="${d[c] ?? ''}" /><\/td>`).join('')}
        <td class="tight-cell-input border-r border-gray-200"><input type="text" id="edit-balanch-rem" class="input-cell" value="${d.remarks || ''}" /><\/td>
        <td class="tight-cell text-xs text-gray-500 truncate max-w-[100px] border-r border-gray-200">${getUserName()}<\/td>
        <td class="tight-cell flex space-x-2 whitespace-nowrap col-actions">
            <button class="update-balanch-btn bg-emerald-600 text-white font-bold py-1 px-3 rounded hover:bg-emerald-700 transition" data-id="${d.eng_date}">Save<\/button>
            <button class="cancel-balanch-btn bg-gray-300 text-gray-700 font-bold py-1 px-2 rounded hover:bg-gray-400 transition">X<\/button>
        <\/td>`;
}

function renderBalanchTable() {
    if(!balanchBody) return;
    balanchBody.innerHTML = '';
    if (!['staff', 'normal'].includes(userRole)) {
        balanchBody.innerHTML = createBalanchInputRow();
    }
    allBalanchData.forEach(d => {
        const row = document.createElement('tr');
        row.id = `balanch-row-${d.eng_date}`;
        if (d.eng_date === editingBalanchId) {
            row.classList.add('bg-indigo-50');
        } else {
            row.classList.add('hover:bg-slate-50');
        }
        row.innerHTML = (d.eng_date === editingBalanchId) ? createBalanchEditRow(d) : createBalanchDisplayRow(d);
        balanchBody.appendChild(row);
    });
}

async function loadBalanchData() {
    if (isLoadingBalanch) return;
    isLoadingBalanch = true;
    let data = [], page = 0, more = true;
    const todayStr = getTodayStr(); // <-- FIX

    while (more) {
        try {
            const { data: chunk, error } = await supabase.from('balanch_readings')
                .select('*')
                .lte('eng_date', todayStr) // <-- FIX
                .order('eng_date', { ascending: false })
                .range(page * 1000, (page + 1) * 1000 - 1);
            if (error) throw error;
            if (chunk && chunk.length > 0) data = data.concat(chunk);
            if (!chunk || chunk.length < 1000) more = false; else page++;
        } catch(err) {
            console.warn("Failed to load Balanch data");
            break;
        }
    }
    allBalanchData = data;
    renderBalanchTable();
    isLoadingBalanch = false;
}

async function handleAddOrUpdateBalanch(docId, isUpdate = false) {
    if (!currentUser) return showNotification("You must be logged in.", true);
    const prefix = isUpdate ? 'edit-balanch-' : 'new-balanch-';
    const targetDate = isUpdate ? docId : document.getElementById('new-balanch-date')?.value;
    if (!targetDate) return showNotification("English date required.", true);

    const payload = {
        eng_date: targetDate,
        nep_date: document.getElementById(prefix + 'nep')?.value || null,
        operator_email: currentUser?.email || '',
        remarks: document.getElementById(prefix + 'rem')?.value || null,
        updated_at: new Date().toISOString()
    };
    balanchCols.forEach(c => payload[c] = parseFloat(document.getElementById(prefix + c)?.value) || null);

   try {
        const { error: bErr } = await supabase.from('balanch_readings').upsert(payload);
        if (bErr) throw bErr;

        // Prepare the update for the Daily Metering tab (plant_data table)
        const plantSync = { 
            id: targetDate, 
            updated_at: new Date().toISOString(),
            export_substation: payload.main_export, // Changed from export_plant to export_substation
            import_substation: payload.main_import, 
            nepali_date: payload.nep_date           
        };

        // EXECUTE SYNC: This sends the data to the Daily Metering master table
        await supabase.from('plant_data').upsert(plantSync, { onConflict: 'id' });

        showNotification(`✅ Substation saved & Daily Metering updated!`);
        editingBalanchId = null;
        loadBalanchData(); // Refreshes Substation Tab
        loadAndListenData(); // Refreshes Daily Metering Tab
    } catch (error) {
        showNotification("Error: " + error.message, true);
    }
}

balanchBody?.addEventListener('click', e => {
    if (e.target.id === 'add-balanch-btn') handleAddOrUpdateBalanch(null, false);
    if (e.target.classList.contains('edit-balanch-btn')) {
        editingBalanchId = JSON.parse(e.target.dataset.doc).eng_date;
        renderBalanchTable();
    }
    if (e.target.classList.contains('delete-balanch-btn')) {
        const docId = e.target.dataset.id;
        showConfirmation('Confirm Deletion', `Delete Substation data for ${docId}?`, async () => {
            await supabase.from('balanch_readings').delete().eq('eng_date', docId);
            showNotification("Deleted successfully.");
            loadBalanchData();
        });
    }
    if (e.target.classList.contains('update-balanch-btn')) handleAddOrUpdateBalanch(e.target.dataset.id, true);
    if (e.target.classList.contains('cancel-balanch-btn')) {
        editingBalanchId = null;
        renderBalanchTable();
    }
});

// ==========================================
// 2. SUBSTATION METERING (BALANCH) - UPLOAD (unchanged)
// ==========================================
document.getElementById('balanch-upload-btn')?.addEventListener('click', () => {
    document.getElementById('balanch-file-upload')?.click();
});

document.getElementById('balanch-file-upload')?.addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            // raw: true forces exact numeric values, preventing Javascript from changing Excel dates
            const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            showConfirmation('Confirm Upload', `Scan and upload Substation Data?`, () => processBalanchUpload(workbook));
        } catch (error) {
            showNotification("Error reading file.", true);
        }
    };
    reader.readAsArrayBuffer(file);
    document.getElementById('balanch-file-upload').value = '';
});

async function processBalanchUpload(workbook) {
    if (!currentUser) return showNotification("Authentication error.", true);

    let targetSheet = null;
    let dataStartRow = -1;

    // 1. SMART SCANNER: Find the correct sheet and the row where data starts
    for (const sheetName of workbook.SheetNames) {
        const jd = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
        for(let i=0; i < Math.min(10, jd.length); i++) {
            const rowStr = (jd[i] || []).map(c => String(c||'').toLowerCase()).join('');
            // Identify the sub-header row
            if(rowStr.includes('nepali') && rowStr.includes('english')) {
                targetSheet = jd;
                dataStartRow = i + 1; // Data begins exactly one row below the sub-headers
                break;
            }
        }
        if (targetSheet) break;
    }

    if(!targetSheet || dataStartRow === -1) {
        return showNotification("Could not find the 'Daily Meter Data' format in this file.", true);
    }

    const payloadMap = new Map(); 
    
    // 2. EXTRACT DATA USING STRICT TEMPLATE INDICES
    // Col 0: Nepali Date, Col 1: English Date, Col 2: Main Export, Col 3: Main Import, Col 4: Check Export, Col 5: Check Import, Col 6: Remarks
    for(let r = dataStartRow; r < targetSheet.length; r++) {
        const row = targetSheet[r];
        if (!row || row.length === 0) continue;

        // Skip any stray header rows if they bled through
        if (String(row[1]||'').toLowerCase().includes('english') || String(row[2]||'').toLowerCase().includes('export')) continue;

        const dv = row[1]; 
        if (dv == null || dv === '') continue;

        // Bulletproof Date Parser to prevent timezone shifts (Nepal +5:45 bug)
        let ds = null;
        if (typeof dv === 'number') {
            const ex = XLSX.SSF.parse_date_code(dv, { date1904: false });
            if (ex) ds = `${ex.y}-${String(ex.m).padStart(2, '0')}-${String(ex.d).padStart(2, '0')}`;
        } else if (typeof dv === 'string') {
            const cleanStr = dv.trim().replace(/\//g, '-');
            const dt = new Date(cleanStr);
            if (!isNaN(dt.getTime())) {
                // Use UTC to prevent shifting 2023-03-11 backward to 2023-03-10
                ds = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
            }
        }

        if (!ds || ds.includes("NaN")) continue;

        // Bulletproof Number Parser (strips commas, handles empty dashes)
        const safeNum = (val) => {
            if (val == null || val === '' || String(val).trim() === '-') return null;
            const num = parseFloat(String(val).replace(/,/g, '').trim());
            return isNaN(num) ? null : num;
        };

        const mExp = safeNum(row[2]);
        const mImp = safeNum(row[3]);
        const cExp = safeNum(row[4]);
        const cImp = safeNum(row[5]);
        const rem  = row[6] ? String(row[6]).trim() : null;

        // Only add row if it actually contains numerical data or remarks
        if (mExp !== null || mImp !== null || cExp !== null || cImp !== null || rem !== null) {
            payloadMap.set(ds, {
                eng_date: ds,
                nep_date: row[0] ? String(row[0]).trim() : null,
                main_export: mExp,
                main_import: mImp,
                check_export: cExp,
                check_import: cImp,
                remarks: rem,
                operator_email: currentUser?.email || '',
                updated_at: new Date().toISOString()
            });
        }
    }

    const payload = Array.from(payloadMap.values());
    if (payload.length === 0) return showNotification("No valid Substation records found to upload.", true);

    showNotification(`Uploading ${payload.length} rows to database...`);

    try {
        // 1. UPLOAD TO SUBSTATION (BALANCH) TABLE
        const { error: balanchErr } = await supabase.from('balanch_readings').upsert(payload, { onConflict: 'eng_date' });
        if (balanchErr) throw balanchErr;
        
        // 2. AUTOMATIC "SAFE SYNC" TO DAILY METERING FOR ALL UPLOADED DATES
        // Get all dates from the upload
        const targetDates = payload.map(p => p.eng_date);
        
        // Fetch existing daily data for all those dates to prevent erasing existing generator logs
        const { data: existingPlantData } = await supabase.from('plant_data').select('*').in('id', targetDates);
        
        // Merge the old data with the new substation data
        const plantSyncPayloads = payload.map(row => {
            const existing = existingPlantData?.find(p => p.id === row.eng_date) || {};
            return {
                ...existing, // Keep all existing data
                id: row.eng_date,
                export_plant: row.main_export,
                import_substation: row.main_import,
                operator_email: currentUser?.email || '',
                updated_at: new Date().toISOString()
            };
        });
        
        // Send the safely merged data to the daily metering table
        const { error: plantErr } = await supabase.from('plant_data').upsert(plantSyncPayloads, { onConflict: 'id' });
        if (plantErr) console.error("Bulk Sync to Daily Metering failed:", plantErr.message);

        showNotification(`✅ Success! ${payload.length} records updated & synced to Daily Metering.`);
        
        // Refresh both tables
        loadBalanchData();
        loadAndListenData();
    } catch (e) {
        showNotification("Upload Error: " + e.message, true);
    }
}



// =====================================
// 3. OUTAGES & LOSSES (unchanged, added loading flag)
// =====================================
const outagesBody = document.getElementById("outages-body");
const outageFields = [
    { key: 'nea_curtailed_energy', type: 'number' },
    { key: 'nea_trip_loss_time_min', type: 'number' },
    { key: 'no_of_trippings', type: 'number' },
    { key: 'loss_time_min', type: 'number' },
    { key: 'loss_time_u1_min', type: 'number' },
    { key: 'loss_time_u2_min', type: 'number' },
    { key: 'energy_loss_line_trip', type: 'number' },
    { key: 'energy_loss_other', type: 'number' },
    { key: 'total_energy_loss', type: 'number' },
    { key: 'reason', type: 'text' }
];

function createOutageInputRow() {
    let inputCells = outageFields.map(f => `<td class="tight-cell-input"><input type="${f.type}" id="new-out-${f.key}" step="any" class="input-cell ${f.key === 'total_energy_loss' ? 'font-bold text-red-700' : ''}" /><\/td>`).join('');
    return `<tr id="add-new-outage-row" class="bg-indigo-50/60 sticky top-0 shadow-sm border-b-2 border-indigo-200 z-10">
        <td class="tight-cell-input"><input type="date" id="new-outage-date" class="input-cell font-bold" value="${getTodayStr()}" required /><\/td>
        ${inputCells}
        <td class="tight-cell text-xs text-gray-500 truncate max-w-[100px]">${getUserName()}<\/td>
        <td class="tight-cell-input"><button id="add-outage-btn" class="w-full bg-indigo-600 text-white font-bold py-1 px-3 rounded shadow hover:bg-indigo-700 transition">Add<\/button><\/td>
    <\/tr>`;
}

function createOutageDisplayRow(d) {
    const canEdit = ['admin'].includes(userRole);
    const docDataString = JSON.stringify(d).replace(/'/g, "&apos;");
    let displayCells = outageFields.map(f => `<td class="tight-cell text-sm text-gray-600 ${f.key === 'reason' ? 'reason-col text-xs' : ''} ${f.key === 'total_energy_loss' ? 'font-bold text-red-800 bg-red-50/50 border-x border-red-100' : ''}">${f.key === 'reason' ? (d[f.key] || '') : formatNumber(d[f.key])}<\/td>`).join('');
    return `<td class="tight-cell text-sm font-bold text-gray-900">${d.id}<\/td>
        ${displayCells}
        <td class="tight-cell text-xs text-gray-500 truncate max-w-[100px]" title="${d.operator_email}">${(d.operator_email || '').split('@')[0]}<\/td>
        <td class="tight-cell text-sm font-medium space-x-2 whitespace-nowrap col-actions ${canEdit ? '' : 'hidden'}">
            <button class="edit-outage-btn text-indigo-600 font-bold hover:underline" data-doc='${docDataString}'>Edit<\/button>
            ${userRole === 'admin' ? `<button class="delete-outage-btn text-red-600 font-bold hover:underline" data-id="${d.id}">Del<\/button>` : ''}
        <\/td>`;
}

function createOutageEditRow(d) {
    let editCells = outageFields.map(f => `<td class="tight-cell-input"><input type="${f.type}" id="edit-out-${f.key}" step="any" class="input-cell" value="${d[f.key] ?? ''}" /><\/td>`).join('');
    return `<td class="tight-cell-input"><input type="date" class="input-cell bg-gray-200 font-bold" value="${d.id}" disabled /><\/td>
        ${editCells}
        <td class="tight-cell text-xs text-gray-500 truncate max-w-[100px]">${getUserName()}<\/td>
        <td class="tight-cell flex space-x-2 whitespace-nowrap col-actions">
            <button class="update-outage-btn bg-emerald-600 text-white font-bold py-1 px-3 rounded hover:bg-emerald-700 transition" data-id="${d.id}">Save<\/button>
            <button class="cancel-outage-btn bg-gray-300 text-gray-700 font-bold py-1 px-2 rounded hover:bg-gray-400 transition">X<\/button>
        <\/td>`;
}

function renderOutagesTable() {
    if(!outagesBody) return;
    outagesBody.innerHTML = '';
    if (!['staff', 'normal'].includes(userRole)) {
        outagesBody.innerHTML = createOutageInputRow();
    }
    allOutages.forEach(d => {
        const row = document.createElement('tr');
        row.id = `outage-row-${d.id}`;
        if (d.id === editingOutageId) {
            row.classList.add('bg-indigo-50');
        } else {
            row.classList.add('hover:bg-slate-50');
        }
        row.innerHTML = (d.id === editingOutageId) ? createOutageEditRow(d) : createOutageDisplayRow(d);
        outagesBody.appendChild(row);
    });
}

async function loadOutagesData() {
    if (isLoadingOutages) return;
    isLoadingOutages = true;
    let data = [], page = 0, more = true;
    const todayStr = getTodayStr(); // <-- FIX

    while (more) {
        try {
            const { data: chunk, error } = await supabase.from('outages')
                .select('*')
                .lte('id', todayStr) // <-- FIX
                .order('id', { ascending: false })
                .range(page * 1000, (page + 1) * 1000 - 1);
            if (error) throw error;
            if (chunk && chunk.length > 0) data = data.concat(chunk);
            if (!chunk || chunk.length < 1000) more = false; else page++;
        } catch(err) {
            console.warn("Failed to load outages");
            break;
        }
    }
    if (data) {
        allOutages = data;
        renderOutagesTable();
    }
    isLoadingOutages = false;
}

async function handleAddOrUpdateOutage(docId, isUpdate = false) {
    if (!currentUser) return showNotification("You must be logged in.", true);
    const prefix = isUpdate ? 'edit-out-' : 'new-out-';
    const dateVal = isUpdate ? docId : document.getElementById('new-outage-date')?.value;

    if (!dateVal) return showNotification("Date is required.", true);

    const data = {
        id: dateVal,
        operator_email: currentUser?.email || '',
        updated_at: new Date().toISOString()
    };

    outageFields.forEach(f => {
        const inputEl = document.getElementById(`${prefix}${f.key}`);
        if (f.type === 'number') data[f.key] = parseFloat(inputEl?.value) || null;
        else data[f.key] = inputEl?.value || null;
    });

    try {
        const { error } = await supabase.from('outages').upsert(data);
        if (error) throw error;
        showNotification(`Outage log ${isUpdate ? 'updated' : 'added'} successfully!`);
        editingOutageId = null;
        loadOutagesData();
    } catch (error) {
        showNotification("Error saving outage data: " + error.message, true);
    }
}

outagesBody?.addEventListener('click', async (e) => {
    if (e.target.id === 'add-outage-btn') handleAddOrUpdateOutage(null, false);
    else if (e.target.classList.contains('edit-outage-btn')) {
        editingOutageId = JSON.parse(e.target.dataset.doc).id;
        renderOutagesTable();
    } else if (e.target.classList.contains('update-outage-btn')) {
        handleAddOrUpdateOutage(e.target.dataset.id, true);
    } else if (e.target.classList.contains('cancel-outage-btn')) {
        editingOutageId = null;
        renderOutagesTable();
    } else if (e.target.classList.contains('delete-outage-btn')) {
        const docId = e.target.dataset.id;
        showConfirmation('Confirm Deletion', `Are you sure you want to delete the log for ${docId}?`, async () => {
            try {
                await supabase.from('outages').delete().eq('id', docId);
                showNotification("Outage log deleted.");
                loadOutagesData();
            } catch (error) {
                showNotification("Error deleting record: " + error.message, true);
            }
        });
    }
});

document.getElementById('outages-download-btn')?.addEventListener('click', () => {
    const hdrs = {
        id: 'Date',
        nea_curtailed_energy: 'NEA Curtailed',
        nea_trip_loss_time_min: 'NEA Trip Loss (m)',
        no_of_trippings: 'Trippings',
        loss_time_min: 'Total Loss (m)',
        loss_time_u1_min: 'U1 Loss (m)',
        loss_time_u2_min: 'U2 Loss (m)',
        energy_loss_line_trip: 'Line Loss (MWh)',
        energy_loss_other: 'Other Loss (MWh)',
        total_energy_loss: 'Total MWh Loss',
        reason: 'Reason'
    };

    const exportData = allOutages.map(d => {
        let r = {};
        for (let k in hdrs) r[hdrs[k]] = d[k] ?? null;
        return r;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Outages");
    XLSX.writeFile(workbook, "Outages_MakariGad.xlsx");
});

document.getElementById('outages-upload-btn')?.addEventListener('click', () => {
    document.getElementById('outages-file-upload')?.click();
});

document.getElementById('outages-file-upload')?.addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            // FIX: Removed 'cellDates: true' to stop javascript from shifting timezones backwards
            const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            showConfirmation('Confirm Upload', `Upload Outages file?`, () => processAndUploadOutages(workbook));
        } catch (err) {
            showNotification("File error", true);
        }
    };
    reader.readAsArrayBuffer(file);
    document.getElementById('outages-file-upload').value = '';
});

async function processAndUploadOutages(workbook) {
    let targetSheet = null;
    let headerRowIndex = -1;

    for (const sheetName of workbook.SheetNames) {
        const jd = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
        for (let i = 0; i < Math.min(10, jd.length); i++) {
            const rowStr = (jd[i] || []).map(c => String(c||'').toLowerCase()).join('');
            if (rowStr.includes('curtailed') || rowStr.includes('tripping') || rowStr.includes('loss time')) {
                targetSheet = jd;
                headerRowIndex = i;
                break;
            }
        }
        if (targetSheet) break;
    }

    if (!targetSheet) return showNotification("Could not find the Outages sheet.", true);

    const headers = targetSheet[headerRowIndex].map(h => String(h || '').toLowerCase().trim());
    
    // FIX: Updated to match your exact Excel headers like "Unit I" and "Unit II"
    const colMap = {
        date: headers.findIndex(h => h.includes('date')),
        nea_curtailed_energy: headers.findIndex(h => h.includes('curtailed')),
        nea_trip_loss_time_min: headers.findIndex(h => h.includes('nea trip')),
        no_of_trippings: headers.findIndex(h => h.includes('trippings') || h.includes('no of tripping')),
        loss_time_min: headers.findIndex(h => h.includes('faults') ),
        loss_time_u1_min: headers.findIndex(h => h.includes('unit i ') || h.includes('unit 1') || h.includes('u1')),
        loss_time_u2_min: headers.findIndex(h => h.includes('unit ii') || h.includes('unit 2') || h.includes('u2')),
        energy_loss_line_trip: headers.findIndex(h => h.includes('line tripping') || h.includes('line trip')),
        energy_loss_other: headers.findIndex(h => h.includes('other reason') || h.includes('other')),
        total_energy_loss: headers.findIndex(h => h.includes('total energy')),
        reason: headers.findIndex(h => h.includes('reason for'))
    };

    if (colMap.date === -1) colMap.date = 0;

    const payloadMap = new Map(); 

    for (let r = headerRowIndex + 1; r < targetSheet.length; r++) {
        const row = targetSheet[r];
        if (!row || row.length === 0) continue;

        const dv = row[colMap.date];
        if (!dv) continue;

        // FIX: Bulletproof Date Parser that strips away Timezone shifts
        let ds = null;
        if (typeof dv === 'number') {
            const ex = XLSX.SSF.parse_date_code(dv, { date1904: false });
            if (ex) ds = `${ex.y}-${String(ex.m).padStart(2, '0')}-${String(ex.d).padStart(2, '0')}`;
        } else if (dv instanceof Date) {
            // Extracts exact UTC digits to prevent backward shifting
            ds = `${dv.getUTCFullYear()}-${String(dv.getUTCMonth() + 1).padStart(2, '0')}-${String(dv.getUTCDate()).padStart(2, '0')}`;
        } else if (typeof dv === 'string') {
            const cleanStr = dv.trim().replace(/\//g, '-');
            const dt = new Date(cleanStr);
            if (!isNaN(dt.getTime())) {
                const offsetDt = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
                ds = offsetDt.toISOString().split('T')[0];
            }
        }

        if (!ds || ds.includes("NaN")) continue;

        const dd = {
            id: ds,
            operator_email: currentUser?.email || '',
            updated_at: new Date().toISOString()
        };

        const parseNum = (idx) => {
            if (idx === -1 || row[idx] == null || String(row[idx]).trim() === '' || String(row[idx]).trim() === '-') return null;
            const cleanVal = String(row[idx]).replace(/,/g, '').trim();
            const num = parseFloat(cleanVal);
            return isNaN(num) ? null : num;
        };

        dd.nea_curtailed_energy = parseNum(colMap.nea_curtailed_energy);
        dd.nea_trip_loss_time_min = parseNum(colMap.nea_trip_loss_time_min);
        dd.no_of_trippings = parseNum(colMap.no_of_trippings);
        dd.loss_time_u1_min = parseNum(colMap.loss_time_u1_min);
        dd.loss_time_u2_min = parseNum(colMap.loss_time_u2_min);
        dd.loss_time_min = parseNum(colMap.loss_time_min); 
        dd.energy_loss_line_trip = parseNum(colMap.energy_loss_line_trip);
        dd.energy_loss_other = parseNum(colMap.energy_loss_other);
        dd.total_energy_loss = parseNum(colMap.total_energy_loss);
        dd.reason = colMap.reason !== -1 && row[colMap.reason] ? String(row[colMap.reason]).trim() : null;

        // Prevent pushing empty records
        if (dd.nea_curtailed_energy !== null || dd.nea_trip_loss_time_min !== null || dd.reason !== null || dd.loss_time_min !== null || dd.loss_time_u1_min !== null || dd.loss_time_u2_min !== null || dd.energy_loss_line_trip !== null || dd.no_of_trippings !== null) {
            payloadMap.set(ds, dd); 
        }
    }

    const payload = Array.from(payloadMap.values());

    if(payload.length === 0) return showNotification("No valid outage records found.", true);

    try {
        const { error } = await supabase.from('outages').upsert(payload);
        if(error) throw error;
        showNotification(`Outages uploaded: ${payload.length} rows`);
        loadOutagesData();
    } catch (e) {
        showNotification("Upload Error: " + e.message, true);
    }
}

// =====================================
// 4. CONTRACT ENERGY (MCE) – unchanged, added loading flag
// =====================================
const mceBody = document.getElementById('mce-body');
const mceFields = [
    { key: 'week1_ad' }, { key: 'week2_ad' }, { key: 'week3_ad' },
    { key: 'week4_ad' }, { key: 'week5_ad' }, { key: 'total_ad' },
    { key: 'contract_energy' }, { key: 'no_of_days' }
];

function createMCEInputRow() {
    if (['staff', 'normal'].includes(userRole)) return '';

    const cy = new Date().getFullYear() + 57;
    const ys = [-2, -1, 0, 1, 2].map(i => `<option value="${cy + i}">${cy + i}</option>`).join('');
    const ms = nepaliMonths.map(m => `<option value="${m}">${m}</option>`).join('');

    // FIX 1: Wrap each input in a <td> tag and add highlights for totals
    const inputs = mceFields.map(f => {
        const isHighlight = f.key.includes('total') || f.key.includes('contract');
        const extraClass = isHighlight ? 'bg-indigo-50 font-bold text-indigo-700' : '';
        return `<td><input type="number" id="new-${f.key}" step="any" class="input-cell ${extraClass}" /></td>`;
    }).join('');

    // FIX 2: Change bg-indigo-50/60 to a solid bg-indigo-50 to stop scroll-bleed
    return `<tr class="bg-indigo-50 sticky top-0 z-20 shadow-sm border-b-2 border-indigo-200">
        <td><select id="new-mce-year" class="input-cell font-bold text-indigo-700 bg-white">${ys}</select></td>
        <td><select id="new-mce-month" class="input-cell font-bold text-indigo-700 bg-white">${ms}</select></td>
        ${inputs}
        <td class="truncate-text text-xs text-slate-500 text-center">${getUserName()}</td>
        <td class="col-actions">
            <button id="add-mce-btn" class="w-full bg-indigo-600 text-white font-bold py-1 px-3 rounded shadow hover:bg-indigo-700 transition">Save</button>
        </td>
    </tr>`;
}

function createMCEDisplayRow(d) {
    const canEdit = ['admin'].includes(userRole);
    const cells = mceFields.map(f => `<td class="text-slate-600 ${f.key.includes('total') || f.key.includes('contract') ? 'font-bold text-indigo-800 bg-indigo-50/50' : ''}">${formatNumber(d[f.key], 2)}<\/td>`).join('');
    return `<td class="font-bold text-slate-900">${d.year}<\/td>
        <td class="font-bold text-slate-900">${d.month}<\/td>
        ${cells}
        <td class="truncate-text text-xs text-slate-500">${d.operator_email}<\/td>
        <td class="col-actions space-x-2 whitespace-nowrap ${canEdit ? '' : 'hidden'}">
            <button class="edit-mce-btn text-indigo-600 font-bold hover:underline" data-doc='${JSON.stringify(d).replace(/'/g, "&apos;")}'>Edit<\/button>
            ${userRole === 'admin' ? `<button class="delete-mce-btn text-red-600 font-bold hover:underline" data-id="${d.id}">Del<\/button>` : ''}
        <\/td>`;
}

function createMCEEditRow(d) {
    // FIX: Wrap edit inputs in <td> tags as well
    const inputs = mceFields.map(f => {
        const isHighlight = f.key.includes('total') || f.key.includes('contract');
        const extraClass = isHighlight ? 'bg-indigo-50 font-bold text-indigo-700' : '';
        return `<td><input type="number" id="edit-${f.key}" class="input-cell ${extraClass}" value="${d[f.key] ?? ''}"></td>`;
    }).join('');
   
    return `<tr class="bg-indigo-50">
        <td><input class="input-cell bg-slate-200 font-bold text-slate-500" value="${d.year}" disabled></td>
        <td><input class="input-cell bg-slate-200 font-bold text-slate-500" value="${d.month}" disabled></td>
        ${inputs}
        <td class="truncate-text text-xs text-slate-500 text-center">${getUserName()}</td>
        <td class="flex space-x-2 whitespace-nowrap">
            <button class="update-mce-btn bg-emerald-600 text-white font-bold py-1 px-2 rounded hover:bg-emerald-700 shadow-sm" data-id="${d.id}">Save</button>
            <button class="cancel-mce-btn bg-slate-300 text-slate-700 font-bold py-1 px-2 rounded hover:bg-slate-400 shadow-sm">X</button>
        </td>
    </tr>`;
}

function renderMCETable() {
    if(!mceBody) return;
    mceBody.innerHTML = '';
    if (!['staff', 'normal'].includes(userRole)) {
        mceBody.innerHTML = createMCEInputRow();
    }

    const getMonthIdx = (m) => {
        if (!m) return -1;
        const map = { baisakh: 0, jestha: 1, ashadh: 2, ashar: 2, shrawan: 3, sawan: 3, bhadra: 4, ashoj: 5, asoj: 5, kartik: 6, mangsir: 7, mangshir: 7, poush: 8, magh: 9, falgun: 10, fagun: 10, chaitra: 11, chait: 11 };
        return map[m.toLowerCase().trim()] ?? -1;
    };

    allMCE.sort((a, b) => Number(b.year) - Number(a.year) || getMonthIdx(b.month) - getMonthIdx(a.month)).forEach(d => {
        const row = document.createElement('tr');
        row.innerHTML = d.id === editingMCEId ? createMCEEditRow(d) : createMCEDisplayRow(d);
        if (d.id === editingMCEId) {
            row.classList.add('bg-indigo-50');
        } else {
            row.classList.add('hover:bg-slate-50');
        }
        mceBody.appendChild(row);
    });
}

async function loadMCEData() {
    if (isLoadingMCE) return;
    isLoadingMCE = true;
    try {
        const { data } = await supabase.from('contract_energy').select('*');
        if (data) {
            allMCE = data;
            renderMCETable();
        }
    } catch(err) {
        console.warn("Failed to load MCE Data");
    }
    isLoadingMCE = false;
}

async function handleAddOrUpdateMCE(docId, isUpd = false) {
    const pre = isUpd ? 'edit-' : 'new-';
    let y, m;

    if (isUpd) {
        [y, m] = docId.split('_');
    } else {
        y = document.getElementById('new-mce-year')?.value;
        m = document.getElementById('new-mce-month')?.value;
    }

    const data = {
        id: `${y}_${m}`,
        year: parseInt(y),
        month: m,
        operator_email: currentUser?.email || ''
    };

    mceFields.forEach(f => {
        data[f.key] = parseFloat(document.getElementById(`${pre}${f.key}`)?.value) || null;
    });

    try {
        await supabase.from('contract_energy').upsert(data);
        showNotification("Saved!");
        editingMCEId = null;
        loadMCEData();
    } catch (e) {
        showNotification("Error", true);
    }
}

mceBody?.addEventListener('click', (e) => {
    if (e.target.id === 'add-mce-btn') {
        handleAddOrUpdateMCE(null);
    } else if (e.target.classList.contains('edit-mce-btn')) {
        editingMCEId = JSON.parse(e.target.dataset.doc).id;
        renderMCETable();
    } else if (e.target.classList.contains('update-mce-btn')) {
        handleAddOrUpdateMCE(e.target.dataset.id, true);
    } else if (e.target.classList.contains('cancel-mce-btn')) {
        editingMCEId = null;
        renderMCETable();
    } else if (e.target.classList.contains('delete-mce-btn')) {
        showConfirmation('Confirm', `Delete MCE?`, async () => {
            await supabase.from('contract_energy').delete().eq('id', e.target.dataset.id);
            showNotification("Deleted");
            loadMCEData();
        });
    }
});

document.getElementById('mce-download-btn')?.addEventListener('click', () => {
    const exportData = allMCE.map(d => ({
        'Year': d.year,
        'Month': d.month,
        'Week1 AD': d.week1_ad,
        'Week2 AD': d.week2_ad,
        'Week3 AD': d.week3_ad,
        'Week4 AD': d.week4_ad,
        'Week5 AD': d.week5_ad,
        'Total AD': d.total_ad,
        'Contract Energy': d.contract_energy,
        'No. Days': d.no_of_days,
        'Operator': d.operator_email
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "MCE");
    XLSX.writeFile(workbook, "ContractEnergy.xlsx");
});

document.getElementById('mce-upload-btn')?.addEventListener('click', () => document.getElementById('mce-file-upload')?.click());

document.getElementById('mce-file-upload')?.addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
            const jd = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            if (jd.length === 0) return;
            showConfirmation('Confirm', `Upload ${jd.length} rows?`, () => processAndUploadMCE(jd));
        } catch (err) {
            showNotification("File error", true);
        }
    };
    reader.readAsArrayBuffer(file);
    ev.target.value = '';
});

async function processAndUploadMCE(jd) {
    const payload = [];

    function nKey(s) {
        return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    const hKeys = Object.keys(jd[0] || {});
    const nMap = {};
    hKeys.forEach(k => nMap[nKey(k)] = k);

    function fKey(arr) {
        for (let c of arr) if (nMap[nKey(c)]) return nMap[nKey(c)];
        for (let k of hKeys) for (let c of arr) if (nKey(k).includes(nKey(c))) return k;
        return null;
    }

    const yk = fKey(['year', 'bsyear', 'bs']);
    const mk = fKey(['month', 'monthname']);

    for (let row of jd) {
        let y = row[yk], m = row[mk];
        if (!y && !m) continue;

        let dt = {
            id: `${y}_${m}`,
            year: parseInt(y),
            month: String(m).charAt(0).toUpperCase() + String(m).slice(1).toLowerCase(),
            operator_email: currentUser?.email || '',
            updated_at: new Date().toISOString()
        };

        mceFields.forEach(f => {
            let rk = fKey([f.key, f.key.replace('_', ' ')]);
            dt[f.key] = rk ? parseFloat(row[rk]) || null : null;
        });
        payload.push(dt);
    }

    if (!payload.length) return showNotification("No valid data found to upload.", true);

    try {
        const { error } = await supabase.from('contract_energy').upsert(payload);
        if (error) throw error;
        
        showNotification("Contract Energy data uploaded successfully!");
        loadMCEData();
    } catch (e) {
        showNotification("Upload Error: " + e.message, true);
        console.error(e);
    }
}

// =====================================
// 5. TRENDS (unchanged, but we will add timestamp pre‑parsing and downsampling)
// =====================================
const trendChartOptionsContainer = document.getElementById('trend-chart-options');
const trendSeries = [
    { key: 'waterlevel_cm', name: 'Water Level (cm)' },
    { key: 'pressure_mwc', name: 'Pressure (mWC)' },
    { key: 'active_power_kw', name: 'Active Power (kW)' },
    { key: 'voltage_kv', name: 'Voltage (kV)' },
    { key: 'reactive_power_kvar', name: 'Reactive Power (kVar)' },
    { key: 'u1_spear_pct', name: 'U1 Spear (%)' },
    { key: 'u1_active_power_kw', name: 'U1 Power (kW)' },
    { key: 'u2_spear_pct', name: 'U2 Spear (%)' },
    { key: 'u2_active_power_kw', name: 'U2 Power (kW)' }
];

if(trendChartOptionsContainer) {
    trendSeries.forEach((f, idx) => {
        const div = document.createElement('label');
        div.className = 'flex items-center space-x-2 text-[11px] font-bold text-slate-700 bg-white border border-slate-200 px-3 py-1.5 rounded-full cursor-pointer hover:border-indigo-400 transition';
        // Default visibility: Active Power and Energy (Energy is automatically included in updateTrendChart)
        const isDefaultChecked = f.key === 'active_power_kw';
        div.innerHTML = `<input type="checkbox" value="${f.key}" class="trend-checkbox w-4 h-4 accent-indigo-600" ${isDefaultChecked ? 'checked' : ''}> <span>${f.name}</span>`;
        trendChartOptionsContainer.appendChild(div);
    });

    trendChartOptionsContainer.addEventListener('change', (e) => {
        if (e.target.classList.contains('trend-checkbox')) {
            document.getElementById('view-trend-btn')?.click();
        }
    });
}

function syncDatesFromNepaliSelection() {
    const y = document.getElementById('trend-nepali-year')?.value;
    const mName = document.getElementById('trend-nepali-month')?.value;
    if (!y || !mName || allData.length === 0) return;

    const mIndex = nepaliMonths.indexOf(mName) + 1;
    const searchPrefix = `${y}.${String(mIndex).padStart(2, '0')}`;
    
    // Grabs from allData (which strictly comes from the Generation Summary / plant_data table)
    const matchingRecords = allData.filter(d => d.nepali_date && d.nepali_date.startsWith(searchPrefix));

    if (matchingRecords.length > 0) {
        matchingRecords.sort((a,b) => a.id.localeCompare(b.id));
        if(document.getElementById('trend-start-date')) document.getElementById('trend-start-date').value = matchingRecords[0].id;
        if(document.getElementById('trend-end-date')) document.getElementById('trend-end-date').value = matchingRecords[matchingRecords.length - 1].id;
    } else {
        if(document.getElementById('trend-start-date')) document.getElementById('trend-start-date').value = '';
        if(document.getElementById('trend-end-date')) document.getElementById('trend-end-date').value = '';
    }
}

document.getElementById('trend-nepali-year')?.addEventListener('change', syncDatesFromNepaliSelection);
document.getElementById('trend-nepali-month')?.addEventListener('change', syncDatesFromNepaliSelection);

document.getElementById('view-trend-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('view-trend-btn');
    btn.textContent = 'Loading...';
    btn.disabled = true;

    let s = document.getElementById('trend-start-date')?.value;
    let e = document.getElementById('trend-end-date')?.value;

    if (!s || !e) {
        btn.textContent = 'Render Chart';
        btn.disabled = false;
        return showNotification("Set dates first.", true);
    }

    // SCADA fetches strictly from Start Date to End Date
    const endDateObject = new Date(e);
    endDateObject.setHours(23, 59, 59);
    const startStr = new Date(s).toISOString();
    const endStr = endDateObject.toISOString();

    // Energy fetches up to End Date + 1 Day to calculate cumulative differences
    const ePlus1Obj = new Date(e);
    ePlus1Obj.setDate(ePlus1Obj.getDate() + 1);
    const ePlus1 = ePlus1Obj.toISOString().split('T')[0];
    const dData = allData.filter(d => d.id >= s && d.id <= ePlus1); 

    let hData = [], hPage = 0, hMore = true;
    while (hMore) {
        try {
            const { data, error } = await supabase.from('historical_data')
                .select('*')
                .gte('timestamp', startStr)
                .lte('timestamp', endStr)
                .order('timestamp')
                .range(hPage * 1000, (hPage + 1) * 1000 - 1);

            if (error) throw error;
            if (data && data.length > 0) {
                // 🔥 OPTIMIZATION: Pre‑parse timestamps as numbers
                const withMs = data.map(d => ({ ...d, timestamp_ms: new Date(d.timestamp).getTime() }));
                hData = hData.concat(withMs);
            }
            if (!data || data.length < 1000) hMore = false; else hPage++;
        } catch(err) {
            showNotification("Error fetching trend data.", true);
            break;
        }
    }

    updateTrendChart(dData, hData);
    btn.textContent = 'Render Chart';
    btn.disabled = false;
});

// 🔥 OPTIMIZATION: Downsample and use pre‑parsed timestamps
function updateTrendChart(dailyData, historicalData) {
    const dailyDispatchData = [];

    dailyData.sort((a,b) => a.id.localeCompare(b.id));

    for (let i = 0; i < dailyData.length - 1; i++) {
        const currentDay = dailyData[i];
        const nextDay = dailyData[i + 1];

        if (nextDay.export_substation != null && currentDay.export_substation != null) {
            const dispatch = nextDay.export_substation - currentDay.export_substation;
            if (dispatch >= 0) {
                dailyDispatchData.push({
                    // CRITICAL FIX: Plot the energy generated on the NEXT day (e.g. Falgun 1's generated energy shows on Falgun 2)
                    x: new Date(`${nextDay.id}T12:00:00`),
                    y: dispatch
                });
            }
        }
    }

    const datasets = [{
        label: 'Daily Energy (MWh)',
        data: dailyDispatchData,
        backgroundColor: 'rgba(79, 70, 229, 0.6)',
        borderColor: 'rgba(79, 70, 229, 1)',
        borderWidth: 1,
        type: 'bar',
        yAxisID: 'y-energy',
        order: 2
    }];

    const colors = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899'];

    const scales = {
        x: {
            type: 'time',
            time: { unit: 'day' },
            grid: { display: false }
        },
        'y-energy': {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Energy (MWh)' }
        }
    };

    // 🔥 Downsample historical data if too many points
    let processedData = historicalData;
    const maxPoints = 2000;
    if (processedData.length > maxPoints) {
        const step = Math.ceil(processedData.length / maxPoints);
        processedData = processedData.filter((_, i) => i % step === 0);
        console.log(`Downsampled historical data from ${historicalData.length} to ${processedData.length} points`);
    }

    Array.from(document.querySelectorAll('.trend-checkbox:checked')).forEach((chk, i) => {
        const key = chk.value;
        const fInfo = trendSeries.find(s => s.key === key);

        if (!fInfo || processedData.length === 0) return;

        datasets.push({
            label: fInfo.name,
            data: processedData.map(d => ({ x: d.timestamp_ms, y: d[key] ?? null })).filter(p => p.y !== null),
            borderColor: colors[i % colors.length],
            backgroundColor: colors[i % colors.length],
            borderWidth: 2,
            tension: 0.2,
            pointRadius: 0,
            yAxisID: `y-${key}`,
            type: 'line',
            order: 1
        });

        scales[`y-${key}`] = {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: true, text: fInfo.name, color: colors[i % colors.length] }
        };
    });

    if (trendChartInstance) {
        trendChartInstance.data.datasets = datasets;
        trendChartInstance.options.scales = scales;
        trendChartInstance.update();
    } else {
        const canvas = document.getElementById('trend-chart');
        if(canvas) {
            trendChartInstance = new Chart(canvas.getContext('2d'), {
                data: { datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales
                }
            });
        }
    }
}

document.getElementById('download-trend-btn')?.addEventListener('click', () => {
    const canvas = document.getElementById('daily-trend-chart');
    if (!canvas) return;
    const nc = document.createElement('canvas');
    nc.width = canvas.width;
    nc.height = canvas.height;
    const ctx = nc.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, nc.width, nc.height);
    ctx.drawImage(canvas, 0, 0);
    const l = document.createElement('a');
    l.download = `Trend_${new Date().toISOString().slice(0, 10)}.jpg`;
    l.href = nc.toDataURL('image/jpeg', 1.0);
    l.click();
});

// =====================================
// 6. HISTORICAL SCADA with pagination
// =====================================
const historicalYearSelect = document.getElementById('historical-year');
const historicalMonthSelect = document.getElementById('historical-month');
const historicalViewBtn = document.getElementById('historical-view-btn');
const historicalStatus = document.getElementById('historical-status');
const historicalThead = document.getElementById('historical-thead');
const historicalTbody = document.getElementById('historical-tbody');
const historicalDownloadBtn = document.getElementById('historical-download-btn');

// 🔥 Pagination variables
let fullHistoricalData = [];
let currentPage = 1;
const rowsPerPage = 100;

function renderHistoricalPage() {
    // Show all records (no pagination)
    const pageData = fullHistoricalData;
    const keys = ['waterlevel_cm', 'pressure_mwc', 'active_power_kw', 'voltage_kv', 'reactive_power_kvar', 'u1_spear_pct', 'u1_active_power_kw', 'u2_spear_pct', 'u2_active_power_kw'];

    // Build header (remove stray dot)
    let headerHtml = `<th class="tight-cell text-left font-bold text-gray-600 uppercase border-r border-gray-200">Date</th><th class="tight-cell text-left font-bold text-gray-600 uppercase border-r border-gray-200">Time</th>`;
    keys.forEach(h => headerHtml += `<th class="tight-cell text-left font-bold text-gray-600 uppercase">${h}</th>`);
    headerHtml += `</tr>`;
    if (historicalThead) historicalThead.innerHTML = headerHtml;

    // Build rows
    const rows = [];
    pageData.forEach(d => {
        let dateStr = '', timeStr = '';
        if (d.timestamp) {
            const dateObj = new Date(d.timestamp);
            dateStr = dateObj.toLocaleDateString('en-GB');
            timeStr = dateObj.toLocaleTimeString('en-GB', { hour12: false });
        }
        let rowHtml = `<td class="tight-cell text-gray-900 font-bold border-r border-gray-200">${dateStr}</td><td class="tight-cell text-gray-500 border-r border-gray-200">${timeStr}</td>`;
        keys.forEach(k => rowHtml += `<td class="tight-cell text-gray-600">${d[k] ?? ''}</td>`);
        rowHtml += `</tr>`;
        rows.push(rowHtml);
    });

    if (historicalTbody) historicalTbody.innerHTML = rows.join('');

    // No pagination controls are used, so we skip updating any UI elements
}

function populateHistoricalYearsFromAllData() {
    if(!historicalYearSelect) return;
    const yearsSet = new Set();
    allData.forEach(d => {
        if (d.id) yearsSet.add(parseInt(d.id.split('-')[0], 10));
    });
    const currentYear = new Date().getFullYear();
    for (let y = 2023; y <= currentYear; y++) {
        yearsSet.add(y);
    }
    historicalYearSelect.innerHTML = '';
    Array.from(yearsSet).sort((a, b) => b - a).forEach(y => historicalYearSelect.add(new Option(y, y)));
}

historicalViewBtn?.addEventListener('click', async () => {
    const year = historicalYearSelect?.value;
    const month = historicalMonthSelect?.value;

    if (!year || !month) {
        showNotification("Please select year and month.", true);
        return;
    }

    if(historicalStatus) historicalStatus.textContent = 'Loading historical data...';
    if(historicalThead) historicalThead.innerHTML = '';
    if(historicalTbody) historicalTbody.innerHTML = '';
    historicalDownloadBtn?.classList.add('hidden');

    try {
        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
        const startDate = `${year}-${month.padStart(2, '0')}-01T00:00:00`;
        const endDate = `${year}-${month.padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59`;

        let data = [], page = 0, more = true;
        while (more) {
            const { data: chunk, error } = await supabase.from('historical_data')
                .select('*')
                .gte('timestamp', startDate)
                .lte('timestamp', endDate)
                .order('timestamp')
                .range(page * 1000, (page + 1) * 1000 - 1);

            if (error) throw error;
            if (chunk && chunk.length > 0) data = data.concat(chunk);
            if (!chunk || chunk.length < 1000) more = false; else page++;
        }

        if (!data || data.length === 0) {
            if(historicalStatus) historicalStatus.textContent = 'No historical data found for that month.';
            return;
        }

        // Store the full dataset for pagination
        fullHistoricalData = data;
        currentPage = 1;
        renderHistoricalPage();
        if(historicalStatus) historicalStatus.textContent = `Loaded ${fullHistoricalData.length} records.`;
        historicalDownloadBtn?.classList.remove('hidden');
    } catch (error) {
    console.error("Supabase query failed:", error);
    if(historicalStatus) historicalStatus.textContent = `Error: ${error.message || error}`;
    showNotification(`Error: ${error.message || 'Failed to fetch data'}`, true);
}
});

// Attach pagination event listeners after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const prevBtn = document.getElementById('historical-prev');
    const nextBtn = document.getElementById('historical-next');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderHistoricalPage();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(fullHistoricalData.length / rowsPerPage);
            if (currentPage < totalPages) {
                currentPage++;
                renderHistoricalPage();
            }
        });
    }
});

historicalDownloadBtn?.addEventListener('click', () => {
    if (!historicalTbody || historicalTbody.rows.length === 0) return showNotification("No data available to download.", true);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.table_to_sheet(document.getElementById('historical-table'));
    XLSX.utils.book_append_sheet(wb, ws, "HistoricalData");
    const year = historicalYearSelect?.value;
    const monthName = historicalMonthSelect?.options[historicalMonthSelect.selectedIndex].text;
    XLSX.writeFile(wb, `Historical_Data_${monthName}_${year}.xlsx`);
});

const historicalUploadBtn = document.getElementById('historical-upload-btn');
const historicalFileUpload = document.getElementById('historical-file-upload');

if (historicalUploadBtn && historicalFileUpload) {
    historicalUploadBtn.addEventListener('click', () => historicalFileUpload.click());
    historicalFileUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            const lines = text.split(/\r?\n/);
            if (lines.length < 2) return showNotification("File is empty or missing headers", true);

            const headers = lines[0].split(';').map(h => h.trim().toLowerCase());
            const mapKeys = {
                'waterlevel feedback 1': 'waterlevel_cm',
                'penstock pressure': 'pressure_mwc',
                'active power [kw]': 'active_power_kw',
                'voltage grid': 'voltage_kv',
                'reactive power grid': 'reactive_power_kvar',
                'u1 spear opening': 'u1_spear_pct',
                'u1 active power generator': 'u1_active_power_kw',
                'u2 spear opening': 'u2_spear_pct',
                'u2 active power generator': 'u2_active_power_kw'
            };

            const colMap = {};
            headers.forEach((h, i) => {
                for (const [key, val] of Object.entries(mapKeys)) {
                    if (h.includes(key)) {
                        colMap[i] = val;
                        break;
                    }
                }
            });

            const dateIdx = headers.findIndex(h => h === 'date');
            const timeIdx = headers.findIndex(h => h === 'time');
            if (dateIdx === -1 || timeIdx === -1) return showNotification("Could not find 'Date' or 'Time' columns in CSV", true);

            const parsedDataMap = new Map();
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const cols = line.split(';');
                if (cols[dateIdx] && cols[timeIdx]) {
                    let dateStr = cols[dateIdx].trim().replace(/[\/\-]/g, '.');
                    const dateParts = dateStr.split('.');
                    const timeParts = cols[timeIdx].split(':');
                    if (dateParts.length === 3 && timeParts.length >= 2) {
                        let p1 = parseInt(dateParts[0], 10);
                        let p2 = parseInt(dateParts[1], 10);
                        let p3 = parseInt(dateParts[2], 10);
                        let day, month, year;
                        if (p3 > 1000) { year = p3; if (p1 > 12) { day = p1; month = p2; } else if (p2 > 12) { day = p2; month = p1; } else { day = p1; month = p2; } }
                        else if (p1 > 1000) { year = p1; if (p2 > 12) { day = p2; month = p3; } else if (p3 > 12) { day = p3; month = p2; } else { month = p2; day = p3; } }
                        else { year = p3 + 2000; day = p1; month = p2; }
                        if (year < 2000) year += 2000;
                        const hour = parseInt(timeParts[0], 10) || 0;
                        const minute = parseInt(timeParts[1], 10) || 0;
                        const dateObj = new Date(year, month - 1, day, hour, minute);
                        const row = { timestamp: dateObj.toISOString() };
                        for (const [idx, key] of Object.entries(colMap)) {
                            let val = cols[idx];
                            if (val) {
                                val = val.replace(',', '.');
                                const num = parseFloat(val);
                                if (!isNaN(num)) row[key] = num;
                            }
                        }
                        const docId = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}_${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
                        row.id = docId;
                        parsedDataMap.set(docId, row);
                    }
                }
            }

            const parsedData = Array.from(parsedDataMap.values());
            if (parsedData.length === 0) return showNotification("No valid data rows found", true);

            showConfirmation('Confirm Upload', `Found ${parsedData.length} records to upload. Proceed?`, async () => {
                let total = 0;
                try {
                    for (let i = 0; i < parsedData.length; i += 500) {
                        const chunk = parsedData.slice(i, i + 500);
                        const { error } = await supabase.from('historical_data').upsert(chunk);
                        if (error) throw error;
                        total += chunk.length;
                    }
                    showNotification(`Successfully uploaded ${total} records.`);
                } catch (err) {
                    showNotification("Error uploading: " + err.message, true);
                }
            });
        };
        reader.readAsText(file);
        historicalFileUpload.value = '';
    });
}

function setDefaultTrendToLastNepaliMonth() {
    const ty = document.getElementById('trend-nepali-year');
    const tm = document.getElementById('trend-nepali-month');
    if(!ty || !tm) return;

    ty.innerHTML = '';
    for (let i = 0; i < 10; i++) {
        let y = new Date().getFullYear() + 57 - i;
        ty.add(new Option(y, y));
    }

    tm.innerHTML = '';
    nepaliMonths.forEach(m => tm.add(new Option(m, m)));

    for (let i = allData.length - 1; i >= 0; i--) {
        if (allData[i].nepali_date) {
            const p = allData[i].nepali_date.split('.');
            if (p.length === 3) {
                ty.value = p[0];
                tm.value = nepaliMonths[parseInt(p[1]) - 1];
                break;
            }
        }
    }
}

// --- Authentication & Initialization (cleaned up) ---
async function initAuth() {
    try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (session?.user) {
            currentUser = session.user;
            
            try {
                const { data: roleData } = await supabase.from('user_roles').select('role').eq('email', currentUser.email).maybeSingle();
                if (roleData && roleData.role) {
                    userRole = roleData.role;
                }
            } catch (err) {
                console.warn("Could not load user role:", err);
            }

            if (currentUser.email.toLowerCase() === 'upenjyo@gmail.com') {
                userRole = 'admin';
            }
            
            // Load header once
            try {
                const headerRes = await fetch('header.html');
                if (headerRes.ok) {
                   const globalHeader = document.getElementById('global-header-container') || document.getElementById('global-header');
                    if(globalHeader) globalHeader.innerHTML = await headerRes.text();
                }
            } catch (err) {
                console.warn("Failed to load header.html", err);
            }

            const emailElement = document.getElementById('header-email');
            if (emailElement) {
                emailElement.innerText = currentUser.email.split('@')[0];
            }
            
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.onclick = async () => {
                    await supabase.auth.signOut();
                    window.location.href = "signin.html";
                };
            }
            
            applyPermissions();
            
            // --- DATA LOADING FUNCTIONS (called once) ---
            loadAndListenData();
            loadBalanchData();
            loadMCEData();
            loadOutagesData();
            loadRainfallData();
            loadExpensesData();

            // Auto-sync trend filters
            const ySel = document.getElementById('grid-rf-year');
            const mSel = document.getElementById('grid-rf-month');
            if (ySel && mSel) {
                ySel.addEventListener('change', loadTrendData);
                mSel.addEventListener('change', loadTrendData);
            }
            
        } else {
            window.location.href = "index.html";
        }
    } catch (authErr) {
        console.error("Auth init error:", authErr);
        showNotification("Authentication issue. Check console.", true);
    }
}

function applyPermissions() {
    // --- 1. NEW: HEADER SECURITY UNLOCK ---
    // Un-hide the main navigation and profile area since the user is logged in
    document.getElementById('main-nav')?.classList.remove('hidden');
    document.getElementById('main-nav')?.classList.add('flex');
    document.getElementById('login-btn')?.classList.add('hidden');
    document.getElementById('user-profile')?.classList.remove('hidden');
    document.getElementById('user-profile')?.classList.add('flex');

    // Unlock specific header links based on the user's role
    if (userRole === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('role-hidden'));
        document.querySelectorAll('.staff-only').forEach(el => el.classList.remove('role-hidden'));
    } else if (userRole === 'staff') {
        document.querySelectorAll('.staff-only').forEach(el => el.classList.remove('role-hidden'));
    }

    // --- 2. EXISTING LOGIC: BULK UPLOAD BUTTONS ---
    // ADMIN ONLY: Can see Bulk Uploads
    if (userRole === 'admin') {
        document.querySelectorAll('[id*="-upload-btn"]').forEach(btn => {
            if (btn) btn.classList.remove('role-hidden');
        });
    }
    
    // EVERYONE: Can Export / Download Data
    document.querySelectorAll('[id*="-download-btn"]').forEach(btn => {
        if (btn) btn.classList.remove('hidden');
    });

    // --- 3. EXISTING LOGIC: SECURE READ-ONLY LOCK ---
    // (For both Management Staff AND normal users)
    if (userRole !== 'admin' && userRole !== 'operator') {
        const style = document.createElement('style');
        style.innerHTML = `
            /* Hide the 'Actions' Header Column */
            .col-actions { display: none !important; }
            
            /* Find and destroy ANY dynamically loaded Edit/Delete buttons */
            button[onclick*="edit"], button[onclick*="delete"], 
            button[onclick*="Edit"], button[onclick*="Delete"],
            .edit-btn, .delete-btn, .edit-balanch-btn, .delete-balanch-btn,
            .edit-outage-btn, .delete-outage-btn, .edit-mce-btn, .delete-mce-btn,
            .edit-rf-btn, .delete-rf-btn, .delete-exp-btn { 
                display: none !important; 
            }
            
            /* Freeze all data inputs so they look like flat, unclickable text */
            .table-container input, .table-container select, .table-container textarea {
                pointer-events: none !important;
                background-color: transparent !important;
                border: none !important;
                color: #334155 !important;
                font-weight: 600 !important;
                -webkit-appearance: none;
                appearance: none;
            }
        `;
        document.head.appendChild(style);
    }

    // --- 4. EXISTING LOGIC: OPERATOR RESTRICTION ---
    // Hide Site Expenses Tab
    if (userRole === 'operator') {
        const expenseTab = document.querySelector('[data-target="expenses-tab"]');
        const expenseSection = document.getElementById('expenses-tab');
        
        // Hide the clickable tab at the top
        if (expenseTab) expenseTab.style.display = 'none';
        
        // Hide the actual content below it just to be safe
        if (expenseSection) expenseSection.style.display = 'none';
    }
}

// Remove the duplicate header fetch block at the end (the one that starts with `try { const headerRes = await fetch('header.html?v=' + Date.now()); ... }`)
// It has been removed to prevent redundant loading.

initAuth();
