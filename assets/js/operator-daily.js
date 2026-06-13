import { supabase, initializeApplication, showNotification, safeUpsert } from './core-app.js';

let currentUser = null, userRole = 'operator', currentUserName = '';

// ─── Toast ───
function toast(msg, isErr = false) {
  const el = document.getElementById('notification-modal');
  const txt = document.getElementById('notification-message');
  if(!el || !txt) return;
  el.style.borderLeftColor = isErr ? '#ef4444' : '#10b981';
  txt.textContent = msg;
  el.classList.remove('opacity-0','-translate-y-4');
  el.classList.add('opacity-100','translate-y-0');
  setTimeout(() => { el.classList.remove('opacity-100','translate-y-0'); el.classList.add('opacity-0','-translate-y-4'); }, 3500);
}

// ─── TABS ───
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab)?.classList.remove('hidden');
  });
});

// ─── WEATHER SELECTOR ───
let selectedWeather = '';
document.querySelectorAll('.weather-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.weather-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedWeather = btn.dataset.weather;
    document.getElementById('entry-weather').value = selectedWeather;
  });
});

// ─── DATE INIT ───
function getNepaliToday() {
  const n = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

// ─── LOAD ADMIN NOTICE ───
async function loadAdminNotice() {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('*')
      .eq('setting_key', 'operator_notice')
      .maybeSingle();
    
    if (data && data.setting_value) {
      const notice = typeof data.setting_value === 'string' ? JSON.parse(data.setting_value) : data.setting_value;
      if (notice.active && notice.message) {
        const bar = document.getElementById('admin-notice-bar');
        const txt = document.getElementById('admin-notice-text');
        // Check expiry
        if (!notice.expires_at || new Date(notice.expires_at) > new Date()) {
          bar?.classList.remove('hidden');
          if(txt) txt.textContent = '📢 ' + notice.message;
        }
      }
      // Populate admin form
      if (userRole === 'admin') {
        const content = document.getElementById('admin-notice-content');
        const active = document.getElementById('admin-notice-active');
        const expiry = document.getElementById('admin-notice-expiry');
        if(content) content.value = notice.message || '';
        if(active) active.checked = notice.active !== false;
        if (notice.expires_at && expiry) expiry.value = notice.expires_at.slice(0,16);
      }
    }
  } catch (e) { console.warn('Notice load error:', e); }
}

// ─── SHIFT LOG ───
async function loadShiftEntries(date) {
  const list = document.getElementById('entries-list');
  if(!list) return;
  list.innerHTML = '<div class="text-slate-400 animate-pulse font-bold">Loading…</div>';
  try {
    const { data, error } = await supabase
      .from('operator_daily_logs')
      .select('*')
      .eq('entry_date', date)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    if (!data || data.length === 0) {
      list.innerHTML = '<p class="text-slate-400 italic text-sm py-4 text-center">No entries for this date. Be the first to log your shift!</p>';
      return;
    }
    list.innerHTML = data.map(e => `
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 hover:border-indigo-200 transition">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">${e.shift ? e.shift + ' Shift' : ''}</span>
            <span class="text-xs font-bold text-slate-700">${e.operator_name || 'Unknown'}</span>
            ${e.weather ? `<span class="text-xs text-slate-500 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-100">${e.weather}${e.weather_from ? ' ' + e.weather_from + '–' + e.weather_to : ''}</span>` : ''}
          </div>
          <span class="text-[10px] text-slate-400 shrink-0">${new Date(e.created_at).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'})}</span>
        </div>
        ${e.major_task ? `<p class="text-sm text-slate-700 mb-1"><span class="font-bold text-slate-500">Task:</span> ${e.major_task}</p>` : ''}
        ${e.remark ? `<p class="text-sm text-amber-700 mb-1"><span class="font-bold">Remark:</span> ${e.remark}</p>` : ''}
        ${e.note_for_management ? `<p class="text-sm text-indigo-700"><span class="font-bold">Note:</span> ${e.note_for_management}</p>` : ''}
      </div>
    `).join('');
  } catch(e) {
    list.innerHTML = `<p class="text-rose-500 text-sm font-bold">Error: ${e.message}</p>`;
  }
}

