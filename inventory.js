(() => {
  'use strict';
  const TF=window.TwoFly;
  let incoming=[];

  function fill(){
    const cats=TF.categoryOptions();
    TF.$('adjustCategory').innerHTML=cats;
    TF.$('incomingCategory').innerHTML=cats;
    TF.$('garterAccount').innerHTML=TF.accountOptions(false);
    TF.$('garterPurchaseDate').value=TF.today();
    TF.$('incomingDate').value=TF.today();
    updateAdjustmentFields();
  }

  function updateAdjustmentFields(){
    const action=TF.$('adjustAction').value;
    const bucket=TF.$('adjustBucket').value;
    TF.$('adjustQtyLabel').textContent=action==='set_count'?'Exact physical count':'Quantity';
    TF.$('physicalCountHelp').classList.toggle('hidden',action!=='set_count');
    TF.$('adjustUnitCostWrap').classList.toggle('hidden',!(action==='add'&&bucket==='costed'));
  }

  async function load(){
    try{
      const [invR,incomingR,garterR,receiptsR,movesR]=await Promise.all([
        TF.state.supa.from('v_inventory_summary').select('*').order('category_name'),
        TF.isManagement()?TF.state.supa.from('v_incoming_inventory_summary').select('*').order('created_at',{ascending:false}):Promise.resolve({data:[],error:null}),
        TF.isManagement()?TF.state.supa.from('garter_balance').select('*').eq('singleton',true).single():Promise.resolve({data:null,error:null}),
        TF.isManagement()?TF.state.supa.from('garter_receipts').select('*').eq('status','awaiting_count').order('purchase_date',{ascending:false}):Promise.resolve({data:[],error:null}),
        TF.isManagement()?TF.state.supa.from('inventory_movements').select('*,inventory_categories(name)').order('movement_date',{ascending:false}).limit(100):Promise.resolve({data:[],error:null})
      ]);
      const error=invR.error||incomingR.error||garterR.error||receiptsR.error||movesR.error;if(error)throw error;
      const rows=invR.data||[];incoming=incomingR.data||[];
      TF.$('invTotalAvailable').textContent=rows.reduce((a,x)=>a+TF.num(x.total_available),0).toLocaleString();
      TF.$('invLegacy').textContent=rows.reduce((a,x)=>a+TF.num(x.legacy_on_hand),0).toLocaleString();
      TF.$('invCosted').textContent=rows.reduce((a,x)=>a+TF.num(x.costed_on_hand),0).toLocaleString();
      if(TF.isManagement())TF.$('invValue').textContent=TF.money(rows.reduce((a,x)=>a+TF.num(x.costed_inventory_value),0));
      TF.$('inventoryPermissionNotice').classList.toggle('hidden',TF.isManagement());
      TF.$('inventoryTable').innerHTML=`<table><thead><tr><th>Category</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Incoming</th><th class="management-only">Average cost</th><th class="management-only">Tracked value</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${TF.esc(x.category_name)}</strong></td><td>${TF.num(x.total_on_hand).toLocaleString()}<br><small>${TF.num(x.legacy_on_hand)} old / ${TF.num(x.costed_on_hand)} costed</small></td><td>${TF.num(x.total_reserved).toLocaleString()}</td><td><strong>${TF.num(x.total_available).toLocaleString()}</strong></td><td>${TF.num(x.incoming_unreserved).toLocaleString()}<br><small>${TF.num(x.incoming_reserved)} reserved incoming</small></td><td class="management-only">${TF.money(x.weighted_average_cost)}</td><td class="management-only">${TF.money(x.costed_inventory_value)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No inventory categories.</td></tr>'}</tbody></table>`;
      if(TF.isManagement()){
        TF.$('incomingTable').innerHTML=`<table><thead><tr><th>Batch</th><th>Category</th><th>Expected</th><th>Planned</th><th>Reserved</th><th>Received</th><th>Status</th><th></th></tr></thead><tbody>${incoming.map(x=>`<tr><td><strong>${TF.esc(x.batch_name)}</strong></td><td>${TF.esc(x.category_name)}</td><td>${TF.esc(x.expected_date||'—')}</td><td>${TF.num(x.incoming_quantity)}</td><td>${TF.num(x.reserved_quantity)}</td><td>${TF.num(x.received_quantity)}</td><td>${TF.statusPill(x.status)}</td><td>${['incoming','partially_received'].includes(x.status)?`<button class="btn primary small" data-receive="${x.id}">Receive</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">No incoming batches.</td></tr>'}</tbody></table>`;
        const g=garterR.data||{};
        TF.$('garterBalance').innerHTML=`<span>Exact usable garters</span><strong>${TF.num(g.usable_pieces_on_hand).toLocaleString()}</strong><small>Average cost ${TF.money(g.weighted_average_cost)} · Value ${TF.money(g.inventory_value)}</small>`;
        TF.$('garterReceipt').innerHTML='<option value="">Select purchase</option>'+(receiptsR.data||[]).map(r=>`<option value="${r.id}">${TF.esc(r.purchase_date)} — ${TF.esc(r.supplier||'No supplier')} — ${TF.money(r.total_cost)}</option>`).join('');
        TF.$('movementTable').innerHTML=`<table><thead><tr><th>Date</th><th>Category</th><th>Type</th><th>Bucket</th><th>Change</th><th>Unit cost</th><th>Reason</th></tr></thead><tbody>${(movesR.data||[]).map(x=>`<tr><td>${TF.esc(String(x.movement_date).slice(0,10))}</td><td>${TF.esc(x.inventory_categories?.name||'')}</td><td>${TF.esc(String(x.movement_type).replaceAll('_',' '))}</td><td>${TF.esc(x.stock_bucket)}</td><td>${TF.num(x.quantity_delta)>0?'+':''}${TF.num(x.quantity_delta)}</td><td>${TF.money(x.unit_cost)}</td><td>${TF.esc(x.reason||'')}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No inventory movements.</td></tr>'}</tbody></table>`;
      }
    }catch(e){TF.fail(e,'Inventory failed');}
  }

  async function adjust(e){
    e.preventDefault();const btn=e.submitter;TF.setLoading(btn,true);
    try{
      const action=TF.$('adjustAction').value,qty=Number(TF.$('adjustQty').value),bucket=TF.$('adjustBucket').value,category=TF.$('adjustCategory').value,reason=TF.$('adjustReason').value.trim();
      let result;
      if(action==='set_count'){
        result=await TF.state.supa.rpc('set_inventory_physical_count_v5',{p_category_code:category,p_bucket:bucket,p_physical_count:qty,p_reason:reason});
      }else{
        const delta=action==='remove'?-Math.abs(qty):Math.abs(qty);
        let movement=TF.$('adjustType').value;
        if(action==='remove'&&['opening_legacy','opening_costed','manual_add'].includes(movement))movement='manual_remove';
        result=await TF.state.supa.rpc('adjust_inventory_v5',{p_category_code:category,p_bucket:bucket,p_quantity_delta:delta,p_unit_cost:Number(TF.$('adjustUnitCost').value||0),p_movement_type:movement,p_reason:reason});
      }
      if(result.error)throw result.error;
      TF.toast(action==='set_count'?'Physical count saved':'Inventory updated');e.target.reset();updateAdjustmentFields();await load();
    }catch(err){TF.fail(err,'Inventory not saved');}finally{TF.setLoading(btn,false);}
  }

  async function createIncoming(e){
    e.preventDefault();const btn=e.submitter;TF.setLoading(btn,true);
    try{const {error}=await TF.state.supa.rpc('create_incoming_inventory_batch_v5',{p_batch_name:TF.$('incomingName').value.trim(),p_category_code:TF.$('incomingCategory').value,p_expected_date:TF.$('incomingDate').value||null,p_quantity:Number(TF.$('incomingQty').value),p_notes:TF.$('incomingNotes').value.trim()});if(error)throw error;TF.toast('Incoming stock recorded');e.target.reset();TF.$('incomingDate').value=TF.today();await load();}catch(err){TF.fail(err,'Incoming batch not created');}finally{TF.setLoading(btn,false);}
  }

  function openReceive(id){
    const row=incoming.find(x=>x.id===id);if(!row)return;
    TF.$('receiveIncomingId').value=id;TF.$('receiveIncomingTitle').textContent=`Receive ${row.batch_name}`;
    TF.$('receiveIncomingQty').value=Math.max(TF.num(row.incoming_quantity)-TF.num(row.received_quantity),0);
    TF.$('receiveIncomingCost').value='';TF.$('receiveIncomingClose').checked=false;TF.$('receiveIncomingNotes').value='';TF.$('receiveIncomingDialog').showModal();
  }

  async function receiveIncoming(e){
    e.preventDefault();const btn=e.submitter;TF.setLoading(btn,true);
    try{const {error}=await TF.state.supa.rpc('receive_incoming_inventory_batch_v5',{p_batch_id:TF.$('receiveIncomingId').value,p_received_quantity:Number(TF.$('receiveIncomingQty').value),p_receipt_cost:Number(TF.$('receiveIncomingCost').value||0),p_close_batch:TF.$('receiveIncomingClose').checked,p_notes:TF.$('receiveIncomingNotes').value.trim()});if(error)throw error;TF.$('receiveIncomingDialog').close();TF.toast('Incoming stock received');await load();}catch(err){TF.fail(err,'Incoming stock not received');}finally{TF.setLoading(btn,false);}
  }

  async function buyGarter(e){
    e.preventDefault();const btn=e.submitter;TF.setLoading(btn,true);
    try{const {error}=await TF.state.supa.rpc('record_garter_purchase_v5',{p_purchase_date:TF.$('garterPurchaseDate').value,p_supplier:TF.$('garterSupplier').value.trim(),p_bundle_count:Number(TF.$('garterBundles').value),p_total_cost:Number(TF.$('garterCost').value),p_cash_account_id:TF.$('garterAccount').value,p_notes:TF.$('garterPurchaseNotes').value.trim()});if(error)throw error;TF.toast('Garter purchase recorded');e.target.reset();TF.$('garterPurchaseDate').value=TF.today();TF.$('garterBundles').value='1';await load();}catch(err){TF.fail(err,'Garter purchase not saved');}finally{TF.setLoading(btn,false);}
  }

  async function countGarter(e){
    e.preventDefault();const btn=e.submitter;TF.setLoading(btn,true);
    try{const {error}=await TF.state.supa.rpc('count_garter_purchase_v5',{p_receipt_id:TF.$('garterReceipt').value,p_exact_usable_pieces:Number(TF.$('garterPieces').value),p_notes:TF.$('garterCountNotes').value.trim()});if(error)throw error;TF.toast('Exact garter count saved');e.target.reset();await load();}catch(err){TF.fail(err,'Garter count not saved');}finally{TF.setLoading(btn,false);}
  }

  TF.ready.then(()=>{
    fill();
    TF.$('adjustAction').addEventListener('change',updateAdjustmentFields);TF.$('adjustBucket').addEventListener('change',updateAdjustmentFields);
    TF.$('inventoryAdjustForm').addEventListener('submit',adjust);TF.$('incomingForm').addEventListener('submit',createIncoming);
    TF.$('incomingTable').addEventListener('click',e=>{const b=e.target.closest('[data-receive]');if(b)openReceive(b.dataset.receive);});
    TF.$('receiveIncomingForm').addEventListener('submit',receiveIncoming);TF.$('closeReceiveIncoming').addEventListener('click',()=>TF.$('receiveIncomingDialog').close());TF.$('cancelReceiveIncoming').addEventListener('click',()=>TF.$('receiveIncomingDialog').close());
    TF.$('garterPurchaseForm').addEventListener('submit',buyGarter);TF.$('garterCountForm').addEventListener('submit',countGarter);
    window.addEventListener('twofly:refresh',load);load();
  }).catch(e=>TF.fail(e,'Inventory failed'));
})();
