const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>console.log('PAGEERROR',e.message));await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:8601'}/editor.html`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.vm?.editingTarget&&window.vm.runtime.raytracer);await page.waitForTimeout(2000);
await page.getByText('GPU',{exact:true}).first().click();
// The GPU button opens the same editor as My Blocks.
await page.getByText('Make a GPU block',{exact:true}).click();
await page.locator('[class*=custom-procedures_modal-content]').waitFor();
assert.equal(await page.getByText('Run without screen refresh').count(),0);
await page.waitForTimeout(300);
await page.keyboard.type('UI kernel');
await page.getByText('number or text',{exact:true}).click();
await page.waitForTimeout(200);
await page.keyboard.type('tint');
await page.getByRole('button',{name:'OK',exact:true}).click();
await page.waitForFunction(()=>Object.values(window.vm.editingTarget.blocks._blocks).some(b=>b.opcode==='procedures_prototype'&&b.mutation?.gpu==='true'));
const created=await page.evaluate(()=>{const p=Object.values(window.vm.editingTarget.blocks._blocks).find(b=>b.opcode==='procedures_prototype');return {proccode:p.mutation.proccode,names:JSON.parse(p.mutation.argumentnames)};});
console.log('created',created);assert.equal(created.proccode,'UI kernel %s %s %s');assert.deepEqual(created.names,['tint','uv','buffer']);
await page.locator('.blocklyBlockCanvas').getByText('define GPU',{exact:true}).first().waitFor();
await page.locator('.blocklyFlyout').getByText('UI kernel',{exact:true}).first().waitFor();
// My Blocks must not list GPU definitions; the GPU caller hides uv and names the output buffer.
const flyout=await page.evaluate(()=>{const fb=window.vm.runtime.flyoutBlocks;const call=Object.values(fb._blocks).find(b=>b.opcode==='rtgpu_call'&&b.mutation.proccode==='UI kernel %s %s %s');const ids=JSON.parse(call.mutation.argumentids);
 const procedures=Object.values(fb._blocks).filter(b=>b.opcode==='procedures_call'&&b.mutation.proccode.startsWith('UI kernel')).length;
 return {inputs:Object.keys(call.inputs).map(id=>ids.indexOf(id)),buffer:fb.getBlock(call.inputs[ids[2]].block).fields.TEXT.value,procedures};});
