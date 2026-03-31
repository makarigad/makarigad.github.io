import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://ineaqjsmabbsjwwbjfya.supabase.co';
const supabaseKey = 'sb_publishable_uadlDXas6Tpif6j4eWp30g_j6OG326s';
export const supabase = createClient(supabaseUrl, supabaseKey);

export let currentUser = null;
export let userRole = 'operator';

// ============================================================
// Helper: show a notification using the modal (if present)
// ============================================================
export function showNotification(msg, isError = false) {
    const modal = document.getElementById('notification-modal');
    const messageEl = document.getElementById('notification-message');
    if (!modal || !messageEl) return;
    messageEl.textContent = msg;
    modal.classList.remove('opacity-0', '-translate-y-4');
    modal.style.borderLeftColor = isError ? '#dc2626' : '#10b981';
    modal.classList.add('opacity-100');
    setTimeout(() => {
        modal.classList.remove('opacity-100');
        modal.classList.add('opacity-0', '-translate-y-4');
    }, 4500);
}

// ============================================================
// Universal UTC date parser (YYYY-MM-DD)
// ============================================================
export function parseToUTCDate(dateInput) {
    if (!dateInput) return null;
    let date;
    if (typeof dateInput === 'number') {
        // Excel serial number (date1904 = false)
        if (typeof XLSX !== 'undefined' && XLSX.SSF) {
            const ex = XLSX.SSF.parse_date_code(dateInput, { date1904: false });
            if (ex) date = new Date(Date.UTC(ex.y, ex.m - 1, ex.d));
        } else {
            // Fallback: Excel serial to JS date (works for most dates after 1900)
            const jsDate = new Date(Math.round((dateInput - 25569) * 86400 * 1000));
            date = new Date(Date.UTC(jsDate.getUTCFullYear(), jsDate.getUTCMonth(), jsDate.getUTCDate()));
        }
    } else if (dateInput instanceof Date) {
        date = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
    } else {
        // Try to parse string
        let s = String(dateInput).trim();
        let match = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
        if (match) {
            date = new Date(Date.UTC(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3])));
        } else {
            match = s.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
            if (match) {
                date = new Date(Date.UTC(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1])));
            }
        }
    }
    if (date && !isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
    }
    return null;
}

// ============================================================
// Enhanced timeout with optional retries (exponential backoff)
// ============================================================
const fetchWithTimeout = async (promise, ms = 8000, retries = 1) => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            let timeoutId;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('Network Timeout')), ms);
            });
            const result = await Promise.race([promise, timeoutPromise]);
            clearTimeout(timeoutId);
            return result;
        } catch (err) {
            lastError = err;
            if (attempt === retries) break;
            await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt)));
        }
    }
    throw lastError;
};

// ============================================================
// Main initialization function
// ============================================================
export async function initializeApplication(requireAuth = true) {
    await loadGlobalUI();

    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (session && session.user) {
            currentUser = session.user;
            // Safe check for email just in case
            let isAdmin = currentUser.email && currentUser.email.toLowerCase() === 'upenjyo@gmail.com';

            if (!isAdmin) {
                if (navigator.onLine) {
                    try {
                        const query = supabase.from('user_roles')
                            .select('role')
                            .eq('email', currentUser.email)
                            .maybeSingle();
                        const { data, error: dbErr } = await fetchWithTimeout(query, 8000, 1);
                        
                        if (data && !dbErr) {
                            if (data.role === 'admin') isAdmin = true;
                            else if (data.role === 'staff') userRole = 'staff';
                            else userRole = 'operator';
                            localStorage.setItem('makarigad_offline_role', userRole);
                        } else {
                            throw new Error("DB Error");
                        }
                    } catch (e) {
                        if (!navigator.onLine || e.message === 'Network Timeout') {
                            userRole = localStorage.getItem('makarigad_offline_role') || 'operator';
                            if (userRole === 'admin') isAdmin = true;
                        } else {
                            userRole = 'operator';
                        }
                    }
                } else {
                    userRole = localStorage.getItem('makarigad_offline_role') || 'operator';
                    if (userRole === 'admin') isAdmin = true;
                }
            } else {
                userRole = 'admin';
                localStorage.setItem('makarigad_offline_role', 'admin');
            }
            
            window.userRole = userRole;

            activateUserUI();
            applyRoleBasedUI();

            const href = window.location.href.toLowerCase();
            if (userRole === 'operator' && (href.includes('energy-summary') || href.includes('nepali-calendar') || href.includes('user-management'))) {
                window.location.href = 'index.html';
                return null;
            }
            if (userRole === 'staff' && (href.includes('nepali-calendar') || href.includes('user-management'))) {
                window.location.href = 'index.html';
                return null;
            }

            if (navigator.onLine) processSyncQueue();

            return { user: currentUser, role: userRole };

        } else {
            handleUnauthenticated(requireAuth);
            return null;
        }
    } catch (err) {
        console.warn("Auth check failed (Likely Offline):", err);
        handleUnauthenticated(requireAuth);
    }
}