document.getElementById('btn-load-entries')?.addEventListener('click', () => {
  const d = document.getElementById('view-date')?.value;
  if (d) loadShiftEntries(d);
});

document.getElementById('daily-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn-save-shift');
  const spinner = document.getElementById('shift-save-spinner');
  if(btn) btn.disabled = true;
  if(spinner) spinner.classList.remove('hidden');
  
  const entry_date = document.getElementById('entry-date')?.value;
  const shift = document.getElementById('entry-shift')?.value;
  const major_task = document.getElementById('entry-task')?.value.trim();
  
  if (!entry_date || !shift || !major_task) {
    toast('⚠️ Date, Shift, and Major Task are required.', true);
    if(btn) btn.disabled = false; 
    if(spinner) spinner.classList.add('hidden');
    return;
  }
  
  const payload = {
    entry_date,
    shift,
    operator_name: currentUserName,
    operator_email: currentUser?.email || null,
    operator_uid: currentUser?.id || null,
    weather: document.getElementById('entry-weather')?.value || null,
    weather_from: document.getElementById('weather-from')?.value || null,
    weather_to: document.getElementById('weather-to')?.value || null,
    major_task,
    remark: document.getElementById('entry-remark')?.value.trim() || null,
    note_for_management: document.getElementById('entry-note')?.value.trim() || null,
    created_at: new Date().toISOString()
  };
  
  try {
    await safeUpsert('operator_daily_logs', payload);
    toast('✅ Shift entry queued/saved!');
    document.getElementById('shift-save-msg')?.classList.remove('hidden');
    setTimeout(() => document.getElementById('shift-save-msg')?.classList.add('hidden'), 3000);
    document.getElementById('daily-form')?.reset();
    document.getElementById('entry-date').value = entry_date;
    document.getElementById('entry-operator').value = currentUserName;
    selectedWeather = '';
    document.querySelectorAll('.weather-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('view-date').value = entry_date;
    loadShiftEntries(entry_date);
  } catch(err) {
    toast('❌ Error: ' + err.message, true);
  } finally {
    if(btn) btn.disabled = false; 
    if(spinner) spinner.classList.add('hidden');
  }
});

// ─── MAINTENANCE LOG ───
let allMaintRecords = [];

