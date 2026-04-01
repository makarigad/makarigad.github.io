import './hourly-log-tools.js';
import { supabase, initializeApplication, safeUpsert, parseToUTCDate, showNotification } from './core-app.js';

const nepaliMonths = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashoj", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];

window.currentDayLogs = []; 
window.latestLog = null; 
window.currentUser = null;
window.userRole = 'normal';
window.currentUserName = '';
window.isDailyExport = true;
window.previewDataCache = []; 
window.outagesDataCache = []; 
window.currentValidationErrors = []; 

const dateInput = document.getElementById('log-date');
const nepaliDisplay = document.getElementById('nepali-date-display');
const saveBtn = document.getElementById('save-btn');

window.setCurrentHour = function() {
    const hr = new Date().getHours().toString().padStart(2, '0');
    const timeSelect = document.getElementById('log-time');
    if (timeSelect) timeSelect.value = `${hr}:00:00`;
}

window.clearMasterFormInputsOnly = function() {
    const d = document.getElementById('log-date').value;
    const t = document.getElementById('log-time').value;
    
    document.getElementById('hourly-form').reset();
    
    document.getElementById('log-date').value = d;
    document.getElementById('log-time').value = t;
    document.getElementById('log-operator').value = window.currentUserName || '';
    
    localStorage.removeItem('makarigad_hourly_draft'); 
    window.validateForm();
    
    if (saveBtn) {
        saveBtn.innerHTML = "💾 Save New Data";
        saveBtn.className = "px-6 py-2 bg-indigo-600 text-white font-black rounded shadow-md hover:bg-indigo-700 transition min-w-[200px]";
    }
};

window.fmt = (val, type, mwVal = null) => {
    if (val === null || val === undefined || val === '') return '';
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    if (type === 'hz') {
        const mwCheck = parseFloat(mwVal);
        if (isNaN(mwCheck) || mwCheck <= 0) return '0';
        let str = num.toFixed(1);
        return str.endsWith('.0') ? str.slice(0, -2) : str;
    }
    if (type === 'mw') return num.toFixed(3);
    if (type === 'kv') return num.toFixed(2);
    let str = num.toFixed(1);
    return str.endsWith('.0') ? str.slice(0, -2) : str;
};

async function updateDates() {
    const todayDate = dateInput.value;
    if (!todayDate) return;
    
    if(nepaliDisplay) nepaliDisplay.innerHTML = '<span class="text-slate-500 font-bold">Loading...</span>';
    
    try {
        const { data: mapData, error: mapErr } = await supabase.from('calendar_mappings')
            .select('nep_date_str, nep_month, nep_day, nep_year, status')
            .eq('eng_date', todayDate)
            .limit(1);
            
        const data = mapData && mapData.length > 0 ? mapData[0] : null;
        
        if (data && data.nep_date_str) {
            const warning = data.status === 'AUTO_GENERATED' ? ' (Draft)' : '';
            if(nepaliDisplay) nepaliDisplay.innerText = `${data.nep_date_str}${warning}`;
            
            if(document.getElementById('export-year')) document.getElementById('export-year').value = data.nep_year;
            const monthIdx = nepaliMonths.indexOf(data.nep_month) + 1;
            if(document.getElementById('export-month') && monthIdx > 0) document.getElementById('export-month').value = monthIdx;
            if(document.getElementById('export-day')) document.getElementById('export-day').value = data.nep_day;
        } else {
            const { data: pdRes } = await supabase.from('plant_data')
                .select('nepali_date')
                .eq('id', todayDate)
                .limit(1);
                
            const pdData = pdRes && pdRes.length > 0 ? pdRes[0] : null;
            
            if (pdData && pdData.nepali_date) {
                if(nepaliDisplay) nepaliDisplay.innerText = pdData.nepali_date;
            } else {
                if(nepaliDisplay) nepaliDisplay.innerHTML = '<span class="text-rose-600 font-bold text-xs uppercase tracking-wider">⚠️ Not Found in Calendar</span>';
            }
        }
    } catch (err) {
        console.error("Calendar Error:", err);
        if(nepaliDisplay) nepaliDisplay.innerText = "Date Error";
    }
    
    if (typeof window.fetchLogs === 'function') window.fetchLogs();
}

window.fetchLogs = async function() {
    const todayDate = dateInput.value;
    document.querySelectorAll('.preview-table-container').forEach(el => {
        el.innerHTML = '<div class="p-6 text-center text-indigo-600 font-bold animate-pulse">Loading data...</div>';
    });

    try {
        const { data, error } = await supabase.from('hourly_logs').select('*').eq('log_date', todayDate).order('log_time', { ascending: true });
        
        if (error) { 
            if (error.message === 'Failed to fetch' || !navigator.onLine) {
                console.warn('Offline mode: Showing cached data if available.');
            } else {
                showNotification(`❌ DATABASE READ ERROR!\n\nError: ${error.message}`, true);
            }
            throw error; 
        }

        window.currentDayLogs = data || [];
        window.latestLog = data && data.length > 0 ? data[data.length - 1] : null;
        // Update "X / 24 hours logged" badge in the page header
        const badge = document.getElementById('log-count-badge');
        if (badge) {
            const count = (data || []).length;
            badge.textContent = count + ' / 24 hours logged';
            badge.classList.toggle('hidden', count === 0);
            if (count === 24) {
                badge.className = 'text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg uppercase tracking-wider';
            } else {
                badge.className = 'text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg uppercase tracking-wider';
            }
        }

        const nepD = nepaliDisplay ? nepaliDisplay.innerText.replace('Nepali Date: ', '').trim() : '';
        const monthSelect = document.getElementById('export-month');
        let monthName = '';
        if (monthSelect && monthSelect.options && monthSelect.options.length > 0) {
            monthName = monthSelect.options[monthSelect.selectedIndex > -1 ? monthSelect.selectedIndex : 0].text;
        }
        
        const canEdit = ['admin', 'operator'].includes(window.userRole);

        const renderMap = [
            { id: 'view-gen-container', type: 'generation', label: 'Gen' },
            { id: 'view-temp-container', type: 'tempoil', label: 'Temp' },
            { id: 'view-trans-container', type: 'transformer', label: 'Trans' },
            { id: 'view-elec-container', type: 'schedule3', label: 'Schedule 3' }
        ];

        renderMap.forEach(rm => {
            const container = document.getElementById(rm.id);
            if (container && typeof window.generateTableHTML === 'function') {
                try {
                    container.innerHTML = window.generateTableHTML(window.currentDayLogs, nepD, todayDate, monthName, false, rm.type, canEdit);
                } catch(e) { container.innerHTML = `<div class="p-4 text-rose-600 font-bold bg-rose-50">⚠️ Tab Error: ${e.message}</div>`; }
            }
        });

        let currentTime = document.getElementById('log-time').value;
        if (currentTime && currentTime.length === 5) currentTime += ':00';
        const existingLog = window.currentDayLogs.find(l => l.log_time && l.log_time.startsWith(currentTime.substring(0,5)));
        
        if (existingLog) window.editLog(currentTime, false);
        else window.clearMasterFormInputsOnly();

    } catch (error) {
        console.error("Fetch logs error:", error);
    }
}

