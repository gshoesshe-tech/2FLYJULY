(() => {
  'use strict';
  const TF=window.TwoFly;
  const S={batches:[],rawBatches:[],cutting:[],cuttingPayments:[],payables:[],payablePayments:[],partners:[],people:[],assignments:[],pullouts:[],settlements:[],suppliers:[],supplierItems:[],supplierPayments:[],supplierReceiptItems:[],fabric:[]};
  const byId=(arr,id)=>arr.find(x=>x.id===id);
  const fmt=(v)=>TF.money(TF.num(v));
  const date=(v)=>v?String(v).slice(0,10):'—';
  const safeLines=(v)=>TF.esc(v||'').replaceAll('\n','<br>');

  async function query(table,select='*',build){
    let q=TF.state.supa.from(table).select(select); if(build) q=build(q); const r=await q; if(r.error) throw r.error; return r.data||[];
  }
  function accountOptions(blank=true){return TF.accountOptions(blank);}
  function activeOwnPartners(categoryId=null){return S.people.filter(x=>x.role_type==='own_production'&&x.active&&(!categoryId||!x.category_id||x.category_id===categoryId));}
  function cutters(){return S.people.filter(x=>x.role_type==='cutter'&&x.active);}
  function fullSubcons(categoryId=null){return S.people.filter(x=>x.role_type==='full_subcon'&&x.active&&(!categoryId||!x.category_id||x.category_id===categoryId));}
  function partnerOptions(list,blank='Select partner'){return `<option value="">${blank}</option>`+list.map(x=>`<option value="${x.id}">${TF.esc(x.name)} — ${fmt(x.default_rate)}/pc</option>`).join('');}

  function initFields(){
    const today=TF.today();
    ['cutDate','wipBatchDate','assignDate','pulloutDate','fabricDate','subconDate','payPayableDate','advanceDate','supplierPayDate','supplierReceiveDate'].forEach(id=>{if(TF.$(id))TF.$(id).value=today;});
    TF.$('cutCategory').innerHTML=TF.categoryOptions(); TF.$('subconCategory').innerHTML=TF.categoryOptions();
    ['cutAccount','pulloutAccount','subconAccount','payPayableAccount','advanceAccount','supplierPayAccount','supplierDeliveryAccount','supplierFinalPaymentAccount','fabricAccount'].forEach(id=>TF.$(id).innerHTML=accountOptions(id==='advanceAccount'||id==='supplierDeliveryAccount'||id==='supplierFinalPaymentAccount'));
    TF.$('cutRate').value=TF.state.settings.default_cutting_rate||1.5;
    TF.$('wipSewerRate').value=TF.state.settings.default_sewer_rate||9;
    TF.$('pulloutSewerRate').value=TF.state.settings.default_sewer_rate||9;
  }

  async function load(){
    try{
      const [batches,rawBatches,cutting,cuttingPayments,payables,payablePayments,partners,people,assignments,pullouts,settlements,suppliers,supplierItems,supplierPayments,supplierReceiptItems,fabric]=await Promise.all([
        query('v_production_batch_cost_v13','*',q=>q.order('created_at',{ascending:false})),
        query('production_batches','*,inventory_categories(code,name)',q=>q.order('created_at',{ascending:false})),
        query('v_cutting_jobs_v13','*',q=>q.order('cut_date',{ascending:false})),
        query('cutting_job_payments_v13','*,cash_accounts(name)',q=>q.order('payment_date',{ascending:false})),
        query('v_open_payables_v13','*',q=>q.neq('status','paid').order('payable_date',{ascending:false})),
        query('payable_payments_v13','*,cash_accounts(name)',q=>q.order('payment_date',{ascending:false})),
        query('v_production_partner_summary_v13','*',q=>q.order('name')),
        query('production_people_v13','*',q=>q.order('name')),
        query('production_batch_assignments_v13','*,production_people_v13(name,default_rate)',q=>q.eq('active',true).order('assigned_date',{ascending:false})),
        query('production_pullouts','*',q=>q.order('pullout_date',{ascending:false})),
        query('production_pullout_settlements_v13','*'),
        query('v_supplier_orders_v13','*',q=>q.order('order_date',{ascending:false})),
        query('supplier_purchase_order_items_v12','*',q=>q.order('design_name')),
        query('supplier_purchase_order_payments_v12','*,cash_accounts(name)',q=>q.order('payment_date',{ascending:false})),
        query('supplier_purchase_order_receipt_items_v13','purchase_order_item_id,quantity_received'),
        query('fabric_purchases','*',q=>q.order('purchase_date',{ascending:false}))
      ]);
      Object.assign(S,{batches,rawBatches,cutting,cuttingPayments,payables,payablePayments,partners,people,assignments,pullouts,settlements,suppliers,supplierItems,supplierPayments,supplierReceiptItems,fabric});
      fillDynamicOptions(); renderAll();
    }catch(e){TF.fail(e,'Production data failed');}
  }

  function fillDynamicOptions(){
    TF.$('cutFabricPurchase').innerHTML='<option value="">No linked fabric purchase</option>'+S.fabric.map(f=>`<option value="${f.id}" data-landed="${TF.num(f.total_cost)+TF.num(f.inbound_delivery_cost)}">${date(f.purchase_date)} — ${TF.esc(f.supplier||'Fabric')} — ${fmt(TF.num(f.total_cost)+TF.num(f.inbound_delivery_cost))} landed</option>`).join('');
    TF.$('cutCutter').innerHTML=partnerOptions(cutters(),'Cutter not confirmed yet');
    TF.$('wipJob').innerHTML='<option value="">Select Cut WIP</option>'+S.cutting.filter(j=>TF.num(j.wip_quantity)>0&&j.status!=='cancelled').map(j=>`<option value="${j.id}">${TF.esc(j.job_code)} — ${j.wip_quantity} pcs — ${fmt(j.wip_total_value)}</option>`).join('');
    TF.$('wipPartner').innerHTML=partnerOptions(activeOwnPartners());
    const openOwn=S.rawBatches.filter(b=>b.source_type==='own_production'&&!['completed','cancelled'].includes(b.status));
    const batchOpt='<option value="">Select batch</option>'+openOwn.map(b=>`<option value="${b.id}">${TF.esc(b.batch_number)} — ${TF.esc(b.inventory_categories?.name||'')}</option>`).join('');
    TF.$('assignBatch').innerHTML=batchOpt; TF.$('pulloutBatch').innerHTML=batchOpt;
    TF.$('assignPartner').innerHTML=partnerOptions(activeOwnPartners());
    updatePulloutPartners();
    updateSubconPartners();
  }

  function renderAll(){renderKpis();renderBatches();renderCutting();renderCuttingPayments();renderPayables();renderPartners();renderSuppliers();renderFabric();updateSummaries();}
  function renderKpis(){
    TF.$('kpiActiveBatches').textContent=S.batches.filter(x=>!['completed','cancelled'].includes(x.status)).length;
    TF.$('kpiCutWip').textContent=S.cutting.reduce((a,x)=>a+TF.num(x.wip_quantity),0).toLocaleString('en-PH');
    TF.$('kpiPayables').textContent=fmt(S.payables.filter(x=>['cutting','sewer','subcon','other'].includes(x.payable_type)).reduce((a,x)=>a+TF.num(x.remaining_amount),0));
    TF.$('kpiSupplierBalance').textContent=fmt(S.suppliers.reduce((a,x)=>a+TF.num(x.remaining_balance),0));
  }
  function renderBatches(){
    TF.$('productionTable').innerHTML=`<table><thead><tr><th>Batch</th><th>Partner(s)</th><th>Progress</th><th>Materials + cutting</th><th>Sewing</th><th>Estimated total</th><th>Est. unit</th><th>Open balance</th><th></th></tr></thead><tbody>${S.batches.map(b=>`<tr><td><strong>${TF.esc(b.batch_number)}</strong><br><small>${TF.esc(b.category_name)} · ${date(b.start_date)}</small></td><td>${TF.esc(b.partner_name||'Unassigned')}</td><td>${b.good_finished_quantity}/${b.cut_quantity} good<br><small>${b.pieces_remaining} remaining · ${b.rejected_quantity} reject</small></td><td>${fmt(TF.num(b.fabric_cost_used)+TF.num(b.garter_cost)+TF.num(b.cutting_cost)+TF.num(b.inbound_delivery_cost))}</td><td>${fmt(b.completed_sewing_cost)} completed<br><small>${fmt(b.expected_remaining_sewing)} expected remaining</small></td><td><strong>${fmt(b.estimated_final_cost)}</strong></td><td>${fmt(b.estimated_unit_cost)} ${TF.statusPill(b.cost_status)}</td><td><strong>${fmt(b.open_payables)}</strong></td><td><button class="btn small" data-batch-detail="${b.id}">View details</button></td></tr>`).join('')||'<tr><td colspan="9" class="empty">No production batches.</td></tr>'}</tbody></table>`;
  }
  function renderCutting(){
    TF.$('cuttingTable').innerHTML=`<table><thead><tr><th>Job</th><th>Cutter</th><th>Usable / assigned</th><th>Automatic Cut WIP</th><th>WIP value</th><th>Cutting paid / balance</th><th>Status</th></tr></thead><tbody>${S.cutting.map(j=>`<tr><td><strong>${TF.esc(j.job_code)}</strong><br><small>${date(j.cut_date)} · ${TF.esc(j.category_name)}</small></td><td>${j.cutter_name?TF.esc(j.cutter_name):`<div class="inline-action"><select data-cutter-select="${j.id}">${partnerOptions(cutters(),'Select cutter')}</select><button class="btn small primary" data-assign-cutter="${j.id}">Save</button></div>`}</td><td>${j.usable_quantity} / ${j.allocated_quantity}</td><td><strong>${j.wip_quantity} pcs</strong><br><small>Fabric ${fmt(j.wip_fabric_cost)} + cutting ${fmt(j.wip_cutting_cost)}</small></td><td>${fmt(j.wip_total_value)}</td><td>${fmt(j.cutting_paid)} / <strong>${fmt(j.cutting_remaining)}</strong></td><td>${TF.statusPill(j.status)} ${j.payable_status?TF.statusPill(j.payable_status):''}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No cutting jobs.</td></tr>'}</tbody></table>`;
  }
  function renderCuttingPayments(){
    const rows=[]; const seen=new Set();
    S.cuttingPayments.forEach(x=>{const job=byId(S.cutting,x.cutting_job_id);const key=x.cash_transaction_id||x.id;seen.add(key);rows.push({date:x.payment_date,job:job?.job_code||'Cutting job',cutter:job?.cutter_name||'Unassigned',amount:x.amount,account:x.cash_accounts?.name||'',reference:x.reference_number||x.notes||'',key});});
    S.cutting.filter(j=>j.payable_id).forEach(j=>S.payablePayments.filter(x=>x.payable_id===j.payable_id).forEach(x=>{const key=x.cash_transaction_id||x.id;if(seen.has(key))return;seen.add(key);rows.push({date:x.payment_date,job:j.job_code,cutter:j.cutter_name||'Unassigned',amount:x.amount,account:x.cash_accounts?.name||'',reference:x.reference_number||x.notes||'',key});}));
    rows.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    TF.$('cuttingPaymentsTable').innerHTML=`<table><thead><tr><th>Date</th><th>Job / cutter</th><th>Amount</th><th>Paid from</th><th>Reference</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${date(x.date)}</td><td><strong>${TF.esc(x.job)}</strong><br><small>${TF.esc(x.cutter)}</small></td><td>${fmt(x.amount)}</td><td>${TF.esc(x.account)}</td><td>${TF.esc(x.reference)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No cutting payments yet.</td></tr>'}</tbody></table>`;
    const cutPayables=S.payables.filter(x=>x.payable_type==='cutting');
    TF.$('cuttingPayablesTable').innerHTML=`<table><thead><tr><th>Party</th><th>Original</th><th>Paid</th><th>Remaining</th><th></th></tr></thead><tbody>${cutPayables.map(p=>`<tr><td><strong>${TF.esc(p.party_name)}</strong><br><small>${date(p.payable_date)}</small></td><td>${fmt(p.amount_due)}</td><td>${fmt(p.amount_paid)}</td><td><strong>${fmt(p.remaining_amount)}</strong></td><td><button class="btn primary small" data-pay="${p.id}">Pay</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No cutting payables.</td></tr>'}</tbody></table>`;
  }

  function renderPayables(){
    TF.$('payablesTable').innerHTML=`<table><thead><tr><th>Date</th><th>Type / party</th><th>Original</th><th>Paid</th><th>Remaining</th><th>Last payment</th><th></th></tr></thead><tbody>${S.payables.map(p=>`<tr><td>${date(p.payable_date)}</td><td><strong>${TF.esc(p.party_name)}</strong><br><small>${TF.esc(p.payable_type)} · ${TF.esc(p.notes||'')}</small></td><td>${fmt(p.amount_due)}</td><td>${fmt(p.amount_paid)}<br><small>${p.payment_count||0} payment(s)</small></td><td><strong>${fmt(p.remaining_amount)}</strong></td><td>${p.last_payment_date?`${date(p.last_payment_date)} · ${fmt(p.last_payment_amount)}<br><small>${TF.esc(p.last_payment_account_name||'')} ${TF.esc(p.last_reference_number||'')}</small>`:'No payment yet'}</td><td><button class="btn primary small" data-pay="${p.id}">Pay / history</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">No open payables.</td></tr>'}</tbody></table>`;
  }
  function renderPartners(){
    TF.$('partnersTable').innerHTML=`<table><thead><tr><th>Name</th><th>Type</th><th>Default rate</th><th>Assigned work</th><th>Confirmed advance</th><th>Needs details</th><th>Open payable</th><th></th></tr></thead><tbody>${S.partners.filter(p=>p.role_type!=='cutter').map(p=>`<tr><td><strong>${TF.esc(p.name)}</strong><br><small>${TF.esc(p.category_name||'All categories')}</small></td><td>${TF.esc(p.role_type.replaceAll('_',' '))}</td><td>${fmt(p.default_rate)}/pc</td><td>${p.active_batches} batch(es) · ${p.assigned_quantity||0} pcs</td><td>${fmt(p.confirmed_advance_balance)}</td><td>${fmt(p.declared_unconfirmed_advance)}</td><td>${fmt(p.open_payables)}</td><td>${TF.num(p.declared_unconfirmed_advance)>0?`<button class="btn primary small" data-confirm-advance="${p.id}">Enter payment details</button>`:''}</td></tr>`).join('')}</tbody></table>`;
  }
  function renderSuppliers(){
    TF.$('supplierOrdersTable').innerHTML=`<table><thead><tr><th>Order</th><th>Products</th><th>Ordered / received</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>${S.suppliers.map(o=>`<tr><td><strong>${TF.esc(o.supplier_name)}</strong><br><small>${TF.esc(o.order_code)} · ${date(o.order_date)}</small></td><td>${safeLines(o.item_summary)}</td><td>${o.ordered_quantity} / ${o.received_quantity}<br><small>${o.remaining_quantity} remaining</small></td><td>${fmt(o.expected_total)}</td><td>${fmt(o.amount_paid)}</td><td><strong>${fmt(o.remaining_balance)}</strong></td><td>${TF.statusPill(o.status)}</td><td><button class="btn primary small" data-supplier="${o.id}">Pay / receive</button></td></tr>`).join('')||'<tr><td colspan="8" class="empty">No supplier orders.</td></tr>'}</tbody></table>`;
  }
  function renderFabric(){
    TF.$('fabricTable').innerHTML=`<table><thead><tr><th>Date</th><th>Supplier</th><th>Description</th><th>Purchase</th><th>Inbound</th><th>Landed</th><th>Allocated</th></tr></thead><tbody>${S.fabric.map(f=>`<tr><td>${date(f.purchase_date)}</td><td>${TF.esc(f.supplier||'—')}</td><td>${TF.esc(f.description||'')}</td><td>${fmt(f.total_cost)}</td><td>${fmt(f.inbound_delivery_cost)}</td><td>${fmt(TF.num(f.total_cost)+TF.num(f.inbound_delivery_cost))}</td><td>${fmt(f.allocated_cost)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No fabric purchases.</td></tr>'}</tbody></table>`;
  }

  function updatePulloutPartners(){
    const batch=byId(S.rawBatches,TF.$('pulloutBatch').value); const asg=S.assignments.filter(a=>a.production_batch_id===batch?.id);
    TF.$('pulloutPartner').innerHTML='<option value="">Select assigned partner</option>'+asg.map(a=>`<option value="${a.partner_id}" data-rate="${a.production_people_v13?.default_rate||9}">${TF.esc(a.production_people_v13?.name||'Partner')} — ${a.assigned_quantity} assigned</option>`).join('');
  }
  function updateSubconPartners(){
    const cat=TF.state.categories.find(c=>c.code===TF.$('subconCategory').value);
    TF.$('subconPartner').innerHTML=partnerOptions(fullSubcons(cat?.id));
  }
  function updateSummaries(){
    const cutQty=TF.num(TF.$('cutUsableQty').value),cutRate=TF.num(TF.$('cutRate').value),cutPaid=TF.num(TF.$('cutPaid').value),cutTotal=cutQty*cutRate;
    TF.$('cutSummary').textContent=cutQty?`Cutting cost ${fmt(cutTotal)} · paid ${fmt(cutPaid)} · payable ${fmt(Math.max(cutTotal-cutPaid,0))}`:'Enter the usable quantity to calculate the cutting cost.';
    const job=byId(S.cutting,TF.$('wipJob').value); TF.$('wipSummary').textContent=job?`${job.wip_quantity} pcs available · current WIP value ${fmt(job.wip_total_value)} · value transfers automatically`:'Choose a cutting job to see available WIP.';
    if(job){TF.$('wipQty').max=job.wip_quantity;}
    const partner=byId(S.partners,TF.$('pulloutPartner').value),qty=TF.num(TF.$('pulloutQty').value),rate=TF.num(TF.$('pulloutSewerRate').value),paid=TF.num(TF.$('pulloutPaid').value),sewer=qty*rate,advance=Math.max(TF.num(partner?.confirmed_advance_balance),0),applied=Math.min(advance,sewer),after=sewer-applied;
    TF.$('pulloutSummary').textContent=qty?`Sewing ${fmt(sewer)} · advance applied ${fmt(applied)} · cash now ${fmt(paid)} · new payable ${fmt(Math.max(after-paid,0))}`:'Select a batch and partner to calculate the settlement.';
    const sq=TF.num(TF.$('subconQty').value),sp=TF.num(TF.$('subconPrice').value),sh=TF.num(TF.$('subconHandling').value),sd=TF.num(TF.$('subconPaid').value),st=sq*sp+sh;
    TF.$('subconSummary').textContent=sq&&sp?`Landed cost ${fmt(st)} · paid ${fmt(sd)} · payable ${fmt(Math.max(st-sd,0))}`:'Enter quantity and price to see the total cost.';
    [['cutAccountWrap','cutAccount',cutPaid],['pulloutAccountWrap','pulloutAccount',paid],['subconAccountWrap','subconAccount',sd]].forEach(([wrap,id,val])=>{TF.$(wrap).classList.toggle('field-disabled',val<=0);TF.$(id).disabled=val<=0;});
  }

  function openBatch(id){
    const b=byId(S.batches,id); if(!b)return; const ps=S.pullouts.filter(x=>x.production_batch_id===id).sort((a,z)=>String(a.pullout_date).localeCompare(String(z.pullout_date)));
    const asg=S.assignments.filter(x=>x.production_batch_id===id);
    TF.$('batchDialogTitle').textContent=b.batch_number; TF.$('batchDialogMeta').textContent=`${b.category_name} · ${b.partner_name}`;
    TF.$('batchDialogBody').innerHTML=`<div class="detail-grid ops-detail"><div><span>Fabric</span><strong>${fmt(b.fabric_cost_used)}</strong></div><div><span>Garters</span><strong>${fmt(b.garter_cost)}</strong></div><div><span>Cutting</span><strong>${fmt(b.cutting_cost)}</strong></div><div><span>Inbound deliveries</span><strong>${fmt(TF.num(b.inbound_delivery_cost)+TF.num(b.pullout_delivery_cost))}</strong></div><div><span>Sewing completed</span><strong>${fmt(b.completed_sewing_cost)}</strong></div><div><span>Expected remaining sewing</span><strong>${fmt(b.expected_remaining_sewing)}</strong></div><div><span>Estimated final cost</span><strong>${fmt(b.estimated_final_cost)}</strong></div><div><span>Estimated unit cost</span><strong>${fmt(b.estimated_unit_cost)}</strong></div><div><span>Finished inventory value received</span><strong>${fmt(b.received_inventory_value)}</strong></div><div><span>Open batch payables</span><strong>${fmt(b.open_payables)}</strong></div></div><div class="notice info ops-formula"><strong>Formula:</strong> fabric + garters + cutting + inbound delivery + completed sewing + expected remaining sewing = estimated final batch cost.</div><h4>Partner assignments</h4><div class="table-wrap"><table><thead><tr><th>Partner</th><th>Pieces assigned</th><th>Date</th><th>Notes</th></tr></thead><tbody>${asg.map(a=>`<tr><td>${TF.esc(a.production_people_v13?.name||'')}</td><td>${a.assigned_quantity}</td><td>${date(a.assigned_date)}</td><td>${TF.esc(a.notes||'')}</td></tr>`).join('')||'<tr><td colspan="4">No V13 assignment yet.</td></tr>'}</tbody></table></div><h4>Pullouts</h4><div class="table-wrap"><table><thead><tr><th>Date</th><th>Good pieces</th><th>Sewing</th><th>Cash paid</th><th>Receipt cost</th><th>Notes</th></tr></thead><tbody>${ps.map(p=>`<tr><td>${date(p.pullout_date)}</td><td>${p.completed_quantity}</td><td>${fmt(p.sewer_pay)}</td><td>${fmt(p.amount_paid)}</td><td>${fmt(p.receipt_cost)}</td><td>${TF.esc(p.notes||'')}</td></tr>`).join('')||'<tr><td colspan="6">No pullouts.</td></tr>'}</tbody></table></div>`;
    TF.$('batchDialog').showModal();
  }

  function openPay(id){
    const p=byId(S.payables,id); if(!p)return; TF.$('payPayableId').value=id; TF.$('payPayableTitle').textContent=`Pay ${p.party_name}`; TF.$('payPayableMeta').textContent=`${p.payable_type} · remaining ${fmt(p.remaining_amount)}`; TF.$('payPayableAmount').value=TF.num(p.remaining_amount).toFixed(2); TF.$('payPayableReference').value='';TF.$('payPayableNotes').value='';
    const h=S.payablePayments.filter(x=>x.payable_id===id); TF.$('payableHistory').innerHTML=h.length?`<table><thead><tr><th>Date</th><th>Amount</th><th>Account</th><th>Reference</th></tr></thead><tbody>${h.map(x=>`<tr><td>${date(x.payment_date)}</td><td>${fmt(x.amount)}</td><td>${TF.esc(x.cash_accounts?.name||'')}</td><td>${TF.esc(x.reference_number||x.notes||'')}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">No payment history yet.</p>'; TF.$('payPayableDialog').showModal();
  }
  function openAdvance(partnerId){const p=byId(S.partners,partnerId);const d=S.people.find(x=>x.id===partnerId);if(!p||!d)return;TF.$('advanceId').value=partnerId;TF.$('advanceMeta').textContent=`${p.name} · ${fmt(p.declared_unconfirmed_advance)} needs payment date and account`;TF.$('advanceDialog').showModal();}
  async function findAdvanceId(partnerId){const r=await TF.state.supa.from('production_partner_declared_advances_v13').select('id').eq('partner_id',partnerId).eq('status','needs_payment_details').single();if(r.error)throw r.error;return r.data.id;}
  function openSupplier(id){
    const o=byId(S.suppliers,id);if(!o)return;const items=S.supplierItems.filter(x=>x.purchase_order_id===id);const pays=S.supplierPayments.filter(x=>x.purchase_order_id===id);
    TF.$('supplierDialogTitle').textContent=o.supplier_name;TF.$('supplierDialogMeta').textContent=`${o.order_code} · balance ${fmt(o.remaining_balance)}`;TF.$('supplierPayOrderId').value=id;TF.$('supplierReceiveOrderId').value=id;TF.$('supplierPayAmount').value=TF.num(o.remaining_balance).toFixed(2);
    TF.$('supplierOrderDetail').innerHTML=`<div class="detail-grid"><div><span>Order total</span><strong>${fmt(o.expected_total)}</strong></div><div><span>Paid</span><strong>${fmt(o.amount_paid)}</strong></div><div><span>Remaining</span><strong>${fmt(o.remaining_balance)}</strong></div><div><span>Received</span><strong>${o.received_quantity}/${o.ordered_quantity} pcs</strong></div></div><h4>Payment history</h4><div class="table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Account</th><th>Notes</th></tr></thead><tbody>${pays.map(x=>`<tr><td>${date(x.payment_date)}</td><td>${fmt(x.amount)}</td><td>${TF.esc(x.cash_accounts?.name||'')}</td><td>${TF.esc(x.notes||'')}</td></tr>`).join('')||'<tr><td colspan="4">No payments.</td></tr>'}</tbody></table></div>`;
    TF.$('supplierReceiveItems').innerHTML=items.map(i=>{const received=S.supplierReceiptItems.filter(x=>x.purchase_order_item_id===i.id).reduce((a,x)=>a+TF.num(x.quantity_received),0),remaining=Math.max(TF.num(i.quantity)-received,0);return `<label>${TF.esc(i.design_name)} — ${remaining} remaining of ${i.quantity}<input type="number" min="0" max="${remaining}" step="1" value="0" data-receive-item="${i.id}" ${remaining===0?'disabled':''}></label>`;}).join(''); TF.$('supplierDialog').showModal();
  }

  async function rpc(name,args,success,button){TF.setLoading(button,true);try{const r=await TF.state.supa.rpc(name,args);if(r.error)throw r.error;TF.toast(success);await load();return r.data;}catch(e){TF.fail(e,success+' failed');throw e;}finally{TF.setLoading(button,false);}}
  async function saveCutting(e){e.preventDefault();const b=e.submitter;await rpc('record_cutting_job_v13',{p_job_code:TF.$('cutJobCode').value.trim(),p_cut_date:TF.$('cutDate').value,p_category_code:TF.$('cutCategory').value,p_fabric_purchase_id:TF.$('cutFabricPurchase').value||null,p_cutter_id:TF.$('cutCutter').value||null,p_usable_quantity:TF.num(TF.$('cutUsableQty').value),p_rejected_quantity:TF.num(TF.$('cutRejectedQty').value),p_fabric_cost_total:TF.num(TF.$('cutFabricCost').value),p_cutting_rate:TF.num(TF.$('cutRate').value),p_amount_paid:TF.num(TF.$('cutPaid').value),p_cash_account_id:TF.num(TF.$('cutPaid').value)>0?TF.$('cutAccount').value:null,p_reference_number:TF.$('cutReference').value.trim(),p_notes:TF.$('cutNotes').value.trim()},'Cutting job saved',b);e.target.reset();initFields();}
  async function assignCutter(jobId,select){const button=document.querySelector(`[data-assign-cutter="${jobId}"]`);if(!select.value)return TF.toast('Select Rex Dalman or Jessa',true);await rpc('assign_cutter_to_job_v13',{p_cutting_job_id:jobId,p_cutter_id:select.value},'Cutter assigned',button);}
  async function createWipBatch(e){e.preventDefault();const b=e.submitter;await rpc('create_batch_from_cutting_job_v13',{p_cutting_job_id:TF.$('wipJob').value,p_batch_number:TF.$('wipBatchNumber').value.trim(),p_start_date:TF.$('wipBatchDate').value,p_partner_id:TF.$('wipPartner').value,p_quantity:TF.num(TF.$('wipQty').value),p_expected_good_output:TF.num(TF.$('wipExpected').value),p_garter_quantity_used:TF.num(TF.$('wipGarters').value),p_default_sewer_rate:TF.num(TF.$('wipSewerRate').value),p_notes:TF.$('wipNotes').value.trim()},'Batch created from Cut WIP',b);e.target.reset();initFields();}
  async function assignPartner(e){e.preventDefault();const b=e.submitter;await rpc('assign_partner_to_batch_v13',{p_batch_id:TF.$('assignBatch').value,p_partner_id:TF.$('assignPartner').value,p_assigned_quantity:TF.num(TF.$('assignQty').value),p_assigned_date:TF.$('assignDate').value,p_notes:TF.$('assignNotes').value.trim()},'Partner assigned',b);e.target.reset();TF.$('assignDate').value=TF.today();}
  async function savePullout(e){e.preventDefault();const b=e.submitter;const paid=TF.num(TF.$('pulloutPaid').value);await rpc('add_production_pullout_v13',{p_batch_id:TF.$('pulloutBatch').value,p_partner_id:TF.$('pulloutPartner').value,p_pullout_date:TF.$('pulloutDate').value,p_completed_quantity:TF.num(TF.$('pulloutQty').value),p_sewer_rate:TF.num(TF.$('pulloutSewerRate').value),p_amount_paid:paid,p_cash_account_id:paid>0?TF.$('pulloutAccount').value:null,p_final_pullout:TF.$('pulloutFinal').checked,p_rejected_quantity:TF.num(TF.$('pulloutRejects').value),p_notes:TF.$('pulloutNotes').value.trim()},'Pullout added to inventory',b);e.target.reset();initFields();}
  async function savePay(e){e.preventDefault();const b=e.submitter;await rpc('pay_payable_v13',{p_payable_id:TF.$('payPayableId').value,p_payment_date:TF.$('payPayableDate').value,p_amount:TF.num(TF.$('payPayableAmount').value),p_cash_account_id:TF.$('payPayableAccount').value,p_reference_number:TF.$('payPayableReference').value.trim(),p_notes:TF.$('payPayableNotes').value.trim()},'Payable payment recorded',b);TF.$('payPayableDialog').close();}
  async function confirmAdvance(e){e.preventDefault();const b=e.submitter;try{const declaredId=await findAdvanceId(TF.$('advanceId').value);await rpc('confirm_partner_advance_v13',{p_declared_advance_id:declaredId,p_payment_date:TF.$('advanceDate').value,p_cash_account_id:TF.$('advanceBeforeSystem').checked?null:TF.$('advanceAccount').value,p_paid_before_system:TF.$('advanceBeforeSystem').checked,p_notes:TF.$('advanceNotes').value.trim()},'Production advance confirmed',b);TF.$('advanceDialog').close();}catch(_){} }
  async function saveFabric(e){e.preventDefault();const b=e.submitter;await rpc('record_fabric_purchase_v5',{p_purchase_date:TF.$('fabricDate').value,p_supplier:TF.$('fabricSupplier').value.trim(),p_description:TF.$('fabricDescription').value.trim(),p_total_cost:TF.num(TF.$('fabricCost').value),p_cash_account_id:TF.$('fabricAccount').value,p_notes:TF.$('fabricNotes').value.trim()},'Fabric purchase recorded',b);e.target.reset();TF.$('fabricDate').value=TF.today();}
  async function saveSubcon(e){e.preventDefault();const b=e.submitter;const paid=TF.num(TF.$('subconPaid').value),partner=byId(S.people,TF.$('subconPartner').value);await rpc('receive_subcon_batch_v5',{p_batch_number:TF.$('subconBatchNumber').value.trim(),p_category_code:TF.$('subconCategory').value,p_received_date:TF.$('subconDate').value,p_partner_name:partner?.name||'',p_quantity:TF.num(TF.$('subconQty').value),p_price_per_piece:TF.num(TF.$('subconPrice').value),p_handling_cost:TF.num(TF.$('subconHandling').value),p_amount_paid:paid,p_cash_account_id:paid>0?TF.$('subconAccount').value:null,p_notes:TF.$('subconNotes').value.trim()},'Subcon inventory received',b);e.target.reset();initFields();}
  async function paySupplier(e){e.preventDefault();const b=e.submitter;await rpc('pay_supplier_order_v13',{p_purchase_order_id:TF.$('supplierPayOrderId').value,p_payment_date:TF.$('supplierPayDate').value,p_amount:TF.num(TF.$('supplierPayAmount').value),p_cash_account_id:TF.$('supplierPayAccount').value,p_reference_number:TF.$('supplierPayReference').value.trim(),p_notes:TF.$('supplierPayNotes').value.trim()},'Supplier payment recorded',b);TF.$('supplierDialog').close();}
  async function receiveSupplier(e){e.preventDefault();const b=e.submitter;const items=[...TF.$('supplierReceiveItems').querySelectorAll('[data-receive-item]')].map(x=>({purchase_order_item_id:x.dataset.receiveItem,quantity_received:TF.num(x.value)})).filter(x=>x.quantity_received>0);await rpc('receive_supplier_order_v13',{p_purchase_order_id:TF.$('supplierReceiveOrderId').value,p_receipt_date:TF.$('supplierReceiveDate').value,p_items:items,p_delivery_cost:TF.num(TF.$('supplierDeliveryCost').value),p_delivery_cash_account_id:TF.num(TF.$('supplierDeliveryCost').value)>0?TF.$('supplierDeliveryAccount').value:null,p_final_payment:TF.num(TF.$('supplierFinalPayment').value),p_payment_cash_account_id:TF.num(TF.$('supplierFinalPayment').value)>0?TF.$('supplierFinalPaymentAccount').value:null,p_reference_number:TF.$('supplierReceiveReference').value.trim(),p_notes:TF.$('supplierReceiveNotes').value.trim()},'Supplier stock received',b);TF.$('supplierDialog').close();}

  function bind(){
    TF.$('productionTabs').addEventListener('click',e=>{const b=e.target.closest('[data-section]');if(!b)return;TF.$$('#productionTabs .section-tab').forEach(x=>x.classList.toggle('active',x===b));TF.$$('[data-panel]').forEach(x=>x.classList.toggle('hidden',x.dataset.panel!==b.dataset.section));});
    TF.$('productionTable').addEventListener('click',e=>{const b=e.target.closest('[data-batch-detail]');if(b)openBatch(b.dataset.batchDetail);});
    TF.$('payablesTable').addEventListener('click',e=>{const b=e.target.closest('[data-pay]');if(b)openPay(b.dataset.pay);});
    TF.$('cuttingPayablesTable').addEventListener('click',e=>{const b=e.target.closest('[data-pay]');if(b)openPay(b.dataset.pay);});
    TF.$('partnersTable').addEventListener('click',e=>{const b=e.target.closest('[data-confirm-advance]');if(b)openAdvance(b.dataset.confirmAdvance);});
    TF.$('supplierOrdersTable').addEventListener('click',e=>{const b=e.target.closest('[data-supplier]');if(b)openSupplier(b.dataset.supplier);});
    TF.$('cuttingTable').addEventListener('click',e=>{const b=e.target.closest('[data-assign-cutter]');if(b)assignCutter(b.dataset.assignCutter,TF.$('cuttingTable').querySelector(`[data-cutter-select="${b.dataset.assignCutter}"]`));});
    document.addEventListener('click',e=>{const b=e.target.closest('[data-close]');if(b)TF.$(b.dataset.close).close();});
    TF.$('cuttingForm').addEventListener('submit',saveCutting);TF.$('wipBatchForm').addEventListener('submit',createWipBatch);TF.$('partnerAssignmentForm').addEventListener('submit',assignPartner);TF.$('pulloutForm').addEventListener('submit',savePullout);TF.$('payPayableForm').addEventListener('submit',savePay);TF.$('advanceForm').addEventListener('submit',confirmAdvance);TF.$('fabricPurchaseForm').addEventListener('submit',saveFabric);TF.$('subconForm').addEventListener('submit',saveSubcon);TF.$('supplierPaymentForm').addEventListener('submit',paySupplier);TF.$('supplierReceiveForm').addEventListener('submit',receiveSupplier);
    TF.$('pulloutBatch').addEventListener('change',()=>{updatePulloutPartners();updateSummaries();});TF.$('pulloutPartner').addEventListener('change',e=>{const o=e.target.selectedOptions[0];if(o?.dataset.rate)TF.$('pulloutSewerRate').value=o.dataset.rate;updateSummaries();});TF.$('subconCategory').addEventListener('change',updateSubconPartners);TF.$('subconPartner').addEventListener('change',e=>{const p=byId(S.people,e.target.value);if(p)TF.$('subconPrice').value=p.default_rate;updateSummaries();});TF.$('cutFabricPurchase').addEventListener('change',e=>{const o=e.target.selectedOptions[0];if(o?.dataset.landed)TF.$('cutFabricCost').value=o.dataset.landed;});
    ['cutUsableQty','cutRate','cutPaid','wipJob','pulloutQty','pulloutSewerRate','pulloutPaid','subconQty','subconPrice','subconHandling','subconPaid'].forEach(id=>TF.$(id).addEventListener('input',updateSummaries));
    TF.$('advanceBeforeSystem').addEventListener('change',e=>{TF.$('advanceAccount').disabled=e.target.checked;});
  }

  TF.ready.then(()=>{initFields();bind();window.addEventListener('twofly:refresh',load);load();}).catch(e=>TF.fail(e,'Production failed'));
})();
