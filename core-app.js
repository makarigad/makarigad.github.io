import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://ineaqjsmabbsjwwbjfya.supabase.co';
const supabaseKey = 'sb_publishable_uadlDXas6Tpif6j4eWp30g_j6OG326s';
export const supabase = createClient(supabaseUrl, supabaseKey);
window.supabaseClient = supabase;

export let currentUser = null;
export let userRole = 'operator';

export async function initializeApplication(requireAuth = true) {
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (session && session.user) {
            currentUser = session.user;
            window.currentUser = currentUser;
        } else {
            currentUser = null;
            window.currentUser = null;
        }

        await loadGlobalUI();

        if (error) throw error;
        
        if (session?.user) {
            let isAdmin = currentUser.email.toLowerCase() === 'upenjyo@gmail.com';
            if (!isAdmin) {
                try {
                    const { data, error: dbErr } = await supabase.from('user_roles').select('role').eq('email', currentUser.email).maybeSingle();
                    if (data && !dbErr) {
                        if (data.role === 'admin') isAdmin = true;
                        else if (data.role === 'staff') userRole = 'staff'; 
                        else userRole = 'operator';
                        localStorage.setItem('makarigad_offline_role', userRole);
                    } else { throw new Error("Offline"); }
                } catch (e) {
                    userRole = localStorage.getItem('makarigad_offline_role') || 'operator';
                    if (userRole === 'admin') isAdmin = true;
                }
            } else {
                userRole = 'admin';
                localStorage.setItem('makarigad_offline_role', 'admin');
            }
            
            window.userRole = userRole; 
            const href = window.location.href.toLowerCase();
            
            if (userRole === 'operator' && (href.includes('energy-summary') || href.includes('nepali-calendar') || href.includes('user-management'))) {
                window.location.href = 'index.html'; return null;
            }
            if (userRole === 'staff' && (href.includes('nepali-calendar') || href.includes('user-management'))) {
                window.location.href = 'index.html'; return null;
            }

            applyRoleBasedUI();
            return { user: currentUser, role: userRole };

        } else if (requireAuth) {
            window.location.href = "index.html"; return null;
        } else { return null; }
    } catch (err) {
        console.error("Auth Error:", err);
        if (requireAuth) window.location.href = "index.html";
    }
}

async function loadGlobalUI() {
    try {
        let headerContainer = document.getElementById('global-header-container') || document.getElementById('global-header');
        if (headerContainer) {
            const headerRes = await fetch('./header.html'); 
            if (headerRes.ok) headerContainer.innerHTML = await headerRes.text();
        }
        
        const mainNav = document.getElementById('main-nav');
        const loginBtn = document.getElementById('login-btn');
        const logoutBtn = document.getElementById('logout-btn'); 
        const profileBtn = document.getElementById('profile-btn');

        if (currentUser) {
            if (mainNav) { mainNav.classList.remove('hidden'); mainNav.classList.add('flex'); }
            if (loginBtn) loginBtn.classList.add('hidden');
            if (logoutBtn) logoutBtn.classList.remove('hidden');
            
            if (profileBtn) {
                profileBtn.classList.remove('hidden');
                profileBtn.classList.add('flex');
                profileBtn.onclick = () => {
                    const modal = document.getElementById('profile-modal');
                    if(modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
                };
            }
            if (logoutBtn) logoutBtn.onclick = async () => { await window.supabaseClient.auth.signOut(); window.location.href = "index.html"; };
        } else {
            if (mainNav) { mainNav.classList.add('hidden'); mainNav.classList.remove('flex'); }
            if (logoutBtn) logoutBtn.classList.add('hidden');
            if (profileBtn) profileBtn.classList.add('hidden');
            if (loginBtn) {
                loginBtn.classList.remove('hidden');
                loginBtn.onclick = () => {
                    const modal = document.getElementById('login-modal');
                    if (modal) modal.classList.remove('hidden'); else window.location.href = "index.html";
                };
            }
        }
    } catch(e) { console.warn("Could not load global header"); }
}

function applyRoleBasedUI() {
    document.querySelectorAll('.admin-only, .staff-only').forEach(el => el.classList.add('role-hidden'));

    if (userRole === 'admin') {
        document.querySelectorAll('.admin-only, .staff-only').forEach(el => el.classList.remove('role-hidden'));
    } else if (userRole === 'staff') {
        document.querySelectorAll('.staff-only').forEach(el => el.classList.remove('role-hidden'));
    }
    
    const nameDisplay = document.getElementById('display-user-name');
    if (nameDisplay && currentUser) nameDisplay.innerText = currentUser.email.split('@')[0];
    const roleDisplay = document.getElementById('display-user-role');
    if (roleDisplay) roleDisplay.innerText = userRole;
}

window.addEventListener('online', async () => { await processSyncQueue(); });

export async function safeUpsert(tableName, payload) {
    if (navigator.onLine) {
        try {
            const { error } = await supabase.from(tableName).upsert(payload);
            if (error) {
                alert(`❌ DATABASE REJECTED SAVE!\n\nError: ${error.message}`);
                return { success: false, queued: false };
            }
            return { success: true, queued: false };
        } catch (e) { return { success: false, queued: false }; }
    } else {
        queueForSync(tableName, payload);
        return { success: true, queued: true };
    }
}

function queueForSync(tableName, payload) {
    let queue = JSON.parse(localStorage.getItem('makarigad_sync_queue')) || [];
    queue.push({ table: tableName, data: Array.isArray(payload) ? payload : [payload], timestamp: new Date().toISOString() });
    localStorage.setItem('makarigad_sync_queue', JSON.stringify(queue));
}

export async function processSyncQueue() {
    let queue = JSON.parse(localStorage.getItem('makarigad_sync_queue')) || [];
    if (queue.length === 0) return;
    let remainingQueue = [];
    for (let task of queue) {
        try { const { error } = await supabase.from(task.table).upsert(task.data); if (error) throw error; } 
        catch (e) { remainingQueue.push(task); }
    }
    localStorage.setItem('makarigad_sync_queue', JSON.stringify(remainingQueue));
}
setTimeout(processSyncQueue, 3000);