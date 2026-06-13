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
            { data: todayRainfall }
        ] = await Promise.all([
            fetchWithTimeout(supabase.from('hourly_logs').select('*').gte('log_date', dbYesterdayStr).lte('log_date', tomorrowStr).order('log_date').order('log_time'), 4000),
            fetchWithTimeout(supabase.from('balanch_readings').select('*').gte('eng_date', dbYesterdayStr).lte('eng_date', tomorrowStr), 4000),
            fetchWithTimeout(supabase.from('outages').select('*').gte('id', dbYesterdayStr).lte('id', todayStr), 4000),
            fetchWithTimeout(supabase.from('calendar_mappings').select('*').gte('eng_date', dbYesterdayStr).lte('eng_date', tomorrowStr), 4000),
            rainId ? fetchWithTimeout(supabase.from('rainfall_data').select('*').eq('id', rainId).maybeSingle(), 4000) : Promise.resolve({ data: null })
        ]);

        const todayLogs = (allLogs || []).filter(l => l.log_date === todayStr);

        // --- CALENDAR DAY (00:00 to 23:59) ---
        let calGross = 0, calExport = 0, calStation = 0;
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

            let gross = 0, exportPlant = 0;
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
                let lossFactor = 0.02 + (avgPower / 10) * 0.03; 
                if (lossFactor > 0.05) lossFactor = 0.05;
                if (lossFactor < 0.02) lossFactor = 0.02;
                if (avgPower >= 10) lossFactor = 0.05;

                transLoss = exportPlant * lossFactor;
                balanchExport = exportPlant - transLoss;
                transLossPct = lossFactor * 100;
            }
            
            const outData = (allOutages || []).find(o => o.id === cycleDateForOutages);
            const gridFaults = outData?.energy_loss_line_trip || 0;
            
            const calMap = (allCal || []).find(c => c.eng_date === endStr);
            const nepaliDateStr = calMap?.nep_date_str || endStr;
            
            return { gross, exportPlant, balanchExport, isPredicted, transLoss, transLossPct, gridFaults, pf: (gross / 240) * 100, nepaliDateStr };
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

        setText('active-gross', activeData.gross > 0 ? activeData.gross.toFixed(2) : '0.00');
        setText('active-export', activeData.exportPlant > 0 ? activeData.exportPlant.toFixed(2) : '0.00');
        setText('active-balanch', activeData.balanchExport > 0 ? activeData.balanchExport.toFixed(2) : '0.00');
        
        const actBadgeEl = document.getElementById('active-balanch-badge');
        if (actBadgeEl) actBadgeEl.style.display = activeData.isPredicted ? 'block' : 'none';

        setText('active-loss', activeData.transLoss > 0 ? `${activeData.transLoss.toFixed(2)}` : '0.00');
        setText('active-loss-pct', `(${activeData.transLossPct.toFixed(1)}%)`);
        setText('active-faults', activeData.gridFaults > 0 ? activeData.gridFaults.toFixed(2) : '0.00');
        setText('active-pf', activeData.pf > 0 ? activeData.pf.toFixed(1) + '%' : '0.0%');
        
        const actCycleBadge = document.getElementById('active-cycle-badge');
        if (actCycleBadge) actCycleBadge.textContent = 'Live (Ends ' + activeData.nepaliDateStr + ')';

        setText('comp-gross', compData.gross > 0 ? compData.gross.toFixed(2) : '0.00');
        setText('comp-export', compData.exportPlant > 0 ? compData.exportPlant.toFixed(2) : '0.00');
        setText('comp-balanch', compData.balanchExport > 0 ? compData.balanchExport.toFixed(2) : '0.00');
        
        const compBadgeEl = document.getElementById('comp-balanch-badge');
        if (compBadgeEl) compBadgeEl.style.display = compData.isPredicted ? 'block' : 'none';

        setText('comp-loss', compData.transLoss > 0 ? `${compData.transLoss.toFixed(2)}` : '0.00');
        setText('comp-loss-pct', `(${compData.transLossPct.toFixed(1)}%)`);
        setText('comp-faults', compData.gridFaults > 0 ? compData.gridFaults.toFixed(2) : '0.00');
        setText('comp-pf', compData.pf > 0 ? compData.pf.toFixed(1) + '%' : '0.0%');
        
        const compCycleBadge = document.getElementById('completed-cycle-badge');
        if (compCycleBadge) compCycleBadge.textContent = 'Ended ' + compData.nepaliDateStr;

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