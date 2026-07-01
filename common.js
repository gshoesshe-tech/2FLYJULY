(() => {
  'use strict';
  const cfg = window.__2FLY_CONFIG__ || {};
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money = (v) => '₱' + Number(v || 0).toLocaleString('en-PH',{minimumFractionDigits:0,maximumFractionDigits:2});
  const num = (v) => Number(v || 0);
  const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const monthKey = () => today().slice(0,7);
  const normalizeCategoryLabel = (v) => String(v||'').trim().toUpperCase().replace(/\s+/g,' ');
  let toastTimer;

  const state = {
    supa:null, session:null, profile:null, role:'none',
    products:[], productByCode:new Map(), categories:[], categoryById:new Map(), aliasToCategory:new Map(),
    accounts:[], settings:null
  };

  function toast(message,error=false){
    let el=$('toast');
    if(!el){ el=document.createElement('div'); el.id='toast'; el.className='toast'; document.body.appendChild(el); }
    el.textContent=message; el.classList.toggle('error',error); el.classList.add('show');
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2200);
  }
  function fail(error,prefix=''){
    const msg=error?.message||String(error||'Unknown error');
    console.error(prefix,msg,error); toast((prefix?prefix+': ':'')+msg,true);
  }
  function setLoading(button,loading,label){
    if(!button) return;
    if(loading){ button.dataset.old=button.textContent; button.disabled=true; button.textContent=label||'Saving…'; }
    else { button.disabled=false; button.textContent=button.dataset.old||button.textContent; }
  }
  function parseLinesMap(text){
    const out={};
    String(text||'').split(/\r?\n/).forEach(line=>{
      const m=line.trim().match(/^([A-Za-z0-9-]+)\s*[:=,\-]?\s+(\d+)$/);
      if(m) out[m[1].toUpperCase()]=Number(m[2]);
    });
    return out;
  }
  async function sha256(text){
    const bytes=new TextEncoder().encode(text);
    const hash=await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  function isManagement(){ return ['owner','admin'].includes(state.role); }
  function isOwner(){ return state.role==='owner'; }
  function statusPill(v){
    const s=String(v||'');
    const cls=['paid','ready_to_pack','delivered','verified','completed'].includes(s)?'ok':['waiting_stock','partial','payment_review','packing','shipped','incoming','partially_received'].includes(s)?'warn':['cancelled','refunded','unpaid','voided','rejected'].includes(s)?'danger':'';
    return `<span class="pill ${cls}">${esc(s.replaceAll('_',' '))}</span>`;
  }
  function monthEndExclusive(m){
    const y=Number(m.slice(0,4)), mo=Number(m.slice(5,7));
    return new Date(y,mo,1).toISOString().slice(0,10);
  }
  function accountOptions(includeBlank=true){
    return (includeBlank?'<option value="">No cash movement / select later</option>':'')+state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');
  }
  function categoryOptions(){ return state.categories.map(c=>`<option value="${esc(c.code)}">${esc(c.name)}</option>`).join(''); }

  async function loadBaseData(){
    const [{data:cats,error:ce},{data:aliases,error:ae},{data:products,error:pe},{data:accounts,error:acce},{data:settings,error:se}]=await Promise.all([
      state.supa.from('inventory_categories').select('*').eq('active',true).order('name'),
      state.supa.from('category_aliases').select('*'),
      state.supa.from('products').select('*,inventory_categories(code,name)').eq('active',true).order('code'),
      state.supa.from('cash_accounts').select('*').eq('active',true).order('name'),
      state.supa.from('business_settings').select('*').eq('singleton',true).single()
    ]);
    if(ce||ae||pe||se) throw ce||ae||pe||se;
    if(acce && isManagement()) throw acce;
    state.categories=cats||[]; state.products=products||[]; state.accounts=accounts||[]; state.settings=settings;
    state.categoryById=new Map(state.categories.map(c=>[c.id,c]));
    state.productByCode=new Map(state.products.map(p=>[p.code.toUpperCase(),p]));
    state.aliasToCategory=new Map();
    (aliases||[]).forEach(a=>state.aliasToCategory.set(normalizeCategoryLabel(a.alias),state.categoryById.get(a.category_id)));
    state.categories.forEach(c=>state.aliasToCategory.set(normalizeCategoryLabel(c.name),c));
  }

  function applyRoleVisibility(){
    $$('.management-only').forEach(el=>el.classList.toggle('hidden',!isManagement()));
    $$('.owner-only').forEach(el=>el.classList.toggle('hidden',!isOwner()));
  }
  function enforcePageAccess(){
    const required=document.body.dataset.requiredRole||'team';
    if(required==='management'&&!isManagement()){ location.replace('./dashboard.html'); return false; }
    if(required==='owner'&&!isOwner()){ location.replace('./dashboard.html'); return false; }
    return true;
  }
  function initShell(){
    if($('userEmail')) $('userEmail').textContent=state.profile.email||state.session.user.email||'—';
    if($('userRole')) $('userRole').textContent=String(state.role).toUpperCase();
    const active=document.body.dataset.page;
    $$('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===active));
    if($('logoutBtn')) $('logoutBtn').addEventListener('click',async()=>{ await state.supa.auth.signOut(); location.replace('./index.html'); });
    if($('refreshBtn')) $('refreshBtn').addEventListener('click',()=>window.dispatchEvent(new CustomEvent('twofly:refresh')));
    applyRoleVisibility();
  }

  async function init(){
    if(!window.supabase||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||cfg.SUPABASE_URL.includes('YOUR_PROJECT')){
      document.body.innerHTML='<main class="auth-shell"><section class="auth-card"><h2>Configuration required</h2><p class="notice danger">Open config.js and add the URL and anon key from the NEW Supabase project.</p></section></main>';
      throw new Error('Missing Supabase configuration');
    }
    state.supa=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data:{session},error}=await state.supa.auth.getSession();
    if(error) throw error;
    if(!session){ location.replace('./index.html'); return state; }
    state.session=session;
    const {data:profile,error:pe}=await state.supa.from('profiles').select('*').eq('user_id',session.user.id).single();
    if(pe) throw pe;
    if(!profile.active) throw new Error('This team account is inactive.');
    state.profile=profile; state.role=profile.role;
    if(!enforcePageAccess()) return state;
    await loadBaseData();
    initShell();
    return state;
  }

  window.TwoFly={
    state,$,$$,esc,money,num,today,monthKey,monthEndExclusive,normalizeCategoryLabel,parseLinesMap,sha256,
    toast,fail,setLoading,isManagement,isOwner,statusPill,accountOptions,categoryOptions,
    ready:init()
  };
})();
