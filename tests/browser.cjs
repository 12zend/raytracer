const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>console.log('PAGEERROR',e.message));await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:8601'}/editor.html`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.vm?.editingTarget&&window.vm.runtime.raytracer);await page.waitForTimeout(2000);
await page.getByText('GPU',{exact:true}).first().click();
await page.getByText('Make a GPU block',{exact:true}).click();
await page.getByLabel('Block name').fill('UI kernel');
await page.getByRole('button',{name:'Add argument',exact:true}).click();
await page.getByLabel('Argument 1 name').fill('tint');
await page.getByLabel('Argument 1 type').selectOption('vec4');
await page.getByRole('button',{name:'Create GPU definition',exact:true}).click();
await page.waitForFunction(()=>Object.values(window.vm.editingTarget.blocks._blocks).some(b=>b.opcode==='rtgpu_define'&&b.mutation?.name==='UI kernel'));
const result=await page.evaluate(async()=>{
 const vm=window.vm,rt=vm.runtime.raytracer,target=vm.editingTarget;
 const errors=[];vm.runtime.on('RAYTRACER_ERROR',e=>errors.push(e));
 const blocks=[
 {id:'gpu-test',opcode:'rtgpu_define',mutation:{tagName:'mutation',children:[],name:'gradient',params:'[{"name":"gain","type":"float"}]'},next:'return-test',topLevel:true},
 {id:'return-test',opcode:'procedures_return',inputs:{VALUE:{name:'VALUE',block:'color-test',shadow:null}},parent:'gpu-test'},
 {id:'color-test',opcode:'rtobject_vec4',inputs:{X:{block:'gain-test'},Y:{block:'zero-test'},Z:{block:'zero-test'},W:{block:'one-test'}},parent:'return-test'},
 {id:'gain-test',opcode:'rtgpu_argument',fields:{NAME:{name:'NAME',value:'gain'}},parent:'color-test'},
 ...[['zero-test',0],['one-test',1],['gain-value',0.25]].map(([id,value])=>({id,opcode:'math_number',fields:{NUM:{name:'NUM',value:String(value)}},shadow:true,parent:id==='gain-value'?'call-test':'color-test'})),
 {id:'flag-test',opcode:'event_whenflagclicked',topLevel:true,next:'call-test'},
 {id:'call-test',opcode:'rtgpu_call',parent:'flag-test',next:'render-test',mutation:{tagName:'mutation',children:[],name:'gradient',params:'[{"name":"gain","type":"float"}]'},inputs:{BUFFER:{block:'buffer-name'},ARG0:{block:'gain-value'}}},
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
await page.screenshot({path:process.env.SCREENSHOT || '/tmp/raytracer-running.png'});
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
