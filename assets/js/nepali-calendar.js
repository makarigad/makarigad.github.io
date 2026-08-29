import { supabase, initializeApplication } from './core-app.js';

const M=[
    {n:'Baisakh', em:3, yo:-57, acc:'a-spring',  sl:'Pre-Monsoon'},
    {n:'Jestha',  em:4, yo:-57, acc:'a-spring',  sl:'Pre-Monsoon'},
    {n:'Ashadh',  em:5, yo:-57, acc:'a-monsoon', sl:'Monsoon'},
    {n:'Shrawan', em:6, yo:-57, acc:'a-monsoon', sl:'Monsoon'},
    {n:'Bhadra',  em:7, yo:-57, acc:'a-monsoon', sl:'Monsoon'},
    {n:'Ashoj',   em:8, yo:-57, acc:'a-autumn',  sl:'Autumn'},
    {n:'Kartik',  em:9, yo:-57, acc:'a-autumn',  sl:'Autumn'},
    {n:'Mangsir', em:10,yo:-57, acc:'a-autumn',  sl:'Autumn'},
    {n:'Poush',   em:11,yo:-57, acc:'a-winter',  sl:'Winter — year ends'},
    {n:'Magh',    em:0, yo:-56, acc:'a-winter',  sl:'Winter — new Eng year'},
    {n:'Falgun',  em:1, yo:-56, acc:'a-winter',  sl:'Winter'},
    {n:'Chaitra', em:2, yo:-56, acc:'a-winter',  sl:'Winter'},
];
const NP=['१','२','३','४','५','६','७','८','९','१०','११','१२'];
const EN_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let currentUser=null, userRole='normal', NY=2082;
let days=new Array(12).fill(null);
let sts=new Array(12).fill('DRAFT');
let editMode=false;

