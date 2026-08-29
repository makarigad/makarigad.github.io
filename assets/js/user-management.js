import { supabase, initializeApplication } from './core-app.js';

function showToast(msg, isError = false) {
    const toast = document.getElementById('um-toast');
    const msgEl = document.getElementById('um-toast-msg');
    msgEl.textContent = msg;
    toast.style.borderLeftColor = isError ? '#dc2626' : '#10b981';
    toast.classList.remove('opacity-0');
    toast.classList.add('opacity-100');
    setTimeout(() => { toast.classList.remove('opacity-100'); toast.classList.add('opacity-0'); }, 4000);
}

async function startPage() { 
    const sessionData = await initializeApplication(true); 
    
    if (sessionData && sessionData.role === 'admin') { 
        document.getElementById('admin-panel').classList.remove('hidden'); 
        loadUsers(); 
    } else { 
        document.getElementById('access-denied').classList.remove('hidden'); 
    } 
}

async function loadUsers() {
    const { data, error } = await supabase.from('user_roles').select('*').order('role', { ascending: true });
    if (error) return;

    const tbody = document.getElementById('users-body');
    tbody.innerHTML = '';

    data.forEach(user => {
        let roleColor = 'bg-slate-100 text-slate-600';
        if (user.role === 'admin') roleColor = 'bg-red-100 text-red-700';
        if (user.role === 'operator') roleColor = 'bg-indigo-100 text-indigo-700';
        if (user.role === 'staff') roleColor = 'bg-emerald-100 text-emerald-700';
        if (user.role === 'management') roleColor = 'bg-purple-100 text-purple-700';

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50";

        const td1 = document.createElement('td');
        const nameDiv = document.createElement('div');
        nameDiv.className = 'font-bold text-slate-800';
        nameDiv.textContent = user.full_name || '—';
        const posDiv = document.createElement('div');
        posDiv.className = 'text-xs text-slate-500';
        posDiv.textContent = user.position || 'No Title';
        td1.appendChild(nameDiv);
        td1.appendChild(posDiv);

        const td2 = document.createElement('td');
        const emailDiv = document.createElement('div');
        emailDiv.className = 'text-sm font-medium text-slate-700';
        emailDiv.textContent = user.email;
        const contactDiv = document.createElement('div');
        contactDiv.className = 'text-xs text-slate-500';
        contactDiv.textContent = `${user.phone || ''} | ${user.company || ''}`;
        td2.appendChild(emailDiv);
        td2.appendChild(contactDiv);

        const td3 = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${roleColor}`;
        badge.textContent = user.role;
        td3.appendChild(badge);

        const td4 = document.createElement('td');
        td4.className = 'text-center';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'text-indigo-600 hover:underline font-bold text-xs mr-3';
        editBtn.textContent = 'Edit';
        editBtn.dataset.email = user.email;
        editBtn.addEventListener('click', () => window.editUser(user.email));

        const delBtn = document.createElement('button');
        delBtn.className = 'text-red-600 hover:underline font-bold text-xs';
        delBtn.textContent = 'Del';
        delBtn.dataset.email = user.email;
        delBtn.addEventListener('click', () => window.deleteUser(user.email));

        td4.appendChild(editBtn);
        td4.appendChild(delBtn);

        tr.appendChild(td1);
        tr.appendChild(td2);
        tr.appendChild(td3);
        tr.appendChild(td4);
        tbody.appendChild(tr);
    });
}

window.editUser = async function(email) {
    const { data } = await supabase.from('user_roles').select('*').eq('email', email).single();
    if (data) {
        document.getElementById('u-email').value = data.email;
        document.getElementById('u-role').value = data.role;
        document.getElementById('u-name').value = data.full_name || '';
        document.getElementById('u-position').value = data.position || '';
        document.getElementById('u-phone').value = data.phone || '';
        document.getElementById('u-dob').value = data.dob || '';
        document.getElementById('u-company').value = data.company || 'Makari Gad Hydroelectric Project';
        document.getElementById('u-password').value = ''; 
        
        const perms = data.permissions || {};
        document.getElementById('perm-plant_data').value = perms.plant_data || 'edit';
        document.getElementById('perm-hourly_log').value = perms.hourly_log || 'edit';
        document.getElementById('perm-inventory').value = perms.inventory || 'edit';
        document.getElementById('perm-attendance').value = perms.attendance || 'edit';
        document.getElementById('perm-operator_log').value = perms.operator_log || 'edit';
        document.getElementById('perm-energy_summary').value = perms.energy_summary || 'edit';
        document.getElementById('perm-ad_prediction').value = perms.ad_prediction || 'edit';

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

document.getElementById('user-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('u-email').value.trim().toLowerCase();
    const password = document.getElementById('u-password').value;
    const btn = document.getElementById('save-btn');
    btn.innerText = "Processing...";

    try {
        if (password.length > 0) {
            if (password.length < 6) throw new Error("Password must be at least 6 characters.");
            const { error: authError } = await supabase.auth.signUp({ email: email, password: password });
            if (authError && authError.message !== "User already registered") throw authError;
        }

        const userPermissions = {
            plant_data: document.getElementById('perm-plant_data').value,
            hourly_log: document.getElementById('perm-hourly_log').value,
            inventory: document.getElementById('perm-inventory').value,
            attendance: document.getElementById('perm-attendance').value,
            operator_log: document.getElementById('perm-operator_log').value,
            energy_summary: document.getElementById('perm-energy_summary').value,
            ad_prediction: document.getElementById('perm-ad_prediction').value
        };

        const { error: dbError } = await supabase.from('user_roles').upsert({
            email: email,
            role: document.getElementById('u-role').value,
            permissions: userPermissions,
            full_name: document.getElementById('u-name').value.trim() || null,
            position: document.getElementById('u-position').value.trim() || null,
            phone: document.getElementById('u-phone').value.trim() || null,
            dob: document.getElementById('u-dob').value || null,
            company: document.getElementById('u-company').value.trim() || null,
            updated_at: new Date().toISOString()
        }, { onConflict: 'email' });

        if (dbError) throw dbError;
        
        document.getElementById('user-form').reset();
        document.getElementById('u-company').value = 'Makari Gad Hydroelectric Project';
        showToast("✅ Employee and permissions successfully saved!");
        loadUsers();
    } catch (err) {
        showToast("❌ Error: " + err.message, true);
    } finally {
        btn.innerText = "Create / Update User";
    }
});

window.deleteUser = async function(email) {
    if (!window.confirm(`Remove profile for ${email}?\n\nThis only removes their dashboard role. Their login account remains active.`)) return;
    const { error } = await supabase.from('user_roles').delete().eq('email', email);
    if (error) {
        showToast("❌ Error deleting: " + error.message, true);
    } else {
        showToast("User profile removed.");
        loadUsers();
    }
};

startPage();