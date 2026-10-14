const test = require('node:test'),
    assert = require('node:assert/strict');
const Compiler = require('../scratch-vm/src/raytracer/compiler');
const n = (id, value) => ({
    id,
    opcode: 'math_number',
    fields: {NUM: {value}},
    inputs: {}
});
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
test('compile return vec4 and implicit uv, buffer declarations', () => {
    const b = sample(),
        s = new Compiler().compile(b, b.d).source;
    assert.match(s, /return vec4\(1.0,1.0,1.0,1.0\)/);
    assert.match(s, /kernel\(gl_FragCoord.xy\/resolution\)/);
    assert.match(s, /uniform sampler2D previousBuffer/);
});
test('reject wrong return and unsupported CPU commands', () => {
    const b = sample();
    b.r.inputs.VALUE.block = 'n';
    // Errors name the offending block so the editor can reveal it.
    assert.throws(() => new Compiler().compile(b, b.d), e => e.blockId === 'r' && /needs a vec4, but got a number/.test(e.message));
    b.r.opcode = 'control_wait';
    assert.throws(() => new Compiler().compile(b, b.d), /cannot run inside a GPU block/);
});
test('argument types follow the caller and uv, buffer are implicit', () => {
    const b = sample();
    b.p = prototype('kernel %s %b', ['tint', 'on']);
    b.r.inputs.VALUE.block = 'a';
    b.a = argument('a', 'tint');
    assert.match(new Compiler().compile(b, b.d, ['vec4', 'bool']).source, /uniform vec4 arg0;\nuniform bool arg1;/);
    assert.throws(() => new Compiler().compile(b, b.d, ['float', 'bool']), /needs a vec4, but got a number/);
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
test('hit? is a boolean condition and rejects non-hit values', () => {
    const b = sample();
    b.d.next = 'if';
    b.if = {id: 'if', opcode: 'control_if', inputs: {CONDITION: {block: 'h'}, SUBSTACK: {block: 'r'}}};
    b.h = {id: 'h', opcode: 'rtray_hit', inputs: {RAY: {block: 't'}}};
    // get ray takes a vec3 origin and direction.
    b.t = {id: 't', opcode: 'rtray_trace', inputs: {ORIGIN: {block: 'o'}, DIRECTION: {block: 'o'}}};
    b.o = {id: 'o', opcode: 'rtobject_vec3', inputs: {X: {block: 'n'}, Y: {block: 'n'}, Z: {block: 'n'}}};
    assert.match(new Compiler().compile(b, b.d).source, /if\(\(traceRay\(vec3\(1\.0,1\.0,1\.0\),vec3\(1\.0,1\.0,1\.0\)\)\)\.hit\)/);
    b.t.inputs.DIRECTION.block = 'n';
    assert.throws(() => new Compiler().compile(b, b.d), e => e.blockId === 't' && /needs a vec3, but got a number/.test(e.message));
    b.t.inputs.DIRECTION.block = 'o';
    b.h.inputs.RAY.block = 'n';
    assert.throws(() => new Compiler().compile(b, b.d), e => e.blockId === 'h' && /needs a ray hit/.test(e.message));
});
test('Insert prop sets or appends a vector component', () => {
    const b = sample();
    b.p = prototype('kernel %s', ['focal']);
    b.d.next = 's';
    // set rd to normalize(insert uv z = focal), as in a camera ray setup.
    b.s = {id: 's', opcode: 'data_setvariableto', inputs: {VALUE: {block: 'norm'}}, fields: {VARIABLE: {value: 'rd', id: 'rd'}}, next: 'r'};
    b.norm = {id: 'norm', opcode: 'rtgpu_normalize', inputs: {V: {block: 'i'}}};
    b.i = {id: 'i', opcode: 'rtobject_insert', inputs: {OBJ: {block: 'uv'}, IDX: {block: 'key'}, PROP: {block: 'f'}}};
    b.uv = argument('uv', 'uv');
    b.f = argument('f', 'focal');
    b.key = {id: 'key', opcode: 'text', fields: {TEXT: {value: 'z'}}, inputs: {}};
    assert.match(new Compiler().compile(b, b.d, ['float']).source, /vec3 local0=vec3\(0\);\nlocal0=normalize\(vec3\(uv,arg0\)\);/);
    b.key.fields.TEXT.value = 'g';
    assert.match(new Compiler().compile(b, b.d, ['float']).source, /local0=normalize\(set_y\(uv,arg0\)\);/);
    b.key.fields.TEXT.value = 'w';
    assert.throws(() => new Compiler().compile(b, b.d, ['float']), e => e.blockId === 'i' && /cannot take the key “w”\. Use x, y, z/.test(e.message));
    b.i.inputs.OBJ.block = 'f';
    assert.throws(() => new Compiler().compile(b, b.d, ['float']), /needs a vector, but got a number/);
});
