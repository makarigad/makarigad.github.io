import { supabase, initializeApplication, showNotification, fetchWithTimeout, performAutoAttendance } from './core-app.js';

window.currentUserEmail = null;
window.userRole = 'normal';

// ── Service Worker Registration ──
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.info('[SW] Offline mode ready.', reg.scope))
            .catch(err => console.error('[SW] Registration failed:', err));
    });
}

// ── Connection status bar ──
function updateConnBar(online) {
    const bar  = document.getElementById('page-conn-bar');
    const dot  = document.getElementById('page-conn-dot');
    const text = document.getElementById('page-conn-text');
    if (!bar) return;
    if (online) {
        bar.className  = 'flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 shadow-sm px-3 py-1.5 rounded-lg transition-all duration-300';
        dot.className  = 'live-dot online';
        text.textContent = 'Online';
    } else {
        bar.className  = 'flex items-center gap-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 shadow-sm px-3 py-1.5 rounded-lg transition-all duration-300';
        dot.className  = 'live-dot offline';
        text.textContent = 'Offline Mode';
    }
}
window.addEventListener('online',  () => updateConnBar(true));
window.addEventListener('offline', () => updateConnBar(false));
updateConnBar(navigator.onLine);

// ── Modals (login / profile) ──
function closeLoginModal() {
    const m = document.getElementById('login-modal');
    if (!m) return;
    m.classList.add('hidden');
    m.classList.remove('flex');
}

function closeProfileModal() {
    const m = document.getElementById('profile-modal');
    if (!m) return;
    m.classList.add('hidden');
    m.classList.remove('flex');
}

document.getElementById('lm-toggle-pw')?.addEventListener('click', function () {
    const i = document.getElementById('login-password');
    const isHidden = i?.type === 'password';
    if (i) i.type = isHidden ? 'text' : 'password';
    this.textContent = isHidden ? 'Hide' : 'Show';
});

document.getElementById('login-modal-close')?.addEventListener('click', closeLoginModal);
document.getElementById('profile-modal-close')?.addEventListener('click', closeProfileModal);

document.getElementById('login-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'login-modal') closeLoginModal();
});

document.getElementById('profile-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'profile-modal') closeProfileModal();
});

// ── Page initialisation ──
async function startPage() {
    const session = await initializeApplication(false);

    const guestHint = document.getElementById('quick-nav-guest-hint');
    if (session?.user) {
        window.currentUserEmail = session.user.email;
        window.userRole = session.role;
        if (navigator.onLine) fetchUserProfile(session.user.email);
        if (guestHint) guestHint.classList.add('hidden');
    } else if (guestHint) {
        guestHint.classList.remove('hidden');
    }

    loadDashboardData();
    loadAdminNotice();
}
startPage();

async function loadAdminNotice() {
    try {
        const { data } = await supabase
            .from('app_settings')
            .select('setting_value')
            .eq('setting_key', 'operator_notice')
            .maybeSingle();
        if (data && data.setting_value) {
            const notice = typeof data.setting_value === 'string' ? JSON.parse(data.setting_value) : data.setting_value;
            if (notice.active && notice.message) {
                if (!notice.expires_at || new Date(notice.expires_at) > new Date()) {
                    const bar = document.getElementById('index-admin-notice');
                    const txt = document.getElementById('index-admin-notice-text');
                    if (bar && txt) {
                        txt.textContent = '📢 Admin Notice: ' + notice.message;
                        bar.classList.remove('hidden');
                        bar.classList.add('flex');
                    }
                }
            }
        }
    } catch (e) { console.warn('Notice load error:', e); }
}

// ── Login modal form ──
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!navigator.onLine) {
        showNotification('No internet connection — cannot authenticate offline.', true);
        return;
    }

    const email    = document.getElementById('login-email')?.value?.trim();
    const password = document.getElementById('login-password')?.value;
    const errEl    = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');
    const btnText  = document.getElementById('login-btn-text');
    const spinner  = document.getElementById('login-spinner');

    errEl?.classList.add('hidden');
    if (btnText) btnText.textContent = 'Authenticating…';
    spinner?.classList.remove('hidden');
    if (submitBtn) submitBtn.disabled = true;

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        const msg = error.message === 'Invalid login credentials'
            ? 'Invalid email or password.'
            : error.message;
        if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
        if (btnText) btnText.textContent = 'Authenticate';
        spinner?.classList.add('hidden');
        if (submitBtn) submitBtn.disabled = false;
    } else {
        if (btnText) btnText.textContent = 'Checking location...';
        await performAutoAttendance(email, 'IN');
        if (btnText) btnText.textContent = 'Redirecting…';
        window.location.reload();
    }
});

