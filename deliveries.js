(() => {
  'use strict';
  const TF=window.TwoFly;
  let fabric=[],batches=[],pullouts=[],history=[];
  const batchById=new Map();

  function targetTypeOptions(){return `<option value="inventory_category">Inventory category</option><option value="fabric_purchase">Fabric purchase</option><option value="production_batch">Production batch</option><option value="production_pullout">Production pullout</option>`;}
  function targetOptions(type){
    if(type==='inventory_category')return '<option value="">Select category</option>'+TF.state.categories.map(c=>`<option value="${c.id}">${TF.esc(c.name)}</option>`).join('');
    if(type==='fabric_purchase')return '<option value="">Select fabric purchase</option>'+fabric.map(f=>`<option value="${f.id}">${TF.esc(f.purchase_date)} — ${TF.esc(f.supplier||'No supplier')} — ${TF.money(f.total_cost)}</option>`).join('');
    if(type==='production_batch')return '<option value="">Select ongoing batch</option>'+batches.filter(b=>!['completed','cancelled'].includes(b.status)).map(b=>`<option value="${b.id}">${TF.esc(b.batch_number)} — ${TF.esc(b.inventory_categories?.name||'')}</option>`).join('');
    if(type==='production_pullout')return '<option value="">Select partial pullout</option>'+pullouts.map(p=>{const b=batchById.get(p.production_batch_id)||{};return `<option value="${p.id}">${TF.esc(p.pullout_date)} — ${TF.esc(b.batch_number||'Batch')} — ${TF.num(p.completed_quantity).toLocaleString()} pcs</option>`;}).join('');
    return '<option value="">Select target</option>';
  }

  function addAllocation(seed={}){
    const row=document.createElement('div');row.className='allocation-row';
    row.innerHTML=`<label>Target type<select class="allocation-type">${targetTypeOptions()}</select></label><label>Target<select class="allocation-target" required></select></label><label>Amount<input class="allocation-amount" type="number" min="0.01" step="0.01" required></label><label>Qty carried<input class="allocation-qty" type="number" min="1" step="1" placeholder="Optional"></label><label class="allocation-notes">Allocation note<input class="allocation-note" placeholder="Example: 75% of shared ride"></label><button type="button" class="btn danger small remove-allocation">Remove</button>`;
    const type=row.querySelector('.allocation-type'),target=row.querySelector('.allocation-target');type.value=seed.target_type||'inventory_category';target.innerHTML=targetOptions(type.value);if(seed.target_id)target.value=seed.target_id;
    row.querySelector('.allocation-amount').value=seed.amount||'';row.querySelector('.allocation-qty').value=seed.quantity||'';row.querySelector('.allocation-note').value=seed.notes||'';
    type.addEventListener('change',()=>{target.innerHTML=targetOptions(type.value);recalc();});row.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',recalc));
    row.querySelector('.remove-allocation').addEventListener('click',()=>{if(allocationRows().length<=1){TF.toast('Keep at least one allocation',true);return;}row.remove();recalc();});
    TF.$('allocationRows').appendChild(row);recalc();
  }
  function allocationRows(){return Array.from(TF.$('allocationRows').querySelectorAll('.allocation-row'));}
  function recalc(){
    const fee=TF.num(TF.$('deliveryFee').value),allocated=allocationRows().reduce((sum,row)=>sum+TF.num(row.querySelector('.allocation-amount').value),0),diff=fee-allocated,box=TF.$('allocationSummary');box.classList.remove('info','warn','danger');
    if(fee>0&&Math.abs(diff)<=0.01){box.classList.add('info');box.textContent=`Fully allocated: ${TF.money(allocated)}.`;}else{box.classList.add(diff<0?'danger':'warn');box.textContent=`Allocated ${TF.money(allocated)} of ${TF.money(fee)}. ${diff>=0?TF.money(diff)+' remaining':TF.money(Math.abs(diff))+' over allocated'}.`;}
  }
  function updatePaymentMode(){
    const mode=TF.$('deliveryPaymentMode').value,company=mode==='company_cash',reimburse=mode==='reimbursement_payable';
    TF.$('deliveryAccountWrap').classList.toggle('field-disabled',!company);TF.$('deliveryAccount').disabled=!company;TF.$('deliveryAccount').required=company;
    TF.$('deliveryReimbursementWrap').classList.toggle('hidden',!reimburse);TF.$('deliveryReimbursementParty').required=reimburse;
  }

  async function loadReferences(){
    const [fR,bR,pR]=await Promise.all([
      TF.state.supa.from('fabric_purchases').select('id,purchase_date,supplier,description,total_cost,allocated_cost,inbound_delivery_cost').order('purchase_date',{ascending:false}).limit(300),
      TF.state.supa.from('production_batches').select('id,batch_number,category_id,status,source_type,inventory_categories(code,name)').order('created_at',{ascending:false}).limit(400),
      TF.state.supa.from('production_pullouts').select('id,production_batch_id,pullout_date,completed_quantity,inbound_delivery_cost').order('pullout_date',{ascending:false}).limit(500)
    ]);if(fR.error||bR.error||pR.error)throw fR.error||bR.error||pR.error;fabric=fR.data||[];batches=bR.data||[];pullouts=pR.data||[];batchById.clear();batches.forEach(b=>batchById.set(b.id,b));
  }
  async function loadHistory(){
    const month=TF.$('deliveryMonth').value||TF.monthKey(),start=month+'-01',end=TF.monthEndExclusive(month);
    const {data,error}=await TF.state.supa.from('v_inbound_delivery_list_v8').select('*').gte('delivery_date',start).lt('delivery_date',end).order('delivery_date',{ascending:false}).order('created_at',{ascending:false});if(error)throw error;history=data||[];
    const active=history.filter(x=>x.status==='active');TF.$('deliveryTripsMonth').textContent=active.length.toLocaleString();TF.$('deliveryCostMonth').textContent=TF.money(active.reduce((s,x)=>s+TF.num(x.total_fee),0));TF.$('deliveryCashMonth').textContent=TF.money(active.filter(x=>x.payment_mode==='company_cash').reduce((s,x)=>s+TF.num(x.total_fee),0));TF.$('deliveryReimbursementMonth').textContent=TF.money(active.filter(x=>x.payment_mode==='reimbursement_payable').reduce((s,x)=>s+TF.num(x.total_fee),0));
    TF.$('deliveryHistory').innerHTML=`<table><thead><tr><th>Date</th><th>Route</th><th>Fee</th><th>Payment</th><th>Allocated to</th><th>Status</th><th></th></tr></thead><tbody>${history.map(x=>{let payment='';if(x.payment_mode==='reimbursement_payable')payment=`Reimburse ${TF.esc(x.reimbursement_party_name||'—')}<br><small>${TF.money(x.reimbursement_remaining)} remaining</small>`;else if(x.payment_mode==='paid_before_system')payment='Paid before system';else payment=TF.esc(x.cash_account_name||'—');return `<tr><td>${TF.esc(x.delivery_date)}</td><td><strong>${TF.esc(x.origin)}</strong><span class="route-arrow">→</span>${TF.esc(x.destination)}${x.reference_number?`<br><small>Ref: ${TF.esc(x.reference_number)}</small>`:''}</td><td><strong>${TF.money(x.total_fee)}</strong></td><td>${payment}</td><td><small>${TF.esc(x.allocation_summary||'').replaceAll('\n','<br>')}</small></td><td>${TF.statusPill(x.status)}</td><td>${x.status==='active'&&x.can_void?`<button class="btn danger small" data-void="${x.id}">Void</button>`:x.status==='active'?'<small>Paid reimbursement</small>':''}</td></tr>`;}).join('')||'<tr><td colspan="7" class="empty">No inbound deliveries for this month.</td></tr>'}</tbody></table>`;
  }
  async function load(){try{await Promise.all([loadReferences(),loadHistory()]);allocationRows().forEach(row=>{const type=row.querySelector('.allocation-type').value,target=row.querySelector('.allocation-target'),selected=target.value;target.innerHTML=targetOptions(type);target.value=selected;});}catch(e){TF.fail(e,'Inbound deliveries failed');}}

  async function save(e){
    e.preventDefault();const btn=e.submitter;TF.setLoading(btn,true);
    try{
      const total=TF.num(TF.$('deliveryFee').value),allocations=allocationRows().map(row=>({target_type:row.querySelector('.allocation-type').value,target_id:row.querySelector('.allocation-target').value,amount:TF.num(row.querySelector('.allocation-amount').value),quantity:row.querySelector('.allocation-qty').value||null,notes:row.querySelector('.allocation-note').value.trim()}));
      if(allocations.some(a=>!a.target_id||a.amount<=0))throw new Error('Complete every allocation target and amount.');const allocated=allocations.reduce((s,a)=>s+a.amount,0);if(Math.abs(allocated-total)>0.01)throw new Error('The allocations must equal the full Lalamove fee.');
      const mode=TF.$('deliveryPaymentMode').value;
      const {error}=await TF.state.supa.rpc('create_inbound_delivery_v13_2',{p_delivery_date:TF.$('deliveryDate').value,p_origin:TF.$('deliveryOrigin').value.trim(),p_destination:TF.$('deliveryDestination').value.trim(),p_total_fee:total,p_payment_mode:mode,p_cash_account_id:mode==='company_cash'?TF.$('deliveryAccount').value:null,p_reimbursement_party_name:mode==='reimbursement_payable'?TF.$('deliveryReimbursementParty').value.trim():null,p_reference_number:TF.$('deliveryReference').value.trim(),p_notes:TF.$('deliveryNotes').value.trim(),p_allocations:allocations});if(error)throw error;
      TF.toast(mode==='reimbursement_payable'?'Delivery saved and reimbursement payable created':'Inbound delivery saved and allocated');e.target.reset();TF.$('deliveryDate').value=TF.today();TF.$('deliveryPaymentMode').value='company_cash';updatePaymentMode();TF.$('allocationRows').innerHTML='';addAllocation();await loadHistory();await loadReferences();
    }catch(err){TF.fail(err,'Delivery not saved');}finally{TF.setLoading(btn,false);}
  }
  async function voidDelivery(id){const reason=prompt('Why are you voiding this inbound delivery?');if(!reason||!reason.trim())return;try{const {error}=await TF.state.supa.rpc('void_inbound_delivery_v13_2',{p_delivery_id:id,p_reason:reason.trim()});if(error)throw error;TF.toast('Inbound delivery voided and reversed');await load();}catch(e){TF.fail(e,'Delivery could not be voided');}}

  TF.ready.then(async()=>{
    TF.$('deliveryDate').value=TF.today();TF.$('deliveryMonth').value=TF.monthKey();TF.$('deliveryAccount').innerHTML=TF.accountOptions(false);TF.$('deliveryPaymentMode').addEventListener('change',updatePaymentMode);TF.$('deliveryFee').addEventListener('input',recalc);TF.$('addAllocationBtn').addEventListener('click',()=>addAllocation());TF.$('deliveryForm').addEventListener('submit',save);TF.$('deliveryMonth').addEventListener('change',loadHistory);TF.$('deliveryHistory').addEventListener('click',e=>{const b=e.target.closest('[data-void]');if(b)voidDelivery(b.dataset.void);});window.addEventListener('twofly:refresh',load);await loadReferences();addAllocation();await loadHistory();updatePaymentMode();
  }).catch(e=>TF.fail(e,'Inbound deliveries failed'));
})();
