import { supabase, initializeApplication, showNotification } from './core-app.js';

window.currentUserEmail = null;
window.userRole = 'normal';

// ── Service Worker Registration ──
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('Offline Mode Ready!', reg))
        .catch(err => console.error('Offline Mode Failed:', err));
    });
}

// ── Connection status bar ──
function updateConnBar(online) {
    const bar  = document.getElementById('page-conn-bar');
    const dot  = document.getElementById('page-conn-dot');
    const text = document.getElementById('page-conn-text');
    if (!bar) return;
    if (online) {
        bar.className  = 'flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl';
        dot.className  = 'live-dot online';
        text.textContent = 'Online';
    } else {
        bar.className  = 'flex items-center gap-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl';
        dot.className  = 'live-dot offline';
        text.textContent = 'Offline Mode';
    }
}
window.addEventListener('online',  () => updateConnBar(true));
window.addEventListener('offline', () => updateConnBar(false));
updateConnBar(navigator.onLine);

// Helper to enforce 3-second timeout on hanging network requests
const fetchWithTimeout = async (promise, ms = 3000) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Network Timeout')), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

// Watcher to hook into the dynamic header
const observer = new MutationObserver(() => {
    const userNameEl = document.getElementById('display-user-name');
    if (userNameEl && !userNameEl.hasAttribute('data-click-bound') && userNameEl.innerText !== 'Loading...') {
        userNameEl.setAttribute('data-click-bound', 'true'); 
        userNameEl.classList.add('clickable-username');
        userNameEl.title = "Click to Edit Profile";
        
        if (!navigator.onLine) {
            userNameEl.classList.add('offline-disabled');
            userNameEl.title = "Offline: Cannot edit profile";
        }
        
        userNameEl.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation(); 
            if (!navigator.onLine) {
                showNotification("⚠️ You must be online to edit your profile.", true);
                return;
            }
            const modal = document.getElementById('profile-modal');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.getElementById('prof-password').value = ''; 
        });
    }
});
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener('offline', () => {
    const userNameEl = document.getElementById('display-user-name');
    if (userNameEl) { userNameEl.classList.add('offline-disabled'); userNameEl.title = "Offline: Cannot edit profile"; }
});
window.addEventListener('online', () => {
    const userNameEl = document.getElementById('display-user-name');
    if (userNameEl) { userNameEl.classList.remove('offline-disabled'); userNameEl.title = "Click to Edit Profile"; }
});

async function startPage() {
    const sessionData = await initializeApplication(false); 
    
    if (sessionData && sessionData.user) {
        window.currentUserEmail = sessionData.user.email;
        window.userRole = sessionData.role;
        if (navigator.onLine) fetchUserProfile(sessionData.user.email);

        // Show quick-nav section for logged-in users
        const qnav = document.getElementById('quick-nav-section');
        if (qnav) qnav.classList.remove('hidden');
    }

    loadDatabasePreview();
}

startPage();

// -- Login Logic --
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!navigator.onLine) {
        showNotification("⚠️ No internet connection — cannot authenticate offline.", true);
        return;
    }

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    errEl.classList.add('hidden');
    submitBtn.textContent = "Authenticating...";
    
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
        errEl.textContent = "Invalid credentials.";
        errEl.classList.remove('hidden');
        submitBtn.textContent = "Authenticate";
    } else {
        window.location.reload(); 
    }
});

// Fetch details to fill the form
async function fetchUserProfile(email) {
    const emailField = document.getElementById('prof-email');
    if (emailField) emailField.value = email; 
    try {
        const query = supabase.from('user_roles').select('*').eq('email', email).maybeSingle();
        const { data, error } = await fetchWithTimeout(query, 3000);
        if (data) {
            if (data.full_name) document.getElementById('prof-name').value = data.full_name;
            if (data.position) document.getElementById('prof-position').value = data.position;
            if (data.phone)    document.getElementById('prof-phone').value = data.phone;
            if (data.dob)      document.getElementById('prof-dob').value = data.dob;
            if (data.company)  document.getElementById('prof-company').value = data.company;
        } else {
            document.getElementById('prof-company').value = 'Makari Gad Hydroelectric Project';
        }
    } catch(e) {
        console.warn("Could not fetch profile (offline or slow)");
    }
}