// ── Fetch user profile ──
async function fetchUserProfile(email) {
    const emailField = document.getElementById('prof-email');
    if (emailField) emailField.value = email;
    try {
        const { data } = await fetchWithTimeout(
            supabase.from('user_roles').select('*').eq('email', email).maybeSingle(),
            4000
        );
        if (data) {
            setField('prof-name',     data.full_name);
            setField('prof-position', data.position);
            setField('prof-phone',    data.phone);
            setField('prof-dob',      data.dob);
            setField('prof-company',  data.company);
            updateHeaderDisplayName(data.full_name || email.split('@')[0]);
        } else {
            setField('prof-company', 'Makari Gad Hydroelectric Project');
            updateHeaderDisplayName(email.split('@')[0]);
        }
    } catch {
        console.warn('[profile] Could not fetch (offline or slow)');
        updateHeaderDisplayName(email.split('@')[0]);
    }
}

function updateHeaderDisplayName(name) {
    const headerEmailSpan = document.getElementById('header-email')?.querySelector('span');
    if (headerEmailSpan && name) {
        headerEmailSpan.textContent = name.includes(' ') ? name.split(' ')[0] : name;
    }
}

function setField(id, value) {
    const el = document.getElementById(id);
    if (el && value) el.value = value;
}

// ── Profile save ──
document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!navigator.onLine) {
        showNotification('You are offline. Cannot save profile changes.', true);
        return;
    }

    const btn        = document.getElementById('save-prof-btn');
    const newPassword = document.getElementById('prof-password')?.value;
    const email       = window.currentUserEmail;

    btn.textContent = 'Saving…';
    btn.disabled = true;

    try {
        if (newPassword) {
            if (newPassword.length < 6) throw new Error('Password must be at least 6 characters.');
            const { error: pwErr } = await supabase.auth.updateUser({ password: newPassword });
            if (pwErr) throw pwErr;
        }

        const payload = {
            email,
            role:      window.userRole,
            full_name: document.getElementById('prof-name')?.value.trim()     || null,
            position:  document.getElementById('prof-position')?.value.trim() || null,
            phone:     document.getElementById('prof-phone')?.value.trim()    || null,
            dob:       document.getElementById('prof-dob')?.value             || null,
            company:   document.getElementById('prof-company')?.value.trim()  || null,
            updated_at: new Date().toISOString()
        };

        const { error: dbErr } = await supabase.from('user_roles').upsert(payload, { onConflict: 'email' });
        if (dbErr) throw dbErr;

        showNotification('Profile updated successfully!');
        closeProfileModal();

        if (payload.full_name) updateHeaderDisplayName(payload.full_name);

    } catch (err) {
        showNotification('Error saving profile: ' + err.message, true);
    } finally {
        btn.textContent = 'Save Profile Changes';
        btn.disabled = false;
    }
});