window.editLog = function(timeStr, navigate = true) {
    const timePrefix = timeStr.substring(0, 5);
    const log = window.currentDayLogs.find(l => l.log_time && l.log_time.substring(0,5) === timePrefix);
    if(!log) return;

    const m = (id, val) => { const el = document.getElementById(id); if(el) el.value = (val !== null && val !== undefined) ? val : ''; };
    m('log-time', log.log_time.substring(0, 5) + ':00');
    
    m('u1-status', log.u1_status || 'O'); m('u1-hour', log.u1_hour_counter); m('u1-load', log.u1_load); m('u1-pf', log.u1_pf); m('u1-pmu', log.u1_pmu_reading); m('u1-feeder', log.u1_feeder);
    m('u2-status', log.u2_status || 'O'); m('u2-hour', log.u2_hour_counter); m('u2-load', log.u2_load); m('u2-pf', log.u2_pf); m('u2-pmu', log.u2_pmu_reading); m('u2-feeder', log.u2_feeder);
    m('sst-kwh', log.sst); m('outgoing-kwh', log.outgoing); m('import-mwh', log.import_mwh); m('water-level', log.water_level); 
    
    let remStr = log.remarks || '';
    let catStr = 'Generation';
    if (remStr.startsWith('[')) {
        let closeIdx = remStr.indexOf(']');
        if (closeIdx > -1) { catStr = remStr.substring(1, closeIdx); remStr = remStr.substring(closeIdx + 1).trim(); }
    }
    m('remark-category', catStr);
    m('log-remarks', remStr);

    m('e_u1_v_ry', log.e_u1_v_ry); m('e_u1_v_yb', log.e_u1_v_yb); m('e_u1_v_br', log.e_u1_v_br); m('e_u1_a_i1', log.e_u1_a_i1); m('e_u1_a_i2', log.e_u1_a_i2); m('e_u1_a_i3', log.e_u1_a_i3); m('e_u1_mw', log.e_u1_mw); m('e_u1_kvar', log.e_u1_kvar); m('e_u1_cos', log.e_u1_cos); m('e_u1_hz', log.e_u1_hz); m('e_u1_gwh', log.e_u1_gwh);
    m('e_u2_v_ry', log.e_u2_v_ry); m('e_u2_v_yb', log.e_u2_v_yb); m('e_u2_v_br', log.e_u2_v_br); m('e_u2_a_i1', log.e_u2_a_i1); m('e_u2_a_i2', log.e_u2_a_i2); m('e_u2_a_i3', log.e_u2_a_i3); m('e_u2_mw', log.e_u2_mw); m('e_u2_kvar', log.e_u2_kvar); m('e_u2_cos', log.e_u2_cos); m('e_u2_hz', log.e_u2_hz); m('e_u2_gwh', log.e_u2_gwh);
    m('e_out_v_ry', log.e_out_v_ry); m('e_out_v_yb', log.e_out_v_yb); m('e_out_v_br', log.e_out_v_br); m('e_out_a_i1', log.e_out_a_i1); m('e_out_a_i2', log.e_out_a_i2); m('e_out_a_i3', log.e_out_a_i3); m('e_out_mw', log.e_out_mw); m('e_out_kvar', log.e_out_kvar); m('e_out_cos', log.e_out_cos); m('e_out_hz', log.e_out_hz); m('e_out_mwh', log.e_out_mwh);

    m('t_u1_u', log.t_u1_u); m('t_u1_v', log.t_u1_v); m('t_u1_w', log.t_u1_w); m('t_u1_de', log.t_u1_de); m('t_u1_nde', log.t_u1_nde); m('t_u1_gov', log.t_u1_gov_temp); m('t_u1_hyd', log.t_u1_hyd_temp); m('t_u1_flow', log.t_u1_oil_flow); m('t_u1_lvl', log.t_u1_oil_level);
    m('t_u2_u', log.t_u2_u); m('t_u2_v', log.t_u2_v); m('t_u2_w', log.t_u2_w); m('t_u2_de', log.t_u2_de); m('t_u2_nde', log.t_u2_nde); m('t_u2_gov', log.t_u2_gov_temp); m('t_u2_hyd', log.t_u2_hyd_temp); m('t_u2_flow', log.t_u2_oil_flow); m('t_u2_lvl', log.t_u2_oil_level);
    m('t_temp_out', log.t_temp_out); m('t_temp_in', log.t_temp_in); m('t_temp_intake', log.t_temp_intake); m('t_pressure', log.t_pressure);
    m('tr_1_temp', log.tr_1_temp); m('tr_1_lvl', log.tr_1_lvl); m('tr_2_temp', log.tr_2_temp); m('tr_2_lvl', log.tr_2_lvl); m('tr_aux_temp', log.tr_aux_temp); m('tr_aux_lvl', log.tr_aux_lvl);
    m('dg_batt', log.dg_batt); m('dg_fuel', log.dg_fuel); m('dg_runtime', log.dg_runtime);
    
    if (navigate) {
        const formTab = document.querySelector('[data-target="hourly-form"]');
        if (formTab) formTab.click();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    window.validateForm();
    if (saveBtn) {
        saveBtn.innerHTML = "💾 Update Existing Data";
        saveBtn.className = "px-6 py-2 bg-amber-500 text-white font-black rounded shadow-md hover:bg-amber-600 transition min-w-[200px]";
    }
};

window.validateForm = function() {
    let errors = [];
    document.querySelectorAll('.validation-warning').forEach(el => el.classList.remove('validation-warning', 'bg-rose-50', 'ring-2', 'ring-rose-500'));

    const val = (id) => { const el = document.getElementById(id); return (el && el.value !== '') ? parseFloat(el.value) : null; };
    const markErr = (id) => { const el = document.getElementById(id); if (el) el.classList.add('validation-warning', 'bg-rose-50', 'ring-2', 'ring-rose-500'); };

    ['u1', 'u2'].forEach(u => {
        const statEl = document.getElementById(u + '-status');
        if (statEl) {
            const stat = statEl.value;
            const isDown = (stat === 'S' || stat === 'B');
            
            const fieldsToZero = [
                `${u}-load`, `${u}-pf`, 
                `e_${u}_v_ry`, `e_${u}_v_yb`, `e_${u}_v_br`,
                `e_${u}_a_i1`, `e_${u}_a_i2`, `e_${u}_a_i3`,
                `e_${u}_mw`, `e_${u}_kvar`, `e_${u}_cos`, `e_${u}_hz`
            ];

           fieldsToZero.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    if (isDown) {
                        if (el.value !== '0') el.value = '0';
                        el.setAttribute('readonly', 'true');
                        el.classList.add('bg-slate-100', 'text-slate-400', 'cursor-not-allowed');
                    } else {
                        el.removeAttribute('readonly');
                        el.classList.remove('bg-slate-100', 'text-slate-400', 'cursor-not-allowed');
                    }
                }
            });
        }
    });

    const u1Mw = val('e_u1_mw'), u2Mw = val('e_u2_mw'), outMw = val('e_out_mw');
    if (u1Mw !== null && (u1Mw < 0 || u1Mw > 5.3)) { errors.push("U1 Load (MW) must be between 0 and 5.3."); markErr('e_u1_mw'); markErr('u1-load'); }
    if (u2Mw !== null && (u2Mw < 0 || u2Mw > 5.3)) { errors.push("U2 Load (MW) must be between 0 and 5.3."); markErr('e_u2_mw'); markErr('u2-load'); }
    if (outMw !== null && (outMw < 0 || outMw > 10.6)) { errors.push("Outgoing Load (MW) must be between 0 and 10.6."); markErr('e_out_mw'); markErr('outgoing-kwh'); }

    const checkFreqPf = (mwId, hzId, pfId, name) => {
        const m = val(mwId), h = val(hzId), p = val(pfId);
        if (m === 0) {
            if (h !== 0 && h !== null) { errors.push(`${name} Freq must be 0 when MW is 0.`); markErr(hzId); }
            if (p !== 0 && p !== null) { errors.push(`${name} PF must be 0 when MW is 0.`); markErr(pfId); }
        } else if (m > 0) {
            if (h !== null && (h < 49.5 || h > 50.5)) { errors.push(`${name} Frequency must be between 49.5 and 50.5.`); markErr(hzId); }
            if (p !== null && (p < -1 || p > 1)) { errors.push(`${name} Power Factor must be between -1 and 1.`); markErr(pfId); }
        }
    };
    checkFreqPf('e_u1_mw', 'e_u1_hz', 'e_u1_cos', 'Unit 1');
    checkFreqPf('e_u2_mw', 'e_u2_hz', 'e_u2_cos', 'Unit 2');
    checkFreqPf('e_out_mw', 'e_out_hz', 'e_out_cos', 'Outgoing Line');

    ['e_u1_kvar', 'e_u2_kvar', 'e_out_kvar'].forEach(id => {
        if (val(id) !== null && (val(id) < -3000 || val(id) > 3000)) { errors.push(`kVAR must be between -3000 and 3000.`); markErr(id); }
    });

    const checkVolts = (ryId, ybId, brId, isLine, name) => {
        const ry = val(ryId), yb = val(ybId), br = val(brId);
        if (ry===null || yb===null || br===null) return;
        const allZero = ry===0 && yb===0 && br===0;
        
        if (isLine) {
            const u1z = val('e_u1_v_ry')===0 && val('e_u1_v_yb')===0 && val('e_u1_v_br')===0;
            const u2z = val('e_u2_v_ry')===0 && val('e_u2_v_yb')===0 && val('e_u2_v_br')===0;
            if (u1z && u2z) {
                if (!allZero) { errors.push(`Outgoing Voltages must be 0 since both U1 & U2 are 0.`); markErr(ryId); markErr(ybId); markErr(brId); }
            } else if (!allZero) {
                if (ry<31.9||ry>34.1 || yb<31.9||yb>34.1 || br<31.9||br>34.1) { errors.push(`Outgoing Voltages must be between 31.9 and 34.1`); markErr(ryId); markErr(ybId); markErr(brId); }
                const avg = (ry+yb+br)/3;
                if (Math.abs(ry-avg) > avg*0.006 || Math.abs(ry-avg) > avg*0.006 || Math.abs(br-avg) > avg*0.006) { errors.push(`Outgoing Voltages vary by > 0.6% from average.`); markErr(ryId); markErr(ybId); markErr(brId); }
            }
        } else {
            if (!allZero) {
                if (ry<6.3||ry>6.9 || yb<6.3||yb>6.9 || br<6.3||br>6.9) { errors.push(`${name} Voltages must be between 6.3 and 6.9`); markErr(ryId); markErr(ybId); markErr(brId); }
                const avg = (ry+yb+br)/3;
                if (Math.abs(ry-avg) > avg*0.005 || Math.abs(yb-avg) > avg*0.005 || Math.abs(br-avg) > avg*0.005) { errors.push(`${name} Voltages vary by > 0.5% from average.`); markErr(ryId); markErr(ybId); markErr(brId); }
            }
        }
    };
    checkVolts('e_u1_v_ry', 'e_u1_v_yb', 'e_u1_v_br', false, 'Unit 1');
    checkVolts('e_u2_v_ry', 'e_u2_v_yb', 'e_u2_v_br', false, 'Unit 2');
    checkVolts('e_out_v_ry', 'e_out_v_yb', 'e_out_v_br', true, 'Outgoing Line');

    const checkAmps = (i1Id, i2Id, i3Id, isLine, name) => {
        const i1 = val(i1Id), i2 = val(i2Id), i3 = val(i3Id);
        if (i1===null || i2===null || i3===null) return;
        const allZero = i1===0 && i2===0 && i3===0;
        
        if (isLine) {
            const u1z = val('e_u1_a_i1')===0 && val('e_u1_a_i2')===0 && val('e_u1_a_i3')===0;
            const u2z = val('e_u2_a_i1')===0 && val('e_u2_a_i2')===0 && val('e_u2_a_i3')===0;
            if (u1z && u2z) {
                if (!allZero) { errors.push(`Outgoing Currents must be 0 since both U1 & U2 are 0.`); markErr(i1Id); markErr(i2Id); markErr(i3Id); }
            } else if (!allZero) {
                if (i1<10||i1>190 || i2<10||i2>190 || i3<10||i3>190) { errors.push(`Outgoing Currents must be between 10 and 190.`); markErr(i1Id); markErr(i2Id); markErr(i3Id); }
                const avg = (i1+i2+i3)/3;
                if (Math.abs(i1-avg) > 15 || Math.abs(i2-avg) > 15 || Math.abs(i3-avg) > 15) { errors.push(`Outgoing Currents vary by > 15 from average.`); markErr(i1Id); markErr(i2Id); markErr(i3Id); }
            }
        } else {
            if ((i1===0 || i2===0 || i3===0) && !allZero) { errors.push(`${name} Currents: If one is 0, all must be 0.`); markErr(i1Id); markErr(i2Id); markErr(i3Id); }
            else if (!allZero) {
                if (i1<50||i1>470 || i2<50||i2>470 || i3<50||i3>470) { errors.push(`${name} Currents must be between 50 and 470.`); markErr(i1Id); markErr(i2Id); markErr(i3Id); }
                const avg = (i1+i2+i3)/3;
                if (Math.abs(i1-avg) > 60 || Math.abs(i2-avg) > 60 || Math.abs(i3-avg) > 60) { errors.push(`${name} Currents vary by > 60 from average.`); markErr(i1Id); markErr(i2Id); markErr(i3Id); }
            }
        }
    };
    checkAmps('e_u1_a_i1', 'e_u1_a_i2', 'e_u1_a_i3', false, 'Unit 1');
    checkAmps('e_u2_a_i1', 'e_u2_a_i2', 'e_u2_a_i3', false, 'Unit 2');
    checkAmps('e_out_a_i1', 'e_out_a_i2', 'e_out_a_i3', true, 'Outgoing Line');

    const checkCalcMw = (mwId, vIds, iIds, name) => {
        const mw = val(mwId);
        if (mw !== null && mw > 0) {
            // Guard: only check if all voltage and current values are present
            const v0 = val(vIds[0]), v1 = val(vIds[1]), v2 = val(vIds[2]);
            const i0 = val(iIds[0]), i1 = val(iIds[1]), i2 = val(iIds[2]);
            if (v0 === null || v1 === null || v2 === null || i0 === null || i1 === null || i2 === null) return;
            const avgV = (v0 + v1 + v2) / 3;
            const avgI = (i0 + i1 + i2) / 3;
            const calcMw = (avgI * avgV * 1.732) / 1000;
            if (Math.abs(mw - calcMw) > 0.15) { errors.push(`${name} MW (${mw}) differs from computed V×I×√3 result (${calcMw.toFixed(3)} MW). Check voltage/current readings.`); markErr(mwId); }
        }
    };
    checkCalcMw('e_u1_mw', ['e_u1_v_ry', 'e_u1_v_yb', 'e_u1_v_br'], ['e_u1_a_i1', 'e_u1_a_i2', 'e_u1_a_i3'], 'Unit 1');
    checkCalcMw('e_u2_mw', ['e_u2_v_ry', 'e_u2_v_yb', 'e_u2_v_br'], ['e_u2_a_i1', 'e_u2_a_i2', 'e_u2_a_i3'], 'Unit 2');
    checkCalcMw('e_out_mw', ['e_out_v_ry', 'e_out_v_yb', 'e_out_v_br'], ['e_out_a_i1', 'e_out_a_i2', 'e_out_a_i3'], 'Outgoing Line');

    const u1Gwh = val('e_u1_gwh'), u2Gwh = val('e_u2_gwh'), outMwh = val('e_out_mwh');
    const pmu1 = val('u1-pmu'), feed1 = val('u1-feeder'), pmu2 = val('u2-pmu'), feed2 = val('u2-feeder');
    
    if (u1Gwh!==null && u2Gwh!==null && outMwh!==null && (u1Gwh*1000 + u2Gwh*1000) < outMwh) { errors.push(`Sum of U1+U2 Energy must be ≥ Outgoing Energy (U1+U2=${(u1Gwh*1000+u2Gwh*1000).toFixed(3)}, Out=${outMwh}).`); markErr('e_out_mwh'); }

    // Outgoing MW cannot exceed U1+U2 total MW (losses are always positive)
    if (u1Mw !== null && u2Mw !== null && outMw !== null && outMw > 0) {
        const totalGenMw = u1Mw + u2Mw;
        if (outMw > totalGenMw + 0.25) { errors.push(`Outgoing MW (${outMw}) cannot exceed U1+U2 total (${totalGenMw.toFixed(3)} MW). Check transformer losses.`); markErr('e_out_mw'); }
    }
    if (feed1!==null && feed2!==null && outMwh!==null && (feed1 + feed2) < outMwh) { errors.push(`Sum of Feeders must be > Outgoing.`); markErr('u1-feeder'); markErr('u2-feeder'); }
    if (pmu1!==null && feed1!==null && pmu1*1000 < feed1) { errors.push(`U1 PMU (GWh) must be > U1 Feeder (MWh).`); markErr('u1-pmu'); markErr('u1-feeder'); }
    if (pmu2!==null && feed2!==null && pmu2*1000 < feed2) { errors.push(`U2 PMU (GWh) must be > U2 Feeder (MWh).`); markErr('u2-pmu'); markErr('u2-feeder'); }

    const curTime = document.getElementById('log-time').value.substring(0,5);
    let prevLog = null;
    for (let i = window.currentDayLogs.length - 1; i >= 0; i--) {
        if (window.currentDayLogs[i].log_time && window.currentDayLogs[i].log_time.substring(0,5) < curTime) { prevLog = window.currentDayLogs[i]; break; }
    }
    if (prevLog) {
        if (u1Gwh !== null && prevLog.u1_pmu_reading != null) {
            if (u1Gwh < prevLog.u1_pmu_reading) { errors.push(`U1 Energy cannot be less than previous hour (${prevLog.u1_pmu_reading}).`); markErr('e_u1_gwh'); markErr('u1-pmu'); }
            if (u1Gwh > prevLog.u1_pmu_reading + 0.00535) { errors.push(`U1 Energy increased by more than max allowed (5.35 MWh).`); markErr('e_u1_gwh'); markErr('u1-pmu'); }
        }
        if (u2Gwh !== null && prevLog.u2_pmu_reading != null) {
            if (u2Gwh < prevLog.u2_pmu_reading) { errors.push(`U2 Energy cannot be less than previous hour (${prevLog.u2_pmu_reading}).`); markErr('e_u2_gwh'); markErr('u2-pmu'); }
            if (u2Gwh > prevLog.u2_pmu_reading + 0.00535) { errors.push(`U2 Energy increased by more than max allowed (5.35 MWh).`); markErr('e_u2_gwh'); markErr('u2-pmu'); }
        }
        if (outMwh !== null && prevLog.outgoing != null) {
            if (outMwh < prevLog.outgoing) { errors.push(`Outgoing Energy cannot be less than previous hour (${prevLog.outgoing}).`); markErr('e_out_mwh'); markErr('outgoing-kwh'); }
            if (outMwh > prevLog.outgoing + 10.65) { errors.push(`Outgoing Energy increased by more than max allowed (10.65 MWh).`); markErr('e_out_mwh'); markErr('outgoing-kwh'); }
        }
    }

    // Water level range (0–1200 cm typical; flag if clearly impossible)
    const waterLvl = val('water-level');
    if (waterLvl !== null && (waterLvl < 0 || waterLvl > 1500)) { errors.push(`Water Level (${waterLvl} cm) is out of expected range (0–1500 cm).`); markErr('water-level'); }

    const chk = (id, min, max, name) => { const v=val(id); if(v!==null && (v<min || v>max)) { errors.push(`${name} must be between ${min} and ${max}.`); markErr(id); } };
    ['t_u1_u', 't_u1_v', 't_u1_w', 't_u1_de', 't_u1_nde', 't_u2_u', 't_u2_v', 't_u2_w', 't_u2_de', 't_u2_nde'].forEach(id => chk(id, 15, 95, id.toUpperCase() + ' Temp'));
    ['t_u1_gov', 't_u1_hyd', 't_u2_gov', 't_u2_hyd'].forEach(id => chk(id, 15, 50, 'Governor/Hyd Temp'));
    chk('t_temp_out', 10, 50, 'Outside Temp'); chk('t_temp_in', 10, 50, 'Inside Temp'); chk('t_temp_intake', -5, 30, 'Intake Temp');
    chk('t_pressure', 830, 900, 'Pressure');
    ['tr_1_temp', 'tr_2_temp', 'tr_aux_temp'].forEach(id => chk(id, 15, 70, 'Transformer Temp'));
    ['tr_1_lvl', 'tr_2_lvl'].forEach(id => chk(id, 3, 9.5, 'Trans Oil Level')); chk('tr_aux_lvl', 70, 90, 'Aux Oil Level');
    chk('dg_batt', 11, 14.3, 'DG Battery'); chk('dg_fuel', 10, 100, 'DG Fuel %');

    ['t_u1_flow', 't_u2_flow'].forEach(id => {
        const v = val(id);
        const unitNum = id.includes('u1') ? '1' : '2';
        const stat = document.getElementById(`u${unitNum}-status`)?.value;
        if (v !== null) {
            if ((stat === 'S' || stat === 'B') && v === 0) {
                // Valid
            } else if (v < 40 || v > 50) {
                errors.push(`Unit ${unitNum} Oil Flow must be between 40 and 50 (or 0 if Unit Status is S/B).`);
                markErr(id);
            }
        }
    });

    window.currentValidationErrors = errors;

    const banner = document.getElementById('validation-banner');
    if (errors.length > 0) {
         banner.innerHTML = `<span class="uppercase tracking-widest block mb-2 font-black">⛔ Data Validation Failed</span><p class="text-xs mb-2">Please correct the following fields to save:</p><ul class="list-disc pl-4 space-y-1 text-[11px]">${errors.map(w => `<li>${w}</li>`).join('')}</ul>`;
         banner.classList.remove('hidden');
         
         if(saveBtn) { 
             saveBtn.innerHTML = "⚠️ Save with Errors"; 
             saveBtn.classList.replace('bg-indigo-600', 'bg-rose-600');
             saveBtn.classList.replace('bg-amber-500', 'bg-rose-600');
         }
    } else { 
         if(banner) banner.classList.add('hidden'); 
         
         if(saveBtn) { 
             saveBtn.innerHTML = saveBtn.innerText.includes('Errors') ? "💾 Save Hour Data" : saveBtn.innerText;
             saveBtn.classList.replace('bg-rose-600', 'bg-indigo-600');
         }
    }
};

