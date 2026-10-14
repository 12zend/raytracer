const test = require('node:test'),
    assert = require('node:assert/strict');
const Compiler = require('../scratch-vm/src/raytracer/compiler');
const n = (id, value) => ({
    id,
    opcode: 'math_number',
    fields: {NUM: {value}},
    inputs: {}
});
const text = (id, value) => ({id, opcode: 'text', fields: {TEXT: {value}}, inputs: {}});
// GPU definitions are My Blocks definitions whose prototype carries gpu="true".
const prototype = (proccode, names) => ({
    id: 'p',
    opcode: 'procedures_prototype',
    inputs: {},
    mutation: {
        proccode: `${proccode} %s %s`,
        argumentnames: JSON.stringify([...names, 'uv', 'buffer']),
        argumentids: JSON.stringify([...names, 'uv', 'buffer'].map((name, i) => `id${i}`)),
        gpu: 'true'
    }
});
const argument = (id, name, opcode = 'argument_reporter_string_number') => ({
    id,
    opcode,
    fields: {VALUE: {value: name}},
    inputs: {}
});
const block = (id, opcode, inputs = {}, fields = {}, extra = {}) => ({
    id,
    opcode,
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, {name: k, block: v}])),
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'object' ? v : {name: k, value: v}])),
    ...extra
});
const variable = (id, name) => block(id, 'data_variable', {}, {VARIABLE: {value: name, id: name}});
const set = (id, name, value, next) => block(id, 'data_setvariableto', {VALUE: value}, {VARIABLE: {value: name, id: name}}, {next});
const sample = () => ({
    d: {id: 'd', opcode: 'procedures_definition', inputs: {custom_block: {block: 'p'}}, next: 'r'},
    p: prototype('kernel', []),
    r: {id: 'r', opcode: 'procedures_return', inputs: {VALUE: {block: 'v'}}},
    v: {
        id: 'v',
        opcode: 'rtobject_vec4',
        inputs: {
            X: {block: 'n'},
            Y: {block: 'n'},
            Z: {block: 'n'},
            W: {block: 'n'}
        }
    },
    n: n('n', 1)
});
const kernel = source => source.slice(source.indexOf('vec4 kernel'));
// Project access as the runtime provides it: variables by name and CPU-only reporters.
const env = (variables = {}, host = {}) => ({
    variable: field => variables[field.value],
    host: opcode => {
        if (!(opcode in host)) throw new Error(`no ${opcode}`);
        return host[opcode];
    }
});
test('compile return vec4 and implicit uv, buffer declarations', () => {
    const b = sample(),
        s = new Compiler().compile(b, b.d).source;
    assert.match(s, /return vec4\(1.0,1.0,1.0,1.0\)/);
    assert.match(s, /kernel\(gl_FragCoord.xy\/resolution\)/);
    assert.match(s, /uniform sampler2D previousBuffer/);
});
test('reject wrong return and blocks that change the project', () => {
    const b = sample();
    b.r.inputs.VALUE.block = 'v3';
    b.v3 = block('v3', 'rtobject_vec3', {X: 'n', Y: 'n', Z: 'n'});
    // Errors name the offending block so the editor can reveal it.
    assert.throws(() => new Compiler().compile(b, b.d), e => e.blockId === 'r' && /needs a vec4, but got a vec3/.test(e.message));
    b.r.opcode = 'looks_say';
    assert.throws(() => new Compiler().compile(b, b.d), e => e.blockId === 'r' && /changes the project/.test(e.message));
    b.r.opcode = 'some_unknown_block';
    assert.throws(() => new Compiler().compile(b, b.d), /cannot run inside a GPU block/);
});
test('argument types follow the caller and a number fills a vector', () => {
    const b = sample();
    b.p = prototype('kernel %s %b', ['tint', 'on']);
    b.r.inputs.VALUE.block = 'a';
    b.a = argument('a', 'tint');
    assert.match(new Compiler().compile(b, b.d, ['vec4', 'bool']).source, /uniform vec4 arg0;\nuniform bool arg1;/);
    // Scratch passes plain numbers; on the GPU a number fills every component.
    assert.match(new Compiler().compile(b, b.d, ['float', 'bool']).source, /return vec4\(arg0\);/);
    assert.throws(() => new Compiler().compile(b, b.d, ['vec3', 'bool']), /needs a vec4, but got a vec3/);
    assert.throws(() => new Compiler().compile(b, b.d, ['vec4', 'float']), /must be a boolean/);
    b.a = argument('a', 'buffer');
    assert.match(new Compiler().compile(b, b.d, ['vec4', 'bool']).source, /return texture\(previousBuffer,uv\);/);
    b.p.mutation.argumentnames = JSON.stringify(['tint', 'on']);
    assert.throws(() => new Compiler().compile(b, b.d), /lost its uv and buffer inputs/);
});
test('bounded sample loops and cyclic input diagnostic', () => {
    const b = sample();
    b.d.next = 'loop';
    b.loop = {
        id: 'loop',
        opcode: 'control_repeat',
        inputs: {TIMES: {block: 'n'}, SUBSTACK: {block: 'r'}}
    };
    assert.match(new Compiler().compile(b, b.d).source, /count0/);
    b.v.inputs.X.block = 'v';
    assert.throws(() => new Compiler().compile(b, b.d), /plugged into itself/);
});
test('get ray takes vec3 inputs; hit? needs a ray hit', () => {
    const b = sample();
    b.d.next = 'if';
    b.if = {id: 'if', opcode: 'control_if', inputs: {CONDITION: {block: 'h'}, SUBSTACK: {block: 'r'}}};
    b.h = {id: 'h', opcode: 'rtray_hit', inputs: {RAY: {block: 't'}}};
    b.t = {id: 't', opcode: 'rtray_trace', inputs: {ORIGIN: {block: 'n'}, DIRECTION: {block: 'o'}}};
    b.o = {id: 'o', opcode: 'rtobject_vec3', inputs: {X: {block: 'n'}, Y: {block: 'n'}, Z: {block: 'n'}}};
    // origin 1 means (1, 1, 1), like an origin typed as 0 means the world origin.
    assert.match(new Compiler().compile(b, b.d).source, /if\(\(traceRay\(vec3\(1\.0\),vec3\(1\.0,1\.0,1\.0\)\)\)\.hit\)/);
    b.t.inputs.DIRECTION.block = 't2';
    b.t2 = {id: 't2', opcode: 'rtray_trace', inputs: {ORIGIN: {block: 'n'}, DIRECTION: {block: 'n'}}};
    assert.throws(() => new Compiler().compile(b, b.d), e => e.blockId === 't' && /The direction needs a vec3, but got a ray hit/.test(e.message));
    b.t.inputs.DIRECTION.block = 'o';
    b.h.inputs.RAY.block = 'n';
    assert.throws(() => new Compiler().compile(b, b.d), e => e.blockId === 'h' && /needs a ray hit/.test(e.message));
});
test('Insert prop sets or appends a vector component', () => {
    const b = sample();
    b.p = prototype('kernel %s', ['focal']);
    b.d.next = 's';
    // set rd to normalize(insert uv z = focal), as in a camera ray setup.
    b.s = set('s', 'rd', 'norm', 'r');
    b.norm = block('norm', 'rtgpu_normalize', {V: 'i'});
    b.i = block('i', 'rtobject_insert', {OBJ: 'uv', IDX: 'key', PROP: 'f'});
    b.uv = argument('uv', 'uv');
    b.f = argument('f', 'focal');
    b.key = text('key', 'z');
    assert.match(kernel(new Compiler().compile(b, b.d, ['float']).source), /var0=normalize\(vec3\(uv,arg0\)\);/);
    b.key.fields.TEXT.value = 'g';
    assert.match(new Compiler().compile(b, b.d, ['float']).source, /var0=normalize\(set_y\(uv,arg0\)\);/);
    b.key.fields.TEXT.value = 'w';
    assert.throws(() => new Compiler().compile(b, b.d, ['float']), e => e.blockId === 'i' && /cannot take the key “w”\. Use x, y, z/.test(e.message));
    b.i.inputs.OBJ.block = 'f';
    assert.throws(() => new Compiler().compile(b, b.d, ['float']), /needs a vector, but got a number/);
});
test('variables start each pixel with their CPU value and keep the type set on the GPU', () => {
    const b = sample();
    // set rd to (rd + 1); set ray to get ray (1) (rd); return (count)
    b.d.next = 's1';
    b.s1 = set('s1', 'rd', 'add', 's2');
    b.add = block('add', 'operator_add', {NUM1: 'rdv', NUM2: 'n'});
    b.rdv = variable('rdv', 'rd');
    b.s2 = set('s2', 'ray', 't', 'r');
    b.t = block('t', 'rtray_trace', {ORIGIN: 'n', DIRECTION: 'rdv2'});
    b.rdv2 = variable('rdv2', 'rd');
    b.r.inputs.VALUE.block = 'cv';
    b.cv = variable('cv', 'count');
    const compiled = new Compiler().compile(b, b.d, [], env({rd: {x: 0, y: 0, z: -1}, ray: 0, count: '3'}));
    const s = compiled.source;
    assert.match(s, /uniform vec3 host0;\nuniform float host1;\nuniform float host2;/);
    assert.match(kernel(s), /var0=host0;\nvar1=Hit\(false.*\);\nvar2=host2;\nvar0=\(var0\+1\.0\);\nvar1=traceRay\(vec3\(1\.0\),var0\);\nreturn vec4\(var2\);/);
    assert.equal(compiled.signature, 'vec3|float|float');
    // The runtime samples the values every call and recompiles when a type changes.
    const now = Compiler.sample(compiled, env({rd: {x: 1, y: 2, z: 3}, ray: 0, count: 7}));
    assert.equal(now.signature, compiled.signature);
    assert.deepEqual(Compiler.uniforms(compiled, now.values), {
        host0: {type: 'vec3', value: {x: 1, y: 2, z: 3}},
        host1: {type: 'float', value: 0},
        host2: {type: 'float', value: 7}
    });
    assert.equal(Compiler.sample(compiled, env({rd: 0, ray: 0, count: 7})).signature, 'float|float|float');
    // Setting a vector variable to a number fills it; a vector cannot go into a number variable.
    b.s1.inputs.VALUE.block = 'o';
    b.o = block('o', 'rtobject_vec3', {X: 'n', Y: 'n', Z: 'n'});
    assert.match(new Compiler().compile(b, b.d, [], env({rd: 0})).source, /var0=vec3\(host0\);\n/);
    b.s1.inputs.VALUE.block = 'n';
    b.s2.inputs.VALUE.block = 'v';
    b.s2.fields.VARIABLE = {value: 'count', id: 'count'};
    b.r.inputs.VALUE.block = 'v';
    assert.match(kernel(new Compiler().compile(b, b.d, [], env({count: 1})).source), /var0=host0;\nvar1=vec4\(host1\);\nvar0=1\.0;\nvar1=vec4\(1\.0,1\.0,1\.0,1\.0\);/);
    b.s1.fields.VARIABLE = {value: 'count', id: 'count'};
    assert.throws(() => new Compiler().compile(b, b.d, [], env({count: 1})), e => e.blockId === 's2' && /“count” needs a number, but got a vec4/.test(e.message));
});
test('text variables compile in as constants, so comparisons follow Scratch', () => {
    const b = sample();
    b.d.next = 'if';
    b.if = block('if', 'control_if_else', {CONDITION: 'eq', SUBSTACK: 'r', SUBSTACK2: 'r2'});
    b.eq = block('eq', 'operator_equals', {OPERAND1: 'mode', OPERAND2: 'yes'});
    b.mode = variable('mode', 'mode');
    b.yes = text('yes', 'YES');
    b.r2 = block('r2', 'procedures_return', {VALUE: 'zero'});
    b.zero = n('zero', 0);
    const compiled = new Compiler().compile(b, b.d, [], env({mode: 'yes'}));
    assert.match(kernel(compiled.source), /if\(true\)/);
    assert.equal(compiled.signature, 'string:yes');
    assert.equal(Compiler.sample(compiled, env({mode: 'no'})).signature, 'string:no');
    assert.match(kernel(new Compiler().compile(b, b.d, [], env({mode: 'no'})).source), /if\(false\)/);
    // A computed number is never equal to text like "YES"; ordering it against text is an error.
    b.mode = variable('mode', 'count');
    assert.match(kernel(new Compiler().compile(b, b.d, [], env({count: 2})).source), /if\(false\)/);
    b.eq.opcode = 'operator_lt';
    assert.throws(() => new Compiler().compile(b, b.d, [], env({count: 2})), /cannot be compared with the text “YES”/);
});
test('operators fold typed-in values with Scratch semantics', () => {
    const b = sample();
    const fold = (opcode, inputs, fields = {}, types = []) => {
        b.op = block('op', opcode, inputs, fields);
        b.v.inputs.X.block = 'op';
        const s = kernel(new Compiler().compile(b, b.d, types).source);
        return s.slice(s.indexOf('return vec4(') + 12, s.indexOf(',1.0,1.0,1.0)'));
    };
    b.a = text('a', '1');
    b.b = text('b', '2');
    b.t = text('t', 'abc');
    b.up = text('up', 'ABC');
    b.neg = n('neg', -3);
    b.num = text('num', '531');
    b.dec = text('dec', '2.0');
    assert.equal(fold('operator_join', {STRING1: 'a', STRING2: 'b'}), '12.0');
    assert.equal(fold('operator_add', {NUM1: 't', NUM2: 'b'}), '2.0');
    assert.equal(fold('operator_length', {STRING: 't'}), '3.0');
    assert.equal(fold('operator_mod', {NUM1: 'neg', NUM2: 'b'}), '1.0');
    assert.equal(fold('operator_mathop', {NUM: 'b'}, {OPERATOR: '10 ^'}), '100.0');
    assert.equal(fold('operator_equals', {OPERAND1: 't', OPERAND2: 'up'}), '1.0');
    assert.equal(fold('operator_letter_of', {LETTER: 'b', STRING: 'num'}), '3.0');
    // pick random: whole numbers stay whole, a decimal point makes it decimal, computed values decide at run time.
    assert.equal(fold('operator_random', {FROM: 'a', TO: 'b'}), 'randomBetween(1.0,2.0,1)');
    assert.equal(fold('operator_random', {FROM: 'a', TO: 'dec'}), 'randomBetween(1.0,2.0,0)');
    b.p = prototype('kernel %s', ['x']);
    b.x = argument('x', 'x');
    assert.equal(fold('operator_random', {FROM: 'a', TO: 'x'}, {}, ['float']), 'randomBetween(1.0,arg0,2)');
    // Join needs typed-in text on the GPU.
    assert.throws(() => fold('operator_join', {STRING1: 'x', STRING2: 'b'}, {}, ['float']), /only works with text typed into it/);
});
test('vector math and comparisons', () => {
    const b = sample();
    b.p = prototype('kernel %s', ['c']);
    b.c = argument('c', 'c');
    b.r.inputs.VALUE.block = 'op';
    b.op = block('op', 'operator_mathop', {NUM: 'c'}, {OPERATOR: 'floor'});
    assert.match(new Compiler().compile(b, b.d, ['vec4']).source, /return floor\(arg0\);/);
    b.op = block('op', 'operator_mod', {NUM1: 'n', NUM2: 'c'});
    assert.match(new Compiler().compile(b, b.d, ['vec4']).source, /return mod\(vec4\(1\.0\),arg0\);/);
    b.r.inputs.VALUE.block = 'v';
    b.v.inputs.X.block = 'eq';
    b.eq = block('eq', 'operator_equals', {OPERAND1: 'c', OPERAND2: 'c'});
    assert.match(new Compiler().compile(b, b.d, ['vec4']).source, /vec4\(\(all\(equal\(arg0,arg0\)\)\?1\.0:0\.0\)/);
    b.eq.opcode = 'operator_lt';
    assert.throws(() => new Compiler().compile(b, b.d, ['vec4']), /needs a number, but got a vec4/);
});
test('repeat until, while, forever, for each, stop and wait', () => {
    const b = sample();
    const loop = (opcode, inputs = {}, fields = {}, stop = 'this script') => {
        b.d.next = 'l';
        b.l = block('l', opcode, {SUBSTACK: 'w', ...inputs}, fields, {next: 'r'});
        b.w = block('w', 'control_wait', {DURATION: 'n'}, {}, {next: 'st'});
        b.st = block('st', 'control_stop', {}, {STOP_OPTION: stop});
        return kernel(new Compiler().compile(b, b.d).source);
    };
    b.lt = block('lt', 'operator_lt', {OPERAND1: 'n', OPERAND2: 'x'});
    b.x = variable('x', 'x');
    assert.match(loop('control_repeat_until', {CONDITION: 'lt'}), /for\(int loop1=0,count1=100000;loop1<count1;loop1\+\+\)\{\nif\(\(1\.0<var0\)\)break;\nreturn vec4\(0\);\n\}/);
    assert.match(loop('control_while', {CONDITION: 'lt'}), /if\(!\(1\.0<var0\)\)break;/);
    assert.match(loop('control_forever'), /count0=100000;loop0<count0;loop0\+\+\)\{\nreturn vec4\(0\);/);
    assert.match(loop('control_for_each', {VALUE: 'n'}, {VARIABLE: {value: 'i', id: 'i'}}), /var0=host0;\nfor\(int loop1=0,count1=int\(clamp\(ceil\(1\.0\),0\.0,100000\.0\)\);loop1<count1;loop1\+\+\)\{\nvar0=float\(loop1\+1\);/);
    assert.throws(() => loop('control_forever', {}, {}, 'all'), e => e.blockId === 'st' && /stop all/.test(e.message));
});
test('custom blocks compile to GLSL functions per argument type', () => {
    const b = sample();
    const define = (id, proccode, names, next, reporter) => {
        b[`${id}p`] = {id: `${id}p`, opcode: 'procedures_prototype', inputs: {}, mutation: {
            proccode, argumentnames: JSON.stringify(names), argumentids: JSON.stringify(names.map(x => `${id}${x}`)), return: reporter ? '1' : '0'
        }};
        b[id] = {id, opcode: 'procedures_definition', inputs: {custom_block: {block: `${id}p`}}, next};
    };
    const call = (id, proccode, args, reporter, next) => block(id, 'procedures_call', args, {}, {
        mutation: {proccode, return: reporter ? '1' : '0'}, next
    });
    // shade (k) reports k * 2; bump changes a variable shared with the GPU block.
    define('shade', 'shade %s', ['k'], 'sr', true);
    b.sr = block('sr', 'procedures_return', {VALUE: 'mul'});
    b.mul = block('mul', 'operator_multiply', {NUM1: 'ka', NUM2: 'two'});
    b.ka = argument('ka', 'k');
    b.two = n('two', 2);
    define('bump', 'bump', [], 'bs', false);
    b.bs = set('bs', 'total', 'two');
    b.d.next = 'cb';
    b.cb = call('cb', 'bump', {}, false, 'r');
    b.r.inputs.VALUE.block = 'cs';
    b.cs = call('cs', 'shade %s', {shadek: 'v'}, true);
    let s = new Compiler().compile(b, b.d).source;
    assert.match(s, /uniform float host0;\nfloat var\d+;/);
    assert.match(s, /void (proc0_\d+)\(\)\{\nvar\d+=2\.0;\n\}/);
    assert.match(s, /vec4 proc1_\d+\(vec4 p0\)\{\nreturn \(p0\*2\.0\);\nreturn vec4\(0\);\n\}/);
    assert.match(kernel(s), /proc0_\d+\(\);\nreturn proc1_\d+\(vec4\(1\.0,1\.0,1\.0,1\.0\)\);/);
    // A text argument is compiled in, so the custom block can fold it.
    b.cs.inputs.shadek.block = 'txt';
    b.txt = text('txt', 'abc');
    s = new Compiler().compile(b, b.d).source;
    assert.match(s, /float proc1_\d+\(\)\{\nreturn 0\.0;/);
    assert.match(kernel(s), /return vec4\(proc1_\d+\(\)\);/);
    // Custom blocks cannot call themselves on the GPU.
    b.sr.inputs.VALUE.block = 'again';
    b.again = call('again', 'shade %s', {shadek: 'ka'}, true);
    assert.throws(() => new Compiler().compile(b, b.d), e => e.blockId === 'again' && /uses itself/.test(e.message));
    b.cs.mutation.proccode = 'missing';
    assert.throws(() => new Compiler().compile(b, b.d), /definition of “missing” is missing/);
});
test('sensing and motion reporters are read on the CPU for every call', () => {
    const b = sample();
    b.v.inputs.X.block = 'timer';
    b.v.inputs.Y.block = 'down';
    b.v.inputs.Z.block = 'key';
    b.timer = block('timer', 'sensing_timer');
    b.down = block('down', 'sensing_mousedown');
    b.key = block('key', 'sensing_keypressed', {KEY_OPTION: 'menu'});
    b.menu = block('menu', 'sensing_keyoptions', {}, {KEY_OPTION: 'space'}, {shadow: true});
    const compiled = new Compiler().compile(b, b.d, [], env({}, {sensing_timer: 1.5, sensing_mousedown: true, sensing_keypressed: false}));
    assert.match(compiled.source, /uniform float host0;\nuniform bool host1;\nuniform bool host2;/);
    assert.match(compiled.source, /return vec4\(host0,\(host1\?1\.0:0\.0\),\(host2\?1\.0:0\.0\),1\.0\);/);
    assert.deepEqual(compiled.slots[2].args, {KEY_OPTION: 'space'});
    // Text answers (costume names) are compiled in; a GPU block needs the editor to read them.
    b.v.inputs.X.block = 'name';
    b.name = block('name', 'looks_costumenumbername', {}, {NUMBER_NAME: 'name'});
    assert.match(new Compiler().compile(b, b.d, [], env({}, {looks_costumenumbername: 'cat', sensing_mousedown: true, sensing_keypressed: false})).signature, /^string:cat\|/);
    assert.throws(() => new Compiler().compile(b, b.d), e => e.blockId === 'name' && /only run in the editor/.test(e.message));
    // A ray hit read from a variable is passed as a struct.
    const hit = {hit: true, hit_position: {x: 1, y: 2, z: 3}, normal: {x: 0, y: 1, z: 0}, diffuse: {x: 1, y: 1, z: 1, w: 1}, distance: 2, object_id: 0};
    b.r.inputs.VALUE.block = 'hv';
    b.hv = block('hv', 'rtobject_get', {OBJ: 'hitvar', PROP: 'prop'});
    b.hitvar = variable('hitvar', 'hit');
    b.prop = text('prop', 'diffuse');
    const withHit = new Compiler().compile(b, b.d, [], env({hit}));
    assert.match(withHit.source, /uniform Hit host0;/);
    assert.equal(Compiler.uniforms(withHit, [hit])['host0.hit_position'].type, 'vec3');
});
test('lists: read-only lists are textures, changed lists are copied per pixel', () => {
    const b = sample();
    const list = name => ({LIST: {value: name, id: name}});
    const listEnv = lists => ({variable: () => 0, list: field => lists[field.value], host: () => 0});
    // return vec4 (item (last) of xs) (length of xs) (item # of 2 in xs) 1
    b.v.inputs.X.block = 'item';
    b.item = block('item', 'data_itemoflist', {INDEX: 'last'}, list('xs'));
    b.last = text('last', 'last');
    b.v.inputs.Y.block = 'len';
    b.len = block('len', 'data_lengthoflist', {}, list('xs'));
    b.v.inputs.Z.block = 'find';
    b.find = block('find', 'data_itemnumoflist', {ITEM: 'two'}, list('xs'));
    b.two = n('two', 2);
    const compiled = new Compiler().compile(b, b.d, [], listEnv({xs: [1, '2', 'abc']}));
    assert.match(compiled.source, /uniform sampler2D host0;\nuniform int host0_length;/);
    assert.match(compiled.source, /return vec4\(host0_get\(float\(host0_length\)\),float\(host0_length\),host0_find\(2\.0\),1\.0\);/);
    const u = Compiler.uniforms(compiled, [[1, '2', 'abc', 4, 5]]);
    assert.deepEqual(Array.from(u.host0.value), [1, 2, 0, 4, 5, 0, 0, 0]);
    assert.deepEqual([u.host0.width, u.host0.height, u.host0_length.value], [2, 1, 5]);
    // Changing the list (here inside a custom block) makes it a per-pixel array sized by the CPU list.
    b.d.next = 'add';
    b.add = block('add', 'data_addtolist', {ITEM: 'two'}, list('xs'), {next: 'ins'});
    b.ins = block('ins', 'data_insertatlist', {ITEM: 'two', INDEX: 'rnd'}, list('xs'), {next: 'del'});
    b.rnd = text('rnd', 'random');
    b.all = text('all', 'all');
    b.del = block('del', 'data_deleteoflist', {INDEX: 'all'}, list('xs'), {next: 'r'});
    const changed = new Compiler().compile(b, b.d, [], listEnv({xs: [1, 2]})).source;
    assert.match(changed, /float host0_items\[256\];int host0_count;/);
    assert.match(kernel(changed), /host0_count=min\(host0_length,256\);for\(int i=0;i<host0_count;i\+\+\)host0_items\[i\]=host0_item\(i\);\nhost0_add\(2\.0\);\nhost0_insert\(\(floor\(randomFloat\(\)\*float\(host0_count\+1\)\)\+1\.0\),2\.0\);\nhost0_count=0;/);
    assert.match(new Compiler().compile(b, b.d, [], listEnv({xs: new Array(300).fill(0)})).source, /float host0_items\[1024\]/);
    assert.equal(new Compiler().compile(b, b.d, [], listEnv({xs: new Array(300).fill(0)})).signature, 'list:1024');
    assert.throws(() => new Compiler().compile(b, b.d, [], listEnv({xs: new Array(2000).fill(0)})), e => e.blockId === 'add' && /more than 1024 items/.test(e.message));
    b.r.inputs.VALUE.block = 'contents';
    b.contents = block('contents', 'data_listcontents', {}, list('xs'));
    assert.throws(() => new Compiler().compile(b, b.d, [], listEnv({xs: []})), /contents are text/);
});