// Save profile logic
document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!navigator.onLine) {
        showNotification("⚠️ You are offline. Cannot save profile changes.", true);
        return;
    }

    const btn = document.getElementById('save-prof-btn');
    const newPassword = document.getElementById('prof-password').value;
    const email = window.currentUserEmail;
    
    btn.innerText = "Saving Details..."; btn.disabled = true;
    
    try {
        if (newPassword) {
            if (newPassword.length < 6) throw new Error("Password must be at least 6 characters.");
            const { error: pwdErr } = await supabase.auth.updateUser({ password: newPassword });
            if (pwdErr) throw pwdErr;
        }
        
        const payload = {
            email: email,
            role: window.userRole,
            full_name: document.getElementById('prof-name').value.trim() || null,
            position: document.getElementById('prof-position').value.trim() || null,
            phone: document.getElementById('prof-phone').value.trim() || null,
            dob: document.getElementById('prof-dob').value || null,
            company: document.getElementById('prof-company').value.trim() || null,
            updated_at: new Date().toISOString()
        };
        
        const { error: dbErr } = await supabase.from('user_roles').upsert(payload, { onConflict: 'email' });
        if (dbErr) throw dbErr;
        
        showNotification("✅ Profile updated successfully!");
        document.getElementById('profile-modal').classList.add('hidden');
        document.getElementById('profile-modal').classList.remove('flex');
        
        if (payload.full_name) {
            const nameHeader = document.getElementById('display-user-name');
            if (nameHeader) nameHeader.innerText = payload.full_name;
        }
        
    } catch (err) {
        showNotification("❌ Error saving profile: " + err.message, true);
    } finally {
        btn.innerText = "Save Profile Changes"; btn.disabled = false;
    }
});

