import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://ineaqjsmabbsjwwbjfya.supabase.co';
const supabaseKey = 'sb_publishable_uadlDXas6Tpif6j4eWp30g_j6OG326s';
export const supabase = createClient(supabaseUrl, supabaseKey);
window.supabaseClient = supabase;

export let currentUser = null;
export let userRole = 'operator';

export async function initializeApplication(requireAuth = true) {
    // 1. INJECT UI FIRST! This guarantees the header and buttons load instantly, even offline.
    await loadGlobalUI();

    try {
        // 2. Fast local check for session (Works offline)
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (session && session.user) {
            currentUser = session.user;
            window.currentUser = currentUser;

            // 3. Try to get role from DB, fallback to local memory if offline
            let isAdmin = currentUser.email.toLowerCase() === 'upenjyo@gmail.com';
            if (!isAdmin) {
                if (navigator.onLine) {
                    try {
                        const { data, error: dbErr } = await supabase.from('user_roles').select('role').eq('email', currentUser.email).maybeSingle();
                        if (data && !dbErr) {
                            if (data.role === 'admin') isAdmin = true;
                            else if (data.role === 'staff') userRole = 'staff'; 
                            else userRole = 'operator';
                            
                            // Save to laptop's safe memory
                            localStorage.setItem('makarigad_offline_role', userRole);
                        } else {
                            throw new Error("DB Error");
                        }
                    } catch (e) {
                        // OFFLINE FALLBACK
                        userRole = localStorage.getItem('makarigad_offline_role') || 'operator';
                        if (userRole === 'admin') isAdmin = true;
                    }
                } else {
                    // OFFLINE FALLBACK
                    userRole = localStorage.getItem('makarigad_offline_role') || 'operator';
                    if (userRole === 'admin') isAdmin = true;
                }
            } else {
                userRole = 'admin';
                localStorage.setItem('makarigad_offline_role', 'admin');
            }
            
            window.userRole = userRole; 

            // 4. Update the loaded UI with the user's details
            activateUserUI();
            applyRoleBasedUI();

            // 5. Security Routing
            const href = window.location.href.toLowerCase();
            if (userRole === 'operator' && (href.includes('energy-summary') || href.includes('nepali-calendar') || href.includes('user-management'))) {
                window.location.href = 'index.html';
                return null;
            }
            if (userRole === 'staff' && (href.includes('nepali-calendar') || href.includes('user-management'))) {
                window.location.href = 'index.html';
                return null;
            }

            // 6. Trigger background sync
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

async function loadGlobalUI() {
    try {
        let headerContainer = document.getElementById('global-header-container') || document.getElementById('global-header');
        // Only fetch if it's empty to prevent double-loading
        if (headerContainer && !headerContainer.innerHTML.trim()) {
            const headerRes = await fetch('./header.html'); 
            if (headerRes.ok) headerContainer.innerHTML = await headerRes.text();
        }
    } catch(e) { 
        console.warn("Could not load global header - check offline cache"); 
    }
}

function activateUserUI() {
    const mainNav = document.getElementById('main-nav');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn'); 
    const headerEmail = document.getElementById('header-email'); 

    if (mainNav) { mainNav.classList.remove('hidden'); mainNav.classList.add('flex'); }
    if (loginBtn) loginBtn.classList.add('hidden');
    if (logoutBtn) {
        logoutBtn.classList.remove('hidden');
        logoutBtn.onclick = async () => { await supabase.auth.signOut(); window.location.href = "index.html"; };
    }
    if (headerEmail && currentUser) {
        headerEmail.classList.remove('hidden');
        headerEmail.classList.add('flex'); // Unhides the profile button safely
        headerEmail.innerText = currentUser.email.split('@')[0];
    }
}

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
            const modal = document.getElementById('login-modal');
            if (modal) modal.classList.remove('hidden');
            else window.location.href = "index.html";
        };
    }
    
    if (requireAuth) window.location.href = "index.html";
}

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

// -------------------------------------------------------------
// SMART OFFLINE SYNC ENGINE
// -------------------------------------------------------------

// Listen for the exact moment the internet comes back on
window.addEventListener('online', async () => { 
    console.log("Internet restored! Processing sync queue...");
    await processSyncQueue(); 
});

export async function safeUpsert(tableName, payload) {
    if (navigator.onLine) {
        try {
            // Attempt live sync
            const { error } = await supabase.from(tableName).upsert(payload);
            if (error) {
                console.warn(`Live save failed, queueing for offline sync. Error: ${error.message}`);
                queueForSync(tableName, payload);
                return { success: true, queued: true };
            }
            return { success: true, queued: false };
        } catch (e) {
            // Network dropped mid-save
            queueForSync(tableName, payload);
            return { success: true, queued: true };
        }
    } else {
        // Entirely offline
        queueForSync(tableName, payload);
        return { success: true, queued: true };
    }
}

function queueForSync(tableName, payload) {
    // 1. Fetch current offline queue from computer's safe memory
    let queue = JSON.parse(localStorage.getItem('makarigad_sync_queue')) || [];
    
    // 2. Add the new data to the queue
    queue.push({ 
        table: tableName, 
        data: Array.isArray(payload) ? payload : [payload], 
        timestamp: new Date().toISOString() 
    });
    
    // 3. Save it back to memory
    localStorage.setItem('makarigad_sync_queue', JSON.stringify(queue));
    console.log(`Data safely queued offline for table: ${tableName}`);
}

export async function processSyncQueue() {
    let queue = JSON.parse(localStorage.getItem('makarigad_sync_queue')) || [];
    if (queue.length === 0) return;
    
    let remainingQueue = [];
    
    for (let task of queue) {
        try { 
            // The magic happens here: .upsert will overwrite existing database records
            // ensuring that offline edits take priority over older database records.
            const { error } = await supabase.from(task.table).upsert(task.data); 
            if (error) throw error; 
        } catch (e) { 
            // If one specific row fails (e.g. database still down), keep it in the queue for next time
            console.error(`Sync failed for ${task.table}, keeping in queue.`, e);
            remainingQueue.push(task); 
        }
    }
    
    // Update the local queue (removing the successful ones)
    localStorage.setItem('makarigad_sync_queue', JSON.stringify(remainingQueue));
    if (remainingQueue.length === 0) {
        console.log("✅ All offline data successfully synced to Supabase!");
    }
}

// Automatically check the queue every 5 seconds just in case
setInterval(() => {
    if (navigator.onLine) processSyncQueue();
}, 5000);