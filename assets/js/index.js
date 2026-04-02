import { supabase, initializeApplication, showNotification, fetchWithTimeout } from './core-app.js';

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
        bar.className  = 'flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl transition-all duration-300';
        dot.className  = 'live-dot online';
        text.textContent = 'Online';
    } else {
        bar.className  = 'flex items-center gap-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl transition-all duration-300';
        dot.className  = 'live-dot offline';
        text.textContent = 'Offline Mode';
    }
}
window.addEventListener('online',  () => updateConnBar(true));
window.addEventListener('offline', () => updateConnBar(false));
updateConnBar(navigator.onLine);

// ── Observer: bind click on display-user-name once injected by header ──
const _observer = new MutationObserver(() => {
    const el = document.getElementById('display-user-name');
    if (!el || el.dataset.clickBound) return;
    el.dataset.clickBound = 'true';
    el.classList.add('clickable-username');
    el.title = 'Click to edit profile';

    if (!navigator.onLine) el.classList.add('offline-disabled');

    el.addEventListener('click', () => {
        if (!navigator.onLine) {
            showNotification('You must be online to edit your profile.', true);
            return;
        }
        const modal = document.getElementById('profile-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        const pw = document.getElementById('prof-password');
        if (pw) pw.value = '';
    });
});
_observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener('offline', () => {
    document.getElementById('display-user-name')?.classList.add('offline-disabled');
});
window.addEventListener('online', () => {
    document.getElementById('display-user-name')?.classList.remove('offline-disabled');
});

// ── Page initialisation ──
async function startPage() {
    const session = await initializeApplication(false);

    if (session?.user) {
        window.currentUserEmail = session.user.email;
        window.userRole = session.role;
        if (navigator.onLine) fetchUserProfile(session.user.email);

        const qnav = document.getElementById('quick-nav-section');
        if (qnav) qnav.classList.remove('hidden');
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
    } catch(e) { console.warn('Notice load error:', e); }
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
        } else {
            setField('prof-company', 'Makari Gad Hydroelectric Project');
        }
    } catch {
        console.warn('[profile] Could not fetch (offline or slow)');
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
        const modal = document.getElementById('profile-modal');
        modal?.classList.add('hidden');
        modal?.classList.remove('flex');

        if (payload.full_name) {
            const nameEl = document.getElementById('display-user-name');
            if (nameEl) nameEl.textContent = payload.full_name;
            // Also update header email button span
            const headerEmailSpan = document.getElementById('header-email')?.querySelector('span');
            if (headerEmailSpan) headerEmailSpan.textContent = payload.full_name.split(' ')[0];
        }

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
        const CUTOFF_HOUR = 12;

        const displayDate = new Date(nepalNow);
        if (nepalNow.getHours() < CUTOFF_HOUR) displayDate.setDate(displayDate.getDate() - 1);

        const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const todayStr     = fmt(displayDate);
        const yesterday    = new Date(nepalNow); yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = fmt(yesterday);

        if (!navigator.onLine) throw new Error('Offline');

        // Calendar lookup
        const { data: calData } = await fetchWithTimeout(
            supabase.from('calendar_mappings').select('nep_date_str, nep_year, nep_month').eq('eng_date', todayStr).maybeSingle(),
            4000
        );

        // Date badge
        const badge = document.getElementById('card-update');
        if (badge) {
            let dateLabel = calData?.nep_date_str ?? todayStr;
            let rangeText = '';

            if (calData?.nep_year && calData?.nep_month) {
                try {
                    const { data: monthRows } = await fetchWithTimeout(
                        supabase.from('calendar_mappings')
                            .select('eng_date')
                            .eq('nep_year', calData.nep_year)
                            .eq('nep_month', calData.nep_month)
                            .order('eng_date', { ascending: true }),
                        3000
                    );
                    if (monthRows?.length) {
                        const fmtDisplay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
                        rangeText = ` (${fmtDisplay(monthRows[0].eng_date)} – ${fmtDisplay(monthRows[monthRows.length - 1].eng_date)})`;
                    }
                } catch { /* non-critical */ }
            }

            // Update inner span text (not the whole element to preserve icon)
            const span = badge.querySelector('span') ?? badge;
            span.textContent = 'Today: ' + dateLabel + rangeText;
        }

        // Plant data
        const [{ data: todayData }, { data: prevData }] = await Promise.all([
            fetchWithTimeout(supabase.from('plant_data').select('*').eq('id', todayStr).maybeSingle(), 4000),
            fetchWithTimeout(supabase.from('plant_data').select('*').eq('id', yesterdayStr).maybeSingle(), 4000),
        ]);

        let grossGen = 0, netExport = 0;

        if (todayData && prevData) {
            const u1 = Math.max(0, (todayData.unit1_gen ?? 0) - (prevData.unit1_gen ?? 0));
            const u2 = Math.max(0, (todayData.unit2_gen ?? 0) - (prevData.unit2_gen ?? 0));
            grossGen = u1 + u2;
            netExport = Math.max(0, (todayData.export_substation ?? 0) - (prevData.export_substation ?? 0));

            setText('card-u1-hrs', prevData.unit1_counter != null && todayData.unit1_counter != null
                ? Math.max(0, todayData.unit1_counter - prevData.unit1_counter).toFixed(1) + ' h' : '0.0 h');
            setText('card-u2-hrs', prevData.unit2_counter != null && todayData.unit2_counter != null
                ? Math.max(0, todayData.unit2_counter - prevData.unit2_counter).toFixed(1) + ' h' : '0.0 h');
        } else {
            setText('card-u1-hrs', '0.0 h');
            setText('card-u2-hrs', '0.0 h');
        }

        const toMWh = (kwh) => kwh > 1000 ? kwh / 1000 : kwh;
        const grossMWh  = toMWh(grossGen);
        const exportMWh = toMWh(netExport);
        const plantFactor = (grossMWh / 240) * 100;   // 240 = 10 MW × 24 h

        setText('card-gen',    grossMWh  > 0 ? grossMWh.toLocaleString('en-US',  { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MWh' : '0.00 MWh');
        setText('card-export', exportMWh > 0 ? exportMWh.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MWh' : '0.00 MWh');
        setText('card-pf',     grossMWh  > 0 ? plantFactor.toFixed(1) + '%' : '0.0%');

        // Outages
        const { data: oData } = await fetchWithTimeout(
            supabase.from('outages').select('loss_time_min').eq('id', todayStr).maybeSingle(), 3000
        );
        setText('card-outages', oData?.loss_time_min ? (oData.loss_time_min / 60).toFixed(1) + ' h' : '0.0 h');

        // MCE / AD
        if (calData?.nep_year && calData?.nep_month) {
            const mceKey = `${calData.nep_year}_${calData.nep_month}`;
            const { data: mce } = await fetchWithTimeout(
                supabase.from('contract_energy').select('contract_energy, total_ad').eq('id', mceKey).maybeSingle(), 3000
            );
            if (mce) {
                setText('card-mce', mce.contract_energy ? mce.contract_energy.toLocaleString('en-US') + ' MWh' : '—');
                setText('card-ad',  mce.total_ad        ? mce.total_ad.toLocaleString('en-US')        + ' MWh' : '—');
            }
        }

    } catch (err) {
        console.warn('[dashboard] Offline or error:', err.message);
        const badge = document.getElementById('card-update');
        if (badge) {
            const span = badge.querySelector('span') ?? badge;
            span.textContent = 'Status: Offline Mode';
            badge.classList.replace('text-indigo-600', 'text-amber-600');
            badge.classList.replace('bg-indigo-50', 'bg-amber-50');
            badge.classList.replace('border-indigo-100', 'border-amber-200');
        }
        ['card-gen', 'card-export', 'card-pf', 'card-outages', 'card-u1-hrs', 'card-u2-hrs', 'card-mce', 'card-ad']
            .forEach(id => setText(id, '—'));
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}
