/* Optional UI regression against the isolated synthetic preview on port 8001. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');

(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:8001');
  await page.locator('#projectSelect').selectOption('abcdef012345');
  await page.locator('#navCount').filter({hasText:'1'}).waitFor();
  await page.locator('[data-nav=procurement]').click();
  await page.getByRole('heading',{name:'Your project. Ready to source.'}).waitFor();
  const dialog=page.locator('.proc-dialog');
  await page.getByRole('button',{name:/^(Generate AI BOM|Regenerate BOM)$/}).click();
  await dialog.locator('[name=force]').check();
  await dialog.getByRole('button',{name:'Start AI generation',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.locator('.proc-job.active .proc-spinner').waitFor();
  await page.waitForFunction(()=>procurement.data?.jobs?.bom?.status==='complete');
  await page.getByRole('button',{name:'View evidence',exact:true}).waitFor();
  assert.match(await page.locator('#main').innerText(),/Porcelain floor tile/);
  assert.equal(await page.getByRole('button',{name:'Add material',exact:true}).count(),0);
  const screenshot=path.join(os.tmpdir(),'atlas-procurement-materials.png');
  await page.screenshot({path:screenshot,fullPage:true});
  await page.getByRole('button',{name:'View evidence',exact:true}).click();
  assert.equal(await dialog.locator('input,textarea,select').count(),0);
  assert.match(await dialog.innerText(),/Quote matched/);
  await dialog.getByRole('button',{name:'Close evidence'}).click();
  await page.getByRole('tab',{name:'Find suppliers',exact:true}).click();
  await page.getByRole('button',{name:'Find / resume suppliers',exact:true}).click();
  await dialog.locator('[name=force]').check();
  await dialog.getByRole('button',{name:'Start supplier search',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.locator('.proc-job.active .proc-spinner').waitFor();
  await page.waitForFunction(()=>procurement.data?.jobs?.suppliers?.status==='complete');
  await page.getByRole('button',{name:'View 1 matches',exact:true}).click();
  assert.equal(await page.getByRole('link',{name:'Visit supplier / buy ↗'}).getAttribute('href'),'https://supplier.example/tile');
  assert.equal(await page.getByRole('link',{name:'sales@supplier.example'}).getAttribute('href'),'mailto:sales@supplier.example');
  await page.screenshot({path:path.join(os.tmpdir(),'atlas-procurement-suppliers.png'),fullPage:true});
  // Large BOM presentation fixture only: no additional requests and no real data.
  await page.evaluate(()=>{
   window.savedBrowserBOM=structuredClone(procurement.data);
   const original=procurement.data.items[0],result=procurement.data.supplier_results[original.id];
   procurement.data.items=Array.from({length:105},(_,n)=>({...original,id:'fixture'+n,name:'Tile '+String(n+1).padStart(3,'0')}));
   procurement.data.supplier_results=Object.fromEntries(procurement.data.items.map(i=>[i.id,{...result,item_id:i.id,current:true}]));
   procurement.expanded.clear();drawProcurement();
  });
  assert.equal(await page.locator('.proc-supplier-table tbody tr').count(),20);
  assert.match(await page.locator('.proc-pagination').innerText(),/1–20 of 105/);
  await page.getByRole('button',{name:'Next',exact:true}).click();
  assert.match(await page.locator('.proc-pagination').innerText(),/21–40 of 105/);
  await page.getByLabel('Search supplier results').fill('Tile 105');
  assert.equal(await page.locator('.proc-supplier-table tbody tr').count(),1);
  await page.getByLabel('Search supplier results').fill('');
  await page.getByLabel('Country',{exact:true}).selectOption('Malaysia');
  await page.screenshot({path:path.join(os.tmpdir(),'atlas-procurement-batch.png'),fullPage:true});
  await page.setViewportSize({width:900,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No page-level horizontal overflow');
  await page.evaluate(()=>{procurement.data=window.savedBrowserBOM;procurement.supplierCountry='';procurement.supplierState='';procurement.supplierPage=0;drawProcurement()});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('tab',{name:'Supplier quotes',exact:true}).click();
  await page.getByRole('button',{name:'＋ Record supplier quote',exact:true}).click();
  for(const [name,value]of Object.entries({supplier:'Test supplier',reference:'QUOTE-UI-1',product:'Test porcelain tile',specification:'600 x 600 mm porcelain floor tile',unit_price:'10',shipping:'20',tax_percent:'6',available_quantity:'500',lead_days:'2',valid_until:'2099-12-31',compliance_notes:'Dimensions and grade verified for this fixture.',verified_by:'Browser test reviewer'})){
   await dialog.locator(`[name=${name}]`).fill(value);
  }
  await dialog.getByRole('button',{name:'Save quotation',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.match(await page.locator('#procContent').innerText(),/1,081.20/);
  await page.getByRole('button',{name:'Select quote',exact:true}).last().click();
  await dialog.getByRole('button',{name:'Save to cart',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByRole('tab',{name:'Cart (1)',exact:true}).click();
  await page.getByRole('button',{name:'Create purchase orders',exact:true}).click();
  for(const [name,value]of Object.entries({buyer:'Synthetic project only',requested_by:'Test buyer',delivery_address:'Synthetic test site',required_date:'2099-12-31'}))await dialog.locator(`[name=${name}]`).fill(value);
  await dialog.getByRole('button',{name:'Create for approval'}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByRole('tab',{name:/Orders \(/}).click();
  for(const button of ['Approve purchase','Issue purchase order','Record supplier acknowledgement','Record delivery']){
   await page.getByRole('button',{name:button,exact:true}).first().click();
   await dialog.locator('[name=actor]').fill('UI test operator');
   if(await dialog.locator('[name=reference]').count())await dialog.locator('[name=reference]').fill('TEST-REFERENCE');
   if(button==='Record delivery')await dialog.locator('[name^=receive_]').fill('100');
   await dialog.getByRole('button',{name:button,exact:true}).click();
   await dialog.waitFor({state:'hidden'});
  }
  assert.match(await page.locator('#procContent').innerText(),/delivered/);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download purchase order ↗'}).first().click()]);
  assert.match(download.suggestedFilename(),/^PO-.*\.html$/);
  await page.reload();
  await page.locator('#projectSelect').selectOption('abcdef012345');
  await page.locator('#navCount').filter({hasText:'1'}).waitFor();
  await page.locator('[data-nav=procurement]').click();
  await page.getByRole('heading',{name:'Your project. Ready to source.'}).waitFor();
  await page.getByRole('tab',{name:/Orders \(/}).click();
  assert.match(await page.locator('#procContent').innerText(),/delivered/);
  await page.setViewportSize({width:900,height:900});
  await page.screenshot({path:path.join(os.tmpdir(),'atlas-procurement-orders.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: AI BOM progress, read-only evidence, supplier batch, contacts, 105-material pagination, quotation, cart, order, delivery and reload.');
  console.log('Materials screenshot: '+screenshot);
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