// ============================================================
// Load global header/footer
// ============================================================
async function loadGlobalUI() {
    try {
        let headerContainer = document.getElementById('global-header-container') || document.getElementById('global-header');
        if (headerContainer && !headerContainer.innerHTML.trim()) {
            const headerRes = await fetch('./header.html'); 
            if (headerRes.ok) headerContainer.innerHTML = await headerRes.text();
        }
    } catch(e) { 
        console.warn("Could not load global header"); 
    }
}

// ============================================================
// UI activation when logged in
// ============================================================
function activateUserUI() {
    const mainNav = document.getElementById('main-nav');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn'); 
    const headerEmail = document.getElementById('header-email'); 

    if (mainNav) { mainNav.classList.remove('hidden'); mainNav.classList.add('flex'); }
    if (loginBtn) loginBtn.classList.add('hidden');
    if (logoutBtn) {
        logoutBtn.classList.remove('hidden');
        logoutBtn.onclick = async () => { 
            if (!navigator.onLine) {
                showNotification("You must be online to sign out safely.", true);
                return;
            }
            await supabase.auth.signOut();
            localStorage.removeItem('makarigad_offline_role');
            window.location.href = "index.html"; 
        };
    }
    if (headerEmail && currentUser && currentUser.email) {
        headerEmail.classList.remove('hidden');
        headerEmail.classList.add('flex');
        headerEmail.innerText = currentUser.email.split('@')[0];
    }
}

// ============================================================
// Handle unauthenticated state (FIXED: Infinite loop bug)
// ============================================================
function handleUnauthenticated(requireAuth) {
    currentUser = null;
    window.currentUser = null;
    
    const mainNav = document.getElementById('main-nav');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn'); 
    const headerEmail = document.getElementById('header-email'); 

    if (mainNav) { mainNav.classList.add('hidden'); mainNav.classList.remove('flex'); }
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (headerEmail) headerEmail.classList.add('hidden');
    if (loginBtn) {
        loginBtn.classList.remove('hidden');
        loginBtn.onclick = () => {
            if (!navigator.onLine) {
                showNotification("⚠️ No Internet Connection.\n\nYou must have an internet connection to sign in.", true);
                return;
            }
            const modal = document.getElementById('login-modal');
            if (modal) modal.classList.remove('hidden');
            else window.location.href = "index.html";
        };
    }
    
    // Safety check: Only redirect if we aren't already on the login/index page
    const isIndexPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/';
    if (requireAuth && !isIndexPage) {
        window.location.href = "index.html";
    }
}