function mkDate(idx,day,ny){const m=M[idx];return new Date(Date.UTC(ny+m.yo,m.em,day));}
function startOf(idx){return days[idx]!=null?mkDate(idx,days[idx],NY):null;}
function endOf(idx){
    let ns;
    if(idx<11){
        if(days[idx+1]==null)return null;
        ns=mkDate(idx+1,days[idx+1],NY);
    } else {
        if(days[0]==null)return null;
        ns=new Date(Date.UTC((NY+1)+M[0].yo, M[0].em, days[0]));
    }
    return new Date(ns.getTime()-86400000);
}
function toDays(idx){const s=startOf(idx),e=endOf(idx);if(!s||!e)return null;return Math.round((e-s)/86400000)+1;}
function toISO(d){return d.toISOString().split('T')[0];}
function fmt(d){if(!d)return'—';return`${d.getUTCDate()} ${EN_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;}

function notify(msg,isErr=false){
    const m=document.getElementById('notification-modal');
    document.getElementById('notification-message').textContent=msg;
    m.style.borderLeftColor=isErr?'#dc2626':'#10b981';
    m.classList.replace('opacity-0','opacity-100');m.classList.replace('-translate-y-2','translate-y-0');
    setTimeout(()=>{m.classList.replace('opacity-100','opacity-0');m.classList.replace('translate-y-0','-translate-y-2');},3500);
}

async function init(){
    const sd=await initializeApplication(true);
    if(!sd)return window.location.href='index.html';
    currentUser=sd.user;userRole=sd.role;
    if(userRole!=='admin'){alert('Only Administrators can modify the Calendar Matrix.');return window.location.href='plant-data.html';}
    const ys=document.getElementById('year-select');
    const cy=new Date().getFullYear()+57;
    for(let y=2079;y<=cy+5;y++)ys.add(new Option(y,y));
    ys.value=cy;NY=cy;
    document.getElementById('edit-all-btn').addEventListener('click',enableEditAll);
    document.getElementById('approve-all-btn').addEventListener('click',saveAll);
    document.getElementById('cancel-all-btn').addEventListener('click',cancelAll);
    document.getElementById('load-year-btn').addEventListener('click',loadYear);
}

function updateStats(){
    const v=sts.filter(s=>s==='VERIFIED').length;
    let total=0,cov=0;
    for(let i=0;i<12;i++){const d=toDays(i);if(d&&d>0){total+=d;cov++;}}
    document.getElementById('stat-verified').textContent=v;
    document.getElementById('stat-draft').textContent=12-v;
    document.getElementById('stat-days').textContent=total||'—';
    const pct=Math.round((cov/12)*100);
    document.getElementById('stat-pct').textContent=pct+'%';
    document.getElementById('progress-fill').style.width=pct+'%';
    document.getElementById('progress-fill').style.background=pct===100?'#16a34a':pct>=50?'#d97706':'#4f46e5';
}

function renderGrid(){
    const grid=document.getElementById('month-grid');
    const empty=document.getElementById('empty-state');
    const wrap=document.getElementById('month-grid-wrap');
    grid.innerHTML='';
    const hasData=days.some(d=>d!=null);
    if(!hasData){empty.style.display='block';wrap.style.display='none';updateStats();return;}
    empty.style.display='none';wrap.style.display='block';
    document.getElementById('edit-all-btn').disabled=false;

    M.forEach((m,i)=>{
        const verified=sts[i]==='VERIFIED'&&!editMode;
        const d=days[i];
        const startD=startOf(i);
        const endD=endOf(i);
        const td=toDays(i);
        const engY=NY+m.yo;
        const engMLabel=EN_MONTHS[m.em];
        
        let db;
        if(td==null)db='<span style="background:#f1f5f9;color:#94a3b8;border-radius:99px;padding:.15rem .5rem;font-size:.72rem;font-weight:900;display:inline-block">—</span>';
        else if(td>=28&&td<=32)db=`<span style="background:#dcfce7;color:#15803d;border-radius:99px;padding:.15rem .5rem;font-size:.72rem;font-weight:900;display:inline-block">${td}d</span>`;
        else db=`<span style="background:#fef9c3;color:#854d0e;border-radius:99px;padding:.15rem .5rem;font-size:.72rem;font-weight:900;display:inline-block">${td}d</span>`;
        
        const yrBadge=i===9?`<div class="yr-break"><svg style="width:10px;height:10px" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>English year → ${engY}</div>`:'';
        const dotStyle=verified?'background:#16a34a;box-shadow:0 0 0 3px #dcfce7':editMode?'background:#f59e0b;box-shadow:0 0 0 3px #fef3c7':'background:#94a3b8;box-shadow:0 0 0 3px #f1f5f9';

        const card=document.createElement('div');
        card.className=`mc${editMode?' editing':''}${verified?' verified':''}`;
        card.innerHTML=`
<div class="mc-acc ${m.acc}"></div>
<div style="padding:.85rem .9rem">
  ${yrBadge}
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.65rem">
    <div>
      <div style="display:flex;align-items:center;gap:.35rem;margin-bottom:.12rem">
        <span style="font-size:1.05rem;font-weight:900;color:#1e293b">${m.n}</span>
        <span style="font-size:.85rem;font-weight:700;color:#cbd5e1">${NP[i]}</span>
      </div>
      <div style="font-size:.62rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em">${m.sl}</div>
      <div style="font-size:.68rem;font-weight:700;color:#6366f1;margin-top:.12rem">${engMLabel} ${engY}</div>
    </div>
    <div style="display:flex;align-items:center;gap:.35rem">${db}<span style="width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0;${dotStyle}"></span></div>
  </div>

  ${editMode?`
  <div style="background:#f5f3ff;border-radius:.5rem;padding:.7rem;border:1px solid #c7d2fe">
    <div style="font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#6366f1;margin-bottom:.5rem">
      Start day in ${engMLabel} ${engY} &nbsp;(12–18)
    </div>
    <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
      <input type="number" id="di-${i}" class="day-inp${d?' ok':''}" min="12" max="18" value="${d||''}" placeholder="??" tabindex="${i+1}" autocomplete="off">
      <div>
        <div style="font-size:.85rem;font-weight:700;color:#1e293b">
          ${engMLabel} <span id="dp-${i}" style="color:#4f46e5;font-weight:900">${d||'?'}</span>,&nbsp;${engY}
        </div>
        <div id="end-preview-${i}" style="font-size:.65rem;color:#94a3b8;margin-top:.1rem">${endD?'Ends: '+fmt(endD):''}</div>
        ${i===0?'<div style="font-size:.62rem;color:#818cf8;font-weight:600;margin-top:.1rem">Baisakh — anchor of the year</div>':`<div style="font-size:.62rem;color:#94a3b8;font-weight:500;margin-top:.1rem">Tab → next month</div>`}
      </div>
    </div>
  </div>
  `:`
  <div style="display:flex;gap:.75rem;margin-top:.35rem">
    <div style="flex:1"><div style="font-size:.6rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.2rem">Start</div><div style="font-size:.8rem;font-weight:700;color:#334155">${fmt(startD)}</div></div>
    <div style="flex:1"><div style="font-size:.6rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.2rem">End</div><div style="font-size:.8rem;font-weight:700;color:#334155">${fmt(endD)}</div></div>
  </div>
  <div style="margin-top:.55rem;padding-top:.5rem;border-top:1px solid #f1f5f9;display:flex;align-items:center;gap:.35rem">
    ${verified?'<span style="font-size:.62rem;font-weight:900;color:#16a34a;text-transform:uppercase;letter-spacing:.05em">✓ Verified in DB</span>':'<span style="font-size:.62rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em">Draft — not saved</span>'}
  </div>
  `}
</div>`;
        grid.appendChild(card);
    });

    if(editMode){
        M.forEach((_,i)=>{
            const inp=document.getElementById(`di-${i}`);
            if(!inp)return;
            inp.addEventListener('input',()=>{
                const v=parseInt(inp.value);
                const dp=document.getElementById(`dp-${i}`);
                if(v>=12&&v<=18){
                    inp.classList.remove('err');inp.classList.add('ok');
                    days[i]=v;
                    if(dp)dp.textContent=v;
                    const ep=document.getElementById(`end-preview-${i}`);
                    const eD=endOf(i);
                    if(ep)ep.textContent=eD?'Ends: '+fmt(eD):'';
                    if(i<11){
                        const nep=document.getElementById(`end-preview-${i+1}`);
                        const neD=endOf(i+1);
                        if(nep&&neD)nep.textContent='Ends: '+fmt(neD);
                    }
                    updateStats();
                } else if(inp.value!==''){
                    inp.classList.add('err');inp.classList.add('shake');
                    setTimeout(()=>inp.classList.remove('shake'),400);
                    inp.classList.remove('ok');
                    days[i]=null;
                    if(dp)dp.textContent='?';
                    updateStats();
                }
            });
            inp.addEventListener('keydown',(e)=>{
                if(e.key==='Enter'||(e.key==='Tab'&&!e.shiftKey)){
                    e.preventDefault();
                    const nxt=document.getElementById(`di-${Math.min(i+1,11)}`);
                    if(nxt)nxt.focus();
                }
            });
        });
    }
    updateStats();
}

function enableEditAll(){
    editMode=true;sts=sts.map(()=>'EDIT');
    renderGrid();
    document.getElementById('edit-all-btn').classList.add('hidden');
    document.getElementById('approve-all-btn').classList.remove('hidden');
    document.getElementById('cancel-all-btn').classList.remove('hidden');
    setTimeout(()=>document.getElementById('di-0')?.focus(),80);
}
function cancelAll(){
    editMode=false;
    sts=sts.map((_,i)=>(days[i]!=null&&endOf(i))?'VERIFIED':'DRAFT');
    renderGrid();
    document.getElementById('edit-all-btn').classList.remove('hidden');
    document.getElementById('approve-all-btn').classList.add('hidden');
    document.getElementById('cancel-all-btn').classList.add('hidden');
}

async function saveAll(){
    const bad=[];
    for(let i=0;i<12;i++){
        if(days[i]==null||days[i]<12||days[i]>18){bad.push(M[i].n);continue;}
        const td=toDays(i);if(td==null||td<28)bad.push(M[i].n+' (invalid range)');
    }
    if(bad.length>0)return notify('Fix: '+bad.join(', '),true);

    const ov=document.getElementById('save-overlay');
    const msg=document.getElementById('save-overlay-msg');
    const fill=document.getElementById('save-progress-fill');
    const txt=document.getElementById('save-progress-text');
    ov.classList.add('show');

    for(let i=0;i<12;i++){
        msg.textContent=`Saving ${M[i].n} (${i+1}/12)…`;
        fill.style.width=Math.round((i/12)*100)+'%';
        txt.textContent=`${i} / 12 months`;
        await saveMonth(i,true);
    }
    fill.style.width='100%';fill.style.background='#16a34a';
    txt.textContent='12 / 12 months ✅';msg.textContent='All saved!';
    setTimeout(()=>{
        ov.classList.remove('show');
        editMode=false;
        document.getElementById('auto-draft-warning').classList.add('hidden');
        document.getElementById('approve-all-btn').classList.add('hidden');
        document.getElementById('cancel-all-btn').classList.add('hidden');
        document.getElementById('edit-all-btn').classList.remove('hidden');
        sts.fill('VERIFIED');renderGrid();
        notify(`✅ All 12 months of ${NY} saved to database!`);
    },1100);
}

async function saveMonth(idx,silent=false){
    const sD=startOf(idx),eD=endOf(idx);
    if(!sD||!eD){if(!silent)notify('Missing dates for '+M[idx].n,true);return;}
    const td=Math.round((eD-sD)/86400000)+1;
    if(td<28){if(!silent)notify('Invalid range for '+M[idx].n,true);return;}
    const cp=[],pp=[];let nd=1;
    for(let d=new Date(sD.getTime());d<=eD;d.setUTCDate(d.getUTCDate()+1)){
        const eng=toISO(d);
        const nep=`${NY}.${String(idx+1).padStart(2,'0')}.${String(nd).padStart(2,'0')}`;
        cp.push({eng_date:eng,nep_year:NY,nep_month:M[idx].n,nep_day:nd,nep_date_str:nep,status:'VERIFIED',updated_by:currentUser.email});
        pp.push({id:eng,nepali_date:nep,operator_email:currentUser.email,operator_uid:currentUser.id});
        nd++;
    }
    const{error:e1}=await supabase.from('calendar_mappings').upsert(cp,{onConflict:'eng_date'});
    if(e1){if(!silent)notify('DB Error: '+e1.message,true);else throw e1;}
    await supabase.from('plant_data').upsert(pp,{onConflict:'id'});
    sts[idx]='VERIFIED';
    if(!silent){renderGrid();notify(`✅ ${M[idx].n} ${NY} — ${nd-1} days saved.`);}
}

async function loadYear(){
    NY=parseInt(document.getElementById('year-select').value);
    const btn=document.getElementById('load-year-btn');
    btn.textContent='Loading…';btn.disabled=true;
    document.getElementById('approve-all-btn').classList.add('hidden');
    document.getElementById('cancel-all-btn').classList.add('hidden');
    document.getElementById('auto-draft-warning').classList.add('hidden');
    editMode=false;days.fill(null);sts.fill('DRAFT');

    try{
        const{data:cal}=await supabase.from('calendar_mappings').select('*').eq('nep_year',NY).order('eng_date',{ascending:true});
        if(cal&&cal.length>=360){
            extractFromCal(cal,false);notify(`Loaded ${cal.length} verified dates for ${NY}.`);
            return resetBtn(btn);
        }
        const{data:leg}=await supabase.from('plant_data').select('id,nepali_date').ilike('nepali_date',`${NY}.%`).order('id',{ascending:true});
        if(leg&&leg.length>=360){
            extractFromLegacy(leg);notify('Recovered dates from Plant Data logs.');
            return resetBtn(btn);
        }
        notify(`No data — extrapolating from ${NY-1}…`,true);
        const{data:prev}=await supabase.from('calendar_mappings').select('*').eq('nep_year',NY-1).order('eng_date',{ascending:true});
        if(prev&&prev.length>=360){
            extractFromCal(prev,true);
            document.getElementById('auto-draft-warning').classList.remove('hidden');
            document.getElementById('approve-all-btn').classList.remove('hidden');
        } else if(NY===2079){
            days=[14,15,15,16,17,17,17,16,16,15,13,14];
            sts.fill('DRAFT');
            document.getElementById('auto-draft-warning').classList.remove('hidden');
            document.getElementById('approve-all-btn').classList.remove('hidden');
            renderGrid();
        } else {
            notify(`No data for ${NY-1}. Load that year first.`,true);
            days.fill(null);sts.fill('DRAFT');renderGrid();
        }
    }catch(err){notify('Error: '+err.message,true);}
    resetBtn(btn);
}

function resetBtn(btn){
    btn.innerHTML=`<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg> Load Year`;
    btn.disabled=false;
    renderGrid();
}

function extractFromCal(data,addYear=false){
    const mm={};for(let i=0;i<12;i++)mm[i]=[];
    data.forEach(r=>{
        const mi=M.findIndex(m=>m.n===r.nep_month);
        if(mi>=0)mm[mi].push(r.eng_date);
    });
    for(let i=0;i<12;i++){
        if(mm[i].length>0){
            let ds=mm[i].sort()[0];
            if(addYear){const p=ds.split('-');p[0]=String(parseInt(p[0])+1);ds=p.join('-');}
            days[i]=parseInt(ds.split('-')[2]);
            sts[i]=addYear?'DRAFT':'VERIFIED';
        } else {days[i]=null;sts[i]='DRAFT';}
    }
}
function extractFromLegacy(data){
    const mm={};for(let i=0;i<12;i++)mm[i]=[];
    data.forEach(r=>{
        if(r.nepali_date){const p=r.nepali_date.split('.');if(p.length===3){const mi=parseInt(p[1])-1;if(mi>=0&&mi<12)mm[mi].push(r.id);}}
    });
    for(let i=0;i<12;i++){
        if(mm[i].length>0){days[i]=parseInt(mm[i].sort()[0].split('-')[2]);sts[i]='DRAFT';}
        else{days[i]=null;sts[i]='DRAFT';}
    }
}

init();