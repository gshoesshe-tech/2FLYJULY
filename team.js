(() => {
  'use strict';
  const TF=window.TwoFly;
  let plans=[],payments=[];
  const fmt=v=>TF.money(TF.num(v));
  const date=v=>v?String(v).slice(0,10):'—';

  function parseDate(value){
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) throw new Error('Invalid date');
    return {y:Number(m[1]),m:Number(m[2]),d:Number(m[3])};
  }
  function ymd(y,m,d){return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
  function addDays(value,days){
    const x=parseDate(value);
    return new Date(Date.UTC(x.y,x.m-1,x.d+days)).toISOString().slice(0,10);
  }
  function daysInMonth(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate();}
  function isoWeekday(value){
    const x=parseDate(value);
    const day=new Date(Date.UTC(x.y,x.m-1,x.d)).getUTCDay();
    return day===0?7:day;
  }
  function monthBoundsFor(value=TF.today()){
    const x=parseDate(value);
    return {start:ymd(x.y,x.m,1),end:ymd(x.y,x.m,daysInMonth(x.y,x.m))};
  }
  function semiBoundsFor(value=TF.today()){
    const x=parseDate(value);
    return x.d<=15
      ? {start:ymd(x.y,x.m,1),end:ymd(x.y,x.m,15)}
      : {start:ymd(x.y,x.m,16),end:ymd(x.y,x.m,daysInMonth(x.y,x.m))};
  }
  function weekBoundsFor(value=TF.today(),priorOnMonday=false){
    let base=value;
    if(priorOnMonday&&isoWeekday(base)===1) base=addDays(base,-1);
    const start=addDays(base,-(isoWeekday(base)-1));
    return {start,end:addDays(start,6)};
  }
  function periodForPlan(p,value=TF.today()){
    if(p.frequency==='weekly') return weekBoundsFor(value,p.due_rule==='sunday_or_monday');
    if(p.frequency==='semi_monthly') return semiBoundsFor(value);
    return monthBoundsFor(value);
  }
  function periodFromStart(p,start){
    const x=parseDate(start);
    if(p.frequency==='monthly') return monthBoundsFor(start);
    if(p.frequency==='semi_monthly'){
      if(x.d!==1&&x.d!==16) throw new Error('Semi-monthly periods must start on the 1st or 16th.');
      return x.d===1
        ? {start:ymd(x.y,x.m,1),end:ymd(x.y,x.m,15)}
        : {start:ymd(x.y,x.m,16),end:ymd(x.y,x.m,daysInMonth(x.y,x.m))};
    }
    if(isoWeekday(start)!==1) throw new Error('Weekly periods must start on a Monday.');
    return {start,end:addDays(start,6)};
  }

  async function load(){
    try{
      const [a,b]=await Promise.all([
        TF.state.supa.from('v_staff_compensation_v13').select('*').order('name'),
        TF.state.supa.from('staff_payments_v13').select('*,staff_compensation_plans_v13(plan_name,pay_type,amount,staff_members_v13(name,role_title)),cash_accounts(name)').order('payment_date',{ascending:false})
      ]);
      if(a.error||b.error) throw a.error||b.error;
      plans=a.data||[];
      payments=b.data||[];
      render();
      fillPlans();
    }catch(e){TF.fail(e,'Team & Payroll failed');}
  }
  function periodPaid(p,bounds){
    return payments
      .filter(x=>x.compensation_plan_id===p.compensation_plan_id&&date(x.period_start)===bounds.start&&date(x.period_end)===bounds.end)
      .reduce((a,x)=>a+TF.num(x.amount),0);
  }
  function dueLabel(p,bounds){
    if(p.frequency==='monthly') return `Due ${bounds.end}`;
    if(p.frequency==='semi_monthly'){
      const startDay=Number(bounds.start.slice(8,10));
      if(startDay===1) return `Due ${bounds.end}`;
      const x=parseDate(bounds.end);
      return `Due ${ymd(x.y,x.m,Math.min(30,daysInMonth(x.y,x.m)))}`;
    }
    return p.due_rule==='sunday_or_monday'
      ? `Pay Sunday or Monday · period ends ${bounds.end}`
      : `Weekly · period ends ${bounds.end}`;
  }
  function render(){
    const current=TF.today().slice(0,7);
    const staff=new Set(plans.map(x=>x.staff_member_id));
    const monthly=plans.filter(x=>x.pay_type==='salary').reduce((sum,x)=>sum+(x.frequency==='monthly'?TF.num(x.amount):x.frequency==='semi_monthly'?TF.num(x.amount)*2:0),0);
    const weekly=plans.filter(x=>x.frequency==='weekly').reduce((sum,x)=>sum+TF.num(x.amount),0);
    const paidMonth=payments.filter(x=>String(x.payment_date).startsWith(current)).reduce((sum,x)=>sum+TF.num(x.amount),0);
    TF.$('kpiStaff').textContent=staff.size;
    TF.$('kpiMonthly').textContent=fmt(monthly);
    TF.$('kpiWeekly').textContent=fmt(weekly);
    TF.$('kpiPaidMonth').textContent=fmt(paidMonth);

    const groups=[...staff].map(id=>plans.filter(x=>x.staff_member_id===id));
    TF.$('staffCards').innerHTML=groups.map(g=>{
      const x=g[0];
      return `<article class="card ops-staff-card"><div class="card-body"><div class="ops-staff-head"><div><h3>${TF.esc(x.name)}</h3><p>${TF.esc(x.role_title)}</p></div><span class="pill ok">Active</span></div><p class="muted">${TF.esc(x.responsibilities)}</p><div class="ops-plan-list">${g.map(p=>{
        const bounds=periodForPlan(p),paid=periodPaid(p,bounds),remaining=Math.max(TF.num(p.amount)-paid,0);
        return `<div><span>${TF.esc(p.plan_name)}</span><strong>${fmt(p.amount)} · ${TF.esc(p.frequency.replace('_',' '))}</strong><small>${TF.esc(dueLabel(p,bounds))}</small><small>${remaining<=.01?'Current period: paid':`Current period remaining: ${fmt(remaining)}`}</small></div>`;
      }).join('')}</div></div></article>`;
    }).join('');

    TF.$('payrollTable').innerHTML=`<table><thead><tr><th>Paid</th><th>Employee / plan</th><th>Pay period</th><th>Amount</th><th>Account</th><th>Reference / notes</th></tr></thead><tbody>${payments.map(p=>{
      const plan=p.staff_compensation_plans_v13;
      return `<tr><td>${date(p.payment_date)}</td><td><strong>${TF.esc(plan?.staff_members_v13?.name||'')}</strong><br><small>${TF.esc(plan?.plan_name||'')}</small></td><td>${date(p.period_start)} to ${date(p.period_end)}</td><td><strong>${fmt(p.amount)}</strong></td><td>${TF.esc(p.cash_accounts?.name||'')}</td><td>${TF.esc(p.reference_number||p.notes||'')}</td></tr>`;
    }).join('')||'<tr><td colspan="6" class="empty">No payroll payments yet.</td></tr>'}</tbody></table>`;
  }
  function fillPlans(){
    const current=TF.$('payrollPlan').value;
    TF.$('payrollPlan').innerHTML='<option value="">Select employee and plan</option>'+plans.map(p=>`<option value="${p.compensation_plan_id}">${TF.esc(p.name)} — ${TF.esc(p.plan_name)} — ${fmt(p.amount)}</option>`).join('');
    if(current&&plans.some(p=>p.compensation_plan_id===current)) TF.$('payrollPlan').value=current;
  }
  function selectedPlan(){return plans.find(x=>x.compensation_plan_id===TF.$('payrollPlan').value);}
  function updatePeriod(){
    const p=selectedPlan();
    if(!p){TF.$('payrollSummary').textContent='Select a plan.';return;}
    const bounds=periodForPlan(p);
    TF.$('payrollStart').value=bounds.start;
    TF.$('payrollEnd').value=bounds.end;
    TF.$('payrollAmount').value=TF.num(p.amount).toFixed(2);
    TF.$('payrollSummary').textContent=`${p.name} · ${p.plan_name} · ${fmt(p.amount)} · ${String(p.due_rule).replaceAll('_',' ')}. The database only accepts the exact canonical period.`;
  }
  function syncEndFromStart(){
    const p=selectedPlan();
    if(!p||!TF.$('payrollStart').value) return;
    try{
      const bounds=periodFromStart(p,TF.$('payrollStart').value);
      TF.$('payrollStart').value=bounds.start;
      TF.$('payrollEnd').value=bounds.end;
    }catch(e){
      TF.toast(e.message,true);
      updatePeriod();
    }
  }
  async function save(e){
    e.preventDefault();
    const b=e.submitter;
    TF.setLoading(b,true);
    try{
      const r=await TF.state.supa.rpc('record_staff_payment_v13',{
        p_compensation_plan_id:TF.$('payrollPlan').value,
        p_period_start:TF.$('payrollStart').value,
        p_period_end:TF.$('payrollEnd').value,
        p_payment_date:TF.$('payrollDate').value,
        p_amount:TF.num(TF.$('payrollAmount').value),
        p_cash_account_id:TF.$('payrollAccount').value,
        p_reference_number:TF.$('payrollReference').value.trim(),
        p_notes:TF.$('payrollNotes').value.trim()
      });
      if(r.error) throw r.error;
      TF.toast('Staff payment recorded');
      e.target.reset();
      init();
      await load();
    }catch(err){TF.fail(err,'Payroll payment failed');}
    finally{TF.setLoading(b,false);}
  }
  function init(){
    TF.$('payrollDate').value=TF.today();
    TF.$('payrollAccount').innerHTML=TF.accountOptions(false);
    const m=monthBoundsFor();
    TF.$('payrollStart').value=m.start;
    TF.$('payrollEnd').value=m.end;
  }
  TF.ready.then(()=>{
    init();
    TF.$('payrollPlan').addEventListener('change',updatePeriod);
    TF.$('payrollStart').addEventListener('change',syncEndFromStart);
    TF.$('payrollForm').addEventListener('submit',save);
    window.addEventListener('twofly:refresh',load);
    load();
  }).catch(e=>TF.fail(e,'Team & Payroll failed'));
})();
