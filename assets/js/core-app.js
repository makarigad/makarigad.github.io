import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://ineaqjsmabbsjwwbjfya.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uadlDXas6Tpif6j4eWp30g_j6OG326s';
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export let currentUser = null;
export let userRole = 'operator';

const ROLE_CACHE_KEY = 'makarigad_offline_role';
const SYNC_QUEUE_KEY = 'makarigad_sync_queue';
const ADMIN_EMAIL    = 'upenjyo@gmail.com';

// ============================================================
// Notification toast
// ============================================================
export function showNotification(msg, isError = false) {
    const modal   = document.getElementById('notification-modal');
    const msgEl   = document.getElementById('notification-message');
    if (!modal || !msgEl) return;

    msgEl.textContent = msg;
    modal.style.borderLeftColor = isError ? '#dc2626' : '#10b981';
    modal.classList.remove('opacity-0', '-translate-y-4', 'pointer-events-none');
    modal.classList.add('opacity-100');

    clearTimeout(modal._hideTimer);
    modal._hideTimer = setTimeout(() => {
        modal.classList.remove('opacity-100');
        modal.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
    }, isError ? 6000 : 4500);
}

// ============================================================
// Universal UTC date parser  (supports string / Date / Excel serial)
// ============================================================
export function parseToUTCDate(dateInput) {
    if (dateInput == null || dateInput === '') return null;

    let date;
    if (typeof dateInput === 'number') {
        if (typeof XLSX !== 'undefined' && XLSX.SSF) {
            const ex = XLSX.SSF.parse_date_code(dateInput, { date1904: false });
            if (ex) date = new Date(Date.UTC(ex.y, ex.m - 1, ex.d));
        }
        if (!date) {
            const js = new Date(Math.round((dateInput - 25569) * 86400 * 1000));
            date = new Date(Date.UTC(js.getUTCFullYear(), js.getUTCMonth(), js.getUTCDate()));
        }
    } else if (dateInput instanceof Date) {
        date = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
    } else {
        const s = String(dateInput).trim();
        let m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
        if (m) {
            date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        } else {
            m = s.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
            if (m) date = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
        }
    }

    if (date && !isNaN(date.getTime())) return date.toISOString().split('T')[0];
    return null;
}

// ============================================================
// Fetch with timeout + exponential back-off retries
// ============================================================
export async function fetchWithTimeout(promise, ms = 8000, retries = 1) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        let timeoutId;
        try {
            const timeout = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('Network Timeout')), ms);
            });
            const result = await Promise.race([promise, timeout]);
            clearTimeout(timeoutId);
            return result;
        } catch (err) {
            clearTimeout(timeoutId);
            lastError = err;
            if (attempt < retries) {
                // Exponential back-off: 500 ms, 1000 ms, …
                await new Promise(res => setTimeout(res, 500 * Math.pow(2, attempt)));
            }
        }
    }
    throw lastError;
}

// ============================================================
// Main initialisation
// ============================================================
export async function initializeApplication(requireAuth = true) {
    await loadGlobalUI();

    try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
            currentUser = session.user;
            await resolveUserRole();

            window.userRole = userRole;
            activateUserUI();
            applyRoleBasedUI();
            enforcePageAccess();

            if (navigator.onLine) processSyncQueue();

            return { user: currentUser, role: userRole };
        } else {
            handleUnauthenticated(requireAuth);
            return null;
        }
    } catch (err) {
        console.warn('Auth check failed (likely offline):', err.message);
        handleUnauthenticated(requireAuth);
        return null;
    }
}

// ============================================================
// Resolve user role (online → DB, offline → localStorage cache)
// ============================================================
async function resolveUserRole() {
    if (!currentUser?.email) { userRole = 'operator'; return; }

    const email = currentUser.email.toLowerCase();

    // Super-admin shortcut
    if (email === ADMIN_EMAIL) {
        userRole = 'admin';
        localStorage.setItem(ROLE_CACHE_KEY, 'admin');
        return;
    }

    if (navigator.onLine) {
        try {
            const { data, error } = await fetchWithTimeout(
                supabase.from('user_roles').select('role').eq('email', email).maybeSingle(),
                8000, 1
            );
            if (!error && data?.role) {
                userRole = data.role;
                localStorage.setItem(ROLE_CACHE_KEY, userRole);
                return;
            }
        } catch {
            // Fall through to cached value
        }
    }

    // Use cached role when offline or DB unreachable
    userRole = localStorage.getItem(ROLE_CACHE_KEY) || 'operator';
}