document.getElementById('hourly-form').addEventListener('submit', async function(e) {
    e.preventDefault();

    // 1. VALIDATION CHECK — block save if errors exist
    if (window.currentValidationErrors && window.currentValidationErrors.length > 0) {
        const errCount = window.currentValidationErrors.length;
        const msg = `⚠️ VALIDATION: ${errCount} issue${errCount>1?'s':''} found\n\n` +
            window.currentValidationErrors.slice(0,5).join('\n') +
            (errCount > 5 ? `\n... and ${errCount-5} more.` : '') +
            '\n\nSave with these errors anyway?';
        if (!confirm(msg)) return; 
    }

    if (saveBtn) { saveBtn.innerHTML = "⏳ Syncing..."; saveBtn.disabled = true; }

    try {
        let logTime = document.getElementById('log-time').value;
        if (logTime.length === 5) logTime += ':00';
        
        // Helper functions
        const p = (id) => { const el = document.getElementById(id); return (el && el.value !== '') ? parseFloat(el.value) : null; };
        const s = (id) => { const el = document.getElementById(id); return (el && el.value.trim() !== '') ? el.value.trim() : null; };

        const engDate = document.getElementById('log-date').value;
        const ny = document.getElementById('export-year').value;
        const nm = document.getElementById('export-month').value;
        const nd = document.getElementById('export-day').value;
        const bsMonthNames = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashoj", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
        const monthName = bsMonthNames[parseInt(nm) - 1];

        // Ensure we have a valid Nepali Date string for mapping across all tables
        let nepDateStr = (ny && nm && nd) ? `${ny}.${String(nm).padStart(2, '0')}.${String(nd).padStart(2, '0')}` : null;

        // 2. FULL LOG DATA MAPPING
        const logData = {
            log_date: engDate,
            log_time: logTime,
            nepali_date: nepDateStr,
            u1_status: s('u1-status'), u1_hour_counter: p('u1-hour'), u1_load: p('u1-load'), u1_pf: p('u1-pf'), u1_pmu_reading: p('u1-pmu'), u1_feeder: p('u1-feeder'),
            u2_status: s('u2-status'), u2_hour_counter: p('u2-hour'), u2_load: p('u2-load'), u2_pf: p('u2-pf'), u2_pmu_reading: p('u2-pmu'), u2_feeder: p('u2-feeder'),
            sst: p('sst-kwh'), outgoing: p('outgoing-kwh'), import_mwh: p('import-mwh'), water_level: p('water-level'), remarks: s('log-operator'), 
            e_u1_v_ry: p('e_u1_v_ry'), e_u1_v_yb: p('e_u1_v_yb'), e_u1_v_br: p('e_u1_v_br'), e_u1_a_i1: p('e_u1_a_i1'), e_u1_a_i2: p('e_u1_a_i2'), e_u1_a_i3: p('e_u1_a_i3'), e_u1_mw: p('e_u1_mw'), e_u1_kvar: p('e_u1_kvar'), e_u1_cos: p('e_u1_cos'), e_u1_hz: p('e_u1_hz'), e_u1_gwh: p('e_u1_gwh'),
            e_u2_v_ry: p('e_u2_v_ry'), e_u2_v_yb: p('e_u2_v_yb'), e_u2_v_br: p('e_u2_v_br'), e_u2_a_i1: p('e_u2_a_i1'), e_u2_a_i2: p('e_u2_a_i2'), e_u2_a_i3: p('e_u2_a_i3'), e_u2_mw: p('e_u2_mw'), e_u2_kvar: p('e_u2_kvar'), e_u2_cos: p('e_u2_cos'), e_u2_hz: p('e_u2_hz'), e_u2_gwh: p('e_u2_gwh'),
            e_out_v_ry: p('e_out_v_ry'), e_out_v_yb: p('e_out_v_yb'), e_out_v_br: p('e_out_v_br'), e_out_a_i1: p('e_out_a_i1'), e_out_a_i2: p('e_out_a_i2'), e_out_a_i3: p('e_out_a_i3'), e_out_mw: p('e_out_mw'), e_out_kvar: p('e_out_kvar'), e_out_cos: p('e_out_cos'), e_out_hz: p('e_out_hz'), e_out_mwh: p('e_out_mwh'),
            t_u1_u: p('t_u1_u'), t_u1_v: p('t_u1_v'), t_u1_w: p('t_u1_w'), t_u1_de: p('t_u1_de'), t_u1_nde: p('t_u1_nde'), t_u1_gov_temp: p('t_u1_gov'), t_u1_hyd_temp: p('t_u1_hyd'), t_u1_oil_flow: p('t_u1_flow'), t_u1_oil_level: s('t_u1_lvl'),
t_u2_u: p('t_u2_u'), t_u2_v: p('t_u2_v'), t_u2_w: p('t_u2_w'), t_u2_de: p('t_u2_de'), t_u2_nde: p('t_u2_nde'), t_u2_gov_temp: p('t_u2_gov'), t_u2_hyd_temp: p('t_u2_hyd'), t_u2_oil_flow: p('t_u2_flow'), t_u2_oil_level: s('t_u2_lvl'),
            t_temp_out: p('t_temp_out'), t_temp_in: p('t_temp_in'), t_temp_intake: p('t_temp_intake'), t_pressure: p('t_pressure'),
            tr_1_temp: p('tr_1_temp'), tr_1_lvl: p('tr_1_lvl'), tr_2_temp: p('tr_2_temp'), tr_2_lvl: p('tr_2_lvl'), tr_aux_temp: p('tr_aux_temp'), tr_aux_lvl: p('tr_aux_lvl'),
            dg_batt: p('dg_batt'), dg_fuel: p('dg_fuel'), dg_runtime: s('dg_runtime'),
            created_by: window.currentUser ? window.currentUser.id : null
        };

        const timePrefix = logTime.substring(0, 5);
        const existingLog = window.currentDayLogs.find(l => l.log_time && l.log_time.substring(0,5) === timePrefix);
        if (existingLog && existingLog.id) { logData.id = existingLog.id; }

        // 3. MAIN SAVE: HOURLY LOGS
        const { error: hErr } = await supabase.from('hourly_logs').upsert([logData]);
        if (hErr) throw new Error("Hourly Save Failed: " + hErr.message);

        // 4. TRIGGER 12:00 PM 3-WAY SMART SYNC
        if (logTime.startsWith('12:00')) {
            console.log("Attempting 12:00 PM 3-Way Sync...");
            
            // Map c & d variables from the 12:00 PM input
            const c_export = p('outgoing-kwh'); // FIX: Grab Outgoing (Plant Export), not U1 Feeder
            const d_import = p('import-mwh'); // Plant Import

            // FETCH EXISTING DATA to preserve other fields
            const [{ data: curPlant }, { data: curBalanch }] = await Promise.all([
                supabase.from('plant_data').select('*').eq('id', engDate).maybeSingle(),
                supabase.from('balanch_readings').select('*').eq('eng_date', engDate).maybeSingle()
            ]);

            // SYNC TO DAILY METERING (x, y)
            // Inside the 12:00 PM sync block in hourly-log.js
const plantPayload = {
    ...(curPlant || {}),
    id: engDate,
    nepali_date: nepDateStr,
    unit1_gen: p('u1-pmu'),
    unit2_gen: p('u2-pmu'),
    unit1_trans: p('u1-feeder'),      // Added sync for Unit 1 Trans
    unit2_trans: p('u2-feeder'),      // Added sync for Unit 2 Trans
    station_trans: p('sst-kwh'),     // Added sync for Station Trans
    export_plant: p('outgoing-kwh'),    // Added sync for Export Plant
    import_outgoing: p('import-mwh'), // Added sync for Import Substation
    unit1_counter: p('u1-hour'),
    unit2_counter: p('u2-hour'),
   
    updated_at: new Date().toISOString()
};
            
            // Smart logic: Fill if empty (x=c)
            if (c_export !== null && (!curPlant || curPlant.export_plant == null)) plantPayload.export_plant = c_export;
            // FIX: Map to import_outgoing (Plant side), NOT import_substation (Balanch side)
            if (d_import !== null && (!curPlant || curPlant.import_outgoing == null)) plantPayload.import_outgoing = d_import;
            
            await supabase.from('plant_data').upsert(plantPayload);

            // SYNC TO SUBSTATION METERING (a, b)
            const balanchPayload = { 
                ...(curBalanch || {}), 
                eng_date: engDate,
                nep_date: nepDateStr, // Ensures Substation Nepali Date is updated
                updated_at: new Date().toISOString()
            };
            
            let needsBalanchSync = false;
            // Smart logic: Fill if empty (a=c)
            if (c_export !== null && (!curBalanch || curBalanch.main_export == null)) {
                balanchPayload.main_export = c_export;
                needsBalanchSync = true;
            }
            if (d_import !== null && (!curBalanch || curBalanch.main_import == null)) {
                balanchPayload.main_import = d_import;
                needsBalanchSync = true;
            }
            
            if (needsBalanchSync || (nepDateStr && (!curBalanch || !curBalanch.nep_date))) {
                await supabase.from('balanch_readings').upsert(balanchPayload);
            }
            console.log("✅ 12:00 PM Smart Sync Complete!");
        }

        // 5. TRIGGER 08:00 AM SYNC TO RAINFALL
        if (logTime.startsWith('08:00')) {
            console.log("Attempting 08:00 AM Rainfall Sync...");
            
            const monthDropdown = document.getElementById('export-month');
            const safeMonthName = monthDropdown && monthDropdown.options.length > 0 
                ? monthDropdown.options[monthDropdown.selectedIndex].text 
                : null;

            const rYear = parseInt(ny);
            const rDay = parseInt(nd);
            
            if (isNaN(rYear) || isNaN(rDay) || !safeMonthName) {
                alert("⚠️ Cannot sync Rainfall: Nepali Date is missing or invalid.");
            } else {
                // THE FIX: Force the day to have a leading zero (e.g., '5' becomes '05')
                const safeDayStr = String(rDay).padStart(2, '0');
                const rainId = `${rYear}_${safeMonthName}_${safeDayStr}`; 
                console.log("Syncing Rainfall ID:", rainId);
                
                const { data: curRain } = await supabase.from('rainfall_data').select('*').eq('id', rainId).maybeSingle();
                
                const rainPayload = {
                    ...(curRain || {}), 
                    id: rainId,
                    nepali_year: rYear,
                    nepali_month: safeMonthName,
                    day: rDay,
                    headworks: p('water-level') || 0,
                    operator_email: window.currentUser?.email || null,
                    operator_uid: window.currentUser?.id || null,
                    updated_at: new Date().toISOString()
                };
                
                if (!curRain || curRain.powerhouse == null) rainPayload.powerhouse = 0; 

                const { error: rErr } = await supabase.from('rainfall_data').upsert(rainPayload);
                
                if (rErr) {
                    alert("Database Error syncing Rainfall:\n" + rErr.message);
                    console.error("Rainfall Sync Error: ", rErr);
                } else {
                    console.log("✅ 08:00 AM Rainfall Synced to Database!");
                }
            }
        }

        

        // ... (End of the 08:00 AM Rainfall Block) ...

            // THE FIX: Generate a specific, unmissable success message
            let successMsg = "✅ Hourly Log Saved Successfully!";
            if (logTime.startsWith('12:00')) successMsg = "✅ 12:00 PM Data Synced to Daily Master & Substation!";
            if (logTime.startsWith('08:00')) successMsg = "✅ 08:00 AM Rainfall Synced to Daily Master!";
            
            // 1. Try to show the sliding notification
            showNotification(successMsg);
            
            // 2. FORCE a browser popup so the operator knows 100% it worked
            alert(successMsg);

            updateDates();
            if (typeof window.fetchLogs === 'function') window.fetchLogs();

    } catch (err) {
        // Force a popup if it fails, too
        alert("❌ ERROR SAVING:\n" + err.message);
        showNotification("❌ Error: " + err.message, true);
        console.error(err);
    } finally {
        if (saveBtn) { 
            saveBtn.innerHTML = "💾 Update Existing Data"; 
            saveBtn.disabled = false; 
        }
    }
});

document.getElementById('hourly-form').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault(); 
        const focusable = Array.from(this.querySelectorAll('input:not([readonly]):not([disabled]), select:not([disabled])'));
        const index = focusable.indexOf(e.target);
        if (index > -1 && index < focusable.length - 1) { focusable[index + 1].focus(); if(focusable[index + 1].select) focusable[index + 1].select(); }
    }
});

document.getElementById('log-time').addEventListener('change', function(e) {
    let selectedTime = this.value;
    if (selectedTime.length === 5) selectedTime += ':00';
    const existingLog = window.currentDayLogs.find(l => l.log_time === selectedTime);
    
    if (existingLog) { 
        window.editLog(selectedTime, false); 
    } else { 
        const draftStr = localStorage.getItem('makarigad_hourly_draft');
        if (!draftStr || draftStr === '{}') {
            window.clearMasterFormInputsOnly(); 
        } else {
            window.validateForm(); 
        }
    }
});

function loadDraft() {
    const draftStr = localStorage.getItem('makarigad_hourly_draft');
    if (draftStr) {
        const draft = JSON.parse(draftStr);
        for (const [id, value] of Object.entries(draft)) { const el = document.getElementById(id); if (el && id !== 'log-time' && id !== 'log-date') el.value = value; }
    }
}

document.getElementById('hourly-form').addEventListener('input', () => {
    let draft = {}; document.querySelectorAll('#hourly-form input, #hourly-form select').forEach(el => { if(el.id) draft[el.id] = el.value; });
    localStorage.setItem('makarigad_hourly_draft', JSON.stringify(draft));
    window.validateForm();
});

const syncMap = [['u1-load', 'e_u1_mw'], ['u2-load', 'e_u2_mw'], ['u1-pmu', 'e_u1_gwh'], ['u2-pmu', 'e_u2_gwh'], ['outgoing-kwh', 'e_out_mwh']];
syncMap.forEach(pair => { 
    const el1 = document.getElementById(pair[0]); 
    const el2 = document.getElementById(pair[1]); 
    if(el1 && el2) { 
        el1.addEventListener('input', () => { el2.value = el1.value; window.validateForm(); }); 
        el2.addEventListener('input', () => { el1.value = el2.value; window.validateForm(); }); 
    }
});

['e_u1_hz', 'e_u2_hz', 'e_out_hz'].forEach(id => {
    const sourceEl = document.getElementById(id);
    if (sourceEl) {
        sourceEl.addEventListener('input', function() {
            const val = this.value;
            ['e_u1_hz', 'e_u2_hz', 'e_out_hz'].forEach(targetId => {
                if (targetId !== id) {
                    const targetEl = document.getElementById(targetId);
                    if (targetEl) targetEl.value = val;
                }
            });
            window.validateForm();
        });
    }
});

['u1-pf', 'u2-pf', 'e_u1_cos', 'e_u2_cos', 'e_out_cos'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('input', function() {
            const val = this.value;
            ['u1-pf', 'u2-pf', 'e_u1_cos', 'e_u2_cos', 'e_out_cos'].forEach(tid => {
                const tel = document.getElementById(tid);
                if (tel && tid !== id) tel.value = val;
            });
            window.validateForm();
        });
    }
});

function applyDefaultsAndSyncs() {
    ['e_u1_hz', 'e_u2_hz', 'e_out_hz'].forEach(id => { const el = document.getElementById(id); if (el && !el.value) el.value = '50'; });
    ['u1-pf', 'u2-pf', 'e_u1_cos', 'e_u2_cos', 'e_out_cos'].forEach(id => { const el = document.getElementById(id); if (el && !el.value) el.value = '1'; });
}

dateInput.addEventListener('change', updateDates);

const tabs = document.querySelectorAll('.section-tab');
const contents = document.querySelectorAll('.section-content');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => { t.classList.remove('active', 'bg-e0e7ff', 'text-indigo-700', 'text-rose-600'); t.classList.add('bg-slate-50', 'text-slate-600'); });
        contents.forEach(c => { c.classList.remove('active'); c.classList.add('hidden'); });
        tab.classList.add('active'); tab.classList.remove('bg-slate-50', 'text-slate-600');
        if (tab.dataset.target === 'hourly-form') tab.classList.add('text-indigo-700');
        else if (tab.dataset.target === 'tab-admin') tab.classList.add('text-rose-600');
        const target = document.getElementById(tab.dataset.target);
        if(target) { target.classList.add('active'); target.classList.remove('hidden'); }
    });
});

