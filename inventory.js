(() => {
  'use strict';
  const TF=window.TwoFly;
  let designs=[];
  function fillSelects(){
    TF.$('adjustCategory').innerHTML=TF.categoryOptions();
    TF.$('garterAccount').innerHTML=TF.accountOptions(true);
    TF.$('skuList').innerHTML=TF.state.products.map(p=>`<option value="${TF.esc(p.code)}">${TF.esc(p.name)}</option>`).join('');
  }
  async function load(){
    try{
      const [{data:summary,error:se},{data:ds,error:de},{data:garter,error:ge},{data:drops,error:dre}]=await Promise.all([
        TF.state.supa.from('v_inventory_summary').select('*').order('category_name'),
        TF.state.supa.from('v_design_availability').select('*').order('category_code').order('sku'),
        TF.state.supa.from('garter_balance').select('*').eq('singleton',true).single(),
        TF.isManagement()?TF.state.supa.from('earring_drops').select('*').order('created_at',{ascending:false}).limit(20):Promise.resolve({data:[],error:null})
      ]);
      if(se||de||ge||dre) throw se||de||ge||dre;
      const s=summary||[];designs=ds||[];
      TF.$('invTotalAvailable').textContent=s.reduce((a,x)=>a+TF.num(x.total_available),0).toLocaleString();
      TF.$('invLegacy').textContent=s.reduce((a,x)=>a+TF.num(x.legacy_on_hand),0).toLocaleString();
      TF.$('invCosted').textContent=s.reduce((a,x)=>a+TF.num(x.costed_on_hand),0).toLocaleString();
      TF.$('invValue').textContent=TF.money(s.reduce((a,x)=>a+TF.num(x.costed_inventory_value),0));
      TF.$('inventoryTable').innerHTML=`<table><thead><tr><th>Category</th><th>Legacy</th><th>Costed</th><th>Reserved</th><th>Available</th><th>Avg cost</th><th>Costed value</th></tr></thead><tbody>${s.map(x=>`<tr><td><strong>${TF.esc(x.category_name)}</strong></td><td>${TF.num(x.legacy_on_hand).toLocaleString()}</td><td>${TF.num(x.costed_on_hand).toLocaleString()}</td><td>${TF.num(x.total_reserved).toLocaleString()}</td><td>${TF.num(x.total_available).toLocaleString()}</td><td>${TF.money(x.weighted_average_cost)}</td><td>${TF.money(x.costed_inventory_value)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No inventory yet.</td></tr>'}</tbody></table>`;
      renderDesigns();
      TF.$('garterBalance').innerHTML=`<strong>${TF.num(garter.usable_pieces_on_hand).toLocaleString()} exact usable garters</strong><br><span class="muted">Average ${TF.money(garter.weighted_average_cost)} each • Value ${TF.money(garter.inventory_value)}</span>`;
      TF.$('earringDropsList').innerHTML=(drops||[]).map(d=>`<div class="list-item"><div><strong>${TF.esc(d.drop_name)}</strong><small>${TF.esc(d.status)} • Expected ${TF.esc(d.expected_date||'not set')}</small></div>${['incoming','partially_received'].includes(d.status)?`<button class="btn primary" data-receive-drop="${d.id}">Receive</button>`:''}</div>`).join('')||'<div class="empty">No incoming drops.</div>';
    }catch(e){TF.fail(e,'Inventory failed');}
  }
  function renderDesigns(){
    const q=TF.$('designSearch').value.trim().toLowerCase(),rows=designs.filter(x=>!q||x.sku.toLowerCase().includes(q)||x.category_name.toLowerCase().includes(q));
    TF.$('designTable').innerHTML=`<table><thead><tr><th>Category</th><th>SKU</th><th>Available now</th><th>Incoming unreserved</th><th>Reserved</th></tr></thead><tbody>${rows.slice(0,500).map(x=>`<tr><td>${TF.esc(x.category_name)}</td><td><strong>${TF.esc(x.sku)}</strong></td><td>${TF.num(x.available_now)}</td><td>${TF.num(x.incoming_unreserved)}</td><td>${TF.num(x.legacy_reserved)+TF.num(x.costed_reserved)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No design-level stock.</td></tr>'}</tbody></table>`;
  }
  async function adjust(e){
    e.preventDefault();const btn=e.submitter;TF.setLoading(btn,true);
    try{const {error}=await TF.state.supa.rpc('adjust_inventory',{p_category_code:TF.$('adjustCategory').value,p_sku:TF.$('adjustSku').value.trim()||null,p_bucket:TF.$('adjustBucket').value,p_quantity_delta:Number(TF.$('adjustQty').value),p_unit_cost:Number(TF.$('adjustUnitCost').value||0),p_movement_type:TF.$('adjustType').value,p_reason:TF.$('adjustReason').value.trim()});if(error)throw error;TF.toast('Inventory updated');e.target.reset();await load();}catch(err){TF.fail(err,'Inventory update failed');}finally{TF.setLoading(btn,false);}
  }
  async function saveGarter(e){
    e.preventDefault();const btn=e.submitter;TF.setLoading(btn,true);
    try{const {error}=await TF.state.supa.rpc('receive_garter_exact',{p_purchase_date:TF.$('garterDate').value,p_supplier:TF.$('garterSupplier').value.trim(),p_bundle_count:Number(TF.$('garterBundles').value),p_total_cost:Number(TF.$('garterCost').value),p_exact_usable_pieces:Number(TF.$('garterPieces').value),p_cash_account_id:TF.$('garterAccount').value||null,p_notes:TF.$('garterNotes').value.trim()});if(error)throw error;TF.toast('Exact garter count recorded');e.target.reset();TF.$('garterDate').value=TF.today();TF.$('garterBundles').value='1';await load();}catch(err){TF.fail(err,'Garter not saved');}finally{TF.setLoading(btn,false);}
  }
  async function createDrop(e){
    e.preventDefault();const btn=e.submitter;TF.setLoading(btn,true);
    try{const {error}=await TF.state.supa.rpc('create_earring_drop',{p_drop_name:TF.$('dropName').value.trim(),p_expected_date:TF.$('dropDate').value||null,p_default_quantity:Number(TF.$('dropDefaultQty').value),p_overrides:TF.parseLinesMap(TF.$('dropOverrides').value),p_notes:TF.$('dropNotes').value.trim()});if(error)throw error;TF.toast('72-design earring drop created');e.target.reset();await load();}catch(err){TF.fail(err,'Drop not created');}finally{TF.setLoading(btn,false);}
  }
  function openDrop(id){TF.$('receiveDropId').value=id;TF.$('receiveDropCost').value='';TF.$('receiveDropActuals').value='';TF.$('receiveDropDialog').showModal();}
  async function receiveDrop(e){
    e.preventDefault();const btn=TF.$('receiveDropSubmit');TF.setLoading(btn,true);
    try{const {error}=await TF.state.supa.rpc('receive_earring_drop',{p_drop_id:TF.$('receiveDropId').value,p_total_batch_cost:Number(TF.$('receiveDropCost').value),p_actual_quantities:TF.parseLinesMap(TF.$('receiveDropActuals').value)});if(error)throw error;TF.$('receiveDropDialog').close();TF.toast('Earring drop received and reservations allocated');await load();}catch(err){TF.fail(err,'Drop not received');}finally{TF.setLoading(btn,false);}
  }
  TF.ready.then(()=>{
    fillSelects();TF.$('garterDate').value=TF.today();TF.$('designSearch').addEventListener('input',renderDesigns);TF.$('inventoryAdjustForm').addEventListener('submit',adjust);TF.$('garterForm').addEventListener('submit',saveGarter);TF.$('earringDropForm').addEventListener('submit',createDrop);TF.$('earringDropsList').addEventListener('click',e=>{const b=e.target.closest('[data-receive-drop]');if(b)openDrop(b.dataset.receiveDrop);});TF.$('receiveDropForm').addEventListener('submit',receiveDrop);window.addEventListener('twofly:refresh',load);load();
  }).catch(e=>TF.fail(e,'Inventory failed'));
})();
