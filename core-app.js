import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://ineaqjsmabbsjwwbjfya.supabase.co';
const supabaseKey = 'sb_publishable_uadlDXas6Tpif6j4eWp30g_j6OG326s';
export const supabase = createClient(supabaseUrl, supabaseKey);
window.supabaseClient = supabase;

export let currentUser = null;
export let userRole = 'operator';

// Helper function to force a timeout if the network is a "lie" (connected to router, but no internet)
const fetchWithTimeout = async (promise, ms = 3000) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Network Timeout')), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

export async function initializeApplication(requireAuth = true) {
    await loadGlobalUI();

    try {
        // Fast local check for session (Works offline)
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (session && session.user) {
            currentUser = session.user;
            window.currentUser = currentUser;

            let isAdmin = currentUser.email.toLowerCase() === 'upenjyo@gmail.com';
            if (!isAdmin) {
                if (navigator.onLine) {
                    try {
                        // Use the 3-Second Rule to prevent freezing!
                        const query = supabase.from('user_roles').select('role').eq('email', currentUser.email).maybeSingle();
                        const { data, error: dbErr } = await fetchWithTimeout(query, 3000);
                        
                        if (data && !dbErr) {
                            if (data.role === 'admin') isAdmin = true;
                            else if (data.role === 'staff') userRole = 'staff'; 
                            else userRole = 'operator';
                            localStorage.setItem('makarigad_offline_role', userRole);
                        } else {
                            throw new Error("DB Error");
                        }
                    } catch (e) {
                        userRole = localStorage.getItem('makarigad_offline_role') || 'operator';
                        if (userRole === 'admin') isAdmin = true;
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
            if(!navigator.onLine) return alert("You must be online to sign out safely.");
            await supabase.auth.signOut(); window.location.href = "index.html"; 
        };
    }
    if (headerEmail && currentUser) {
        headerEmail.classList.remove('hidden');
        headerEmail.classList.add('flex');
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
            if(!navigator.onLine) return alert("⚠️ No Internet Connection.\n\nYou must have an internet connection to sign in.");
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

window.addEventListener('online', async () => { 
    console.log("Internet restored! Processing sync queue...");
    await processSyncQueue(); 
});

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

function queueForSync(tableName, payload) {
    let queue = JSON.parse(localStorage.getItem('makarigad_sync_queue')) || [];
    queue.push({ table: tableName, data: Array.isArray(payload) ? payload : [payload], timestamp: new Date().toISOString() });
    localStorage.setItem('makarigad_sync_queue', JSON.stringify(queue));
    console.log(`Data safely queued offline for table: ${tableName}`);
}

export async function processSyncQueue() {
    let queue = JSON.parse(localStorage.getItem('makarigad_sync_queue')) || [];
    if (queue.length === 0) return;
    
    let remainingQueue = [];
    
    for (let task of queue) {
        try { 
            const { error } = await supabase.from(task.table).upsert(task.data); 
            if (error) throw error; 
        } catch (e) { 
            console.error(`Sync failed for ${task.table}, keeping in queue.`, e);
            remainingQueue.push(task); 
        }
    }
    
    localStorage.setItem('makarigad_sync_queue', JSON.stringify(remainingQueue));
    if (remainingQueue.length === 0) {
        console.log("✅ All offline data successfully synced to Supabase!");
    }
}

setInterval(() => {
    if (navigator.onLine) processSyncQueue();
}, 5000);