document.getElementById('btn-add-maint')?.addEventListener('click', () => {
  document.getElementById('maint-form-wrapper')?.classList.remove('hidden');
  document.getElementById('maint-form-title').textContent = 'New Maintenance Entry';
  document.getElementById('maint-edit-id').value = '';
  document.getElementById('maint-date').value = getNepaliToday();
  ['maint-start-time','maint-end-time','maint-work-done','maint-staff','maint-remarks'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
});

document.getElementById('btn-cancel-maint')?.addEventListener('click', () => {
  document.getElementById('maint-form-wrapper')?.classList.add('hidden');
});

document.getElementById('btn-save-maint')?.addEventListener('click', async () => {
  const work_done = document.getElementById('maint-work-done')?.value.trim();
  const staffSelect = document.getElementById('maint-staff');
  const staff_involved = staffSelect ? Array.from(staffSelect.selectedOptions).map(opt => opt.value).join(', ') : '';  
  const maint_date = document.getElementById('maint-date')?.value;
  
  if (!maint_date || !work_done || !staff_involved) {
    toast('⚠️ Date, Work Done, and Staff are required.', true);
    return;
  }
  
  const payload = {
    maint_date,
    start_time: document.getElementById('maint-start-time')?.value || null,
    end_time: document.getElementById('maint-end-time')?.value || null,
    work_done,
    staff_involved,
    remarks: document.getElementById('maint-remarks')?.value.trim() || null,
    recorded_by: currentUserName,
    recorded_by_email: currentUser?.email || null,
    created_at: new Date().toISOString()
  };
  
  const editId = document.getElementById('maint-edit-id')?.value;
  if (editId) payload.id = editId;
  
  try {
    await safeUpsert('maintenance_logs', payload);
    toast('✅ Maintenance record saved!');
    document.getElementById('maint-form-wrapper')?.classList.add('hidden');
    loadMaintRecords();
  } catch(err) {
    toast('❌ Error: ' + err.message, true);
  }
});

async function loadMaintRecords(filterDate = null) {
  try {
    let query = supabase.from('maintenance_logs').select('*').order('maint_date', { ascending: false }).order('start_time', { ascending: true });
    if (filterDate) query = query.eq('maint_date', filterDate);
    
    const { data, error } = await query.limit(100);
    if (error) throw error;
    allMaintRecords = data || [];
    renderMaintTable(allMaintRecords);
  } catch(e) {
    const body = document.getElementById('maint-table-body');
    if(body) body.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-rose-500 font-bold">Error: ${e.message}</td></tr>`;
  }
}

function renderMaintTable(records) {
  const tbody = document.getElementById('maint-table-body');
  if(!tbody) return;
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-slate-400 italic">No maintenance records found.</td></tr>';
    return;
  }
  tbody.innerHTML = records.map(r => `
    <tr class="hover:bg-slate-50 transition">
      <td class="font-bold text-slate-700">${r.maint_date || '—'}</td>
      <td class="text-slate-600">${r.start_time || ''}${r.end_time ? '–'+r.end_time : ''}</td>
      <td class="text-slate-700">${r.work_done || '—'}</td>
      <td class="text-indigo-700 font-medium">${r.staff_involved || '—'}</td>
      <td class="text-slate-500 text-xs">${r.remarks || '—'}</td>
      <td class="text-center">
        ${userRole === 'admin' ? `<button onclick="window.editMaint('${r.id}')" class="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 mr-1">Edit</button>
        <button onclick="window.deleteMaint('${r.id}')" class="text-[10px] font-bold text-rose-500 hover:text-rose-700">Del</button>` : '<span class="text-slate-400 text-xs">—</span>'}
      </td>
    </tr>
  `).join('');
}

window.editMaint = (id) => {
  const r = allMaintRecords.find(x => x.id == id); if (!r) return;
  document.getElementById('maint-form-wrapper')?.classList.remove('hidden');
  document.getElementById('maint-form-title').textContent = 'Edit Maintenance Entry';
  document.getElementById('maint-edit-id').value = r.id;
  document.getElementById('maint-date').value = r.maint_date || '';
  document.getElementById('maint-start-time').value = r.start_time || '';
  document.getElementById('maint-end-time').value = r.end_time || '';
  document.getElementById('maint-work-done').value = r.work_done || '';
  const staffSelect = document.getElementById('maint-staff');
  const involvedArr = (r.staff_involved || '').split(',').map(s => s.trim());
  if(staffSelect) {
      Array.from(staffSelect.options).forEach(opt => {
          opt.selected = involvedArr.includes(opt.value);
      });
  }
  document.getElementById('maint-remarks').value = r.remarks || '';
  document.getElementById('maint-form-wrapper')?.scrollIntoView({ behavior: 'smooth' });
};

window.deleteMaint = async (id) => {
  if (!navigator.onLine) return toast('❌ Cannot delete while offline', true);
  if (!confirm('Delete this maintenance record?')) return;
  try {
    const { error } = await supabase.from('maintenance_logs').delete().eq('id', id);
    if (error) throw error;
    toast('✅ Deleted');
    loadMaintRecords();
  } catch(e) { toast('❌ ' + e.message, true); }
};

document.getElementById('maint-filter-date')?.addEventListener('change', (e) => loadMaintRecords(e.target.value || null));
document.getElementById('btn-clear-maint-filter')?.addEventListener('click', () => {
  const dt = document.getElementById('maint-filter-date');
  if(dt) dt.value = '';
  loadMaintRecords();
});