async function startPage() {
    try {
        if (!dateInput.value) {
            const nepalTime = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kathmandu"}));
            const yyyy = nepalTime.getFullYear();
            const mm = String(nepalTime.getMonth() + 1).padStart(2, '0');
            const dd = String(nepalTime.getDate()).padStart(2, '0');
            
            const todayLocalISO = `${yyyy}-${mm}-${dd}`;
            dateInput.value = todayLocalISO;
            if(document.getElementById('dd-entry-date')) document.getElementById('dd-entry-date').value = todayLocalISO;
            if(document.getElementById('summary-date-picker')) document.getElementById('summary-date-picker').value = todayLocalISO;
        }
        
        window.setCurrentHour(); loadDraft(); setTimeout(applyDefaultsAndSyncs, 50);
        
        const sessionData = await initializeApplication(true);
        
        if (sessionData) {
            window.currentUser = sessionData.user;
            window.userRole = sessionData.role;
            
            let fullName = sessionData.user.email.split('@')[0];
            if (navigator.onLine) {
                try {
                    const { data: roleData } = await supabase.from('user_roles').select('full_name').eq('email', sessionData.user.email).maybeSingle();
                    if (roleData && roleData.full_name) {
                        fullName = roleData.full_name;
                        localStorage.setItem('makarigad_user_fullname', fullName);
                    }
                } catch (e) {
                    console.warn("Could not fetch full name, using cached offline name.");
                    fullName = localStorage.getItem('makarigad_user_fullname') || fullName;
                }
            } else {
                fullName = localStorage.getItem('makarigad_user_fullname') || fullName;
            }
            window.currentUserName = fullName;
            
            const userNameEl = document.getElementById('hourly-user-name');
            if (userNameEl) userNameEl.innerText = fullName;
            
            const userRoleEl = document.getElementById('hourly-user-role');
            if (userRoleEl) userRoleEl.innerText = sessionData.role.toUpperCase();
            
            const logOpEl = document.getElementById('log-operator');
            if (logOpEl) logOpEl.value = fullName; 

            if (sessionData.role === 'staff') {
                document.querySelectorAll('#hourly-form input, #hourly-form select, #hourly-form textarea').forEach(el => { el.disabled = true; el.classList.add('bg-slate-100', 'cursor-not-allowed', 'opacity-70'); });
                document.querySelectorAll('#hourly-form button[type="submit"], #save-btn, .delete-btn, #scada-audit-btn').forEach(btn => { if (btn) btn.style.display = 'none'; });
                const banner = document.createElement('div'); banner.className = 'fixed top-0 left-0 w-full bg-amber-500 text-white text-center text-[11px] font-black py-2.5 z-[9999] tracking-widest uppercase shadow-lg';
                banner.innerText = '⚠️ READ-ONLY MODE: Management Staff cannot edit Hourly Logs.'; document.body.appendChild(banner);
            }

            if (sessionData.role === 'admin' || sessionData.role === 'staff') {
                document.getElementById('scada-audit-btn')?.classList.remove('role-hidden');
                document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('role-hidden'));
            }
            updateDates(); 
        } else {
            const userNameEl = document.getElementById('hourly-user-name');
            if (userNameEl) userNameEl.innerText = "Not Logged In";
        }
    } catch (e) {
        console.error("Auth Error:", e);
        const userNameEl = document.getElementById('hourly-user-name');
        if (userNameEl) userNameEl.innerText = "Auth Error";
    }
}

const faultCategories = ['Dispatch instruction', 'Non-Dispatch', 'Grid Faults', '132 kV line faults', '33 kV line fault', 'penstock pipe fault', 'plant equipment issue'];

document.getElementById('dd-entry-time')?.addEventListener('change', async (e) => {
    document.getElementById('section-rainfall').classList.add('hidden');
    document.getElementById('section-noon').classList.add('hidden');
    document.getElementById('section-waiting').classList.add('hidden');

    const targetDate = document.getElementById('dd-entry-date').value;

    if (e.target.value === '08:00') {
        document.getElementById('section-rainfall').classList.remove('hidden');
        
        // AUTOMATICALLY FETCH EXISTING RAINFALL DATA
        try {
            const nepaliDateStr = document.getElementById('nepali-date-display')?.innerText || '';
            const nums = nepaliDateStr.match(/\d+/g);
            
            if (nums && nums.length >= 3) {
                const nYear = parseInt(nums[0]);
                const nMonth = parseInt(nums[1]);
                const nDay = parseInt(nums[2]);
                const safeDayStr = String(nDay).padStart(2, '0');
                
                const bsMonthNames = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashoj", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
                const monthName = bsMonthNames[nMonth - 1] || '';
                
                const rainId = `${nYear}_${monthName}_${safeDayStr}`;
                const { data: curRain } = await supabase.from('rainfall_data').select('headworks, powerhouse').eq('id', rainId).maybeSingle();
                
                if (curRain) {
                    if (document.getElementById('inp-rain-dam')) document.getElementById('inp-rain-dam').value = curRain.headworks !== null ? curRain.headworks : '';
                    if (document.getElementById('inp-rain-ph')) document.getElementById('inp-rain-ph').value = curRain.powerhouse !== null ? curRain.powerhouse : '';
                } else {
                    if (document.getElementById('inp-rain-dam')) document.getElementById('inp-rain-dam').value = '';
                    if (document.getElementById('inp-rain-ph')) document.getElementById('inp-rain-ph').value = '';
                }
            }
        } catch (err) { console.error("Error fetching existing rainfall:", err); }

    } else if (e.target.value === '12:00') {
        document.getElementById('section-noon').classList.remove('hidden');
        
        // --- NEW: AUTOMATICALLY FETCH EXISTING 12:00 PM DATA ---
        try {
            if (targetDate) {
                // 1. Load Existing Substation (Balanch) Data
                const { data: curBal } = await supabase.from('balanch_readings').select('*').eq('eng_date', targetDate).maybeSingle();
                const m = (id, val) => { const el = document.getElementById(id); if (el) el.value = val !== null && val !== undefined ? val : ''; };
                
                if (curBal) {
                    m('inp-bal-main-exp', curBal.main_export);
                    m('inp-bal-main-imp', curBal.main_import);
                    m('inp-bal-chk-exp', curBal.check_export);
                    m('inp-bal-chk-imp', curBal.check_import);
                } else {
                    ['inp-bal-main-exp', 'inp-bal-main-imp', 'inp-bal-chk-exp', 'inp-bal-chk-imp'].forEach(id => m(id, ''));
                }

                // 2. Check Existing Outages/Faults
                const { data: curOut } = await supabase.from('outages').select('fault_details').eq('id', targetDate).maybeSingle();
                const faultContainer = document.getElementById('faults-container');
                faultContainer.innerHTML = ''; 
                
                // Create a status banner for existing faults
                let faultInfoDiv = document.getElementById('existing-faults-info');
                if (!faultInfoDiv) {
                    faultInfoDiv = document.createElement('div');
                    faultInfoDiv.id = 'existing-faults-info';
                    faultContainer.parentNode.insertBefore(faultInfoDiv, faultContainer);
                }

                if (curOut && curOut.fault_details && curOut.fault_details.length > 0) {
                    faultInfoDiv.innerHTML = `<div class="mb-3 p-3 bg-blue-50 text-blue-800 text-xs font-bold rounded border border-blue-200">ℹ️ ${curOut.fault_details.length} fault(s) already saved for today. Adding new ones below will append to the day's record.</div>`;
                } else {
                    faultInfoDiv.innerHTML = '';
                }
                
                // Add one blank fault row to start
                addFaultRow();
            }
        } catch (err) {
            console.error("Error fetching 12:00 PM data:", err);
        }
        // -------------------------------------------------------

    } else {
        document.getElementById('section-waiting').classList.remove('hidden');
    }
});