// ============================================================
// Role-based page access guard
// ============================================================
function enforcePageAccess() {
    const href = window.location.pathname.toLowerCase();

    const OPERATOR_BLOCKED = ['/energy-summary.html', '/nepali-calendar.html', '/user-management.html', '/attendance.html'];
    const STAFF_BLOCKED    = ['/nepali-calendar.html', '/user-management.html'];

    const blocked =
        (userRole === 'operator' && OPERATOR_BLOCKED.some(p => href.endsWith(p))) ||
        (userRole === 'staff'    && STAFF_BLOCKED.some(p => href.endsWith(p)));

    if (blocked) {
        window.location.replace('index.html');
        return false;
    }
    return true;
}

// ============================================================
// Load global header / footer HTML fragments
// ============================================================
async function loadGlobalUI() {
    const pairs = [
        ['global-header-container', 'global-header', './components/header.html'],
        ['global-footer-container', 'global-footer', './components/footer.html'],
    ];

    await Promise.all(pairs.map(async ([id1, id2, url]) => {
        const el = document.getElementById(id1) || document.getElementById(id2);
        if (!el || el.innerHTML.trim()) return;
        try {
            const res = await fetch(url);
            if (res.ok) el.innerHTML = await res.text();
        } catch {
            console.warn(`Could not load ${url}`);
        }
    }));
}

// ============================================================
// UI activation on authenticated state
// ============================================================
function activateUserUI() {
    const mainNav    = document.getElementById('main-nav');
    const loginBtn   = document.getElementById('login-btn');
    const logoutBtn  = document.getElementById('logout-btn');
    const headerEmail = document.getElementById('header-email');
    const mobileBtn  = document.getElementById('mobile-menu-btn');

    if (mainNav) { mainNav.classList.remove('hidden'); mainNav.classList.add('flex'); }
    if (loginBtn) loginBtn.classList.add('hidden');
    if (mobileBtn) mobileBtn.classList.remove('hidden');

    if (logoutBtn) {
        logoutBtn.classList.remove('hidden');
        logoutBtn.onclick = async () => {
            if (!navigator.onLine) {
                showNotification('You must be online to sign out safely.', true);
                return;
            }
            logoutBtn.textContent = 'Signing out…';
            logoutBtn.disabled = true;
            await supabase.auth.signOut();
            localStorage.removeItem(ROLE_CACHE_KEY);
            window.location.replace('index.html');
        };
    }

    if (headerEmail && currentUser?.email) {
        const displayName = currentUser.email.split('@')[0];
        headerEmail.classList.remove('hidden');
        headerEmail.classList.add('flex');
        // Update the <span> inside the button
        const span = headerEmail.querySelector('span');
        if (span) span.textContent = displayName;
        else headerEmail.childNodes[headerEmail.childNodes.length - 1].textContent = displayName;
    }
}

// ============================================================
// Unauthenticated state handler
// ============================================================
function handleUnauthenticated(requireAuth) {
    currentUser = null;
    window.currentUser = null;

    const mainNav    = document.getElementById('main-nav');
    const loginBtn   = document.getElementById('login-btn');
    const logoutBtn  = document.getElementById('logout-btn');
    const headerEmail = document.getElementById('header-email');
    const mobileBtn  = document.getElementById('mobile-menu-btn');

    if (mainNav)     { mainNav.classList.add('hidden');    mainNav.classList.remove('flex'); }
    if (logoutBtn)   logoutBtn.classList.add('hidden');
    if (headerEmail) headerEmail.classList.add('hidden');
    if (mobileBtn)   mobileBtn.classList.add('hidden');

    if (loginBtn) {
        loginBtn.classList.remove('hidden');
        loginBtn.onclick = () => {
            if (!navigator.onLine) {
                showNotification('No internet connection — sign-in requires online access.', true);
                return;
            }
            const modal = document.getElementById('login-modal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            } else {
                window.location.href = 'index.html';
            }
        };
    }

    // Redirect only if truly requiring auth and not already on index/signin
    const path = window.location.pathname;
    const onPublicPage = path.endsWith('index.html') || path.endsWith('signin.html') || path === '/';
    if (requireAuth && !onPublicPage) {
        window.location.replace('index.html');
    }
}