// ─── WEATHER LOG ───
async function loadWeatherLog(month) {
  const container = document.getElementById('weather-log-list');
  if(!container) return;
  container.innerHTML = '<div class="col-span-3 text-slate-400 animate-pulse font-bold">Loading…</div>';
  try {
    const startDate = month + '-01';
    const endDate = month + '-31';
    const { data, error } = await supabase
      .from('operator_daily_logs')
      .select('entry_date, shift, operator_name, weather, weather_from, weather_to')
      .gte('entry_date', startDate)
      .lte('entry_date', endDate)
      .not('weather', 'is', null)
      .order('entry_date', { ascending: true })
      .order('shift', { ascending: true });
    
    if (error) throw error;
    if (!data || data.length === 0) {
      container.innerHTML = '<p class="col-span-3 text-slate-400 italic text-center py-4">No weather data for this month.</p>';
      return;
    }
    container.innerHTML = data.map(r => `
      <div class="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 hover:border-sky-200 transition">
        <div class="text-2xl shrink-0">${r.weather.split(' ')[0] || '⛅'}</div>
        <div>
          <div class="text-xs font-black text-slate-700">${r.entry_date} · ${r.shift || '?'} Shift</div>
          <div class="text-sm font-bold text-sky-700">${r.weather}</div>
          ${r.weather_from ? `<div class="text-[10px] text-slate-400">${r.weather_from}–${r.weather_to || '?'}</div>` : ''}
          <div class="text-[10px] text-slate-400 mt-0.5">${r.operator_name || ''}</div>
        </div>
      </div>
    `).join('');
  } catch(e) {
    container.innerHTML = `<p class="col-span-3 text-rose-500 font-bold">Error: ${e.message}</p>`;
  }
}

document.getElementById('btn-load-weather')?.addEventListener('click', () => {
  const m = document.getElementById('weather-filter-month')?.value;
  if (m) loadWeatherLog(m);
});

// ─── COMPLAINTS ───
async function loadMyComplaints() {
  const list = document.getElementById('my-complaints-list');
  if(!list) return;
  if (!currentUser) { list.innerHTML = '<p class="text-slate-400 italic">Please log in to view your complaints.</p>'; return; }
  try {
    let query = supabase.from('operator_complaints').select('*').order('created_at', { ascending: false }).limit(20);
    if (userRole !== 'admin' && userRole !== 'management') query = query.eq('submitted_by_uid', currentUser.id);
    const { data, error } = await query;
    if (error) throw error;
    renderComplaintList(list, data || []);
  } catch(e) { list.innerHTML = `<p class="text-rose-500 font-bold">Error: ${e.message}</p>`; }
}

async function loadAllComplaints() {
  const list = document.getElementById('all-complaints-list');
  if(!list) return;
  try {
    const { data, error } = await supabase
      .from('operator_complaints').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    renderComplaintList(list, data || [], true);
    
    const unread = (data || []).filter(c => c.status === 'New').length;
    const badge = document.getElementById('unread-badge');
    if (badge && unread > 0) { badge.textContent = unread + ' new'; badge.classList.remove('hidden'); }
  } catch(e) { list.innerHTML = `<p class="text-rose-500 font-bold">Error: ${e.message}</p>`; }
}