function addFaultRow() {
    const container = document.getElementById('faults-container');
    const rowId = 'fault-' + Date.now();
    let options = faultCategories.map(c => `<option value="${c}">${c}</option>`).join('');
    
    const html = `
    <div class="fault-row bg-slate-50 p-4 rounded border border-slate-200 relative mb-3" id="${rowId}">
        <button type="button" onclick="document.getElementById('${rowId}').remove()" class="absolute top-2 right-2 text-rose-500 hover:text-rose-700 font-bold text-lg">&times;</button>
        <div class="grid grid-cols-12 gap-4 mb-4">
            <div class="col-span-12 md:col-span-3">
                <label class="block text-[10px] font-bold text-slate-500 uppercase">Type of Fault</label>
                <select class="f-type w-full border p-2 rounded text-sm font-bold text-rose-700 outline-none">${options}</select>
            </div>
            <div class="col-span-12 md:col-span-5">
                <label class="block text-[10px] font-bold text-slate-500 uppercase">Reason for Tripping / Event</label>
                <input type="text" class="f-reason w-full border p-2 rounded text-sm outline-none" placeholder="e.g. Tree fall in 33kV">
            </div>
            <div class="col-span-6 md:col-span-2">
                <label class="block text-[10px] font-bold text-slate-500 uppercase">Plant Power</label>
                <input type="number" step="any" class="f-power w-full border p-2 rounded text-sm outline-none" placeholder="MW">
            </div>
            <div class="col-span-6 md:col-span-2 f-dispatch-container hidden">
                <label class="block text-[10px] font-bold text-purple-600 uppercase">Dispatch Target</label>
                <input type="number" step="any" class="f-dispatch-power w-full border border-purple-300 bg-purple-50 p-2 rounded text-sm outline-none" placeholder="MW">
            </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
            <div class="flex space-x-2"><div class="w-1/2"><label class="block text-[10px] font-bold text-slate-500 uppercase">Start Date</label><input type="date" class="f-start-date w-full border p-2 rounded text-sm"></div>
            <div class="w-1/2"><label class="block text-[10px] font-bold text-slate-500 uppercase">Start Time</label><input type="time" class="f-start-time w-full border p-2 rounded text-sm"></div></div>
            <div class="flex space-x-2"><div class="w-1/2"><label class="block text-[10px] font-bold text-slate-500 uppercase">End Date</label><input type="date" class="f-end-date w-full border p-2 rounded text-sm"></div>
            <div class="w-1/2"><label class="block text-[10px] font-bold text-slate-500 uppercase">End Time</label><input type="time" class="f-end-time w-full border p-2 rounded text-sm"></div></div>
        </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
    
    const newRow = document.getElementById(rowId);
    newRow.querySelector('.f-type').addEventListener('change', function() {
        const dispatchCont = newRow.querySelector('.f-dispatch-container');
        if (this.value === 'Dispatch instruction') dispatchCont.classList.remove('hidden');
        else dispatchCont.classList.add('hidden');
    });
}

const btnAddFault = document.getElementById('btn-add-fault');
if(btnAddFault) {
    btnAddFault.replaceWith(btnAddFault.cloneNode(true));
    document.getElementById('btn-add-fault').addEventListener('click', addFaultRow);
}

const btnRain = document.getElementById('btn-save-rainfall');
if(btnRain) {
    btnRain.replaceWith(btnRain.cloneNode(true));
    document.getElementById('btn-save-rainfall').addEventListener('click', async () => {
        const btn = document.getElementById('btn-save-rainfall');
        const originalText = btn.innerText;
        btn.innerText = "Saving..."; 
        btn.disabled = true;

        try {
            const nepaliDateStr = document.getElementById('nepali-date-display')?.innerText || ''; 
            const nums = nepaliDateStr.match(/\d+/g) || [2081, 1, 1];
            const nYear = parseInt(nums[0]);
            const nMonth = parseInt(nums[1]);
            const nDay = parseInt(nums[2]);
            
            // THE FIX: Secure the leading zero so Daily Master can see it
            const safeDayStr = String(nDay).padStart(2, '0');
            
            const bsMonthNames = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashoj", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
            const monthName = bsMonthNames[nMonth - 1] || '';

            const rainId = `${nYear}_${monthName}_${safeDayStr}`;

            // Fetch existing so we don't accidentally overwrite anything
            const { data: curRain } = await supabase.from('rainfall_data').select('*').eq('id', rainId).maybeSingle();

            const payload = {
                ...(curRain || {}),
                id: rainId,
                nepali_year: nYear,
                nepali_month: monthName,
                day: nDay,
                headworks: parseFloat(document.getElementById('inp-rain-dam').value) || 0,
                powerhouse: parseFloat(document.getElementById('inp-rain-ph').value) || 0,
                operator_email: window.currentUser?.email || null,
                operator_uid: window.currentUser?.id || null,
                updated_at: new Date().toISOString()
            };
            
            const { error } = await supabase.from('rainfall_data').upsert(payload);
            
            if(error) {
                alert("❌ Database Error saving rainfall:\n" + error.message);
                showNotification("❌ Error: " + error.message, true);
            } else {
                // THE FIX: Unmissable success alert
                const successMsg = "✅ 08:00 AM Rainfall Synced to Daily Master!";
                alert(successMsg);
                showNotification(successMsg);
            }
        } catch (err) {
            alert("❌ Critical Error:\n" + err.message);
            console.error(err);
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    });
}

const btnNoon = document.getElementById('btn-save-noon');
if(btnNoon) {
    btnNoon.replaceWith(btnNoon.cloneNode(true));
    document.getElementById('btn-save-noon').addEventListener('click', async () => {
        const btn = document.getElementById('btn-save-noon');
        btn.innerText = "Syncing..."; btn.disabled = true;

        try {
            const targetDate = document.getElementById('dd-entry-date').value;
            if (!targetDate) throw new Error("Please select an English Date first.");
            
            // 1. Save Substation Readings
            const balPayload = {
                eng_date: targetDate,
                main_export: parseFloat(document.getElementById('inp-bal-main-exp').value) || 0,
                main_import: parseFloat(document.getElementById('inp-bal-main-imp').value) || 0,
                check_export: parseFloat(document.getElementById('inp-bal-chk-exp').value) || 0,
                check_import: parseFloat(document.getElementById('inp-bal-chk-imp').value) || 0,
                operator_email: window.currentUser?.email || null,
                operator_uid: window.currentUser?.id || null,
            };
            const { error: balErr } = await supabase.from('balanch_readings').upsert(balPayload);
            if (balErr) throw new Error("Substation Save Error: " + balErr.message);

            // FIX: Safely Sync these Balanch readings to the Daily Metering (plant_data) table
            // Must fetch existing plant_data to avoid overwriting the morning generation data
            const { data: curPlant } = await supabase.from('plant_data').select('*').eq('id', targetDate).maybeSingle();
            const plantSyncPayload = {
                ...(curPlant || {}),
                id: targetDate,
                updated_at: new Date().toISOString(),
                export_substation: balPayload.main_export,
                import_substation: balPayload.main_import
            };
            const { error: plantSyncErr } = await supabase.from('plant_data').upsert(plantSyncPayload);
            if (plantSyncErr) throw new Error("Daily Metering Sync Error: " + plantSyncErr.message);

            

            // 2. Gather Outages
            const { data: existingOutage } = await supabase.from('outages').select('*').eq('id', targetDate).maybeSingle();
            let faultDetailsArray = existingOutage && existingOutage.fault_details ? [...existingOutage.fault_details] : [];

            let newDetailsArray = [];
            const u1Stat = document.getElementById('u1-status')?.value || 'O';
            const u2Stat = document.getElementById('u2-status')?.value || 'O';

            document.querySelectorAll('.fault-row').forEach(row => {
                const type = row.querySelector('.f-type').value;
                const reason = row.querySelector('.f-reason').value.trim() || 'No reason provided';
                const startD = row.querySelector('.f-start-date').value;
                const startT = row.querySelector('.f-start-time').value;
                const endD = row.querySelector('.f-end-date').value;
                const endT = row.querySelector('.f-end-time').value;
                
                if(!startD || !startT || !endD || !endT) return;

                const start = new Date(`${startD}T${startT}`);
                const end = new Date(`${endD}T${endT}`);
                const durMins = (end - start) / 60000;
                if(durMins <= 0) return;
                
                const plantMw = parseFloat(row.querySelector('.f-power').value) || 0;
                let lossMw = type === 'Dispatch instruction' ? Math.max(0, plantMw - (parseFloat(row.querySelector('.f-dispatch-power').value) || 0)) : plantMw;
                const mwh = lossMw * (durMins/60);
                
                newDetailsArray.push({
                    type: type, reason: reason, start: `${startD} ${startT}`, end: `${endD} ${endT}`, durMins: durMins, plantMw: plantMw, lossMw: lossMw, mwh: Number(mwh.toFixed(3))
                });
            });

            faultDetailsArray = [...faultDetailsArray, ...newDetailsArray];

            let agg = { disp: 0, non: 0, grid: 0, l132: 0, l33: 0, pen: 0, eq: 0, loss_time_min: 0, nea_trip: 0, u1_min: 0, u2_min: 0, trippings: faultDetailsArray.length };
            let reasonsText = [];

            faultDetailsArray.forEach(f => {
                reasonsText.push(f.reason);
                if (f.type === 'Dispatch instruction') { agg.disp += f.mwh; agg.nea_trip += f.durMins; }
                else if (f.type === 'Non-Dispatch') { agg.non += f.mwh; agg.nea_trip += f.durMins; }
                else if (f.type === 'Grid Faults') { agg.grid += f.mwh; agg.loss_time_min += f.durMins; }
                else if (f.type === '132 kV line faults') { agg.l132 += f.mwh; agg.loss_time_min += f.durMins; }
                else if (f.type === '33 kV line fault') { agg.l33 += f.mwh; }
                else if (f.type === 'penstock pipe fault') { agg.pen += f.mwh; }
                else if (f.type === 'plant equipment issue') { agg.eq += f.mwh; }
                
                if(f.type !== 'Dispatch instruction' && f.type !== 'Non-Dispatch' && f.type !== 'Grid Faults' && f.type !== '132 kV line faults'){
                    if (u1Stat === 'O') agg.u1_min += f.durMins;
                    if (u2Stat === 'O') agg.u2_min += f.durMins;
                }
            });

            // Fallback for older existing legacy summaries
            if (existingOutage && (!existingOutage.fault_details || existingOutage.fault_details.length === 0)) {
                 agg.disp += Number(existingOutage.nea_curtailed_energy || 0);
                 agg.grid += Number(existingOutage.energy_loss_line_trip || 0);
                 agg.eq += Number(existingOutage.energy_loss_other || 0);
            }

            const outagePayload = {
                id: targetDate,
                nea_curtailed_energy: Number((agg.disp + agg.non).toFixed(3)),
                nea_trip_loss_time_min: agg.nea_trip,
                no_of_trippings: agg.trippings,
                loss_time_min: agg.loss_time_min,
                loss_time_u1_min: agg.u1_min,
                loss_time_u2_min: agg.u2_min,
                energy_loss_line_trip: Number((agg.grid + agg.l132).toFixed(3)),
                energy_loss_other: Number((agg.l33 + agg.pen + agg.eq).toFixed(3)),
                total_energy_loss: Number((agg.disp + agg.non + agg.grid + agg.l132 + agg.l33 + agg.pen + agg.eq).toFixed(3)),
                reason: reasonsText.join(' + '),
                fault_details: faultDetailsArray, 
                updated_at: new Date().toISOString()
            };

            const { error: outErr } = await supabase.from('outages').upsert(outagePayload);
            if(outErr) throw new Error("Outages Save Error: " + outErr.message);

            // 3. Update Contract Energy (Monthly Summary)
            if (newDetailsArray.length > 0) {
                let newAgg = { disp: 0, non: 0, grid: 0, l132: 0, l33: 0, pen: 0, eq: 0 };
                newDetailsArray.forEach(f => {
                    if (f.type === 'Dispatch instruction') newAgg.disp += f.mwh;
                    else if (f.type === 'Non-Dispatch') newAgg.non += f.mwh;
                    else if (f.type === 'Grid Faults') newAgg.grid += f.mwh;
                    else if (f.type === '132 kV line faults') newAgg.l132 += f.mwh;
                    else if (f.type === '33 kV line fault') newAgg.l33 += f.mwh;
                    else if (f.type === 'penstock pipe fault') newAgg.pen += f.mwh;
                    else if (f.type === 'plant equipment issue') newAgg.eq += f.mwh;
                });

                const nepaliDateStr = document.getElementById('nepali-date-display')?.innerText || ''; 
                const nums = nepaliDateStr.match(/\d+/g);
                
                if(nums && nums.length >= 2) {
                    const nYear = parseInt(nums[0]);
                    const nMonth = parseInt(nums[1]);
                    const bsMonthNames = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashoj", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
                    const monthName = bsMonthNames[nMonth - 1];

                    const { data: ext } = await supabase.from('contract_energy').select('*').eq('year', nYear).eq('month', monthName).maybeSingle();
                    
                    if(ext) {
                        const { error: ceErr } = await supabase.from('contract_energy').update({
                            dispatch_mwh: (parseFloat(ext.dispatch_mwh)||0) + newAgg.disp,
                            forced_outage_mwh: (parseFloat(ext.forced_outage_mwh)||0) + newAgg.non,
                            grid_fault_mwh: (parseFloat(ext.grid_fault_mwh)||0) + newAgg.grid,
                            line_132kv_mwh: (parseFloat(ext.line_132kv_mwh)||0) + newAgg.l132,
                            fm_33kv_mwh: (parseFloat(ext.fm_33kv_mwh)||0) + newAgg.l33,
                            fm_penstock_mwh: (parseFloat(ext.fm_penstock_mwh)||0) + newAgg.pen,
                            fm_equipment_mwh: (parseFloat(ext.fm_equipment_mwh)||0) + newAgg.eq
                        }).eq('year', nYear).eq('month', monthName);
                        if(ceErr) console.error("Contract Energy Sync Error: ", ceErr);
                    }
                }
            }

            // Clean up the UI
            document.getElementById('faults-container').innerHTML = '';
            addFaultRow(); // Add a fresh blank row for next time
            
            const faultInfoDiv = document.getElementById('existing-faults-info');
            if (faultInfoDiv) faultInfoDiv.innerHTML = `<div class="mb-3 p-3 bg-emerald-50 text-emerald-800 text-xs font-bold rounded border border-emerald-200">✅ Data saved. Any new faults added below will be appended.</div>`;

            // --- THE FIX: Unmissable Popup Alerts ---
            const successMsg = "✅ 12:00 PM Data (Substation & Outages) Synced Successfully!";
            alert(successMsg);
            showNotification(successMsg);

        } catch (err) { 
            alert("❌ Critical Error:\n" + err.message);
            showNotification("❌ Error: " + err.message, true); 
            console.error(err);
        } finally { 
            btn.innerText = "Sync 12:00 PM Data to Database"; 
            btn.disabled = false; 
        }
    });
}

const btnLoadSum = document.getElementById('btn-load-summary');
if(btnLoadSum) {
    btnLoadSum.replaceWith(btnLoadSum.cloneNode(true));
    document.getElementById('btn-load-summary').addEventListener('click', async () => {
        const targetDate = document.getElementById('summary-date-picker').value;
        if (!targetDate) return;
        const btn = document.getElementById('btn-load-summary'); btn.innerText = "Loading...";

        try {
            const nepaliDateStr = document.getElementById('nepali-date-display')?.innerText || ''; 
            const nums = nepaliDateStr.match(/\d+/g) || [2081, 1, 1];
            const bsMonthNames = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashoj", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
            const rainfallId = `${nums[0]}_${bsMonthNames[nums[1] - 1]}_${nums[2]}`;

            const [balRes, rainRes, outRes] = await Promise.all([
                supabase.from('balanch_readings').select('*').eq('eng_date', targetDate).limit(1).maybeSingle(),
                supabase.from('rainfall_data').select('*').eq('id', rainfallId).limit(1).maybeSingle(),
                supabase.from('outages').select('*').eq('id', targetDate).limit(1).maybeSingle()
            ]);

            document.getElementById('summary-content').classList.remove('hidden');
            
            const b = balRes.data || {};
            const r = rainRes.data || {};
            const o = outRes.data || {};

            if(outRes.data) window.outagesDataCache = [outRes.data];

            document.getElementById('sum-bal-m-exp').innerText = b.main_export ?? '-';
            document.getElementById('sum-bal-m-imp').innerText = b.main_import ?? '-';
            document.getElementById('sum-bal-c-exp').innerText = b.check_export ?? '-';
            document.getElementById('sum-bal-c-imp').innerText = b.check_import ?? '-';

            document.getElementById('sum-rain-dam').innerText = r.headworks ?? '-';
            document.getElementById('sum-rain-ph').innerText = r.powerhouse ?? '-';

            document.getElementById('sum-out-trips').innerText = o.no_of_trippings ?? '0';
            document.getElementById('sum-out-grid').innerText = o.energy_loss_line_trip ?? '0';
            document.getElementById('sum-out-132').innerText = '0'; 
            document.getElementById('sum-out-disp').innerText = o.nea_curtailed_energy ?? '0';
            document.getElementById('sum-out-force').innerText = o.energy_loss_other ?? '0';
            document.getElementById('sum-out-time').innerText = o.loss_time_min ?? '0';

            const editBtnContainer = document.querySelector('.col-actions');
            if (editBtnContainer) {
                editBtnContainer.innerHTML = `<button onclick="editFaultModal('${targetDate}')" class="bg-amber-100 hover:bg-amber-200 transition text-amber-800 px-4 py-2 rounded text-xs font-bold shadow-sm">✏️ Edit</button>`;
            }

        } catch (e) {
            console.error(e);
            showNotification("Error loading summary: " + e.message, true);
        } finally { btn.innerText = "Load"; }
    });
}

window.editFaultModal = async function(rowId, faultIndex = null) {
    const row = window.outagesDataCache.find(r => r.id === rowId);
    if (!row || !row.fault_details) return showNotification("No detailed data to edit for this date.", true);
    
    let details = row.fault_details;
    let idx = faultIndex;
    
    if (idx === null || idx === undefined) {
        let promptStr = prompt(`Enter the Fault Number (1 to ${details.length}) you want to edit:\n\n` + details.map((d, i) => `${i+1}. ${d.type} (${d.mwh} MWh)`).join('\n'));
        if (!promptStr) return;
        idx = parseInt(promptStr) - 1;
    }
    
    if (idx < 0 || idx >= details.length) return showNotification("Invalid selection.", true);
    
    const d = details[idx];
    const newReason = prompt(`Edit Reason for ${d.type}:`, d.reason);
    if (newReason === null) return;
    
    const newMwh = prompt(`Edit MWh Loss for ${d.type}:`, d.mwh);
    if (newMwh === null) return;
    
    const parsedMwh = parseFloat(newMwh);
    if (isNaN(parsedMwh)) return showNotification("Invalid MWh value.", true);

    details[idx].reason = newReason;
    details[idx].mwh = Number(parsedMwh.toFixed(3));

    let agg = { dispatch_mwh: 0, forced_outage_mwh: 0, grid_fault_mwh: 0, line_132kv_mwh: 0, fm_33kv_mwh: 0, fm_penstock_mwh: 0, fm_equipment_mwh: 0, reasons: [] };
    
    details.forEach(f => {
        agg.reasons.push(f.reason);
        if(f.type === 'Dispatch instruction') agg.dispatch_mwh += f.mwh;
        else if(f.type === 'Non-Dispatch') agg.forced_outage_mwh += f.mwh;
        else if(f.type === 'Grid Faults') agg.grid_fault_mwh += f.mwh;
        else if(f.type === '132 kV line faults') agg.line_132kv_mwh += f.mwh;
        else if(f.type === '33 kV line fault') agg.fm_33kv_mwh += f.mwh;
        else if(f.type === 'penstock pipe fault') agg.fm_penstock_mwh += f.mwh;
        else if(f.type === 'plant equipment issue') agg.fm_equipment_mwh += f.mwh;
    });

    const updatePayload = {
        nea_curtailed_energy: Number((agg.dispatch_mwh + agg.forced_outage_mwh).toFixed(3)),
        energy_loss_line_trip: Number((agg.grid_fault_mwh + agg.line_132kv_mwh).toFixed(3)),
        energy_loss_other: Number((agg.fm_33kv_mwh + agg.fm_penstock_mwh + agg.fm_equipment_mwh).toFixed(3)),
        total_energy_loss: Number((agg.dispatch_mwh + agg.forced_outage_mwh + agg.grid_fault_mwh + agg.line_132kv_mwh + agg.fm_33kv_mwh + agg.fm_penstock_mwh + agg.fm_equipment_mwh).toFixed(3)),
        reason: agg.reasons.join(' + '),
        fault_details: details,
        updated_at: new Date().toISOString()
    };

    try {
        const { error } = await supabase.from('outages').update(updatePayload).eq('id', rowId);
        if (error) throw error;
        showNotification(`✅ Fault updated!`);
        if (document.getElementById('export-type') && document.getElementById('export-type').value === 'outages') {
            window.previewExportData();
        }
    } catch (err) {
        showNotification("❌ Failed to update: " + err.message, true);
    }
};

window.previewExportData = async function() {
    try {
        const type = document.getElementById('export-type')?.value;
        const container = document.getElementById('preview-table-container');
        const previewWrapper = document.getElementById('preview-wrapper');
        const info = document.getElementById('preview-page-info');
        const isDaily = window.isDailyExport; 

        if (type !== 'outages') {
            if (typeof window.originalPreviewExportData === 'function') await window.originalPreviewExportData();
            return;
        }

        previewWrapper.classList.remove('hidden');
        container.innerHTML = '<div class="p-6 text-center text-indigo-600 font-bold animate-pulse">Loading Detailed Data...</div>';

        const year = document.getElementById('export-year')?.value || '2081';
        const monthDropdown = document.getElementById('export-month');
        const monthName = monthDropdown ? monthDropdown.options[monthDropdown.selectedIndex].text : '';
        const targetDay = parseInt(document.getElementById('export-day')?.value || '1');
        
        const { data: plantData, error: plantError } = await supabase.from('calendar_mappings')
            .select('eng_date, nep_date_str, nep_year, nep_month, nep_day')
            .eq('nep_year', year); 
        
        if (plantError) throw plantError;

        let matchingEngDates = [];
        let dateMap = {};
        let displayNepDate = "";

        if (plantData) {
            plantData.forEach(pd => {
                dateMap[pd.eng_date] = pd.nep_date_str; 
                if (isDaily) {
                    if (pd.nep_month === monthName && parseInt(pd.nep_day) === targetDay) {
                        matchingEngDates.push(pd.eng_date);
                        displayNepDate = pd.nep_date_str;
                    }
                } else {
                    if (pd.nep_month === monthName) {
                        matchingEngDates.push(pd.eng_date);
                    }
                }
            });
        }

        if (matchingEngDates.length === 0) {
            matchingEngDates.push(document.getElementById('log-date').value);
            displayNepDate = document.getElementById('nepali-date-display')?.innerText || '';
        }

        info.innerText = isDaily ? `Preview: ${displayNepDate || matchingEngDates[0]}` : `Preview: ${year} ${monthName}`;

        const { data, error } = await supabase.from('outages').select('*').in('id', matchingEngDates).order('id', { ascending: true });

        if (error || !data || data.length === 0) {
            container.innerHTML = `<div class="p-6 text-center text-rose-600 font-bold">❌ No Outages found for the selected date(s).</div>`;
            return;
        }

        window.outagesDataCache = data; 
        
        let mTotals = { grand: 0 };
        const cats = ['disp', 'non', 'grid', 'l132', 'l33', 'pen', 'eq'];
        cats.forEach(c => mTotals[c] = { mins: 0, mwh: 0 });
        
        let detailedHtmlTable = `
            <h3 class="font-bold text-lg text-rose-900 mb-2 border-b border-rose-100 pb-1 mt-2">1. Detailed Fault Matrix</h3>
            <div class="overflow-x-auto max-h-[600px] custom-scroll border border-slate-300 shadow-sm rounded-lg mb-8">
            <table class="w-full text-[11px] text-left border-collapse whitespace-nowrap">
                <thead class="bg-slate-100 text-slate-800 border-b-2 border-slate-300 sticky top-0 z-10 shadow-sm text-center tracking-wider uppercase text-[10px]">
                    <tr>
                        <th class="p-2 border-r border-slate-300 align-middle w-24" rowspan="2">Nepali Date</th>
                        <th class="p-2 border-r border-slate-300 bg-purple-50" colspan="2">Dispatch Details</th>
                        <th class="p-2 border-r border-slate-300 bg-orange-50" colspan="2">Non-Dispatch</th>
                        <th class="p-2 border-r border-slate-300 bg-red-50" colspan="2">Grid Faults</th>
                        <th class="p-2 border-r border-slate-300 bg-red-50" colspan="2">132kV Line</th>
                        <th class="p-2 border-r border-slate-300 bg-amber-50" colspan="2">33kV Line</th>
                        <th class="p-2 border-r border-slate-300 bg-blue-50" colspan="2">Penstock Pipe</th>
                        <th class="p-2 border-r border-slate-300 bg-emerald-50" colspan="2">Plant Equip.</th>
                        <th class="p-2 border-r border-slate-300 bg-rose-100 text-rose-900 align-middle" rowspan="2">Total Loss<br>(MWh)</th>
                        <th class="p-2 border-slate-300 align-middle" rowspan="2">Admin</th>
                     </tr>
                    <tr class="bg-slate-50 text-[10px] text-slate-600">
                        <th class="p-1 border-r border-t border-slate-300 w-16">Time</th><th class="p-1 border-r border-t border-slate-300 w-16">MWh</th>
                        <th class="p-1 border-r border-t border-slate-300 w-16">Time</th><th class="p-1 border-r border-t border-slate-300 w-16">MWh</th>
                        <th class="p-1 border-r border-t border-slate-300 w-16">Time</th><th class="p-1 border-r border-t border-slate-300 w-16">MWh</th>
                        <th class="p-1 border-r border-t border-slate-300 w-16">Time</th><th class="p-1 border-r border-t border-slate-300 w-16">MWh</th>
                        <th class="p-1 border-r border-t border-slate-300 w-16">Time</th><th class="p-1 border-r border-t border-slate-300 w-16">MWh</th>
                        <th class="p-1 border-r border-t border-slate-300 w-16">Time</th><th class="p-1 border-r border-t border-slate-300 w-16">MWh</th>
                        <th class="p-1 border-r border-t border-slate-300 w-16">Time</th><th class="p-1 border-r border-t border-slate-300 w-16">MWh</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let summaryHtmlTable = `
            <h3 class="font-bold text-lg text-indigo-900 mb-2 border-b border-indigo-100 pb-1">2. Daily Aggregated Totals</h3>
            <div class="overflow-x-auto max-h-[500px] custom-scroll border border-slate-300 shadow-sm rounded-lg mb-4">
            <table class="w-full text-[11px] text-left border-collapse whitespace-nowrap">
                <thead class="bg-indigo-50 text-indigo-900 border-b-2 border-indigo-200 sticky top-0 z-10 shadow-sm text-center tracking-wider uppercase text-[10px]">
                    <tr>
                        <th class="p-2 border-r border-indigo-200 text-left w-32">Nepali Date</th>
                        <th class="p-2 border-r border-indigo-200">Dispatch (MWh)</th>
                        <th class="p-2 border-r border-indigo-200">Non-Dispatch (MWh)</th>
                        <th class="p-2 border-r border-indigo-200">Grid Faults (MWh)</th>
                        <th class="p-2 border-r border-indigo-200">132kV Line (MWh)</th>
                        <th class="p-2 border-r border-indigo-200">33kV Line (MWh)</th>
                        <th class="p-2 border-r border-indigo-200">Penstock (MWh)</th>
                        <th class="p-2 border-r border-indigo-200">Equipment (MWh)</th>
                        <th class="p-2 border-indigo-200 text-rose-800">Total (MWh)</th>
                    </tr>
                </thead>
                <tbody>
        `;

        const buildCell = (details, fType) => {
            const faults = details.filter(f => f.type === fType);
            if (faults.length === 0) return '<td class="border-r border-slate-200 text-center text-slate-300 bg-slate-50/30 align-middle">-</td><td class="border-r border-slate-200 text-center text-slate-300 bg-slate-50/30 align-middle">-</td>';
            
            let timeHtml = faults.map(f => {
                const st = f.start ? f.start.split(' ')[1] : '-';
                const et = f.end ? f.end.split(' ')[1] : '-';
                const mins = Number(f.durMins || 0);
                return `<div class="min-h-[3rem] flex flex-col items-center justify-center px-1">
                            <span class="font-mono text-[9px] font-bold text-slate-600 whitespace-nowrap">${st} - ${et}</span>
                            <span class="text-[8px] text-slate-400">${mins.toFixed(0)}m</span>
                        </div>`;
            }).join('<hr class="border-slate-200 m-0">');

            let mwhHtml = faults.map(f => {
                const mwh = Number(f.mwh || 0).toFixed(3);
                const reason = f.reason || '-';
                return `<div class="min-h-[3rem] flex flex-col items-center justify-center px-1">
                            <span class="font-bold text-rose-600 text-[10px]">${mwh}</span>
                            <span class="text-[8px] text-slate-500 truncate w-20 text-center" title="${reason}">${reason}</span>
                        </div>`;
            }).join('<hr class="border-slate-200 m-0">');
            
            return `<td class="border-r border-slate-200 align-top bg-white p-0">${timeHtml}</td><td class="border-r border-slate-200 align-top bg-white p-0">${mwhHtml}</td>`;
        };

        data.forEach(row => {
            const details = row.fault_details || [];
            const dailyTotal = Number(row.total_energy_loss || 0);
            const nepaliDateStr = dateMap[row.id] || row.id;
            
            let dTotals = { grand: dailyTotal };
            cats.forEach(c => dTotals[c] = { mins: 0, mwh: 0 });
            
            details.forEach(f => {
                const m = Number(f.mwh || 0);
                const mins = Number(f.durMins || 0);
                if(f.type === 'Dispatch instruction') { dTotals.disp.mwh += m; dTotals.disp.mins += mins; }
                else if(f.type === 'Non-Dispatch') { dTotals.non.mwh += m; dTotals.non.mins += mins; }
                else if(f.type === 'Grid Faults') { dTotals.grid.mwh += m; dTotals.grid.mins += mins; }
                else if(f.type === '132 kV line faults') { dTotals.l132.mwh += m; dTotals.l132.mins += mins; }
                else if(f.type === '33 kV line fault') { dTotals.l33.mwh += m; dTotals.l33.mins += mins; }
                else if(f.type === 'penstock pipe fault') { dTotals.pen.mwh += m; dTotals.pen.mins += mins; }
                else if(f.type === 'plant equipment issue') { dTotals.eq.mwh += m; dTotals.eq.mins += mins; }
            });

            if(details.length === 0) {
                dTotals.disp.mwh = Number(row.nea_curtailed_energy || 0); 
                dTotals.grid.mwh = Number(row.energy_loss_line_trip || 0);
                dTotals.eq.mwh = Number(row.energy_loss_other || 0);
                dTotals.grid.mins = Number(row.loss_time_min || 0);
            }

            cats.forEach(c => {
                mTotals[c].mwh += dTotals[c].mwh;
                mTotals[c].mins += dTotals[c].mins;
            });
            mTotals.grand += dTotals.grand;

            if (details.length > 0) {
                detailedHtmlTable += `
                    <tr class="border-b border-slate-200 hover:bg-slate-50">
                        <td class="p-2 border-r text-center align-top whitespace-normal w-24">
                            <span class="font-bold text-indigo-700 block">${nepaliDateStr}</span>
                            <span class="text-[9px] text-slate-400 font-mono block mt-1">${row.id}</span>
                        </td>
                        ${buildCell(details, 'Dispatch instruction')}
                        ${buildCell(details, 'Non-Dispatch')}
                        ${buildCell(details, 'Grid Faults')}
                        ${buildCell(details, '132 kV line faults')}
                        ${buildCell(details, '33 kV line fault')}
                        ${buildCell(details, 'penstock pipe fault')}
                        ${buildCell(details, 'plant equipment issue')}
                        <td class="p-2 border-r font-black text-center text-rose-600 bg-rose-50 align-middle">${dailyTotal.toFixed(3)}</td>
                        <td class="p-2 align-middle text-center">
                            <button onclick="editFaultModal('${row.id}')" class="bg-amber-100 hover:bg-amber-200 text-amber-800 px-2 py-1 rounded font-bold shadow-sm text-[10px] w-full">✏️ Edit</button>
                        </td>
                    </tr>
                `;
            } else {
                 detailedHtmlTable += `
                    <tr class="border-b border-slate-200 hover:bg-slate-50 text-center bg-slate-50/50">
                        <td class="p-2 border-r text-center align-top whitespace-normal w-24">
                            <span class="font-bold text-indigo-700 block">${nepaliDateStr}</span>
                            <span class="text-[9px] text-slate-400 font-mono block mt-1">${row.id}</span>
                        </td>
                        <td class="p-2 border-r text-center text-slate-400 align-middle">-</td><td class="p-2 border-r text-purple-700 font-medium align-middle">${dTotals.disp.mwh > 0 ? dTotals.disp.mwh.toFixed(3) : '-'}</td>
                        <td class="p-2 border-r text-center text-slate-400 align-middle">-</td><td class="p-2 border-r text-orange-700 font-medium align-middle">-</td>
                        <td class="p-2 border-r text-center text-slate-400 align-middle">-</td><td class="p-2 border-r text-red-700 font-medium align-middle">${dTotals.grid.mwh > 0 ? dTotals.grid.mwh.toFixed(3) : '-'}</td>
                        <td class="p-2 border-r text-center text-slate-400 align-middle">-</td><td class="p-2 border-r text-red-700 font-medium align-middle">-</td>
                        <td class="p-2 border-r text-center text-slate-400 align-middle">-</td><td class="p-2 border-r text-amber-700 font-medium align-middle">-</td>
                        <td class="p-2 border-r text-center text-slate-400 align-middle">-</td><td class="p-2 border-r text-blue-700 font-medium align-middle">-</td>
                        <td class="p-2 border-r text-center text-slate-400 align-middle">-</td><td class="p-2 border-r text-emerald-700 font-medium align-middle">${dTotals.eq.mwh > 0 ? dTotals.eq.mwh.toFixed(3) : '-'}</td>
                        <td class="p-2 border-r font-black text-rose-600 bg-rose-50 align-middle">${dailyTotal.toFixed(3)}</td>
                        <td class="p-2 text-slate-400 italic text-[10px] align-middle">Legacy</td>
                    </tr>
                `;
            }

            const nepDayMatch = nepaliDateStr.match(/\d+/g);
            const nepDay = nepDayMatch && nepDayMatch.length >= 3 ? nepDayMatch[2] : row.id.split('-')[2];
            
            detailedHtmlTable += `
                <tr class="bg-slate-100 text-center font-bold border-b-[3px] border-slate-400 text-[10px]">
                    <td class="p-2 border-r text-right uppercase text-slate-500 tracking-widest">Total Day ${nepDay}</td>
                    <td class="p-1 border-r text-slate-500">${dTotals.disp.mins > 0 ? dTotals.disp.mins + 'm' : '-'}</td><td class="p-1 border-r text-purple-700">${dTotals.disp.mwh > 0 ? dTotals.disp.mwh.toFixed(3) : '-'}</td>
                    <td class="p-1 border-r text-slate-500">${dTotals.non.mins > 0 ? dTotals.non.mins + 'm' : '-'}</td><td class="p-1 border-r text-orange-700">${dTotals.non.mwh > 0 ? dTotals.non.mwh.toFixed(3) : '-'}</td>
                    <td class="p-1 border-r text-slate-500">${dTotals.grid.mins > 0 ? dTotals.grid.mins + 'm' : '-'}</td><td class="p-1 border-r text-red-700">${dTotals.grid.mwh > 0 ? dTotals.grid.mwh.toFixed(3) : '-'}</td>
                    <td class="p-1 border-r text-slate-500">${dTotals.l132.mins > 0 ? dTotals.l132.mins + 'm' : '-'}</td><td class="p-1 border-r text-red-700">${dTotals.l132.mwh > 0 ? dTotals.l132.mwh.toFixed(3) : '-'}</td>
                    <td class="p-1 border-r text-slate-500">${dTotals.l33.mins > 0 ? dTotals.l33.mins + 'm' : '-'}</td><td class="p-1 border-r text-amber-700">${dTotals.l33.mwh > 0 ? dTotals.l33.mwh.toFixed(3) : '-'}</td>
                    <td class="p-1 border-r text-slate-500">${dTotals.pen.mins > 0 ? dTotals.pen.mins + 'm' : '-'}</td><td class="p-1 border-r text-blue-700">${dTotals.pen.mwh > 0 ? dTotals.pen.mwh.toFixed(3) : '-'}</td>
                    <td class="p-1 border-r text-slate-500">${dTotals.eq.mins > 0 ? dTotals.eq.mins + 'm' : '-'}</td><td class="p-1 border-r text-emerald-700">${dTotals.eq.mwh > 0 ? dTotals.eq.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r text-rose-800 text-sm">${dailyTotal.toFixed(3)}</td>
                    <td></td>
                </tr>
            `;

            summaryHtmlTable += `
                <tr class="border-b border-slate-200 hover:bg-slate-50 text-center">
                    <td class="p-2 border-r font-bold text-indigo-700 text-left w-32 whitespace-normal">${nepaliDateStr}</td>
                    <td class="p-2 border-r">${dTotals.disp.mwh > 0 ? dTotals.disp.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r">${dTotals.non.mwh > 0 ? dTotals.non.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r">${dTotals.grid.mwh > 0 ? dTotals.grid.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r">${dTotals.l132.mwh > 0 ? dTotals.l132.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r">${dTotals.l33.mwh > 0 ? dTotals.l33.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r">${dTotals.pen.mwh > 0 ? dTotals.pen.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r">${dTotals.eq.mwh > 0 ? dTotals.eq.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 font-bold text-rose-700 bg-rose-50">${dTotals.grand.toFixed(3)}</td>
                </tr>
            `;
        });

        if (!isDaily) {
            const grandTotalRow = `
                <tr class="bg-slate-800 text-white font-bold text-sm text-center">
                    <td class="p-3 border-r text-right tracking-widest uppercase">MONTHLY TOTAL:</td>
                    <td class="p-2 border-r text-indigo-300 text-xs">${mTotals.disp.mins > 0 ? mTotals.disp.mins + 'm' : '-'}</td><td class="p-2 border-r text-purple-300">${mTotals.disp.mwh > 0 ? mTotals.disp.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r text-indigo-300 text-xs">${mTotals.non.mins > 0 ? mTotals.non.mins + 'm' : '-'}</td><td class="p-2 border-r text-orange-300">${mTotals.non.mwh > 0 ? mTotals.non.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r text-indigo-300 text-xs">${mTotals.grid.mins > 0 ? mTotals.grid.mins + 'm' : '-'}</td><td class="p-2 border-r text-red-300">${mTotals.grid.mwh > 0 ? mTotals.grid.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r text-indigo-300 text-xs">${mTotals.l132.mins > 0 ? mTotals.l132.mins + 'm' : '-'}</td><td class="p-2 border-r text-red-300">${mTotals.l132.mwh > 0 ? mTotals.l132.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r text-indigo-300 text-xs">${mTotals.l33.mins > 0 ? mTotals.l33.mins + 'm' : '-'}</td><td class="p-2 border-r text-amber-300">${mTotals.l33.mwh > 0 ? mTotals.l33.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r text-indigo-300 text-xs">${mTotals.pen.mins > 0 ? mTotals.pen.mins + 'm' : '-'}</td><td class="p-2 border-r text-blue-300">${mTotals.pen.mwh > 0 ? mTotals.pen.mwh.toFixed(3) : '-'}</td>
                    <td class="p-2 border-r text-indigo-300 text-xs">${mTotals.eq.mins > 0 ? mTotals.eq.mins + 'm' : '-'}</td><td class="p-2 border-r text-emerald-300">${mTotals.eq.mwh > 0 ? mTotals.eq.mwh.toFixed(3) : '-'}</td>
                    <td class="p-3 font-black text-rose-300 text-base" colspan="2">${mTotals.grand.toFixed(3)} MWh</td>
                </tr>
            `;
            const summaryGrandTotalRow = `
                <tr class="bg-slate-800 text-white font-bold text-sm text-center">
                    <td class="p-3 border-r text-right tracking-widest uppercase">MONTHLY TOTAL:</td>
                    <td class="p-3 border-r">${mTotals.disp.mwh > 0 ? mTotals.disp.mwh.toFixed(3) : '-'}</td>
                    <td class="p-3 border-r">${mTotals.non.mwh > 0 ? mTotals.non.mwh.toFixed(3) : '-'}</td>
                    <td class="p-3 border-r">${mTotals.grid.mwh > 0 ? mTotals.grid.mwh.toFixed(3) : '-'}</td>
                    <td class="p-3 border-r">${mTotals.l132.mwh > 0 ? mTotals.l132.mwh.toFixed(3) : '-'}</td>
                    <td class="p-3 border-r">${mTotals.l33.mwh > 0 ? mTotals.l33.mwh.toFixed(3) : '-'}</td>
                    <td class="p-3 border-r">${mTotals.pen.mwh > 0 ? mTotals.pen.mwh.toFixed(3) : '-'}</td>
                    <td class="p-3 border-r">${mTotals.eq.mwh > 0 ? mTotals.eq.mwh.toFixed(3) : '-'}</td>
                    <td class="p-3 font-black text-rose-300 text-base">${mTotals.grand.toFixed(3)}</td>
                </tr>
            `;

            detailedHtmlTable += grandTotalRow;
            summaryHtmlTable += summaryGrandTotalRow;
        }

        detailedHtmlTable += `</tbody></table></div>`;
        summaryHtmlTable += `</tbody></table></div>`;

        container.innerHTML = detailedHtmlTable + summaryHtmlTable;
        return;

    } catch (err) {
        console.error("Preview Error:", err);
        const container = document.getElementById('preview-table-container');
        if(container) container.innerHTML = `<div class="p-6 text-center text-rose-600 font-bold">❌ Error loading preview: ${err.message}</div>`;
    }
};