// ============================================================
// Apply role-based element visibility
// ============================================================
function applyRoleBasedUI() {
    // Hide all role-gated elements first
    document.querySelectorAll('.admin-only, .staff-only').forEach(el => el.classList.add('role-hidden'));

    if (userRole === 'admin') {
        document.querySelectorAll('.admin-only, .staff-only').forEach(el => el.classList.remove('role-hidden'));
    } else if (userRole === 'staff') {
        document.querySelectorAll('.staff-only').forEach(el => el.classList.remove('role-hidden'));
    }

    const nameEl = document.getElementById('display-user-name');
    if (nameEl) nameEl.textContent = currentUser?.email?.split('@')[0] ?? '';

    const roleEl = document.getElementById('display-user-role');
    if (roleEl) roleEl.textContent = userRole.toUpperCase();
}

// ============================================================
// Online event → trigger sync
// ============================================================
window.addEventListener('online', async () => {
    console.info('[Makari Gad] Internet restored – processing sync queue…');
    await processSyncQueue();
});

// ============================================================
// Safe upsert with offline fallback queue
// ============================================================
export async function safeUpsert(tableName, payload) {
    if (navigator.onLine) {
        try {
            const { error } = await supabase.from(tableName).upsert(payload);
            if (error) throw error;
            return { success: true, queued: false };
        } catch (e) {
            console.warn(`[safeUpsert] Live save failed for "${tableName}". Queuing. Error: ${e.message}`);
            queueForSync(tableName, payload);
            return { success: true, queued: true };
        }
    } else {
        queueForSync(tableName, payload);
        return { success: true, queued: true };
    }
}

// ============================================================
// Queue item for offline sync
// ============================================================
function queueForSync(tableName, payload) {
    const queue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
    const items = Array.isArray(payload) ? payload : [payload];

    // Tag items without a real id so they don't overwrite each other
    items.forEach(item => {
        if (!item.id) item.__local_id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    });

    queue.push({ table: tableName, data: items, timestamp: new Date().toISOString() });
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    console.info(`[safeUpsert] Queued ${items.length} item(s) for "${tableName}".`);
}

// ============================================================
// Process sync queue (deduplicate by table + id, keep latest)
// ============================================================
export async function processSyncQueue() {
    const queue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
    if (!queue.length) return;

    // Build a map keyed by "table|id" → keep only the most recent entry
    const latestMap = new Map();
    for (const task of queue) {
        for (const item of task.data) {
            const key = `${task.table}|${item.id ?? item.__local_id}`;
            const existing = latestMap.get(key);
            if (!existing || task.timestamp > existing.timestamp) {
                latestMap.set(key, { table: task.table, data: item, timestamp: task.timestamp });
            }
        }
    }

    // Group deduplicated items by table
    const grouped = {};
    for (const { table, data } of latestMap.values()) {
        (grouped[table] ??= []).push(data);
    }

    const failedTables = new Set();

    for (const [table, items] of Object.entries(grouped)) {
        try {
            const cleanItems = items.map(({ __local_id: _, ...rest }) => rest);
            const { error } = await supabase.from(table).upsert(cleanItems);
            if (error) throw error;
        } catch (e) {
            console.error(`[processSyncQueue] Sync failed for "${table}":`, e.message);
            failedTables.add(table);
        }
    }

    // Re-queue only items for tables that failed
    const remaining = failedTables.size
        ? queue.filter(t => failedTables.has(t.table))
        : [];

    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(remaining));

    if (!remaining.length) {
        console.info('[processSyncQueue] ✅ All offline data synced successfully.');
    }
}

// ============================================================
// Periodic sync every 15 seconds when online
// ============================================================
setInterval(() => {
    if (navigator.onLine) processSyncQueue();
}, 15_000);
