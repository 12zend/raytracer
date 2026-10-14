const fs=require('node:fs');
const JSZip=require('../scratch-vm/node_modules/@turbowarp/jszip');
const crypto=require('node:crypto');
let serial=0;const blocks={};
const block=(opcode,inputs={},fields={},extra={})=>{const id=`b${++serial}`;blocks[id]={opcode,next:null,parent:null,inputs:Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,{name:k,block:v,shadow:null}])),fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,{name:k,value:v}])),shadow:false,topLevel:false,...extra};for(const v of Object.values(inputs))if(v)blocks[v].parent=id;return id;};
const n=value=>block('math_number',{}, {NUM:String(value)},{shadow:true});
const text=value=>block('text',{}, {TEXT:value},{shadow:true});
const v=(...values)=>block(`rtobject_vec${values.length}`,Object.fromEntries(values.map((v,i)=>[['X','Y','Z','W'][i],typeof v==='number'?n(v):v])));
const prop=(o,k)=>block('rtobject_get',{OBJ:o,PROP:text(k)});
const op=(name,a,b)=>block(`operator_${name}`,{NUM1:typeof a==='number'?n(a):a,NUM2:typeof b==='number'?n(b):b});
const variable=name=>block('data_variable',{}, {VARIABLE:name});
const set=(name,value)=>block('data_setvariableto',{VALUE:value},{VARIABLE:name});
const chain=(...ids)=>{for(let i=1;i<ids.length;i++){blocks[ids[i-1]].next=ids[i];blocks[ids[i]].parent=ids[i-1];}return ids[0];};
const trace=(origin,direction)=>block('rtray_trace',{ORIGIN:variable(origin),DIRECTION:variable(direction)});
const random=()=>block('operator_random',{FROM:n(-1),TO:n(1)});
const ret=color=>block('procedures_return',{VALUE:color});
const normalized=a=>block('rtgpu_normalize',{V:a});
// GPU definition = My Blocks definition whose prototype has gpu="true"; uv and buffer are implicit last inputs.
const gpuMutation={tagName:'mutation',children:[],proccode:'Ambient occlusion %s %s',argumentids:JSON.stringify(['ao-uv','ao-buffer']),argumentnames:JSON.stringify(['uv','buffer']),argumentdefaults:JSON.stringify(['','']),warp:'false',gpu:'true'};
const argument=name=>block('argument_reporter_string_number',{}, {VALUE:name},{shadow:true});
const prototype=block('procedures_prototype',{'ao-uv':argument('uv'),'ao-buffer':argument('buffer')},{},{shadow:true,mutation:gpuMutation});
const uv=k=>prop(block('argument_reporter_string_number',{}, {VALUE:'uv'}),k);
const definition=block('procedures_definition',{custom_block:prototype},{},{topLevel:true,x:400,y:40});
const primary=chain(set('origin',v(0,1,3)),set('direction',normalized(v(op('multiply',op('subtract',uv('x'),.5),1.33333),op('subtract',uv('y'),.5),-1))),set('hit',trace('origin','direction')));
blocks[definition].next=primary;blocks[primary].parent=definition;
const hemisphere=block('control_if',{CONDITION:block('operator_lt',{OPERAND1:block('rtgpu_dot',{A:variable('bounce'),B:prop(variable('hit'),'normal')}),OPERAND2:n(0)}),SUBSTACK:set('bounce',op('multiply',variable('bounce'),-1))});
const sample=chain(set('bounce',normalized(v(random(),random(),random()))),hemisphere,set('secondary',trace('point','bounce')),block('control_if',{CONDITION:block('operator_not',{OPERAND:block('rtray_hit',{RAY:variable('secondary')})}),SUBSTACK:block('data_changevariableby',{VALUE:n(1)},{VARIABLE:'visible'})}));
const visible=()=>op('divide',variable('visible'),10);
const shade=chain(set('point',op('add',prop(variable('hit'),'hit_position'),op('multiply',prop(variable('hit'),'normal'),.001))),set('visible',n(0)),block('control_repeat',{TIMES:n(10),SUBSTACK:sample}),ret(v(visible(),visible(),visible(),1)));
const branch=block('control_if_else',{CONDITION:block('rtray_hit',{RAY:variable('hit')}),SUBSTACK:shade,SUBSTACK2:ret(v(.025,.035,.05,1))});
let last=primary;while(blocks[last].next)last=blocks[last].next;blocks[last].next=branch;blocks[branch].parent=last;
const flag=block('event_whenflagclicked',{}, {},{topLevel:true,x:20,y:40});
chain(flag,block('rtbuffer_resolution',{W:n(320),H:n(240)}),block('rtbuffer_add',{NAME:text('main')}),block('rt3d_clear'),block('rt3d_add',{MEDIA:text('scene.obj'),POS:v(0,0,0),ROTATION:v(0,0,0),ORDER:text('XYZ'),SIZE:n(100),SCALE:v(1,1,1),FRAME:n(0)}),block('rtgpu_call',{'ao-buffer':text('main')},{},{mutation:{tagName:'mutation',children:[],proccode:gpuMutation.proccode,argumentids:gpuMutation.argumentids,gpu:'true'}}),block('rtbuffer_render',{NAME:text('main')}));
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#101018"/></svg>';
const assetId=crypto.createHash('md5').update(svg).digest('hex');
const obj='v -5 0 -5\nv 5 0 -5\nv 5 0 5\nv -5 0 5\nv -0.7 0 -0.7\nv 0.7 0 -0.7\nv 0.7 0 0.7\nv -0.7 0 0.7\nv 0 1.5 0\nf 1 4 3 2\nf 5 9 6\nf 6 9 7\nf 7 9 8\nf 8 9 5\n';
const names=['origin','direction','hit','point','visible','bounce','secondary'];
const project={targets:[{isStage:true,name:'Stage',variables:Object.fromEntries(names.map(k=>[k,[k,0]])),lists:{},broadcasts:{},blocks:null,comments:{},currentCostume:0,costumes:[{assetId,name:'background',md5ext:assetId+'.svg',dataFormat:'svg',rotationCenterX:240,rotationCenterY:180}],sounds:[],volume:100,layerOrder:0,tempo:60,videoTransparency:50,videoState:'off',textToSpeechLanguage:null}],monitors:[],extensions:['rtobject','rt3d','rtray','rtbuffer','rtgpu'],meta:{semver:'3.0.0',vm:'0.2.0-raytracer',agent:'Raytracer'},raytracerMedia:[{id:'example-scene',name:'scene.obj',format:'obj',data:Buffer.from(obj).toString('base64')}]};
// Variable fields must carry stable IDs for CPU and GPU compilers.
for(const b of Object.values(blocks))if(b.fields.VARIABLE)b.fields.VARIABLE.id=b.fields.VARIABLE.value;
const GPUCompiler=require('../scratch-vm/src/raytracer/compiler');new GPUCompiler().compile(blocks,{id:definition,...blocks[definition]});
// sb3 stores inputs as [1, blockId] and fields as [value] or [name, id].
project.targets[0].blocks=Object.fromEntries(Object.entries(blocks).map(([id,b])=>[id,{...b,
 inputs:Object.fromEntries(Object.entries(b.inputs).map(([k,v])=>[k,[1,v.block]])),
 fields:Object.fromEntries(Object.entries(b.fields).map(([k,v])=>[k,v.id?[v.value,v.id]:[v.value]]))}]));
fs.writeFileSync('examples/ambient-occlusion.json',JSON.stringify(project,null,2)+'\n');
const zip=new JSZip();zip.file('project.json',JSON.stringify(project));zip.file(assetId+'.svg',svg);zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}).then(data=>fs.writeFileSync('examples/ambient-occlusion.sb3',data));
