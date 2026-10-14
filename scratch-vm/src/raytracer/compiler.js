const library = require('./shader');
const {RaytracerError, typeName} = require('./errors');
const TYPES = ['float', 'bool', 'vec2', 'vec3', 'vec4'];
const IMPLICIT = ['uv', 'buffer'];
/**
 * Read a GPU definition: a procedures_definition whose prototype has gpu="true".
 * The last two arguments are the implicit uv and buffer.
 * @param {object} blocks Block container or plain map.
 * @param {object} definition procedures_definition block.
 * @returns {{prototype: object, names: string[], ids: string[], kinds: string[]}} Argument layout.
 */
const readDefinition = (blocks, definition) => {
    const get = id => (blocks.getBlock ? blocks.getBlock(id) : blocks[id]);
    const input = definition.inputs && definition.inputs.custom_block;
    const prototype = input && get(input.block);
    const mutation = prototype && prototype.mutation;
    if (!mutation || String(mutation.gpu) !== 'true') throw new RaytracerError('This is not a GPU block definition.');
    const names = JSON.parse(mutation.argumentnames || '[]');
    const ids = JSON.parse(mutation.argumentids || '[]');
    const kinds = (mutation.proccode.match(/(^|[^\\])%[nbs]/g) || []).map(m => m.slice(-1));
    if (names.slice(-2).join() !== IMPLICIT.join() || ids.length !== names.length || kinds.length !== names.length) {
        throw new RaytracerError('This GPU block lost its uv and buffer inputs. Create it again with “Make a GPU block”.', definition.id);
    }
    return {
        prototype,
        names: names.slice(0, -2),
        ids: ids.slice(0, -2),
        kinds: kinds.slice(0, -2),
        bufferId: ids[ids.length - 1]
    };
};
class GPUCompiler {
    /**
     * @param {object} blocks Block container or plain map.
     * @param {object} definition procedures_definition block.
     * @param {string[]} types GLSL type of each user argument, decided by the caller's values.
     * @returns {{params: object[], source: string}} Uniform layout and fragment shader.
     */
    compile (blocks, definition, types = []) {
        this.blocks = blocks;
        this.vars = new Map();
        this.params = new Map();
        this.serial = 0;
        this.visiting = new Set();
        const layout = readDefinition(blocks, definition);
        const params = layout.names.map((name, i) => ({name, type: types[i] || 'float'}));
        params.forEach((p, i) => {
            if (!TYPES.includes(p.type) || this.params.has(p.name) || IMPLICIT.includes(p.name)) {
                throw new RaytracerError(`Input “${p.name}” cannot be used on the GPU. Rename it, or pass a number or vector.`, definition.id);
            }
            if ((layout.kinds[i] === 'b') !== (p.type === 'bool')) {
                throw new RaytracerError(`Input “${p.name}” must be ${layout.kinds[i] === 'b' ? 'a boolean' : 'a number or vector'}.`, definition.id);
            }
            this.params.set(p.name, {type: p.type, code: `arg${i}`});
        });
        const body = this.stack(definition.next);
        const declarations = Array.from(this.vars.values())
            .map(
                v =>
                    `${v.type} ${v.code}=${v.type === 'Hit' ? 'Hit(false,vec3(0),vec3(0),vec4(0),-1.0,-1.0)' : `${v.type}(0)`};`
            )
            .join('\n');
        return {
            params,
            source: `#version 300 es\nprecision highp float;precision highp int;\n${library}\n${params.map((p, i) => `uniform ${p.type} arg${i};`).join('\n')}\nout vec4 fragmentColor;\nvec4 kernel(vec2 uv){\n${declarations}\n${body}\nreturn vec4(0);\n}\nvoid main(){seed=sampleSeed;fragmentColor=kernel(gl_FragCoord.xy/resolution);}`
        };
    }
    block (id) {
        const b = this.blocks.getBlock ?
            this.blocks.getBlock(id) :
            this.blocks[id];
        if (!b) throw new RaytracerError('A block inside this GPU block is missing. Try reloading the project.');
        return b;
    }
    error (b, message) {
        throw new RaytracerError(message, b.id);
    }
    input (b, name) {
        const i = b.inputs[name];
        return i && i.block ? this.expr(i.block) : {type: 'float', code: '0.0'};
    }
    require (v, type, b) {
        if (v.type !== type) this.error(b, `This input needs ${typeName(type)}, but got ${typeName(v.type)}.`);
        return v.code;
    }
    expr (id) {
        const b = this.block(id);
        if (this.visiting.has(id)) this.error(b, 'This block is plugged into itself.');
        this.visiting.add(id);
        try {
            return this.expression(b);
        } finally {
            this.visiting.delete(id);
        }
    }
    expression (b) {
        const op = b.opcode;
        const field = k => b.fields[k] && b.fields[k].value;
        const input = k => this.input(b, k);
        const result = (type, code) => ({type, code});
        if (op.startsWith('math_') || op === 'text') {
            const n = Number(field(op === 'text' ? 'TEXT' : 'NUM'));
            if (!Number.isFinite(n)) {
                this.error(b, `“${field(op === 'text' ? 'TEXT' : 'NUM')}” is not a number. GPU blocks only work with numbers, booleans and vectors.`);
            }
            return result('float', Number.isInteger(n) ? `${n}.0` : String(n));
        }
        if (op === 'argument_reporter_string_number' || op === 'argument_reporter_boolean') {
            const name = field('VALUE');
            if (name === 'uv') return result('vec2', 'uv');
            if (name === 'buffer') {
                return result('vec4', 'texture(previousBuffer,uv)');
            }
            if (!this.params.has(name)) {
                this.error(b, `“${name}” is not an input of this GPU block.`);
            }
            return this.params.get(name);
        }
        if (op === 'data_variable') {
            const key = b.fields.VARIABLE.id || field('VARIABLE');
            if (!this.vars.has(key)) {
                this.error(b, `Set “${field('VARIABLE')}” before using it in a GPU block.`);
            }
            return this.vars.get(key);
        }
        if (/^rtobject_vec[234]$/.test(op)) {
            const n = Number(op.slice(-1));
            return result(
                `vec${n}`,
                `vec${n}(${['X', 'Y', 'Z', 'W']
                    .slice(0, n)
                    .map(k => this.require(input(k), 'float', b))
                    .join(',')})`
            );
        }
        if (op === 'rtobject_get') {
            const v = input('OBJ');
            const p = this.block(b.inputs.PROP.block);
            const key = String((p.fields.TEXT || {}).value || '');
            const aliases = {
                r: 'x',
                g: 'y',
                b: 'z',
                a: 'w',
                position: 'hit_position'
            };
            const prop = aliases[key] || key;
            const fields =
                v.type === 'Hit' ?
                    {
                        hit: 'bool',
                        hit_position: 'vec3',
                        normal: 'vec3',
                        diffuse: 'vec4',
                        distance: 'float',
                        object_id: 'float'
                    } :
                    Object.fromEntries(
                        ['x', 'y', 'z', 'w']
                            .slice(0, Number(v.type.slice(3)))
                            .map(k => [k, 'float'])
                    );
            if (!fields[prop]) {
                this.error(b, `${typeName(v.type).replace(/^a/, 'A')} has no property “${key}”. Available: ${Object.keys(fields).join(', ')}.`);
            }
            return result(fields[prop], `(${v.code}).${prop}`);
        }
        if (op === 'rtobject_insert') {
            // On the GPU only vectors can take a new property: a component key sets that component,
            // and the key right after the last one (z for a vec2) makes a longer vector.
            const v = input('OBJ');
            const value = this.require(input('PROP'), 'float', b);
            const p = this.block(b.inputs.IDX.block);
            const key = String((p.fields.TEXT || {}).value || '');
            const keys = ['x', 'y', 'z', 'w'];
            const k = keys.indexOf({r: 'x', g: 'y', b: 'z', a: 'w'}[key] || key);
            const n = /^vec[234]$/.test(v.type) ? Number(v.type.slice(3)) : 0;
            if (!n) this.error(b, `On the GPU, Insert prop needs a vector, but got ${typeName(v.type)}.`);
            if (k < 0 || k > n || k === 4) {
                this.error(b, `${typeName(v.type).replace(/^a/, 'A')} cannot take the key “${key}”. Use ${keys.slice(0, Math.min(n + 1, 4)).join(', ')}.`);
            }
            return k === n ?
                result(`vec${n + 1}`, `vec${n + 1}(${v.code},${value})`) :
                result(v.type, `set_${keys[k]}(${v.code},${value})`);
        }
        if (op === 'rtray_trace') {
            return result(
                'Hit',
                `traceRay(vec3(${['OX', 'OY', 'OZ'].map(k => this.require(input(k), 'float', b)).join(',')}),vec3(${['DX', 'DY', 'DZ'].map(k => this.require(input(k), 'float', b)).join(',')}))`
            );
        }
        if (op === 'rtray_hit') {
            return result('bool', `(${this.require(input('RAY'), 'Hit', b)}).hit`);
        }
        if (op === 'rtray_reflect' || op === 'rtray_refract') {
            return result(
                'vec3',
                `${op === 'rtray_reflect' ? 'reflect' : 'refract'}(${this.require(input('I'), 'vec3', b)},${this.require(input('N'), 'vec3', b)}${op === 'rtray_refract' ? `,${this.require(input('IOR'), 'float', b)}` : ''})`
            );
        }
        if (op === 'rtgpu_normalize') {
            const v = input('V');
            if (!/^vec[234]$/.test(v.type)) {
                this.error(b, `normalize needs a vector, but got ${typeName(v.type)}.`);
            }
            return result(v.type, `normalize(${v.code})`);
        }
        if (op === 'rtgpu_dot') {
            const a = input('A');
            const c = input('B');
            if (!/^vec[234]$/.test(a.type) || a.type !== c.type) {
                this.error(b, 'dot needs two vectors of the same size.');
            }
            return result('float', `dot(${a.code},${c.code})`);
        }
        const arithmetic = {
            operator_add: '+',
            operator_subtract: '-',
            operator_multiply: '*',
            operator_divide: '/'
        };
        if (arithmetic[op]) {
            const a = input('NUM1');
            const c = input('NUM2');
            if (
                a.type === 'bool' ||
                c.type === 'bool' ||
                a.type === 'Hit' ||
                c.type === 'Hit' ||
                (a.type !== c.type && a.type !== 'float' && c.type !== 'float')
            ) {
                this.error(b, 'These values cannot be combined. Use numbers, or vectors of the same size (a vector can be multiplied by a number).');
            }
            return result(
                a.type === 'float' ? c.type : a.type,
                `(${a.code}${arithmetic[op]}${c.code})`
            );
        }
        if (['operator_lt', 'operator_gt', 'operator_equals'].includes(op)) {
            const a = input('OPERAND1');
            const c = input('OPERAND2');
            this.require(a, 'float', b);
            this.require(c, 'float', b);
            return result(
                'bool',
                `(${a.code}${{operator_lt: '<', operator_gt: '>', operator_equals: '=='}[op]}${c.code})`
            );
        }
        if (op === 'operator_and' || op === 'operator_or') {
            return result(
                'bool',
                `(${this.require(input('OPERAND1'), 'bool', b)}${op === 'operator_and' ? '&&' : '||'}${this.require(input('OPERAND2'), 'bool', b)})`
            );
        }
        if (op === 'operator_not') {
            return result(
                'bool',
                `(!${this.require(input('OPERAND'), 'bool', b)})`
            );
        }
        if (op === 'operator_random') {
            return result(
                'float',
                `mix(${this.require(input('FROM'), 'float', b)},${this.require(input('TO'), 'float', b)},randomFloat())`
            );
        }
        if (op === 'operator_mod') {
            return result(
                'float',
                `mod(${this.require(input('NUM1'), 'float', b)},${this.require(input('NUM2'), 'float', b)})`
            );
        }
        if (op === 'operator_round') {
            return result(
                'float',
                `floor(${this.require(input('NUM'), 'float', b)}+0.5)`
            );
        }
        if (op === 'operator_mathop') {
            const f = field('OPERATOR');
            const n = this.require(input('NUM'), 'float', b);
            const functions = {
                'abs': 'abs',
                'floor': 'floor',
                'ceiling': 'ceil',
                'sqrt': 'sqrt',
                'ln': 'log',
                'e ^': 'exp'
            };
            if (functions[f]) return result('float', `${functions[f]}(${n})`);
            if (['sin', 'cos', 'tan'].includes(f)) {
                return result('float', `${f}(radians(${n}))`);
            }
            if (['asin', 'acos', 'atan'].includes(f)) {
                return result('float', `degrees(${f}(${n}))`);
            }
            if (f === 'log') return result('float', `(log(${n})/log(10.0))`);
            if (f === '10 ^') return result('float', `pow(10.0,${n})`);
        }
        this.error(b, 'This block cannot run inside a GPU block.');
    }
    stack (id) {
        let code = '';
        const seen = new Set();
        while (id) {
            const b = this.block(id);
            if (seen.has(id)) this.error(b, 'This script loops back into itself.');
            seen.add(id);
            const input = k => this.input(b, k);
            const sub = k => this.stack(b.inputs[k] && b.inputs[k].block);
            if (b.opcode === 'procedures_return') {
                code += `return ${this.require(input('VALUE'), 'vec4', b)};\n`;
                break;
            } else if (
                b.opcode === 'data_setvariableto' ||
                b.opcode === 'data_changevariableby'
            ) {
                const f = b.fields.VARIABLE;
                const key = f.id || f.value;
                const v = input(
                    b.opcode === 'data_setvariableto' ? 'VALUE' : 'VALUE'
                );
                if (!this.vars.has(key)) {
                    if (b.opcode === 'data_changevariableby') {
                        this.error(b, `Set “${b.fields.VARIABLE.value}” before changing it in a GPU block.`);
                    }
                    this.vars.set(key, {
                        type: v.type,
                        code: `local${this.vars.size}`
                    });
                }
                const target = this.vars.get(key);
                this.require(v, target.type, b);
                code += `${target.code}${b.opcode === 'data_changevariableby' ? '+=' : '='}${v.code};\n`;
            } else if (b.opcode === 'control_repeat') {
                const count = this.require(input('TIMES'), 'float', b);
                const i = this.serial++;
                code += `for(int loop${i}=0, count${i}=int(clamp(floor(${count}+0.5),0.0,100000.0));loop${i}<count${i};loop${i}++){\n${sub('SUBSTACK')}}\n`;
            } else if (
                b.opcode === 'control_if' ||
                b.opcode === 'control_if_else'
            ) {
                code += `if(${this.require(input('CONDITION'), 'bool', b)}){\n${sub('SUBSTACK')}}${b.opcode === 'control_if_else' ? `else{\n${sub('SUBSTACK2')}}` : ''}\n`;
            } else this.error(b, 'This block cannot run inside a GPU block.');
            id = b.next;
        }
        return code;
    }
}
GPUCompiler.readDefinition = readDefinition;
module.exports = GPUCompiler;
