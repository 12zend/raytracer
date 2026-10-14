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
    assert.throws(() => new Compiler().compile(b, b.d), /Expected vec4/);
    b.r.opcode = 'control_wait';
    assert.throws(() => new Compiler().compile(b, b.d), /Unsupported command/);
});
test('argument types follow the caller and uv, buffer are implicit', () => {
    const b = sample();
    b.p = prototype('kernel %s %b', ['tint', 'on']);
    b.r.inputs.VALUE.block = 'a';
    b.a = argument('a', 'tint');
    assert.match(new Compiler().compile(b, b.d, ['vec4', 'bool']).source, /uniform vec4 arg0;\nuniform bool arg1;/);
    assert.throws(() => new Compiler().compile(b, b.d, ['float', 'bool']), /Expected vec4, got float/);
    assert.throws(() => new Compiler().compile(b, b.d, ['vec4', 'float']), /must be boolean/);
    b.a = argument('a', 'buffer');
    assert.match(new Compiler().compile(b, b.d, ['vec4', 'bool']).source, /return texture\(previousBuffer,uv\);/);
    b.p.mutation.argumentnames = JSON.stringify(['tint', 'on']);
    assert.throws(() => new Compiler().compile(b, b.d), /implicit uv and buffer/);
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
    assert.throws(() => new Compiler().compile(b, b.d), /Cyclic expression/);
});