console.log('flyout',flyout);assert.deepEqual(flyout,{inputs:[0,2],buffer:'main',procedures:0});
// Editing reopens the same editor without uv/buffer and restores them afterwards.
await page.locator('.blocklyBlockCanvas').getByText('define GPU',{exact:true}).first().click({button:'right'});
await page.locator('.goog-menuitem-content',{hasText:'Edit'}).click();
await page.locator('[class*=custom-procedures_modal-content]').waitFor();
assert.equal(await page.getByText('Run without screen refresh').count(),0);
const editorArgs=await page.evaluate(()=>[...document.querySelectorAll('[class*=custom-procedures_workspace] .blocklyEditableText text, [class*=custom-procedures_workspace] input')].map(t=>t.textContent||t.value));
await page.getByText('boolean',{exact:true}).click();await page.waitForTimeout(200);await page.keyboard.type('on');
await page.getByRole('button',{name:'OK',exact:true}).click();
await page.waitForFunction(()=>Object.values(window.vm.editingTarget.blocks._blocks).some(b=>b.opcode==='procedures_prototype'&&b.mutation.proccode==='UI kernel %s %b %s %s'));
const edited=await page.evaluate(()=>JSON.parse(Object.values(window.vm.editingTarget.blocks._blocks).find(b=>b.opcode==='procedures_prototype').mutation.argumentnames));
await page.locator('.scratchCategoryMenuItemLabel',{hasText:'My Blocks'}).click();await page.waitForTimeout(500);
await page.locator('.blocklyFlyoutButton',{hasText:'Make a Block'}).click();
await page.getByText('Run without screen refresh').waitFor();
await page.getByRole('button',{name:'Cancel',exact:true}).click();
console.log('edited',editorArgs,edited);assert.ok(!editorArgs.join().includes('uv'));assert.deepEqual(edited,['tint','on','uv','buffer']);
const result=await page.evaluate(async()=>{
 const vm=window.vm,rt=vm.runtime.raytracer,target=vm.editingTarget;
 const errors=[];vm.runtime.on('RAYTRACER_ERROR',e=>errors.push(e));
 const mutation={tagName:'mutation',children:[],proccode:'gradient %s %s %s',argumentids:'["tint-id","uv-id","buffer-id"]',argumentnames:'["tint","uv","buffer"]',argumentdefaults:'["","",""]',warp:'false',gpu:'true'};
 const blocks=[
 {id:'gpu-test',opcode:'procedures_definition',inputs:{custom_block:{name:'custom_block',block:'proto-test',shadow:'proto-test'}},next:'return-test',topLevel:true},
 {id:'proto-test',opcode:'procedures_prototype',shadow:true,parent:'gpu-test',mutation},
 {id:'return-test',opcode:'procedures_return',inputs:{VALUE:{name:'VALUE',block:'tint-test',shadow:null}},parent:'gpu-test'},
 {id:'tint-test',opcode:'argument_reporter_string_number',fields:{VALUE:{name:'VALUE',value:'tint'}},parent:'return-test'},
 {id:'color-value',opcode:'rtobject_vec4',inputs:{X:{block:'gain-value'},Y:{block:'zero-value'},Z:{block:'zero-value'},W:{block:'one-value'}},parent:'call-test'},
 ...[['zero-value',0],['one-value',1],['gain-value',0.25]].map(([id,value])=>({id,opcode:'math_number',fields:{NUM:{name:'NUM',value:String(value)}},shadow:true,parent:'color-value'})),
 {id:'flag-test',opcode:'event_whenflagclicked',topLevel:true,next:'call-test'},
 {id:'call-test',opcode:'rtgpu_call',parent:'flag-test',next:'render-test',mutation:{tagName:'mutation',children:[],proccode:mutation.proccode,argumentids:mutation.argumentids,gpu:'true'},inputs:{'buffer-id':{name:'buffer-id',block:'buffer-name'},'tint-id':{name:'tint-id',block:'color-value'}}},
 {id:'buffer-name',opcode:'text',fields:{TEXT:{name:'TEXT',value:'main'}},shadow:true,parent:'call-test'},
 {id:'render-test',opcode:'rtbuffer_render',parent:'call-test',inputs:{NAME:{block:'render-name'}}},
 {id:'render-name',opcode:'text',fields:{TEXT:{name:'TEXT',value:'main'}},shadow:true,parent:'render-test'}
 ];
 for(const b of blocks)target.blocks.createBlock({next:null,parent:null,fields:{},inputs:{},shadow:false,topLevel:false,...b});
 vm.emitWorkspaceUpdate(); await new Promise(r=>setTimeout(r,300)); rt.gpu().resolution(16,16);rt.gpu().add('main');vm.setCompilerOptions({enabled:true});vm.greenFlag();await new Promise(r=>setTimeout(r,800));
 const g=rt.gpu().gl,b=rt.gpu().require('main');rt.gpu().attach(b,b.textures[b.front]);const data=new Float32Array(4);g.readPixels(8,8,1,1,g.RGBA,g.FLOAT,data);
 const gpu={pixel:Array.from(data),error:g.getError(),errors,threads:vm.runtime.threads.length};
 const obj=new TextEncoder().encode('v -1 -1 0\nv 1 -1 0\nv 0 1 0\nf 1 2 3\n');await rt.scene.import('triangle.obj',obj);await rt.scene.add('triangle.obj',{x:0,y:0,z:0},{x:0,y:0,z:0},'XYZ',100,{x:1,y:1,z:1},0);
 const hit=rt.scene.build().trace([0,0,2],[0,0,-1]);const project=JSON.parse(vm.toJSON());
 const savedCount=project.raytracerMedia.length;await vm.loadProject(JSON.stringify(project));const restored=vm.runtime.raytracer.scene.items.map(i=>i.name);
 return {gpu,hit,savedCount,restored};
});console.log(JSON.stringify(result,null,2));assert.equal(result.gpu.errors.length,0);assert.equal(result.gpu.error,0);assert.ok(Math.abs(result.gpu.pixel[0]-.25)<.001);assert.equal(result.hit.distance,2);assert.equal(result.savedCount,1);assert.deepEqual(result.restored,['triangle.obj']);const example=require('../examples/ambient-occlusion.json');
await page.evaluate(async project=>{await window.vm.loadProject(JSON.stringify(project));window.vm.setCompilerOptions({enabled:true});window.vm.greenFlag();},example);
await page.waitForFunction(()=>window.vm.runtime.raytracer.buffers && window.vm.runtime.threads.length===0);
const ao=await page.evaluate(()=>{const r=window.vm.runtime.raytracer,g=r.gpu().gl,b=r.gpu().require('main');r.gpu().attach(b,b.textures[b.front]);const data=new Float32Array(320*240*4);g.readPixels(0,0,320,240,g.RGBA,g.FLOAT,data);let min=1,max=0;for(let i=0;i<data.length;i+=4){min=Math.min(min,data[i]);max=Math.max(max,data[i]);}return {min,max,error:g.getError()};});
console.log('AO render',ao);assert.equal(ao.error,0);assert.ok(ao.max>.8);assert.ok(ao.min<.1);
// Costume upload accepts images and 3D assets together: images become costumes, models go to the scene.
await page.getByRole('tab').nth(1).click();
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
await page.locator('input[type=file][accept*=".obj"]').setInputFiles([
 {name:'upload-texture.png',mimeType:'image/png',buffer:png},
 {name:'upload-model.obj',mimeType:'text/plain',buffer:Buffer.from('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')}]);