// ── Dashboard data loader ──
async function loadDashboardData() {
    try {
        const nepalNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
        const todayStr = nepalNow.toISOString().split('T')[0];

        const yesterday = new Date(nepalNow);
        yesterday.setDate(nepalNow.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const tomorrow = new Date(nepalNow);
        tomorrow.setDate(nepalNow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        const dbYesterday = new Date(nepalNow);
        dbYesterday.setDate(nepalNow.getDate() - 2);
        const dbYesterdayStr = dbYesterday.toISOString().split('T')[0];

        if (!navigator.onLine) throw new Error('Offline');

        const { data: calData } = await fetchWithTimeout(
            supabase.from('calendar_mappings').select('*').eq('eng_date', todayStr).maybeSingle(),
            4000
        );

        const badge = document.getElementById('card-update');
        if (badge) {
            let dateLabel = calData?.nep_date_str ?? todayStr;
            const span = badge.querySelector('span') ?? badge;
            span.textContent = 'Today: ' + dateLabel;
        }

        let rainId = null;
        if (calData) {
            rainId = `${calData.nep_year}_${calData.nep_month}_${String(calData.nep_day).padStart(2, '0')}`;
        }

        const [
            { data: allLogs },
            { data: allBalanch },
            { data: allOutages },
            { data: allCal },
            { data: todayRainfall },
            { data: histPlant }
        ] = await Promise.all([
            fetchWithTimeout(supabase.from('hourly_logs').select('*').gte('log_date', dbYesterdayStr).lte('log_date', tomorrowStr).order('log_date').order('log_time'), 4000),
            fetchWithTimeout(supabase.from('balanch_readings').select('*').gte('eng_date', dbYesterdayStr).lte('eng_date', tomorrowStr), 4000),
            fetchWithTimeout(supabase.from('outages').select('*').gte('id', dbYesterdayStr).lte('id', todayStr), 4000),
            fetchWithTimeout(supabase.from('calendar_mappings').select('*').gte('eng_date', dbYesterdayStr).lte('eng_date', tomorrowStr), 4000),
            rainId ? fetchWithTimeout(supabase.from('rainfall_data').select('*').eq('id', rainId).maybeSingle(), 4000) : Promise.resolve({ data: null }),
            fetchWithTimeout(supabase.from('plant_data').select('unit1_gen, unit2_gen, export_plant, export_substation').not('export_substation', 'is', null).order('id', { ascending: false }).limit(45), 4000)
        ]);

        // --- DYNAMIC AI PREDICTION LOGIC ---
        function predictLossFactor(targetMw, historicalData) {
            if (!historicalData || historicalData.length === 0) return 0.04;
            let validDays = historicalData.filter(d => d.export_plant > 0 && d.export_substation > 0);
            let points = validDays.map(d => {
                const grossMwh = ((d.unit1_gen||0) + (d.unit2_gen||0)) / 1000;
                const mw = grossMwh / 24; 
                const loss = (d.export_plant - d.export_substation) / d.export_plant;
                return { mw, loss };
            }).filter(p => p.loss >= 0.01 && p.loss <= 0.12);
            
            if (points.length === 0) return 0.04;
            points.sort((a, b) => Math.abs(a.mw - targetMw) - Math.abs(b.mw - targetMw));
            const nearest = points.slice(0, 3);
            return nearest.reduce((s, p) => s + p.loss, 0) / nearest.length;
        }

        const todayLogs = (allLogs || []).filter(l => l.log_date === todayStr);

        // --- CALENDAR DAY (00:00 to 23:59) ---
        let calGross = 0, calExport = 0, calStation = 0, calU1Hrs = 0, calU2Hrs = 0;
        let powers = [];

        if (todayLogs && todayLogs.length > 0) {
            const getDelta = (k1, k2) => {
                let firstVal = null, lastVal = null;
                for (let i = 0; i < todayLogs.length; i++) {
                    const v = parseFloat(todayLogs[i][k1]) || parseFloat(todayLogs[i][k2]);
                    if (v > 0) { firstVal = v; break; }
                }
                for (let i = todayLogs.length - 1; i >= 0; i--) {
                    const v = parseFloat(todayLogs[i][k1]) || parseFloat(todayLogs[i][k2]);
                    if (v > 0) { lastVal = v; break; }
                }
                if (firstVal !== null && lastVal !== null) return Math.max(0, lastVal - firstVal);
                return 0;
            };

            calGross = (getDelta('u1_pmu_reading', 'e_u1_gwh') + getDelta('u2_pmu_reading', 'e_u2_gwh')) * 1000;
            calExport = getDelta('outgoing', 'e_out_mwh');
            calStation = getDelta('sst', 'sst');
            calU1Hrs = getDelta('u1_hour_counter', 'u1_hour_counter');
            calU2Hrs = getDelta('u2_hour_counter', 'u2_hour_counter');

            todayLogs.forEach(log => {
                const u1 = parseFloat(log.e_u1_mw) || parseFloat(log.u1_load) || 0;
                const u2 = parseFloat(log.e_u2_mw) || parseFloat(log.u2_load) || 0;
                const totalMw = u1 + u2;
                if (totalMw > 0) powers.push(totalMw);
            });
        }

        let minPower = 0, maxPower = 0, avgPower = 0;
        if (powers.length > 0) {
            minPower = Math.min(...powers);
            maxPower = Math.max(...powers);
            avgPower = powers.reduce((a,b) => a+b, 0) / powers.length;
        }

        setText('cal-gross', calGross > 0 ? calGross.toFixed(2) : '0.00');
        setText('cal-export', calExport > 0 ? calExport.toFixed(2) : '0.00');
        setText('cal-station', calStation > 0 ? calStation.toFixed(1) : '0.0');
        setText('cal-avg-pwr', avgPower > 0 ? avgPower.toFixed(2) : '0.00');
        setText('cal-minmax-pwr', minPower > 0 || maxPower > 0 ? `${minPower.toFixed(1)} / ${maxPower.toFixed(1)}` : '0.0 / 0.0');
        setText('cal-run-hrs', (calU1Hrs > 0 || calU2Hrs > 0) ? `${calU1Hrs.toFixed(1)} / ${calU2Hrs.toFixed(1)}` : '0.0 / 0.0');

        let rainText = '— / —';
        if (todayRainfall) {
            const dam = todayRainfall.headworks ?? 0;
            const ph = todayRainfall.powerhouse ?? 0;
            rainText = `${dam} / ${ph}`;
        }
        setText('cal-rain', rainText);

        // --- BILLING CYCLES (ACTIVE AND COMPLETED) ---
        function computeCycleData(startStr, endStr, cycleDateForOutages) {
            const cycleLogs = (allLogs || []).filter(l => {
                if (l.log_date === startStr) return l.log_time >= '12:00:00';
                if (l.log_date === endStr) return l.log_time <= '12:00:00';
                return false;
            });

            let gross = 0, exportPlant = 0, u1Hrs = 0, u2Hrs = 0, stationCons = 0;
            let powers = [];
            
            if (cycleLogs.length > 0) {
                const getDelta = (k1, k2) => {
                    let firstVal = null, lastVal = null;
                    for (let i = 0; i < cycleLogs.length; i++) {
                        const v = parseFloat(cycleLogs[i][k1]) || parseFloat(cycleLogs[i][k2]);
                        if (v > 0) { firstVal = v; break; }
                    }
                    for (let i = cycleLogs.length - 1; i >= 0; i--) {
                        const v = parseFloat(cycleLogs[i][k1]) || parseFloat(cycleLogs[i][k2]);
                        if (v > 0) { lastVal = v; break; }
                    }
                    if (firstVal !== null && lastVal !== null) return Math.max(0, lastVal - firstVal);
                    return 0;
                };
                
                gross = (getDelta('u1_pmu_reading', 'e_u1_gwh') + getDelta('u2_pmu_reading', 'e_u2_gwh')) * 1000;
                exportPlant = getDelta('outgoing', 'e_out_mwh');
                u1Hrs = getDelta('u1_hour_counter', 'u1_hour_counter');
                u2Hrs = getDelta('u2_hour_counter', 'u2_hour_counter');
                stationCons = getDelta('sst', 'sst');
                
                cycleLogs.forEach(log => {
                    const u1 = parseFloat(log.e_u1_mw) || parseFloat(log.u1_load) || 0;
                    const u2 = parseFloat(log.e_u2_mw) || parseFloat(log.u2_load) || 0;
                    const totalMw = u1 + u2;
                    if (totalMw > 0) powers.push(totalMw);
                });
            }
            
            let avgPower = 0;
            if (powers.length > 0) avgPower = powers.reduce((a,b) => a+b, 0) / powers.length;
            
            const bS = (allBalanch || []).find(b => b.eng_date === startStr)?.main_export;
            const bE = (allBalanch || []).find(b => b.eng_date === endStr)?.main_export;
            
            let balanchExport = 0, isPredicted = false, transLoss = 0, transLossPct = 0;
            
            if (bS != null && bE != null) {
                balanchExport = Math.max(0, bE - bS);
                transLoss = Math.max(0, exportPlant - balanchExport);
                transLossPct = exportPlant > 0 ? (transLoss / exportPlant) * 100 : 0;
            } else {
                isPredicted = true;
                let lossFactor = predictLossFactor(avgPower, histPlant);
                transLoss = exportPlant * lossFactor;
                balanchExport = exportPlant - transLoss;
                transLossPct = lossFactor * 100;
            }
            
            const outData = (allOutages || []).find(o => o.id === cycleDateForOutages);
            const gridFaults = outData?.energy_loss_line_trip || 0;
            
            const calMap = (allCal || []).find(c => c.eng_date === endStr);
            const nepaliDateStr = calMap?.nep_date_str || endStr;
            
            return { gross, exportPlant, balanchExport, isPredicted, transLoss, transLossPct, gridFaults, pf: (gross / 240) * 100, nepaliDateStr, u1Hrs, u2Hrs, stationCons };
        }

        let activeStart, activeEnd, activeCycleDate;
        let compStart, compEnd, compCycleDate;
        
        if (nepalNow.getHours() >= 12) {
            activeStart = todayStr; activeEnd = tomorrowStr; activeCycleDate = todayStr;
            compStart = yesterdayStr; compEnd = todayStr; compCycleDate = yesterdayStr;
        } else {
            activeStart = yesterdayStr; activeEnd = todayStr; activeCycleDate = yesterdayStr;
            compStart = dbYesterdayStr; compEnd = yesterdayStr; compCycleDate = dbYesterdayStr;
        }

        const activeData = computeCycleData(activeStart, activeEnd, activeCycleDate);
        const compData = computeCycleData(compStart, compEnd, compCycleDate);

        const tbody = document.getElementById('billing-cycles-body');
        if (tbody) {
            const renderRow = (data, title, badgeClass, badgeText) => `
                <tr class="hover:bg-slate-50 transition">
                    <td class="px-5 py-4 border-r border-slate-200">
                        <div class="font-bold text-slate-800">${title}</div>
                        <div class="text-[10px] ${badgeClass} px-2 py-0.5 rounded-full inline-block mt-1 uppercase tracking-wider">${badgeText}</div>
                    </td>
                    <td class="px-4 py-4 text-right font-black text-indigo-600">${data.gross > 0 ? data.gross.toFixed(2) : '0.00'} <span class="text-[9px] text-slate-400 font-normal">MWh</span></td>
                    <td class="px-4 py-4 text-right font-bold">${data.exportPlant > 0 ? data.exportPlant.toFixed(2) : '0.00'}</td>
                    <td class="px-4 py-4 text-right font-black text-emerald-600 bg-emerald-50/30">
                        ${data.balanchExport > 0 ? data.balanchExport.toFixed(2) : '0.00'}
                        ${data.isPredicted ? '<span class="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded" title="Predicted using historical matching">EST</span>' : ''}
                    </td>
                    <td class="px-4 py-4 text-right font-bold text-rose-500">
                        ${data.transLoss > 0 ? data.transLoss.toFixed(2) : '0.00'} 
                        <span class="text-[10px] text-rose-400 font-medium">(${data.transLossPct.toFixed(1)}%)</span>
                    </td>
                    <td class="px-4 py-4 text-right text-slate-600">${data.stationCons > 0 ? data.stationCons.toFixed(1) : '0.0'} <span class="text-[9px] text-slate-400">kWh</span></td>
                    <td class="px-4 py-4 text-center font-mono text-xs text-slate-500">${data.u1Hrs.toFixed(1)} / ${data.u2Hrs.toFixed(1)}</td>
                    <td class="px-4 py-4 text-right text-slate-600">${data.gridFaults > 0 ? data.gridFaults.toFixed(2) : '0.00'}</td>
                    <td class="px-4 py-4 text-right font-bold text-blue-600">${data.pf > 0 ? data.pf.toFixed(1) + '%' : '0.0%'}</td>
                </tr>
            `;

            tbody.innerHTML = 
                renderRow(activeData, 'Active Cycle', 'bg-blue-100 text-blue-700', 'Live Ends ' + activeData.nepaliDateStr) +
                renderRow(compData, 'Completed Cycle', 'bg-emerald-100 text-emerald-700', 'Ended ' + compData.nepaliDateStr);
        }

    } catch (err) {
        console.warn('[dashboard] Error:', err.message);
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value;
        el.classList.remove('skeleton-text');
    }
}