window.originalPreviewExportData = async function() {
    const type = document.getElementById('export-type').value;
    const container = document.getElementById('preview-table-container');
    const previewWrapper = document.getElementById('preview-wrapper');
    const info = document.getElementById('preview-page-info');
    const isDaily = window.isDailyExport; 
    const year = document.getElementById('export-year')?.value || '2081';
    const monthDropdown = document.getElementById('export-month');
    const monthName = monthDropdown ? monthDropdown.options[monthDropdown.selectedIndex].text : '';
    const targetDay = parseInt(document.getElementById('export-day')?.value || '1');

    previewWrapper.classList.remove('hidden');
    container.innerHTML = '<div class="p-6 text-center text-indigo-600 font-bold animate-pulse">Loading data...</div>';

    try {
        const { data: plantData, error: plantError } = await supabase.from('calendar_mappings')
            .select('eng_date, nep_date_str, nep_year, nep_month, nep_day')
            .eq('nep_year', year);

        if (plantError) throw plantError;

        let matchingEngDates = [];
        let dateMap = {};
        let displayNepDate = "";

        if (plantData) {
            plantData.forEach(pd => {
                dateMap[pd.eng_date] = pd.nep_date_str; 
                if (isDaily) {
                    if (pd.nep_month === monthName && parseInt(pd.nep_day) === targetDay) {
                        matchingEngDates.push(pd.eng_date);
                        displayNepDate = pd.nep_date_str;
                    }
                } else {
                    if (pd.nep_month === monthName) {
                        matchingEngDates.push(pd.eng_date);
                    }
                }
            });
        }

        if (matchingEngDates.length === 0) {
            matchingEngDates.push(document.getElementById('log-date').value);
            displayNepDate = document.getElementById('nepali-date-display')?.innerText || '';
        }

        info.innerText = isDaily ? `Preview: ${displayNepDate || matchingEngDates[0]}` : `Preview: ${year} ${monthName}`;

        const { data, error } = await supabase.from('hourly_logs').select('*').in('log_date', matchingEngDates).order('log_date', { ascending: true }).order('log_time', { ascending: true });

        if (error) throw error;
        if (!data || data.length === 0) {
            container.innerHTML = `<div class="p-6 text-center text-rose-600 font-bold">❌ No data found for the selected date(s).</div>`;
            return;
        }

        window.previewDataCache = data; 
        let fullHtml = '';
        
        matchingEngDates.forEach((date, idx) => {
            const dayData = data.filter(d => d.log_date === date);
            if(dayData.length > 0) {
                const nepDate = dateMap[date] || '';
                fullHtml += `<div class="mb-8 ${idx > 0 ? 'border-t-4 border-slate-300 pt-8' : ''}">`;
                if (!isDaily) fullHtml += `<h3 class="font-black text-indigo-800 mb-4 text-lg bg-indigo-50 inline-block px-4 py-1 rounded-lg">Day ${idx + 1} &nbsp; | &nbsp; ${nepDate}</h3>`;
                fullHtml += window.generateTableHTML(dayData, nepDate, date, monthName, false, type, false);
                fullHtml += `</div>`;
            }
        });

        container.innerHTML = fullHtml || `<div class="p-6 text-center text-rose-600 font-bold">❌ No data found.</div>`;
    } catch (err) {
        console.error("Preview Error:", err);
        container.innerHTML = `<div class="p-6 text-center text-rose-600 font-bold">❌ Error loading preview: ${err.message}</div>`;
    }
};

