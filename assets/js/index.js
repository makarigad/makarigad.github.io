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
            rainId = `${calData.nep_year}_${calData.nep_month}_${parseInt(calData.nep_day)}`;
        }

        const [
            { data: todayLogs },
            { data: yesterdayLogs },
            { data: tBalanch },
            { data: yBalanch },
            { data: todayOutages },
            { data: todayRainfall }
        ] = await Promise.all([
            fetchWithTimeout(supabase.from('hourly_logs').select('*').eq('log_date', todayStr).order('log_time'), 4000),
            fetchWithTimeout(supabase.from('hourly_logs').select('*').eq('log_date', yesterdayStr).order('log_time'), 4000),
            fetchWithTimeout(supabase.from('balanch_readings').select('*').eq('eng_date', todayStr).maybeSingle(), 4000),
            fetchWithTimeout(supabase.from('balanch_readings').select('*').eq('eng_date', yesterdayStr).maybeSingle(), 4000),
            fetchWithTimeout(supabase.from('outages').select('*').eq('id', todayStr).maybeSingle(), 4000),
            rainId ? fetchWithTimeout(supabase.from('rainfall_data').select('*').eq('id', rainId).maybeSingle(), 4000) : Promise.resolve({ data: null })
        ]);

        // --- CALENDAR DAY (00:00 to 23:59) ---
        let calGross = 0, calExport = 0, calStation = 0;
        let powers = [];

        if (todayLogs && todayLogs.length > 0) {
            const first = todayLogs[0];
            const last = todayLogs[todayLogs.length - 1];

            const getDelta = (key) => Math.max(0, (parseFloat(last[key]) || 0) - (parseFloat(first[key]) || 0));

            calGross = (getDelta('e_u1_gwh') + getDelta('e_u2_gwh')) * 1000;
            calExport = getDelta('e_out_mwh');
            calStation = getDelta('sst');

            todayLogs.forEach(log => {
                const u1 = parseFloat(log.e_u1_mw) || 0;
                const u2 = parseFloat(log.e_u2_mw) || 0;
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

        // --- NOON-TO-NOON (12:00 Yesterday to 12:00 Today) ---
        let noonGross = 0, noonExport = 0;
        let noonPowers = [];

        const noonLogs = [
            ...(yesterdayLogs || []).filter(l => l.log_time >= '12:00:00'),
            ...(todayLogs || []).filter(l => l.log_time <= '12:00:00')
        ];

        if (noonLogs.length > 0) {
            const first = noonLogs[0] || {};
            const last = noonLogs[noonLogs.length - 1] || {};

            const getDelta = (key) => Math.max(0, (parseFloat(last[key]) || 0) - (parseFloat(first[key]) || 0));

            noonGross = (getDelta('e_u1_gwh') + getDelta('e_u2_gwh')) * 1000;
            noonExport = getDelta('e_out_mwh');

            noonLogs.forEach(log => {
                const u1 = parseFloat(log.e_u1_mw) || 0;
                const u2 = parseFloat(log.e_u2_mw) || 0;
                const totalMw = u1 + u2;
                if (totalMw > 0) noonPowers.push(totalMw);
            });
        }

        let noonAvgPower = 0;
        if (noonPowers.length > 0) {
            noonAvgPower = noonPowers.reduce((a,b) => a+b, 0) / noonPowers.length;
        }

        let balanchExport = 0, isPredicted = false, transLoss = 0, transLossPct = 0;
        const yBal = yBalanch?.main_export;
        const tBal = tBalanch?.main_export;

        if (yBal != null && tBal != null && nepalNow.getHours() >= 12) {
            balanchExport = Math.max(0, tBal - yBal);
            transLoss = Math.max(0, noonExport - balanchExport);
            transLossPct = noonExport > 0 ? (transLoss / noonExport) * 100 : 0;
        } else {
            isPredicted = true;
            let lossFactor = 0.02 + (noonAvgPower / 10) * 0.03; 
            if (lossFactor > 0.05) lossFactor = 0.05;
            if (lossFactor < 0.02) lossFactor = 0.02;
            if (noonAvgPower >= 10) lossFactor = 0.05;

            transLoss = noonExport * lossFactor;
            balanchExport = noonExport - transLoss;
            transLossPct = lossFactor * 100;
        }

        const gridFaults = todayOutages?.energy_loss_line_trip || 0;
        const plantFactor = (noonGross / 240) * 100;

        setText('noon-gross', noonGross > 0 ? noonGross.toFixed(2) : '0.00');
        setText('noon-export', noonExport > 0 ? noonExport.toFixed(2) : '0.00');
        setText('noon-balanch', balanchExport > 0 ? balanchExport.toFixed(2) : '0.00');
        
        const badgeEl = document.getElementById('noon-balanch-badge');
        if (badgeEl) badgeEl.style.display = isPredicted ? 'block' : 'none';

        setText('noon-loss', transLoss > 0 ? `${transLoss.toFixed(2)}` : '0.00');
        setText('noon-loss-pct', `(${transLossPct.toFixed(1)}%)`);
        setText('noon-faults', gridFaults > 0 ? gridFaults.toFixed(2) : '0.00');
        setText('noon-pf', plantFactor > 0 ? plantFactor.toFixed(1) + '%' : '0.0%');

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