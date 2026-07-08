(() => {
  'use strict';
  const TF=window.TwoFly;
  let setup=null;

  function disableOpeningForms(disabled){
    TF.$$('.opening-form input,.opening-form select,.opening-form textarea,.opening-form button').forEach(el=>{
      if(el.id==='reopenOpeningBtn') return;
      el.disabled=disabled;
    });
    TF.$('reopenOpeningBtn').classList.toggle('hidden',!disabled);
    TF.$('finalizeOpeningBtn').classList.toggle('hidden',disabled);
  }

  function batchSummary(){
    const fabric=TF.num(TF.$('openingBatchFabricCost').value);
    const garter=TF.num(TF.$('openingBatchGarterCost').value);
    const cutting=TF.num(TF.$('openingBatchCuttingCost').value);
    const expected=TF.num(TF.$('openingBatchExpectedGood').value);
    const sewer=TF.num(TF.$('openingBatchSewerRate').value);
    const priorSewer=TF.num(TF.$('openingBatchPriorSewerCost').value);
    const base=fabric+garter+cutting;
    const estimated=expected>0?(base/expected)+sewer:0;
    TF.$('openingBatchSummary').textContent=expected>0
      ? `Already-paid production cost: ${TF.money(base+priorSewer)} · Estimated cost before final output: ${TF.money(estimated)} per finished piece. Sewer cash moves only when you pay a pullout.`
      : 'Enter the production costs and expected output.';
  }

  async function load(){
    try{
      const [sR,cR,iR,pR,eR,gR]=await Promise.all([
        TF.state.supa.from('v_opening_setup_summary_v6').select('*').single(),
        TF.state.supa.from('v_cash_account_balances').select('*').order('name'),
        TF.state.supa.from('v_inventory_summary').select('*').order('category_name'),
        TF.state.supa.from('production_batches').select('*,inventory_categories(code,name)').eq('is_opening_batch',true).order('created_at',{ascending:false}),
        TF.state.supa.from('opening_entries_v6').select('*').order('created_at',{ascending:false}).limit(100),
        TF.state.supa.from('garter_balance').select('*').eq('singleton',true).maybeSingle()
      ]);
      const err=sR.error||cR.error||iR.error||pR.error||eR.error||gR.error;if(err)throw err;
      setup=sR.data||{};
      TF.$('openingStartDate').value=setup.start_date||TF.today();
      TF.$('openingSetupNotes').value=setup.notes||'';
      TF.$('openingCashKpi').textContent=TF.money(setup.opening_cash_total);
      TF.$('openingInventoryKpi').textContent=TF.num(setup.opening_inventory_pieces).toLocaleString();
      TF.$('openingInventoryValueKpi').textContent=TF.money(setup.opening_costed_inventory_value);
      TF.$('openingGarterKpi').textContent=TF.num(setup.opening_garter_pieces).toLocaleString();
      TF.$('openingWipKpi').textContent=TF.money(setup.open_transition_production_value);
      TF.$('openingOrdersKpi').textContent=TF.num(setup.migrated_orders).toLocaleString();
      const finalized=setup.status==='finalized';
      TF.$('openingStatusNotice').className=`notice ${finalized?'warn':'info'}`;
      TF.$('openingStatusNotice').innerHTML=finalized
        ? `<strong>Opening Setup finalized.</strong> Normal daily records can continue. Reopen only when a starting record needs correction.`
        : `<strong>Setup is open.</strong> Enter starting records only. These entries do not create fake sales or deduct old payments from cash again.`;
      disableOpeningForms(finalized);

      TF.$('openingCashTable').innerHTML=`<table><thead><tr><th>Account</th><th>Type</th><th>Opening</th><th>Current</th></tr></thead><tbody>${(cR.data||[]).map(a=>`<tr><td><strong>${TF.esc(a.name)}</strong></td><td>${TF.esc(a.account_type)}</td><td>${TF.money(a.opening_balance)}</td><td><strong>${TF.money(a.current_balance)}</strong></td></tr>`).join('')||'<tr><td colspan="4" class="empty">No cash accounts.</td></tr>'}</tbody></table>`;
      TF.$('openingInventoryTable').innerHTML=`<table><thead><tr><th>Category</th><th>Old stock</th><th>Costed stock</th><th>Total</th><th>Average cost</th><th>Tracked value</th></tr></thead><tbody>${(iR.data||[]).map(x=>`<tr><td><strong>${TF.esc(x.category_name)}</strong></td><td>${TF.num(x.legacy_on_hand).toLocaleString()}</td><td>${TF.num(x.costed_on_hand).toLocaleString()}</td><td>${TF.num(x.total_on_hand).toLocaleString()}</td><td>${TF.money(x.weighted_average_cost)}</td><td>${TF.money(x.costed_inventory_value)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No inventory categories.</td></tr>'}</tbody></table>`;
      TF.$('openingProductionTable').innerHTML=`<table><thead><tr><th>Batch</th><th>Category</th><th>Status</th><th>Cut / Expected / Good</th><th>Already paid</th><th>Cost status</th></tr></thead><tbody>${(pR.data||[]).map(b=>`<tr><td><strong>${TF.esc(b.batch_number)}</strong><br><small>Started ${TF.esc(b.original_start_date||b.start_date)}</small></td><td>${TF.esc(b.inventory_categories?.name||'')}</td><td>${TF.statusPill(b.status)}</td><td>${TF.num(b.cut_quantity).toLocaleString()} / ${TF.num(b.expected_good_output).toLocaleString()} / ${TF.num(b.good_finished_quantity).toLocaleString()}</td><td>${TF.money(b.prior_paid_cost)}</td><td>${TF.statusPill(b.cost_status)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No existing production batches.</td></tr>'}</tbody></table>`;
      TF.$('openingEntriesTable').innerHTML=`<table><thead><tr><th>Time</th><th>Type</th><th>Category</th><th>Quantity</th><th>Amount</th><th>Details</th></tr></thead><tbody>${(eR.data||[]).map(e=>`<tr><td>${TF.esc(e.created_at)}</td><td>${TF.esc(String(e.entry_type).replaceAll('_',' '))}</td><td>${TF.esc(e.category_code||'—')}</td><td>${e.quantity==null?'—':TF.num(e.quantity).toLocaleString()}</td><td>${e.amount==null?'—':TF.money(e.amount)}</td><td><small>${TF.esc(JSON.stringify(e.details||{}))}</small></td></tr>`).join('')||'<tr><td colspan="6" class="empty">No opening entries.</td></tr>'}</tbody></table>`;
      if(gR.data){TF.$('openingGarterPieces').value=gR.data.usable_pieces_on_hand||0;TF.$('openingGarterCost').value=gR.data.inventory_value||0;}
    }catch(e){TF.fail(e,'Opening Setup failed');}
  }

  async function saveSetup(e){e.preventDefault();const b=e.submitter;TF.setLoading(b,true);try{const {error}=await TF.state.supa.rpc('save_opening_setup_v6',{p_start_date:TF.$('openingStartDate').value,p_notes:TF.$('openingSetupNotes').value.trim()});if(error)throw error;TF.toast('Starting point saved');await load();}catch(err){TF.fail(err,'Starting point not saved');}finally{TF.setLoading(b,false);}}
  async function saveCash(e){e.preventDefault();const b=e.submitter;TF.setLoading(b,true);try{const {error}=await TF.state.supa.rpc('upsert_opening_cash_account_v6',{p_name:TF.$('openingCashName').value.trim(),p_account_type:TF.$('openingCashType').value,p_opening_balance:TF.num(TF.$('openingCashBalance').value),p_notes:TF.$('openingCashNotes').value.trim()});if(error)throw error;TF.toast('Opening cash account saved');e.target.reset();await load();}catch(err){TF.fail(err,'Opening cash not saved');}finally{TF.setLoading(b,false);}}
  async function saveInventory(e){e.preventDefault();const b=e.submitter;TF.setLoading(b,true);try{const {error}=await TF.state.supa.rpc('set_opening_inventory_v6',{p_category_code:TF.$('openingInventoryCategory').value,p_legacy_quantity:TF.num(TF.$('openingLegacyQty').value),p_costed_quantity:TF.num(TF.$('openingCostedQty').value),p_costed_unit_cost:TF.num(TF.$('openingCostedUnitCost').value),p_reason:TF.$('openingInventoryReason').value.trim()});if(error)throw error;TF.toast('Opening inventory set');await load();}catch(err){TF.fail(err,'Opening inventory not saved');}finally{TF.setLoading(b,false);}}
  async function saveGarter(e){e.preventDefault();const b=e.submitter;TF.setLoading(b,true);try{const {error}=await TF.state.supa.rpc('set_opening_garter_stock_v6',{p_exact_usable_pieces:TF.num(TF.$('openingGarterPieces').value),p_total_cost:TF.num(TF.$('openingGarterCost').value),p_original_payment_date:TF.$('openingGarterPaidDate').value||null,p_supplier:TF.$('openingGarterSupplier').value.trim(),p_notes:TF.$('openingGarterNotes').value.trim()});if(error)throw error;TF.toast('Opening garter stock saved');await load();}catch(err){TF.fail(err,'Opening garter stock not saved');}finally{TF.setLoading(b,false);}}
  async function saveFabric(e){e.preventDefault();const b=e.submitter;TF.setLoading(b,true);try{const {error}=await TF.state.supa.rpc('record_opening_fabric_stock_v6',{p_description:TF.$('openingFabricDescription').value.trim(),p_total_cost:TF.num(TF.$('openingFabricCost').value),p_original_payment_date:TF.$('openingFabricPaidDate').value||null,p_supplier:TF.$('openingFabricSupplier').value.trim(),p_notes:TF.$('openingFabricNotes').value.trim()});if(error)throw error;TF.toast('Opening fabric added');e.target.reset();await load();}catch(err){TF.fail(err,'Opening fabric not saved');}finally{TF.setLoading(b,false);}}
  async function saveProduction(e){e.preventDefault();const b=e.submitter;TF.setLoading(b,true);try{const {error}=await TF.state.supa.rpc('create_opening_production_batch_v6',{p_batch_number:TF.$('openingBatchNumber').value.trim(),p_category_code:TF.$('openingBatchCategory').value,p_original_start_date:TF.$('openingBatchOriginalDate').value||TF.$('openingStartDate').value,p_fabric_cost_already_paid:TF.num(TF.$('openingBatchFabricCost').value),p_garter_quantity_already_assigned:TF.num(TF.$('openingBatchGarterQty').value),p_garter_cost_already_paid:TF.num(TF.$('openingBatchGarterCost').value),p_cut_quantity:TF.num(TF.$('openingBatchCutQty').value),p_cutting_cost_already_paid:TF.num(TF.$('openingBatchCuttingCost').value),p_expected_good_output:TF.num(TF.$('openingBatchExpectedGood').value),p_default_sewer_rate:TF.num(TF.$('openingBatchSewerRate').value),p_good_output_before_start:TF.num(TF.$('openingBatchPriorGood').value),p_rejected_before_start:TF.num(TF.$('openingBatchPriorRejects').value),p_sewer_cost_already_paid:TF.num(TF.$('openingBatchPriorSewerCost').value),p_notes:TF.$('openingBatchNotes').value.trim()});if(error)throw error;TF.toast('Existing production batch created without a cash deduction');e.target.reset();TF.$('openingBatchSewerRate').value=TF.state.settings.default_sewer_rate;batchSummary();await load();}catch(err){TF.fail(err,'Existing production not saved');}finally{TF.setLoading(b,false);}}
  async function finalize(){if(!confirm('Finalize Opening Setup? Normal records can continue, and opening entries will be locked until you reopen the setup.'))return;try{const {error}=await TF.state.supa.rpc('finalize_opening_setup_v6',{p_notes:TF.$('openingSetupNotes').value.trim()});if(error)throw error;TF.toast('Opening Setup finalized');await load();}catch(e){TF.fail(e,'Setup not finalized');}}
  async function reopen(){const reason=prompt('Why are you reopening Opening Setup?');if(!reason)return;try{const {error}=await TF.state.supa.rpc('reopen_opening_setup_v6',{p_reason:reason});if(error)throw error;TF.toast('Opening Setup reopened');await load();}catch(e){TF.fail(e,'Setup not reopened');}}

  TF.ready.then(()=>{
    const cats=TF.categoryOptions();
    TF.$('openingInventoryCategory').innerHTML=cats;
    TF.$('openingBatchCategory').innerHTML=cats;
    TF.$('openingBatchSewerRate').value=TF.state.settings.default_sewer_rate;
    TF.$('openingStartDate').value='2026-07-01';
    ['openingBatchFabricCost','openingBatchGarterCost','openingBatchCuttingCost','openingBatchExpectedGood','openingBatchSewerRate','openingBatchPriorSewerCost'].forEach(id=>TF.$(id).addEventListener('input',batchSummary));
    TF.$('openingSetupForm').addEventListener('submit',saveSetup);
    TF.$('openingCashForm').addEventListener('submit',saveCash);
    TF.$('openingInventoryForm').addEventListener('submit',saveInventory);
    TF.$('openingGarterForm').addEventListener('submit',saveGarter);
    TF.$('openingFabricForm').addEventListener('submit',saveFabric);
    TF.$('openingProductionForm').addEventListener('submit',saveProduction);
    TF.$('finalizeOpeningBtn').addEventListener('click',finalize);
    TF.$('reopenOpeningBtn').addEventListener('click',reopen);
    window.addEventListener('twofly:refresh',load);
    batchSummary();load();
  }).catch(e=>TF.fail(e,'Opening Setup failed'));
})();