// ============================================================
// Role‑based UI (hide admin/staff elements)
// ============================================================
function applyRoleBasedUI() {
    document.querySelectorAll('.admin-only, .staff-only').forEach(el => el.classList.add('role-hidden'));

    if (userRole === 'admin') {
        document.querySelectorAll('.admin-only, .staff-only').forEach(el => el.classList.remove('role-hidden'));
    } else if (userRole === 'staff') {
        document.querySelectorAll('.staff-only').forEach(el => el.classList.remove('role-hidden'));
    }
    
    const nameDisplay = document.getElementById('display-user-name');
    if (nameDisplay) nameDisplay.innerText = currentUser ? currentUser.email.split('@')[0] : '';
    const roleDisplay = document.getElementById('display-user-role');
    if (roleDisplay) roleDisplay.innerText = userRole.toUpperCase();
}

// ============================================================
// Online event handler
// ============================================================
window.addEventListener('online', async () => { 
    console.log("Internet restored! Processing sync queue...");
    await processSyncQueue(); 
});

// ============================================================
// Safe upsert – queues data offline if needed
// ============================================================
export async function safeUpsert(tableName, payload) {
    if (navigator.onLine) {
        try {
            const { error } = await supabase.from(tableName).upsert(payload);
            if (error) {
                console.warn(`Live save failed, queueing for offline sync. Error: ${error.message}`);
                queueForSync(tableName, payload);
                return { success: true, queued: true };
            }
            return { success: true, queued: false };
        } catch (e) {
            queueForSync(tableName, payload);
            return { success: true, queued: true };
        }
    } else {
        queueForSync(tableName, payload);
        return { success: true, queued: true };
    }
}

// ============================================================
// Queue data for offline sync (FIXED: ID generation)
// ============================================================
function queueForSync(tableName, payload) {
    let queue = JSON.parse(localStorage.getItem('makarigad_sync_queue')) || [];
    
    // Ensure every item has a temporary local ID so new inserts don't overwrite each other
    const dataArray = Array.isArray(payload) ? payload : [payload];
    dataArray.forEach(item => {
        if (!item.id) item.__local_id = 'local_' + Date.now() + Math.random().toString(36).substr(2, 9);
    });

    queue.push({
        table: tableName,
        data: dataArray,
        timestamp: new Date().toISOString()
    });
    localStorage.setItem('makarigad_sync_queue', JSON.stringify(queue));
    console.log(`Data safely queued offline for table: ${tableName}`);
}

// ============================================================
// Process sync queue – group by table+id, keep latest
// ============================================================
export async function processSyncQueue() {
    let queue = JSON.parse(localStorage.getItem('makarigad_sync_queue')) || [];
    if (queue.length === 0) return;
    
    const latestMap = new Map();
    for (const task of queue) {
        for (const item of task.data) {
            // Group by actual ID or the temporary local ID
            const key = `${task.table}|${item.id || item.__local_id}`;
            const existing = latestMap.get(key);
            if (!existing || new Date(task.timestamp) > new Date(existing.timestamp)) {
                latestMap.set(key, { table: task.table, data: item, timestamp: task.timestamp });
            }
        }
    }
    
    const groupedTasks = {};
    for (const { table, data } of latestMap.values()) {
        if (!groupedTasks[table]) groupedTasks[table] = [];
        groupedTasks[table].push(data);
    }
    
    let remainingQueue = [];
    for (const [table, items] of Object.entries(groupedTasks)) {
        try {
            // Strip out our temporary __local_id before sending to Supabase
            const cleanItems = items.map(item => {
                const clean = { ...item };
                delete clean.__local_id;
                return clean;
            });

            const { error } = await supabase.from(table).upsert(cleanItems);
            if (error) throw error;
        } catch (e) {
            console.error(`Sync failed for ${table}, keeping in queue.`, e);
            // Re-queue the exact original tasks (with local IDs intact) for this table
            remainingQueue.push(...queue.filter(t => t.table === table));
        }
    }
    
    localStorage.setItem('makarigad_sync_queue', JSON.stringify(remainingQueue));
    if (remainingQueue.length === 0) {
        console.log("✅ All offline data successfully synced to Supabase!");
    }
}

// ============================================================
// Periodic sync every 10 seconds when online
// ============================================================
setInterval(() => {
    if (navigator.onLine) processSyncQueue();
}, 10000);