window.downloadExcel = async function() {
    if (!window.previewDataCache || window.previewDataCache.length === 0) { await window.previewExportData(); }
    setTimeout(async () => {
        const data = window.previewDataCache;
        if (!data || data.length === 0) return showNotification('No data to export.', true);
        const type = document.getElementById('export-type').value;
        const monthSelect = document.getElementById('export-month');
        const monthName = monthSelect ? monthSelect.options[monthSelect.selectedIndex].text : '';
        const wb = XLSX.utils.book_new();
        const uniqueDates = [...new Set(data.map(d => d.log_date))];
        const { data: calMap } = await supabase.from('calendar_mappings').select('eng_date, nep_date_str').in('eng_date', uniqueDates);

        uniqueDates.forEach((date, idx) => {
            const dayData = data.filter(d => d.log_date === date);
            const pdMatch = calMap ? calMap.find(p => p.eng_date === date) : null;
            const nepDate = (pdMatch && pdMatch.nep_date_str) ? pdMatch.nep_date_str : '';
            const html = window.generateTableHTML(dayData, nepDate, date, monthName, false, type, false);
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const table = tempDiv.querySelector('.excel-table');
            if(table) XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(table), `Day ${idx + 1}`);
        });
        XLSX.writeFile(wb, `Makari_Gad_${type}.xlsx`);
    }, 500);
};

