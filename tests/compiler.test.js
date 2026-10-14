const test = require('node:test'),
    assert = require('node:assert/strict');
const Compiler = require('../scratch-vm/src/raytracer/compiler');
const n = (id, value) => ({
    id,
    opcode: 'math_number',
    fields: {NUM: {value}},
    inputs: {}
});
const sample = () => ({
    d: {id: 'd', opcode: 'rtgpu_define', mutation: {params: '[]'}, next: 'r'},
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
test('typed uniform parameters', () => {
    const b = sample();
    b.d.mutation.params = JSON.stringify([{name: 'tint', type: 'vec4'}]);
    b.r.inputs.VALUE.block = 'a';
    b.a = {
        id: 'a',
        opcode: 'rtgpu_argument',
        fields: {NAME: {value: 'tint'}},
        inputs: {}
    };
    assert.match(new Compiler().compile(b, b.d).source, /uniform vec4 arg0/);
    b.d.mutation.params = JSON.stringify([{name: 'uv', type: 'vec2'}]);
    assert.throws(
        () => new Compiler().compile(b, b.d),
        /Invalid GPU parameter/
    );
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