await page.waitForFunction(()=>window.vm.runtime.raytracer.scene.items.some(i=>i.name==='upload-model.obj'));
const uploaded=await page.evaluate(()=>({costumes:window.vm.editingTarget.getCostumes().map(c=>c.name),media:window.vm.runtime.raytracer.scene.items.map(i=>i.name)}));
console.log('upload',uploaded);assert.ok(uploaded.costumes.includes('upload-texture'));assert.ok(!uploaded.media.includes('upload-texture.png'));
// Scene assets are listed after costumes with a read-only preview; they can be exported and deleted.
const assetItem=page.locator('[class*=sprite-selector-item_sprite-selector-item]',{hasText:'upload-model.obj'});
await assetItem.waitFor();
assert.match(await assetItem.innerText(),/Model · OBJ/);
await assetItem.click();
await page.locator('[class*=asset-preview_wrapper]').getByText('Read-only',{exact:true}).waitFor();
assert.equal(await page.locator('[class*=asset-preview_model]').count(),1);
await page.waitForTimeout(500);
await page.screenshot({path:process.env.SCREENSHOT || '/tmp/raytracer-running.png'});
const download=page.waitForEvent('download');
await assetItem.click({button:'right'});
await page.locator('.react-contextmenu--visible').getByText('export',{exact:true}).click();
assert.equal((await download).suggestedFilename(),'upload-model.obj');
await assetItem.click({button:'right'});
assert.equal(await page.locator('.react-contextmenu--visible').getByText('duplicate',{exact:true}).count(),0);
await page.locator('.react-contextmenu--visible').getByText('delete',{exact:true}).click();
await page.waitForFunction(()=>!window.vm.runtime.raytracer.scene.items.some(i=>i.name==='upload-model.obj'));
assert.equal(await assetItem.count(),0);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