window.downloadPDF = async function() {
    if (!window.previewDataCache || window.previewDataCache.length === 0) { await window.previewExportData(); }
    setTimeout(async () => {
        const data = window.previewDataCache;
        if (!data || data.length === 0) return showNotification('No data to export.', true);

        const type = document.getElementById('export-type').value;
        const monthSelect = document.getElementById('export-month');
        const monthNum = monthSelect ? parseInt(monthSelect.value) : 1;
        const monthName = monthSelect ? monthSelect.options[monthSelect.selectedIndex].text : '';
        const yearNum = parseInt(document.getElementById('export-year').value || 2082);
        const fyString = monthNum >= 4 ? `${yearNum}/${yearNum + 1}` : `${yearNum - 1}/${yearNum}`;

        const { jsPDF } = window.jspdf; const doc = new jsPDF('landscape', 'pt', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth(); const pageHeight = doc.internal.pageSize.getHeight();
        const uniqueDates = [...new Set(data.map(d => d.log_date))];
        const { data: calMap } = await supabase.from('calendar_mappings').select('eng_date, nep_date_str').in('eng_date', uniqueDates);

        uniqueDates.forEach((date, idx) => {
            if (idx > 0) doc.addPage();
            const dayData = data.filter(d => d.log_date === date);
            const pdMatch = calMap ? calMap.find(p => p.eng_date === date) : null;
            const nepD = (pdMatch && pdMatch.nep_date_str) ? pdMatch.nep_date_str : '';
            
            let startY = 45;
            if (type === 'schedule3') {
                doc.setFont("times", "bold"); doc.setFontSize(10);
                doc.text("SCHEDULE 3: DAILY LOG SHEET", 15, 25);
                doc.text("Makari Gad Hydropower Limited", 15, 39); 
                doc.text("Site Office: Apihimal-5, Makarigad, Darchula", pageWidth * 0.65, 39);
                doc.text("Makari Gad Hydroelectric Project", 15, 51); 
                doc.setFont("times", "normal").text("Email: makarigad@gmail.com", pageWidth * 0.65, 51);
                doc.text("Head Office: Maharajgunj-3, Kathmandu", 15, 63); 
                doc.text("Tel: 9851275191", pageWidth * 0.65, 63);
                doc.text("Tel: 014720530", 15, 75); 
                doc.text(`Nepali Date: ${nepD}`, pageWidth * 0.35, 75); 
                doc.setFont("times", "bold").text(`FISCAL YEAR: ${fyString}     Month: ${monthName}`, 15, 89);
                doc.setFont("times", "normal").text(`English Date: ${date}`, pageWidth * 0.35, 89);
                startY = 109;

                const html = window.generateTableHTML(dayData, nepD, date, monthName, false, type, false);
                const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
                const table = tempDiv.querySelector('.excel-table');

                let shiftA = '', shiftB = '', shiftC = '';
                dayData.forEach(l => {
                    const t = l.log_time ? l.log_time.substring(0, 5) : '';
                    if (t === '05:00' && l.remarks) shiftA = l.remarks;
                    if (t === '13:00' && l.remarks) shiftB = l.remarks;
                    if (t === '21:00' && l.remarks) shiftC = l.remarks;
                });

                doc.autoTable({ 
                    html: table, startY: startY, theme: 'grid', useCss: false, 
                    styles: { font: 'times', fontSize: 7, cellPadding: 1.5, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.5, halign: 'center', valign: 'middle' },
                    headStyles: { fillColor: [255, 255, 255], textColor: [0,0,0], fontStyle: 'bold', font: 'times' },
                    margin: { top: startY, right: 15, bottom: 60, left: 15 }
                });

                const finalY = doc.lastAutoTable.finalY + 10;
                doc.setFont("times", "normal");
                doc.setFontSize(9);

                doc.text("Shift A", 15, finalY);
                doc.text("Shift B", 15 + 150, finalY);
                doc.text("Shift C", 15 + 300, finalY);

                doc.text("Signature: .............................", 15, finalY + 15);
                doc.text("Signature: .............................", 15 + 150, finalY + 15);
                doc.text("Signature: .............................", 15 + 300, finalY + 15);

                doc.text(`Name: ${shiftA}`, 15, finalY + 30);
                doc.text(`Name: ${shiftB}`, 15 + 150, finalY + 30);
                doc.text(`Name: ${shiftC}`, 15 + 300, finalY + 30);

                doc.text("Signature: .............................", 15, finalY + 45);
                doc.text("Name: Upendra Chand", 15, finalY + 60);
                doc.text("Designation: Plant Manager", 15, finalY + 75);
                doc.text("Official Seal", 15, finalY + 90);
            } 
        });
        const safeDate = uniqueDates[0] ? uniqueDates[0].replace(/[\/.]/g, '-') : 'Export';
        doc.save(`Makari_Gad_${type}_${safeDate}.pdf`);
    }, 500);
};

window.prevPreviewPage = function() { const dayInput = document.getElementById('export-day'); let d = parseInt(dayInput.value) || 2; if(d > 1) { dayInput.value = d - 1; window.previewExportData(); } };
window.nextPreviewPage = function() { const dayInput = document.getElementById('export-day'); let d = parseInt(dayInput.value) || 1; if(d < 32) { dayInput.value = d + 1; window.previewExportData(); } };
window.toggleExportRange = function() { window.isDailyExport = document.querySelector('input[name="export-range"]:checked').value === 'daily'; document.getElementById('export-day-container').style.display = window.isDailyExport ? 'block' : 'none'; }

// ==========================================
// ADMIN EXPORTS: PURGE DATA ENGINE
// ==========================================
window.purgeMonthData = async function() {
    if(window.userRole !== 'admin') return;
    const year = document.getElementById('export-year').value;
    const monthSelect = document.getElementById('export-month');
    const monthName = monthSelect.options[monthSelect.selectedIndex].text;
    const rawMonth = monthSelect.value;
    
    if(!confirm(`⚠️ DANGER: Are you sure you want to permanently delete ALL hourly logs for Nepali Month: ${monthName} ${year}? This cannot be undone.`)) return;

    try {
        const mPad = String(rawMonth).padStart(2, '0');
        const mUnpad = parseInt(rawMonth).toString();
        const search1 = `${year}.${mPad}.%`;
        const search2 = `${year}.${mUnpad}.%`;
        
        const { data: plantData, error: plantError } = await supabase
            .from('plant_data')
            .select('id, nepali_date')
            .or(`nepali_date.ilike.${search1},nepali_date.ilike.${search2}`);

        if (plantError) throw plantError;
        if (!plantData || plantData.length === 0) {
            showNotification(`No mapped dates found for ${monthName} ${year}.`, true);
            return;
        }

        const engDates = plantData.map(pd => pd.id);

        const { error } = await supabase.from('hourly_logs').delete().in('log_date', engDates);
        if (error) throw error;

        showNotification(`✅ Successfully deleted all records for ${monthName} ${year}.`);
        window.previewExportData(); 
    } catch (e) {
        showNotification("Delete Error: " + e.message, true);
    }
};

// ==========================================
// ADMIN EXPORTS: RESTORED SMART LEGACY IMPORT
// ==========================================
window.processLegacyImport = async function() {
    const fileInput = document.getElementById('legacy-upload');
    const statusDiv = document.getElementById('import-status');
    const importType = document.getElementById('import-type').value;

    if (!fileInput.files || fileInput.files.length === 0) {
        showNotification("Please select an Excel or CSV file first.", true);
        return;
    }

    const file = fileInput.files[0];
    statusDiv.innerHTML = "⏳ Reading workbook... (This may take a moment)";
    statusDiv.classList.remove('hidden', 'text-emerald-700');
    statusDiv.classList.add('text-rose-800');

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            
            console.log("=== DEBUG: Workbook loaded ===");
            console.log("Sheets found:", workbook.SheetNames);
            
            const payloads = [];
            let processedSheets = 0;
            let skippedSheets = 0;

            const num = (val) => {
                if(val === null || val === undefined || val === '') return null;
                if(typeof val === 'number') return val;
                if(typeof val === 'string') {
                    let cleaned = val.replace(/[^\d.-]/g, ''); 
                    if(cleaned === '' || cleaned === '.' || cleaned === '-') return null;
                    return parseFloat(cleaned);
                }
                return null;
            };
            const str = (val) => {
                if (val === null || val === undefined || val === '') return null;
                let s = String(val).trim();
                return s === '' ? null : s;
            };

            for (let sheetName of workbook.SheetNames) {
                console.log(`\n=== Processing sheet: ${sheetName} ===`);
                const worksheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, {header: 1, defval: ""});

                let parsedDate = null;
                let nepaliDateStr = null;

                // First, try to find a Nepali date (most reliable)
                for(let i=0; i<30 && i<rows.length; i++) {
                    let row = rows[i];
                    if(!row) continue;
                    let rowStr = row.join(" ");
                    let match = rowStr.match(/Nepali Date.*?(\d{1,2})\D+(\d{1,2})\D+(\d{4})/i);
                    if(match) {
                        nepaliDateStr = `${match[3]}.${match[2].padStart(2,'0')}.${match[1].padStart(2,'0')}`;
                        console.log(`Found Nepali date: ${nepaliDateStr}`);
                        break;
                    }
                }

                // If we have a Nepali date, map it to an English date via plant_data
                if (nepaliDateStr) {
                    statusDiv.innerHTML = `⏳ Bridging Nepali Date (${nepaliDateStr}) on sheet ${sheetName}...`;
                    const parts = nepaliDateStr.split('.');
                    const py = parts[0];
                    const pm = parseInt(parts[1]).toString();
                    const pd = parseInt(parts[2]).toString();
                    const { data: pdData } = await supabase.from('plant_data').select('id')
                        .or(`nepali_date.eq.${py}.${parts[1]}.${parts[2]},nepali_date.eq.${py}.${pm}.${pd},nepali_date.eq.${py}-${parts[1]}-${parts[2]},nepali_date.eq.${py}-${pm}-${pd}`)
                        .limit(1);
                    if (pdData && pdData.length > 0) {
                        parsedDate = pdData[0].id;
                        console.log(`Bridged to English date: ${parsedDate}`);
                    } else {
                        console.warn(`No mapping found for Nepali date: ${nepaliDateStr}`);
                    }
                }

                // If still no date, try to find an English date string (year >= 2020) using parseToUTCDate
                if (!parsedDate) {
                    for(let i=0; i<30 && i<rows.length; i++) {
                        let row = rows[i];
                        if(!row) continue;
                        for(let j=0; j<row.length; j++) {
                            let cell = row[j];
                            if(cell === null || cell === "") continue;
                            // Try to parse using our utility
                            const d = parseToUTCDate(cell);
                            if (d) {
                                const y = parseInt(d.split('-')[0]);
                                if (y >= 2020) {
                                    parsedDate = d;
                                    console.log(`Found date via parseToUTCDate: ${parsedDate}`);
                                    break;
                                }
                            }
                        }
                        if (parsedDate) break;
                    }
                }

                if (!parsedDate) {
                    console.log(`Skipping sheet ${sheetName} - no valid date found`);
                    skippedSheets++;
                    continue;
                }

                let inDataBlock = false;
                let rowsFound = 0;
                let sheetPayloads = []; // NEW: Array to hold this sheet's rows

                for (let i=0; i<rows.length; i++) {
                    let r = rows[i];
                    if(!r || r.length < 2) continue;

                    let offset = 0;
                    let hour = -1;
                    
                    let cellA = r[0];
                    let cellB = r[1];

                    const isExplicitTime = (val) => {
                        if (val === null || val === undefined || val === "") return false;
                        if (typeof val === 'number' && val > 0 && val < 1) return true;
                        if (typeof val === 'string' && /^(\d{1,2}):\d{2}/.test(String(val).trim())) return true;
                        return false;
                    };

                    const isIntegerHour = (val) => {
                        if (val === null || val === undefined || val === "") return false;
                        if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 24) return true;
                        if (typeof val === 'string' && /^(\d{1,2})$/.test(String(val).trim())) return true;
                        return false;
                    };

                    const getHour = (val) => {
                        if (typeof val === 'number') {
                            if (val >= 0 && val < 1) return Math.round(val * 24);
                            return Math.floor(val);
                        }
                        let s = String(val).trim();
                        let m = s.match(/^(\d{1,2}):\d{2}/);
                        if (m) return parseInt(m[1], 10);
                        return parseInt(s, 10);
                    };

                    if (isExplicitTime(cellA)) { offset = 0; hour = getHour(cellA); } 
                    else if (isExplicitTime(cellB)) { offset = 1; hour = getHour(cellB); } 
                    else if (isIntegerHour(cellA)) { offset = 0; hour = getHour(cellA); } 
                    else if (isIntegerHour(cellB)) { offset = 1; hour = getHour(cellB); }

                    if (hour === 24) hour = 0;
                    if (hour === 0 && !inDataBlock) inDataBlock = true;

                    if (inDataBlock && hour >= 0 && hour <= 23) {
                        let timeStr = String(hour).padStart(2, '0') + ":00:00";
                        let logData = { log_date: parsedDate, log_time: timeStr };
                        let o = offset;

                        if (importType === 'generation') {
                            logData.u1_status = str(r[1+o]); logData.u2_status = str(r[2+o]);
                            logData.u1_hour_counter = num(r[3+o]); logData.u2_hour_counter = num(r[4+o]);
                            logData.u1_load = num(r[5+o]); logData.e_u1_mw = num(r[5+o]);
                            logData.u2_load = num(r[6+o]); logData.e_u2_mw = num(r[6+o]);
                            logData.u1_pf = num(r[7+o]); logData.e_u1_cos = num(r[7+o]);
                            logData.u2_pf = num(r[8+o]); logData.e_u2_cos = num(r[8+o]);
                            logData.u1_pmu_reading = num(r[9+o]); logData.e_u1_gwh = num(r[9+o]);
                            logData.u2_pmu_reading = num(r[10+o]); logData.e_u2_gwh = num(r[10+o]);
                            logData.u1_feeder = num(r[11+o]); logData.u2_feeder = num(r[12+o]);
                            logData.sst = num(r[13+o]); 
                            logData.outgoing = num(r[14+o]); logData.e_out_mwh = num(r[14+o]);
                            logData.import_mwh = num(r[15+o]); logData.water_level = num(r[16+o]);
                            logData.remarks = str(r[17+o]); 
                        }
                        else if (importType === 'tempoil') {
                            logData.t_u1_u = num(r[1+o]); logData.t_u1_v = num(r[2+o]); logData.t_u1_w = num(r[3+o]); logData.t_u1_de = num(r[4+o]); logData.t_u1_nde = num(r[5+o]);
                            logData.t_u2_u = num(r[6+o]); logData.t_u2_v = num(r[7+o]); logData.t_u2_w = num(r[8+o]); logData.t_u2_de = num(r[9+o]); logData.t_u2_nde = num(r[10+o]);
                            logData.t_u1_gov_temp = num(r[11+o]); logData.t_u1_hyd_temp = num(r[12+o]); logData.t_u1_oil_flow = num(r[13+o]); logData.t_u1_oil_level = str(r[14+o]);
                            logData.t_u2_gov_temp = num(r[15+o]); logData.t_u2_hyd_temp = num(r[16+o]); logData.t_u2_oil_flow = num(r[17+o]); logData.t_u2_oil_level = str(r[18+o]);
                            logData.t_temp_out = num(r[19+o]); logData.t_temp_in = num(r[20+o]); logData.t_temp_intake = num(r[21+o]); logData.t_pressure = num(r[22+o]);
                        }
                        else if (importType === 'transformer') {
                            logData.tr_1_temp = num(r[1+o]); logData.tr_1_lvl = num(r[2+o]);
                            logData.tr_2_temp = num(r[3+o]); logData.tr_2_lvl = num(r[4+o]);
                            logData.tr_aux_temp = num(r[5+o]); logData.tr_aux_lvl = num(r[6+o]);
                            logData.dg_batt = num(r[7+o]); logData.dg_fuel = num(r[8+o]); 
                            logData.dg_runtime = str(r[9+o]);
                        }
                        else if (importType === 'schedule3') {
                            const dataStartCol = 1 + o;
                            if (r.length >= dataStartCol + 33) {
                                logData.e_u1_v_ry = num(r[dataStartCol + 0]); logData.e_u1_v_yb = num(r[dataStartCol + 1]); logData.e_u1_v_br = num(r[dataStartCol + 2]);
                                logData.e_u1_a_i1 = num(r[dataStartCol + 3]); logData.e_u1_a_i2 = num(r[dataStartCol + 4]); logData.e_u1_a_i3 = num(r[dataStartCol + 5]);
                                logData.e_u1_mw = num(r[dataStartCol + 6]); logData.e_u1_kvar = num(r[dataStartCol + 7]); logData.e_u1_cos = num(r[dataStartCol + 8]);
                                logData.e_u1_hz = num(r[dataStartCol + 9]); logData.e_u1_gwh = num(r[dataStartCol + 10]);

                                logData.e_u2_v_ry = num(r[dataStartCol + 11]); logData.e_u2_v_yb = num(r[dataStartCol + 12]); logData.e_u2_v_br = num(r[dataStartCol + 13]);
                                logData.e_u2_a_i1 = num(r[dataStartCol + 14]); logData.e_u2_a_i2 = num(r[dataStartCol + 15]); logData.e_u2_a_i3 = num(r[dataStartCol + 16]);
                                logData.e_u2_mw = num(r[dataStartCol + 17]); logData.e_u2_kvar = num(r[dataStartCol + 18]); logData.e_u2_cos = num(r[dataStartCol + 19]);
                                logData.e_u2_hz = num(r[dataStartCol + 20]); logData.e_u2_gwh = num(r[dataStartCol + 21]);

                                logData.e_out_v_ry = num(r[dataStartCol + 22]); logData.e_out_v_yb = num(r[dataStartCol + 23]); logData.e_out_v_br = num(r[dataStartCol + 24]);
                                logData.e_out_a_i1 = num(r[dataStartCol + 25]); logData.e_out_a_i2 = num(r[dataStartCol + 26]); logData.e_out_a_i3 = num(r[dataStartCol + 27]);
                                logData.e_out_mw = num(r[dataStartCol + 28]); logData.e_out_kvar = num(r[dataStartCol + 29]); logData.e_out_cos = num(r[dataStartCol + 30]);
                                logData.e_out_hz = num(r[dataStartCol + 31]); logData.e_out_mwh = num(r[dataStartCol + 32]);
                                logData.remarks = '';
                            }
                        }

                        logData.created_by = window.currentUser ? window.currentUser.id : null;
                        sheetPayloads.push(logData); // Save to temp array
                        rowsFound++;

                        if (timeStr === '23:00:00' || (importType === 'transformer' && timeStr === '22:00:00')) break;
                    }
                }

                // --- NAME NORMALIZATION HELPER ---
                const formatOperatorName = (nameStr) => {
                    if (!nameStr) return null;
                    const n = nameStr.trim();
                    const lower = n.toLowerCase();
                    if (lower === "janak") return "Janak Thagunna";
                    if (lower === "nirajan") return "Nirajan Bist";
                    if (lower === "ashok") return "Ashok Nath";
                    if (lower === "bhupendra") return "Bhupendra Singh";
                    if (lower === "jaman") return "Jaman Dhami";
                    return n; // Returns original name if no match
                };

                // --- NEW: EXTRACT SIGNATURE NAMES FROM BOTTOM OF EXCEL ---
                let shiftAName = null, shiftBName = null, shiftCName = null;
                for (let k = 0; k < rows.length; k++) {
                    if (!rows[k]) continue;
                    for (let j = 0; j < rows[k].length; j++) {
                        let cellStr = String(rows[k][j] || "").trim();
                        
                        // Find cells containing "Name :"
                        if (cellStr.toLowerCase().includes("name :") || cellStr.toLowerCase().includes("name:")) {
                            let parts = cellStr.split(/:/);
                            if (parts.length > 1) {
                                let cleanName = formatOperatorName(parts[1]);
                                if (cleanName) {
                                    if (!shiftAName) shiftAName = cleanName;
                                    else if (!shiftBName) shiftBName = cleanName;
                                    else if (!shiftCName) shiftCName = cleanName;
                                }
                            }
                        }
                    }
                }

                // Auto-fill extracted names into the 05:00, 13:00, and 21:00 hour logs
                sheetPayloads.forEach(p => {
                    // Normalize the name even if it was typed directly into the hourly row
                    if (p.remarks) p.remarks = formatOperatorName(p.remarks);

                    // Inject the extracted bottom-of-page names
                    if (p.log_time === '05:00:00' && shiftAName && !p.remarks) p.remarks = shiftAName;
                    if (p.log_time === '13:00:00' && shiftBName && !p.remarks) p.remarks = shiftBName;
                    if (p.log_time === '21:00:00' && shiftCName && !p.remarks) p.remarks = shiftCName;
                });

                payloads.push(...sheetPayloads); // Add modified rows to main upload queue
                // ---------------------------------------------------------

                console.log(`Sheet ${sheetName}: Found ${rowsFound} rows of data`);
                if (rowsFound > 0) processedSheets++;
            }

            console.log(`\n=== SUMMARY ===`);
            console.log(`Total payloads collected: ${payloads.length}`);
            console.log(`Processed sheets: ${processedSheets}`);
            console.log(`Skipped sheets: ${skippedSheets}`);

            if (payloads.length === 0) throw new Error("No readable data rows found in ANY sheet.");

            statusDiv.innerHTML = `⏳ Merging duplicate entries...`;

            const uniquePayloads = new Map();
            payloads.forEach(p => {
                const key = p.log_date + '_' + p.log_time;
                delete p.id;

                if (!uniquePayloads.has(key)) {
                    uniquePayloads.set(key, p);
                } else {
                    const existing = uniquePayloads.get(key);
                    for (let k in p) {
                        if (p[k] !== null && p[k] !== undefined && p[k] !== "") existing[k] = p[k];
                    }
                }
            });

            const finalPayloads = Array.from(uniquePayloads.values());
            console.log(`After deduplication: ${finalPayloads.length} rows`);

            statusDiv.innerHTML = `⏳ Uploading ${finalPayloads.length} rows...`;

            const CHUNK_SIZE = 150;
            for (let i = 0; i < finalPayloads.length; i += CHUNK_SIZE) {
                const chunk = finalPayloads.slice(i, i + CHUNK_SIZE);
                const { error } = await supabase.from('hourly_logs').upsert(chunk, { onConflict: 'log_date, log_time' });
                if (error) throw error;
                console.log(`Uploaded chunk ${Math.floor(i/CHUNK_SIZE) + 1}/${Math.ceil(finalPayloads.length/CHUNK_SIZE)}`);
            }

            let successMsg = `✅ Successfully imported ${finalPayloads.length} rows from ${processedSheets} sheets!`;
            if (skippedSheets > 0) successMsg += ` (Skipped ${skippedSheets} empty/invalid sheets).`;
            
            statusDiv.innerHTML = successMsg;
            statusDiv.classList.replace('text-rose-800', 'text-emerald-700');
            
            if (window.isDailyExport) window.previewExportData();
            else window.fetchLogs();

        } catch (err) {
            console.error("Import Error:", err);
            statusDiv.innerHTML = `❌ Error: ${err.message}`;
            showNotification(`Import failed: ${err.message}\n\nCheck console for details.`, true);
        }
    };
    reader.readAsArrayBuffer(file);
}

// Start the whole process
startPage();