async function loadDatabasePreview() {
    try {
        const nepalTime = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kathmandu"}));
        
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kathmandu"}));
        const cutoffHour = 12; // Data updates at noon Nepal time

        const displayDate = new Date(now);
        if (now.getHours() < cutoffHour) displayDate.setDate(displayDate.getDate() - 1);
        const yyyy = displayDate.getFullYear();
        const mm = String(displayDate.getMonth()+1).padStart(2,'0');
        const dd = String(displayDate.getDate()).padStart(2,'0');
        const todayEngDate = `${yyyy}-${mm}-${dd}`;
        
        const yDate = new Date(nepalTime);
        yDate.setDate(yDate.getDate() - 1);
        const y_yyyy = yDate.getFullYear();
        const y_mm = String(yDate.getMonth() + 1).padStart(2, '0');
        const y_dd = String(yDate.getDate()).padStart(2, '0');
        const yesterdayEngDate = `${y_yyyy}-${y_mm}-${y_dd}`;

        if (!navigator.onLine) throw new Error("Offline Mode");

        const calQuery = supabase.from('calendar_mappings').select('nep_date_str, nep_year, nep_month').eq('eng_date', todayEngDate).maybeSingle();
        const { data: calData, error: calErr } = await fetchWithTimeout(calQuery, 3000);
        
        if (calErr) throw calErr; 

        const displayNepDate = calData ? calData.nep_date_str : todayEngDate;
        let monthRangeText = '';
        if (calData && calData.nep_year && calData.nep_month) {
            try {
                const { data: monthRows } = await fetchWithTimeout(
                    supabase
                        .from('calendar_mappings')
                        .select('eng_date')
                        .eq('nep_year', calData.nep_year)
                        .eq('nep_month', calData.nep_month)
                        .order('eng_date', { ascending: true }),
                    3000
                );
                if (monthRows && monthRows.length > 0) {
                    const startDate = new Date(`${monthRows[0].eng_date}T00:00:00`);
                    const endDate = new Date(`${monthRows[monthRows.length - 1].eng_date}T00:00:00`);
                    const f = (d) => d.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
                    monthRangeText = ` (${f(startDate)} - ${f(endDate)})`;
                } else {
                    const f = (d) => d.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
                    const fallback = new Date(`${todayEngDate}T00:00:00`);
                    monthRangeText = ` (${f(fallback)})`;
                }
            } catch {
                const f = (d) => d.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
                const fallback = new Date(`${todayEngDate}T00:00:00`);
                monthRangeText = ` (${f(fallback)})`;
            }
        } else {
            const f = (d) => d.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
            const fallback = new Date(`${todayEngDate}T00:00:00`);
            monthRangeText = ` (${f(fallback)})`;
        }
        document.getElementById('card-update').textContent = 'Today: ' + displayNepDate + monthRangeText;

        const todayQuery = supabase.from('plant_data').select('*').eq('id', todayEngDate).maybeSingle();
        const prevQuery  = supabase.from('plant_data').select('*').eq('id', yesterdayEngDate).maybeSingle();
        
        const { data: todayData } = await fetchWithTimeout(todayQuery, 3000);
        const { data: prevData }  = await fetchWithTimeout(prevQuery, 3000);

        let dailyGrossGen = 0;
        let dailyExport = 0;

        if (todayData && prevData) {
            const u1GenToday = (Number(todayData.unit1_gen) || 0) - (Number(prevData.unit1_gen) || 0);
            const u2GenToday = (Number(todayData.unit2_gen) || 0) - (Number(prevData.unit2_gen) || 0);
            dailyGrossGen = Math.max(0, u1GenToday) + Math.max(0, u2GenToday);
            
            const expToday = (Number(todayData.export_substation) || 0) - (Number(prevData.export_substation) || 0);
            dailyExport = Math.max(0, expToday);

            if (todayData.unit1_counter != null && prevData.unit1_counter != null)
                document.getElementById('card-u1-hrs').textContent = Math.max(0, todayData.unit1_counter - prevData.unit1_counter).toFixed(1) + ' h';
            if (todayData.unit2_counter != null && prevData.unit2_counter != null)
                document.getElementById('card-u2-hrs').textContent = Math.max(0, todayData.unit2_counter - prevData.unit2_counter).toFixed(1) + ' h';
        } else {
            document.getElementById('card-u1-hrs').textContent = '0.0 h';
            document.getElementById('card-u2-hrs').textContent = '0.0 h';
        }

        const isKwh    = dailyGrossGen > 1000;
        const grossMWh = isKwh ? dailyGrossGen / 1000 : dailyGrossGen;
        const exportMWh = (isKwh || dailyExport > 1000) ? dailyExport / 1000 : dailyExport;

        document.getElementById('card-gen').textContent    = (todayData && grossMWh > 0) ? grossMWh.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MWh' : '0.00 MWh';
        document.getElementById('card-export').textContent = (todayData && exportMWh > 0) ? exportMWh.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MWh' : '0.00 MWh';
        document.getElementById('card-pf').textContent     = (todayData && grossMWh > 0) ? ((grossMWh / 240) * 100).toFixed(1) + '%' : '0.0%';

        const oQuery = supabase.from('outages').select('loss_time_min').eq('id', todayEngDate).maybeSingle();
        const { data: oData } = await fetchWithTimeout(oQuery, 3000);
        document.getElementById('card-outages').textContent = (oData && oData.loss_time_min) ? (oData.loss_time_min / 60).toFixed(1) + ' h' : '0.0 h';

        if (calData && calData.nep_year && calData.nep_month) {
            const mceQuery = supabase.from('contract_energy').select('contract_energy, total_ad').eq('id', `${calData.nep_year}_${calData.nep_month}`).maybeSingle();
            const { data: mceData } = await fetchWithTimeout(mceQuery, 3000);
            if (mceData) {
                document.getElementById('card-mce').textContent = mceData.contract_energy ? mceData.contract_energy.toLocaleString('en-US') + ' MWh' : '—';
                document.getElementById('card-ad').textContent  = mceData.total_ad ? mceData.total_ad.toLocaleString('en-US') + ' MWh' : '—';
            }
        }

    } catch (e) { 
        console.warn('Dashboard is offline:', e.message); 
        const updateEl = document.getElementById('card-update');
        if (updateEl) {
            updateEl.textContent = 'Status: Offline Mode';
            updateEl.classList.replace('text-indigo-600', 'text-amber-600');
            updateEl.classList.replace('bg-indigo-50', 'bg-amber-50');
            updateEl.classList.replace('border-indigo-100', 'border-amber-200');
        }
        
        ['card-gen','card-export','card-pf','card-outages','card-u1-hrs','card-u2-hrs','card-mce','card-ad'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '—';
        });
    }
}