function renderComplaintList(container, items, isAdmin = false) {
  if (!items.length) { container.innerHTML = '<p class="text-slate-400 italic text-sm py-3">No complaints found.</p>'; return; }
  const statusColors = { New: 'bg-rose-50 text-rose-700 border-rose-200', 'In Progress': 'bg-amber-50 text-amber-700 border-amber-200', Resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200', Closed: 'bg-slate-100 text-slate-500 border-slate-200' };
  container.innerHTML = items.map(c => {
    const sc = statusColors[c.status] || statusColors.New;
    return `<div class="complaint-card relative">
      <div class="flex items-start justify-between gap-2 mb-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs font-black text-amber-800">${c.category || '—'}</span>
          <span class="text-[10px] font-bold border px-2 py-0.5 rounded-full ${sc}">${c.status || 'New'}</span>
          ${c.priority === 'Urgent' ? '<span class="text-[10px] font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">🔴 URGENT</span>' : ''}
          ${c.is_anonymous ? '<span class="text-[10px] text-slate-500 italic">Anonymous</span>' : `<span class="text-[10px] text-slate-500">${c.submitted_by_name || ''}</span>`}
        </div>
        <span class="text-[10px] text-slate-400 shrink-0">${new Date(c.created_at).toLocaleDateString()}</span>
      </div>
      <p class="text-sm text-slate-700 mt-1">${c.description}</p>
      ${isAdmin ? `<div class="flex items-center gap-2 mt-2">
        <select onchange="window.updateComplaintStatus('${c.id}', this.value)" class="text-xs border border-slate-300 rounded p-1 font-bold bg-white outline-none">
          ${['New','In Progress','Resolved','Closed'].map(s => `<option value="${s}" ${c.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        ${c.admin_response ? `<span class="text-xs text-indigo-600 italic">"${c.admin_response}"</span>` : `<input type="text" placeholder="Add response..." onkeydown="if(event.key==='Enter'){window.addComplaintResponse('${c.id}',this.value);}" class="text-xs border border-slate-300 rounded p-1 flex-1 outline-none">`}
      </div>` : ''}
    </div>`;
  }).join('');
}

window.updateComplaintStatus = async (id, status) => {
  if (!navigator.onLine) return toast('❌ Cannot update while offline', true);
  await supabase.from('operator_complaints').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  toast('✅ Status updated');
};

window.addComplaintResponse = async (id, response) => {
  if (!navigator.onLine) return toast('❌ Cannot update while offline', true);
  if (!response) return;
  await supabase.from('operator_complaints').update({ admin_response: response, status: 'In Progress', updated_at: new Date().toISOString() }).eq('id', id);
  toast('✅ Response added');
  loadAllComplaints();
};

document.getElementById('btn-submit-complaint')?.addEventListener('click', async () => {
  const category = document.getElementById('complaint-category')?.value;
  const description = document.getElementById('complaint-desc')?.value.trim();
  const isAnon = document.getElementById('complaint-anonymous')?.checked;
  
  if (!category || !description) { toast('⚠️ Category and Description are required.', true); return; }
  
  const payload = {
    category,
    description,
    priority: document.getElementById('complaint-priority')?.value || 'Normal',
    is_anonymous: isAnon,
    submitted_by_uid: isAnon ? null : (currentUser?.id || null),
    submitted_by_name: isAnon ? null : currentUserName,
    submitted_by_email: isAnon ? null : (currentUser?.email || null),
    status: 'New',
    created_at: new Date().toISOString()
  };
  
  try {
    await safeUpsert('operator_complaints', payload);
    toast('✅ Complaint submitted!');
    document.getElementById('complaint-category').value = '';
    document.getElementById('complaint-desc').value = '';
    document.getElementById('complaint-priority').value = 'Normal';
    document.getElementById('complaint-anonymous').checked = false;
    loadMyComplaints();
  } catch(e) { toast('❌ ' + e.message, true); }
});

// ─── ADMIN NOTICE POST ───
document.getElementById('btn-post-notice')?.addEventListener('click', async () => {
  const message = document.getElementById('admin-notice-content')?.value.trim();
  if (!message) { toast('⚠️ Notice message cannot be empty.', true); return; }
  
  const payload = {
    message,
    active: document.getElementById('admin-notice-active')?.checked,
    expires_at: document.getElementById('admin-notice-expiry')?.value || null,
    posted_by: currentUserName,
    posted_at: new Date().toISOString()
  };
  
  try {
    await safeUpsert('app_settings', {
      setting_key: 'operator_notice',
      setting_value: JSON.stringify(payload),
      updated_at: new Date().toISOString()
    });
    toast('✅ Notice posted!');
    loadAdminNotice();
    loadNoticeHistory();
  } catch(e) { toast('❌ ' + e.message, true); }
});

document.getElementById('btn-clear-notice')?.addEventListener('click', async () => {
  if (!navigator.onLine) return toast('❌ Cannot clear notice while offline', true);
  if (!confirm('Clear the active notice?')) return;
  await supabase.from('app_settings').upsert({
    setting_key: 'operator_notice',
    setting_value: JSON.stringify({ active: false, message: '' }),
    updated_at: new Date().toISOString()
  });
  document.getElementById('admin-notice-bar')?.classList.add('hidden');
  toast('✅ Notice cleared');
});

async function loadNoticeHistory() {
  const el = document.getElementById('notice-history');
  if(!el) return;
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('setting_value, updated_at')
      .eq('setting_key', 'operator_notice')
      .maybeSingle();
    
    if (data && data.setting_value) {
      const n = typeof data.setting_value === 'string' ? JSON.parse(data.setting_value) : data.setting_value;
      el.innerHTML = `<div class="notice-card">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-black text-indigo-700 uppercase tracking-wider">Latest Notice</span>
          <span class="text-[10px] text-indigo-400">${new Date(data.updated_at).toLocaleString()}</span>
        </div>
        <p class="text-sm text-slate-800 font-medium">${n.message || 'No message'}</p>
        <div class="flex gap-2 mt-2">
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${n.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}">${n.active ? 'Active' : 'Inactive'}</span>
          ${n.expires_at ? `<span class="text-[10px] text-slate-500">Expires: ${new Date(n.expires_at).toLocaleString()}</span>` : ''}
        </div>
      </div>`;
    } else {
      el.innerHTML = '<p class="text-slate-400 italic text-sm">No notice history.</p>';
    }
  } catch(e) { el.innerHTML = `<p class="text-rose-500 text-sm">Error: ${e.message}</p>`; }
}

async function loadStaffOptions() {
    try {
        const { data } = await supabase.from('user_roles').select('full_name, email').order('full_name');
        if (data) {
            const select = document.getElementById('maint-staff');
            if(select) {
                select.innerHTML = data.map(u => 
                    `<option value="${u.full_name || u.email}">${u.full_name || u.email}</option>`
                ).join('');
            }
        }
    } catch (e) { console.error('Failed to load staff', e); }
}

// ─── PAGE START ───
async function startPage() {
  const today = getNepaliToday();
  if(document.getElementById('entry-date')) document.getElementById('entry-date').value = today;
  if(document.getElementById('view-date')) document.getElementById('view-date').value = today;
  
  const m = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
  if(document.getElementById('weather-filter-month')) document.getElementById('weather-filter-month').value = `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}`;

  const sessionData = await initializeApplication(true);
  if (sessionData) {
    currentUser = sessionData.user;
    userRole = sessionData.role;
    
    try {
      const { data: roleData } = await supabase.from('user_roles').select('full_name').eq('email', sessionData.user.email).maybeSingle();
      currentUserName = (roleData && roleData.full_name) ? roleData.full_name : sessionData.user.email.split('@')[0];
    } catch(e) { currentUserName = sessionData.user.email.split('@')[0]; }
    
    const badge = document.getElementById('od-user-badge');
    if(badge) badge.textContent = currentUserName + ' · ' + userRole.toUpperCase();
    const opInput = document.getElementById('entry-operator');
    if(opInput) opInput.value = currentUserName;

    if (userRole === 'admin' || userRole === 'management') {
      document.getElementById('all-complaints-panel')?.classList.remove('hidden');
      document.querySelector('.admin-notice-tab')?.classList.remove('hidden');
      loadAllComplaints();
      loadNoticeHistory();
    }
  }
  
  loadAdminNotice();
  loadShiftEntries(today);
  loadMaintRecords();
  loadMyComplaints();
  loadStaffOptions();
  
  if (window.location.hash) {
    const targetBtn = document.querySelector(`.tab-btn[data-tab="${window.location.hash.replace('#', '')}"]`);
    if (targetBtn) targetBtn.click();
  }
}

startPage();
