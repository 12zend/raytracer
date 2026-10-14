const Cast = require('../util/cast');
const Operators = require('../blocks/scratch3_operators');
const library = require('./shader');
const {RaytracerError, typeName} = require('./errors');
const TYPES = ['float', 'bool', 'vec2', 'vec3', 'vec4'];
const IMPLICIT = ['uv', 'buffer'];
const VECTOR_KEYS = ['x', 'y', 'z', 'w'];
const HIT_FIELDS = {
    hit: 'bool',
    hit_position: 'vec3',
    normal: 'vec3',
    diffuse: 'vec4',
    distance: 'float',
    object_id: 'float'
};
const ZERO = {
    float: '0.0',
    bool: 'false',
    vec2: 'vec2(0)',
    vec3: 'vec3(0)',
    vec4: 'vec4(0)',
    Hit: 'Hit(false,vec3(0),vec3(0),vec4(0),-1.0,-1.0)'
};
// Loops without a fixed count stop here so a GPU block cannot hang the GPU.
const LOOP_LIMIT = 100000;
const LITERAL_FIELDS = {
    math_number: 'NUM',
    math_positive_number: 'NUM',
    math_whole_number: 'NUM',
    math_integer: 'NUM',
    math_angle: 'NUM',
    text: 'TEXT'
};
// Reporters that read the project (sprite, stage, input devices). They are evaluated on the CPU
// once per GPU call and passed in, so every pixel sees the same value.
const CPU_REPORTER = /^(motion_|looks_|sound_|sensing_)|^control_get_counter$/;
// Commands that change the project outside the pixel being computed.
const SIDE_EFFECT = new RegExp([
    '^(motion|looks|sound|pen|event|music|videoSensing|text2speech|sensing|rt3d|rtbuffer)_',
    '^control_(create_clone_of|delete_this_clone|clear_counter|incr_counter)$',
    '^data_(show|hide)(variable|list)$'
].join('|'));
// Lists: read-only lists are textures of any length; lists changed by the GPU block are copied into
// an array per pixel, sized by the CPU list's length.
const LIST_WRITES = ['data_addtolist', 'data_deleteoflist', 'data_deletealloflist', 'data_insertatlist', 'data_replaceitemoflist'];
const LIST_CAPACITY = [256, 1024];
const MAX_LISTS = 8;
// Placeholder for “stop this script”; becomes the function's default value once its type is known.
const DEFAULT_RETURN = '/*default*/';
const operators = new Operators(null);
const primitives = operators.getPrimitives();
const fold = (opcode, args) => primitives[opcode].call(operators, args);
const isVector = type => /^vec[234]$/.test(type);
const isNumeric = value =>
    typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)));
const glslFloat = n => {
    if (Number.isNaN(n)) return '0.0';
    if (n === Infinity) return 'uintBitsToFloat(0x7f800000u)';
    if (n === -Infinity) return '(-uintBitsToFloat(0x7f800000u))';
    const s = String(n);
    const code = /[.e]/.test(s) ? s : `${s}.0`;
    return n < 0 ? `(${code})` : code;
};
/**
 * A value known while compiling, kept as Scratch sees it (text stays text).
 * @param {*} value Number, text or boolean.
 * @returns {{type: string, code: ?string, constant: *}} Compiled value.
 */
const constant = value => {
    if (typeof value === 'boolean') return {type: 'bool', code: String(value), constant: value};
    if (isNumeric(value)) return {type: 'float', code: glslFloat(Cast.toNumber(value)), constant: value};
    return {type: 'string', code: null, constant: String(value)};
};
const known = v => typeof v.constant !== 'undefined';
/**
 * GPU type of a value read from the CPU (variable, sensing block).
 * @param {*} value CPU value.
 * @returns {string} float, bool, vecN, Hit, string or invalid.
 */
const valueType = value => {
    if (typeof value === 'boolean') return 'bool';
    if (typeof value === 'undefined' || isNumeric(value)) return 'float';
    if (typeof value === 'string') return 'string';
    if (value && typeof value === 'object') {
        if (Object.keys(HIT_FIELDS).every(k => k in value)) return 'Hit';
        const keys = Object.keys(value);
        if (keys.length >= 2 && keys.length <= 4 && keys.every((k, i) => k === VECTOR_KEYS[i])) {
            return `vec${keys.length}`;
        }
    }
    return 'invalid';
};
const listCapacity = items => LIST_CAPACITY.find(c => items.length <= c) || 'large';
const slotType = (slot, value) => {
    if (slot.kind === 'list') return `list:${listCapacity(value)}`;
    const type = valueType(value);
    return type === 'string' ? `string:${value}` : type;
};
/**
 * Read a CPU value the compiled GPU block depends on.
 * @param {object} slot Slot from compile().
 * @param {?object} env Access to the project: variable(field), host(opcode, args).
 * @returns {*} Current value.
 */
const readSlot = (slot, env) => {
    if (slot.kind === 'variable') {
        const value = env ? env.variable(slot.field) : null;
        // A variable that does not exist yet reads as 0, as in Scratch.
        return value === null || typeof value === 'undefined' ? 0 : value;
    }
    if (slot.kind === 'list') {
        const items = env ? env.list(slot.field) : null;
        return Array.isArray(items) ? items : [];
    }
    if (!env) throw new RaytracerError('This GPU block reads the project, so it can only run in the editor.', slot.blockId);
    return env.host(slot.opcode, slot.args);
};
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
const procedureLabel = proccode => proccode.replace(/ %[nbs]/g, '').trim();
class GPUCompiler {
    /**
     * @param {object} blocks Block container or plain map.
     * @param {object} definition procedures_definition block.
     * @param {string[]} types GLSL type of each user argument, decided by the caller's values.
     * @param {?object} env Access to the project for variables and sensing blocks (see readSlot).
     * @returns {{params: object[], slots: object[], signature: string, source: string}} Uniform layout,
     *     the CPU values it was compiled for and the fragment shader.
     */
    compile (blocks, definition, types = [], env = null) {
        this.blocks = blocks;
        this.env = env;
        this.vars = new Map();
        this.lists = new Map();
        this.slots = [];
        this.slotKeys = new Map();
        this.functions = [];
        this.procedures = new Map();
        this.compiling = new Set();
        this.serial = 0;
        this.visiting = new Set();
        const layout = readDefinition(blocks, definition);
        const params = layout.names.map((name, i) => ({name, type: types[i] || 'float'}));
        this.scope = new Map([
            ['uv', {type: 'vec2', code: 'uv'}],
            ['buffer', {type: 'vec4', code: 'texture(previousBuffer,uv)'}]
        ]);
        params.forEach((p, i) => {
            if (!TYPES.includes(p.type) || this.scope.has(p.name)) {
                throw new RaytracerError(`Input “${p.name}” cannot be used on the GPU. Rename it, or pass a number or vector.`, definition.id);
            }
            if ((layout.kinds[i] === 'b') !== (p.type === 'bool')) {
                throw new RaytracerError(`Input “${p.name}” must be ${layout.kinds[i] === 'b' ? 'a boolean' : 'a number or vector'}.`, definition.id);
            }
            this.scope.set(p.name, {type: p.type, code: `arg${i}`});
        });
        this.fn = {returnType: 'vec4'};
        this.changedLists = this.scanListWrites(definition.next);
        const body = this.stack(definition.next)
            .split(DEFAULT_RETURN)
            .join('vec4(0)');
        const uniforms = this.slots
            .filter(s => s.uniform)
            .map(s => (s.type === 'list' ?
                `uniform sampler2D ${s.uniform};\nuniform int ${s.uniform}_length;` :
                `uniform ${s.type} ${s.uniform};`));
        const lists = Array.from(this.lists.values());
        const globals = [
            ...Array.from(this.vars.values())
                .filter(v => v.code)
                .map(v => `${v.type} ${v.code};`),
            ...lists.map(l => l.declarations)
        ];
        const init = [
            ...Array.from(this.vars.values())
                .filter(v => v.code)
                .map(v => `${v.code}=${this.initial(v)};\n`),
            ...lists.map(l => l.init)
        ].join('');
        return {
            params,
            slots: this.slots,
            signature: this.slots.map(s => s.signature).join('|'),
            source: `#version 300 es\nprecision highp float;precision highp int;\n${library}\n${[
                ...params.map((p, i) => `uniform ${p.type} arg${i};`),
                ...uniforms,
                ...globals
            ].join('\n')}\n${this.functions.join('\n')}\nout vec4 fragmentColor;\nvec4 kernel(vec2 uv){\n${init}${body}return vec4(0);\n}\nvoid main(){seed=sampleSeed;fragmentColor=kernel(gl_FragCoord.xy/resolution);}`
        };
    }
    block (id) {
        const b = this.blocks.getBlock ?
            this.blocks.getBlock(id) :
            this.blocks[id];
        if (!b) throw new RaytracerError('A block inside this GPU block is missing. Try reloading the project.');
        return b;
    }
    allBlocks () {
        return Object.values(this.blocks._blocks || this.blocks);
    }
    error (b, message) {
        throw new RaytracerError(message, b.id);
    }
    input (b, name) {
        const i = b.inputs && b.inputs[name];
        return i && i.block ? this.expr(i.block) : constant('');
    }
    /**
     * Convert a value the way Scratch would, or explain why it cannot be.
     * Numbers and booleans convert to each other, and a number fills every component of a vector.
     * @param {object} v Compiled value.
     * @param {string} type Wanted type.
     * @param {object} b Block to report errors on.
     * @param {string} what Name of the input for error messages.
     * @returns {string} GLSL code of the wanted type.
     */
    coerce (v, type, b, what = 'This input') {
        if (v.type === 'string') {
            v = constant(type === 'bool' ? Cast.toBoolean(v.constant) : Cast.toNumber(v.constant));
        }
        if (v.type === type) return v.code;
        if (type === 'bool' && v.type === 'float') {
            return known(v) ? String(Cast.toBoolean(Cast.toNumber(v.constant))) : `(${v.code}!=0.0)`;
        }
        if (type === 'float' && v.type === 'bool') {
            return known(v) ? glslFloat(Cast.toNumber(v.constant)) : `(${v.code}?1.0:0.0)`;
        }
        if (isVector(type) && (v.type === 'float' || v.type === 'bool')) {
            return `${type}(${this.coerce(v, 'float', b, what)})`;
        }
        this.error(b, `${what} needs ${typeName(type)}, but got ${typeName(v.type)}.`);
    }
    /**
     * A number or vector for arithmetic; text and booleans become numbers as in Scratch.
     * @param {object} v Compiled value.
     * @param {object} b Block to report errors on.
     * @returns {object} float or vector value.
     */
    numeric (v, b) {
        if (v.type === 'string') return constant(Cast.toNumber(v.constant));
        if (v.type === 'bool') return {type: 'float', code: this.coerce(v, 'float', b)};
        if (v.type === 'float' || isVector(v.type)) return v;
        this.error(b, `This needs a number or vector, but got ${typeName(v.type)}.`);
    }
    /**
     * The value of an input that must be known while compiling (property names, menus).
     * @param {object} b Block.
     * @param {string} name Input name.
     * @param {string} what Description for the error message.
     * @returns {*} Constant value.
     */
    fixed (b, name, what) {
        const v = this.input(b, name);
        if (!known(v)) this.error(b, `${what} must be typed in, not computed on the GPU.`);
        return v.constant;
    }
    /**
     * Register a CPU value this GPU block depends on. It becomes a uniform, or is
     * compiled in as a constant when it is text.
     * @param {string} key Identity of the value.
     * @param {object} slot Slot description (kind and what to read).
     * @returns {object} Slot with its type.
     */
    slot (key, slot) {
        if (this.slotKeys.has(key)) return this.slotKeys.get(key);
        const value = readSlot(slot, this.env);
        const signature = slotType(slot, value);
        const type = signature.split(':')[0];
        const s = {...slot, type, signature};
        if (type === 'string') s.value = String(value);
        else if (type !== 'invalid') s.uniform = `host${this.slots.length}`;
        this.slots.push(s);
        this.slotKeys.set(key, s);
        return s;
    }
    slotValue (s, b) {
        if (s.type === 'string') return constant(s.value);
        if (s.type === 'invalid') this.error(b, 'This block reports a value the GPU cannot use. GPU blocks use numbers, booleans, vectors and ray hits.');
        return {type: s.type, code: s.uniform};
    }
    variableSlot (field, b) {
        const key = field.id || field.value;
        return this.slot(`variable:${key}`, {
            kind: 'variable',
            field: {id: field.id, value: field.value},
            blockId: b.id
        });
    }
    /**
     * The GPU variable for a Scratch variable. It starts each pixel with the CPU value; text values
     * stay compile-time constants and cannot be set on the GPU.
     * @param {object} field VARIABLE field.
     * @param {object} b Block for errors.
     * @param {?string} writeType Type of the first value set, when the first use is a set.
     * @returns {object} Variable record.
     */
    variable (field, b, writeType = null) {
        const key = field.id || field.value;
        let v = this.vars.get(key);
        if (!v) {
            const s = this.variableSlot(field, b);
            if (s.type === 'string') {
                v = {name: field.value, slot: s, value: constant(s.value)};
            } else {
                const type = writeType || s.type;
                if (type === 'invalid') {
                    this.error(b, `“${field.value}” holds a value the GPU cannot use. Use numbers, booleans, vectors or ray hits.`);
                }
                v = {name: field.value, slot: s, type, code: `var${this.serial++}`};
            }
            this.vars.set(key, v);
        }
        return v;
    }
    readVariable (b) {
        const v = this.variable(b.fields.VARIABLE, b);
        return v.code ? {type: v.type, code: v.code} : v.value;
    }
    writeVariable (field, value, b) {
        if (value.type === 'string') {
            this.error(b, `“${field.value}” would hold text. Variables inside a GPU block hold numbers, booleans and vectors.`);
        }
        const v = this.variable(field, b, value.type);
        if (!v.code) {
            this.error(b, `“${field.value}” holds text on the CPU. Set it to a number or vector before running the GPU block.`);
        }
        return v;
    }
    /**
     * Value a GPU variable starts with: its CPU value, converted when the GPU block uses another type.
     * @param {object} v Variable record.
     * @returns {string} GLSL initializer.
     */
    initial (v) {
        const s = v.slot;
        if (s.type === v.type) return s.uniform;
        if ((s.type === 'float' || s.type === 'bool') && v.type !== 'Hit') {
            return this.coerce({type: s.type, code: s.uniform}, v.type, {id: null});
        }
        return ZERO[v.type];
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
        if (LITERAL_FIELDS[op]) {
            const raw = field(LITERAL_FIELDS[op]);
            const v = constant(raw === null || typeof raw === 'undefined' ? '' : raw);
            // A number field holding text (only possible in edited projects) still counts as a number.
            return op === 'text' ? v : {...v, type: 'float', code: glslFloat(Cast.toNumber(raw))};
        }
        if (op === 'argument_reporter_string_number' || op === 'argument_reporter_boolean') {
            const name = field('VALUE');
            if (!this.scope.has(name)) {
                this.error(b, `“${name}” is not an input of this ${this.fn.label ? `“${this.fn.label}” block` : 'GPU block'}.`);
            }
            return this.scope.get(name);
        }
        if (op === 'data_variable') return this.readVariable(b);
        if (/^rtobject_vec[234]$/.test(op)) {
            const n = Number(op.slice(-1));
            return result(
                `vec${n}`,
                `vec${n}(${VECTOR_KEYS
                    .slice(0, n)
                    .map(k => this.coerce(input(k.toUpperCase()), 'float', b, k))
                    .join(',')})`
            );
        }
        if (op === 'rtobject_get') {
            const v = input('OBJ');
            const key = String(this.fixed(b, 'PROP', 'The property name'));
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
                    HIT_FIELDS :
                    Object.fromEntries(
                        VECTOR_KEYS
                            .slice(0, isVector(v.type) ? Number(v.type.slice(3)) : 0)
                            .map(k => [k, 'float'])
                    );
            if (!fields[prop]) {
                if (!Object.keys(fields).length) this.error(b, `Get prop needs a vector or a ray hit, but got ${typeName(v.type)}.`);
                this.error(b, `${typeName(v.type).replace(/^a/, 'A')} has no property “${key}”. Available: ${Object.keys(fields).join(', ')}.`);
            }
            return result(fields[prop], `(${v.code}).${prop}`);
        }
        if (op === 'rtobject_insert') {
            // On the GPU only vectors can take a new property: a component key sets that component,
            // and the key right after the last one (z for a vec2) makes a longer vector.
            const v = input('OBJ');
            const value = this.coerce(input('PROP'), 'float', b, 'The value');
            const key = String(this.fixed(b, 'IDX', 'The property name'));
            const k = VECTOR_KEYS.indexOf({r: 'x', g: 'y', b: 'z', a: 'w'}[key] || key);
            const n = isVector(v.type) ? Number(v.type.slice(3)) : 0;
            if (!n) this.error(b, `On the GPU, Insert prop needs a vector, but got ${typeName(v.type)}.`);
            if (k < 0 || k > n || k === 4) {
                this.error(b, `${typeName(v.type).replace(/^a/, 'A')} cannot take the key “${key}”. Use ${VECTOR_KEYS.slice(0, Math.min(n + 1, 4)).join(', ')}.`);
            }
            return k === n ?
                result(`vec${n + 1}`, `vec${n + 1}(${v.code},${value})`) :
                result(v.type, `set_${VECTOR_KEYS[k]}(${v.code},${value})`);
        }
        if (op === 'rtray_trace') {
            return result(
                'Hit',
                `traceRay(${this.coerce(input('ORIGIN'), 'vec3', b, 'The origin')},${this.coerce(input('DIRECTION'), 'vec3', b, 'The direction')})`
            );
        }
        if (op === 'rtray_hit') {
            const v = input('RAY');
            if (v.type !== 'Hit') this.error(b, `hit? needs a ray hit, but got ${typeName(v.type)}.`);
            return result('bool', `(${v.code}).hit`);
        }
        if (op === 'rtray_reflect' || op === 'rtray_refract') {
            return result(
                'vec3',
                `${op === 'rtray_reflect' ? 'reflect' : 'refract'}(${this.coerce(input('I'), 'vec3', b, 'The direction')},${this.coerce(input('N'), 'vec3', b, 'The normal')}${op === 'rtray_refract' ? `,${this.coerce(input('IOR'), 'float', b, 'The ratio')}` : ''})`
            );
        }
        if (op === 'rtgpu_normalize') {
            const v = input('V');
            if (!isVector(v.type)) {
                this.error(b, `normalize needs a vector, but got ${typeName(v.type)}.`);
            }
            return result(v.type, `normalize(${v.code})`);
        }
        if (op === 'rtgpu_dot') {
            const a = input('A');
            const c = input('B');
            if (!isVector(a.type) || a.type !== c.type) {
                this.error(b, 'dot needs two vectors of the same size.');
            }
            return result('float', `dot(${a.code},${c.code})`);
        }
        if (op === 'data_itemoflist') {
            const list = this.list(b);
            return result('float', `${list.get}(${this.listIndex(b, list, false)})`);
        }
        if (op === 'data_lengthoflist') return result('float', `float(${this.list(b).length})`);
        if (op === 'data_itemnumoflist' || op === 'data_listcontainsitem') {
            const list = this.list(b);
            const item = input('ITEM');
            const code = item.type === 'string' ? '0.0' : `${list.find}(${this.coerce(item, 'float', b, 'The item')})`;
            return op === 'data_itemnumoflist' ? result('float', code) : result('bool', `(${code}>0.0)`);
        }
        if (op === 'data_listcontents') {
            this.error(b, 'A list’s contents are text, which a GPU block cannot use. Use item or length of the list.');
        }
        if (op.startsWith('operator_')) return this.operator(b);
        if (op === 'procedures_call') {
            const fn = this.callProcedure(b);
            if (fn.returnType === 'void') return constant('');
            return result(fn.returnType, fn.code);
        }
        // A dropdown that is not a reporter (shadow with a single field) is plain text.
        if (b.shadow && !Object.keys(b.inputs || {}).length && Object.keys(b.fields || {}).length === 1) {
            return constant(Object.values(b.fields)[0].value);
        }
        if (CPU_REPORTER.test(op)) return this.cpuReporter(b);
        this.error(b, 'This block cannot run inside a GPU block.');
    }
    operator (b) {
        const op = b.opcode;
        const input = k => this.input(b, k);
        const result = (type, code) => ({type, code});
        const inputs = {
            operator_add: ['NUM1', 'NUM2'],
            operator_subtract: ['NUM1', 'NUM2'],
            operator_multiply: ['NUM1', 'NUM2'],
            operator_divide: ['NUM1', 'NUM2'],
            operator_mod: ['NUM1', 'NUM2'],
            operator_lt: ['OPERAND1', 'OPERAND2'],
            operator_gt: ['OPERAND1', 'OPERAND2'],
            operator_equals: ['OPERAND1', 'OPERAND2'],
            operator_and: ['OPERAND1', 'OPERAND2'],
            operator_or: ['OPERAND1', 'OPERAND2'],
            operator_not: ['OPERAND'],
            operator_join: ['STRING1', 'STRING2'],
            operator_letter_of: ['LETTER', 'STRING'],
            operator_length: ['STRING'],
            operator_contains: ['STRING1', 'STRING2'],
            operator_round: ['NUM'],
            operator_mathop: ['NUM'],
            operator_random: ['FROM', 'TO']
        }[op];
        if (!inputs) this.error(b, 'This block cannot run inside a GPU block.');
        const values = Object.fromEntries(inputs.map(k => [k, input(k)]));
        // Fixed inputs are folded with Scratch's own operator blocks, so text and edge cases match the CPU.
        if (op !== 'operator_random' && Object.values(values).every(known)) {
            const args = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.constant]));
            if (op === 'operator_mathop') args.OPERATOR = b.fields.OPERATOR.value;
            return constant(fold(op, args));
        }
        const arithmetic = {
            operator_add: '+',
            operator_subtract: '-',
            operator_multiply: '*',
            operator_divide: '/'
        };
        if (arithmetic[op] || op === 'operator_mod') {
            const a = this.numeric(values.NUM1, b);
            const c = this.numeric(values.NUM2, b);
            if (a.type !== c.type && a.type !== 'float' && c.type !== 'float') {
                this.error(b, 'These values cannot be combined. Use numbers, or vectors of the same size (a vector can be multiplied by a number).');
            }
            const type = a.type === 'float' ? c.type : a.type;
            if (op === 'operator_mod') {
                // mod(float, vec) does not exist in GLSL; widen the number first.
                const left = a.type === 'float' && type !== 'float' ? `${type}(${a.code})` : a.code;
                return result(type, `mod(${left},${c.code})`);
            }
            return result(type, `(${a.code}${arithmetic[op]}${c.code})`);
        }
        if (['operator_lt', 'operator_gt', 'operator_equals'].includes(op)) {
            const a = values.OPERAND1;
            const c = values.OPERAND2;
            if (op === 'operator_equals' && isVector(a.type) && a.type === c.type) {
                return result('bool', `all(equal(${a.code},${c.code}))`);
            }
            // A number is never equal to text such as "abc" (Scratch compares them as text).
            const text = [a, c].find(v => v.type === 'string');
            if (text) {
                if (op === 'operator_equals') return constant(false);
                this.error(b, `A number cannot be compared with the text “${text.constant}” on the GPU.`);
            }
            const sign = {operator_lt: '<', operator_gt: '>', operator_equals: '=='}[op];
            return result('bool', `(${this.coerce(a, 'float', b)}${sign}${this.coerce(c, 'float', b)})`);
        }
        if (op === 'operator_and' || op === 'operator_or') {
            return result(
                'bool',
                `(${this.coerce(values.OPERAND1, 'bool', b)}${op === 'operator_and' ? '&&' : '||'}${this.coerce(values.OPERAND2, 'bool', b)})`
            );
        }
        if (op === 'operator_not') {
            return result('bool', `(!${this.coerce(values.OPERAND, 'bool', b)})`);
        }
        if (op === 'operator_random') {
            const ints = [values.FROM, values.TO].filter(known).map(v => Cast.isInt(v.constant));
            // 0: decimal, 1: whole numbers, 2: decide from the values (as Scratch does for computed inputs).
            const mode = ints.includes(false) ? 0 : (ints.length === 2 ? 1 : 2);
            return result('float', `randomBetween(${this.coerce(values.FROM, 'float', b)},${this.coerce(values.TO, 'float', b)},${mode})`);
        }
        if (op === 'operator_round') {
            const v = this.numeric(values.NUM, b);
            return result(v.type, `floor(${v.code}+0.5)`);
        }
        if (op === 'operator_mathop') {
            const v = this.numeric(values.NUM, b);
            const n = v.code;
            const t = v.type;
            const f = b.fields.OPERATOR.value;
            const code = {
                'abs': `abs(${n})`,
                'floor': `floor(${n})`,
                'ceiling': `ceil(${n})`,
                'sqrt': `sqrt(${n})`,
                'sin': `sin(radians(${n}))`,
                'cos': `cos(radians(${n}))`,
                'tan': `tan(radians(${n}))`,
                'asin': `degrees(asin(${n}))`,
                'acos': `degrees(acos(${n}))`,
                'atan': `degrees(atan(${n}))`,
                'ln': `log(${n})`,
                'log': `(log(${n})/log(10.0))`,
                'e ^': `exp(${n})`,
                '10 ^': `pow(${t}(10.0),${n})`
            }[f];
            return code ? result(t, code) : constant(0);
        }
        this.error(b, 'This block only works with text typed into it, not values computed on the GPU.');
    }
    cpuReporter (b) {
        const args = {};
        for (const [name, f] of Object.entries(b.fields || {})) {
            args[name] = ['VARIABLE', 'LIST', 'BROADCAST_OPTION'].includes(name) ? {id: f.id, name: f.value} : f.value;
        }
        for (const name of Object.keys(b.inputs || {})) {
            args[name] = this.fixed(b, name, 'This input');
        }
        const s = this.slot(`cpu:${b.opcode}:${JSON.stringify(args)}`, {kind: 'cpu', opcode: b.opcode, args, blockId: b.id});
        return this.slotValue(s, b);
    }
    /**
     * Lists changed anywhere in this GPU block, including the custom blocks it uses.
     * @param {string} head First block of the definition.
     * @returns {Set<string>} List keys (id or name).
     */
    scanListWrites (head) {
        const written = new Set();
        const seen = new Set();
        const visit = id => {
            while (id && !seen.has(id)) {
                seen.add(id);
                const b = this.blocks.getBlock ? this.blocks.getBlock(id) : this.blocks[id];
                if (!b) return;
                if (LIST_WRITES.includes(b.opcode)) written.add(b.fields.LIST.id || b.fields.LIST.value);
                if (b.opcode === 'procedures_call') {
                    const d = this.findProcedure(b.mutation.proccode);
                    if (d) visit(d.next);
                }
                for (const i of Object.values(b.inputs || {})) visit(i.block);
                id = b.next;
            }
        };
        visit(head);
        return written;
    }
    /**
     * The GPU form of a Scratch list. Items are numbers (text items read as 0). A list the GPU block
     * changes is copied into an array for each pixel; changes are not written back to the project.
     * @param {object} b Block with a LIST field.
     * @returns {object} List record with GLSL helper names.
     */
    list (b) {
        const field = b.fields.LIST;
        const key = field.id || field.value;
        if (this.lists.has(key)) return this.lists.get(key);
        if (this.lists.size >= MAX_LISTS) this.error(b, `A GPU block can use at most ${MAX_LISTS} lists.`);
        const s = this.slot(`list:${key}`, {kind: 'list', field: {id: field.id, value: field.value}, blockId: b.id});
        const u = s.uniform;
        const fetch = `float ${u}_item(int i){int t=i/4,w=textureSize(${u},0).x;return texelFetch(${u},ivec2(t%w,t/w),0)[i%4];}`;
        let list;
        if (this.changedLists.has(key)) {
            const capacity = Number(s.signature.split(':')[1]);
            if (!capacity) {
                this.error(b, `“${field.value}” has more than ${LIST_CAPACITY[LIST_CAPACITY.length - 1]} items, so a GPU block cannot change it.`);
            }
            const a = `${u}_items`;
            const n = `${u}_count`;
            list = {
                length: n,
                declarations: [
                    `float ${a}[${capacity}];int ${n};`,
                    fetch,
                    `float ${u}_get(float index){int i=int(floor(index))-1;return i>=0&&i<${n}?${a}[i]:0.0;}`,
                    `float ${u}_find(float item){for(int i=0;i<${n};i++)if(${a}[i]==item)return float(i+1);return 0.0;}`,
                    `void ${u}_add(float v){if(${n}<${capacity}){${a}[${n}]=v;${n}++;}}`,
                    `void ${u}_delete(float index){int i=int(floor(index))-1;if(i<0||i>=${n})return;for(int k=i;k<${n}-1;k++)${a}[k]=${a}[k+1];${n}--;}`,
                    `void ${u}_insert(float index,float v){int i=int(floor(index))-1;if(i<0||i>${n}||${n}>=${capacity})return;for(int k=${n};k>i;k--)${a}[k]=${a}[k-1];${a}[i]=v;${n}++;}`,
                    `void ${u}_replace(float index,float v){int i=int(floor(index))-1;if(i>=0&&i<${n})${a}[i]=v;}`
                ].join('\n'),
                init: `${n}=min(${u}_length,${capacity});for(int i=0;i<${n};i++)${a}[i]=${u}_item(i);\n`
            };
        } else {
            const n = `${u}_length`;
            list = {
                length: n,
                declarations: [
                    fetch,
                    `float ${u}_get(float index){int i=int(floor(index))-1;return i>=0&&i<${n}?${u}_item(i):0.0;}`,
                    `float ${u}_find(float item){for(int i=0;i<${n};i++)if(${u}_item(i)==item)return float(i+1);return 0.0;}`
                ].join('\n'),
                init: ''
            };
        }
        list = {...list, name: u, get: `${u}_get`, find: `${u}_find`};
        this.lists.set(key, list);
        return list;
    }
    /**
     * A list position as Scratch reads it: a number (rounded down), last, or random / any.
     * @param {object} b Block with an INDEX input.
     * @param {object} list List record.
     * @param {boolean} insert Whether the position may be one past the end (insert).
     * @returns {string} GLSL float position (out-of-range positions do nothing).
     */
    listIndex (b, list, insert) {
        const v = this.input(b, 'INDEX');
        const length = `float(${list.length}${insert ? '+1' : ''})`;
        if (known(v) && typeof v.constant === 'string') {
            if (v.constant === 'last') return length;
            if (v.constant === 'random' || v.constant === 'any') return `(floor(randomFloat()*${length})+1.0)`;
            if (v.constant === 'all') return '0.0';
        }
        return this.coerce(v, 'float', b, 'The position');
    }
    listStatement (b) {
        const op = b.opcode;
        const list = this.list(b);
        const item = () => this.coerce(this.input(b, 'ITEM'), 'float', b, 'The item');
        if (op === 'data_deletealloflist') return `${list.length}=0;\n`;
        if (op === 'data_addtolist') return `${list.name}_add(${item()});\n`;
        if (op === 'data_deleteoflist') {
            const v = this.input(b, 'INDEX');
            if (known(v) && v.constant === 'all') return `${list.length}=0;\n`;
            return `${list.name}_delete(${this.listIndex(b, list, false)});\n`;
        }
        if (op === 'data_insertatlist') return `${list.name}_insert(${this.listIndex(b, list, true)},${item()});\n`;
        return `${list.name}_replace(${this.listIndex(b, list, false)},${item()});\n`;
    }
    findProcedure (proccode) {
        if (!this.procedureDefinitions) {
            this.procedureDefinitions = new Map();
            for (const d of this.allBlocks()) {
                if (d.opcode !== 'procedures_definition' || !d.inputs.custom_block) continue;
                const prototype = this.block(d.inputs.custom_block.block);
                const mutation = prototype && prototype.mutation;
                if (mutation && String(mutation.gpu) !== 'true') this.procedureDefinitions.set(mutation.proccode, d);
            }
        }
        return this.procedureDefinitions.get(proccode);
    }
    /**
     * Compile a custom block call into a GLSL function call. Each combination of argument types gets
     * its own function; text arguments are compiled in as constants.
     * @param {object} b procedures_call block.
     * @returns {{code: string, returnType: string}} Call expression and its type ('void' for commands).
     */
    callProcedure (b) {
        const proccode = b.mutation.proccode;
        const label = procedureLabel(proccode);
        const definition = this.findProcedure(proccode);
        if (!definition) this.error(b, `The definition of “${label}” is missing.`);
        if (this.compiling.has(proccode)) {
            this.error(b, `“${label}” uses itself. GPU blocks cannot run custom blocks that call themselves.`);
        }
        const prototype = this.block(definition.inputs.custom_block.block);
        const names = JSON.parse(prototype.mutation.argumentnames || '[]');
        const ids = JSON.parse(prototype.mutation.argumentids || '[]');
        const kinds = (proccode.match(/(^|[^\\])%[nbs]/g) || []).map(m => m.slice(-1));
        const args = ids.map((id, i) => {
            const v = this.input(b, id);
            return kinds[i] === 'b' ? {type: 'bool', code: this.coerce(v, 'bool', b, `“${names[i]}”`)} : v;
        });
        const reporter = !!(b.mutation.return && String(b.mutation.return) !== '0');
        const key = `${proccode}|${args.map(a => (a.type === 'string' ? `text:${a.constant}` : a.type)).join(',')}`;
        let fn = this.procedures.get(key);
        if (!fn) {
            const saved = {scope: this.scope, fn: this.fn, visiting: this.visiting};
            this.scope = new Map(names.map((name, i) => [
                name,
                args[i].type === 'string' ? args[i] : {type: args[i].type, code: `p${i}`}
            ]));
            this.fn = {label, returnType: null};
            this.visiting = new Set();
            this.compiling.add(proccode);
            const body = this.stack(definition.next);
            this.compiling.delete(proccode);
            const returnType = this.fn.returnType || (reporter ? 'float' : 'void');
            const name = `proc${this.procedures.size}_${this.serial++}`;
            const params = args
                .map((a, i) => (a.type === 'string' ? null : `${a.type} p${i}`))
                .filter(Boolean);
            const fallback = returnType === 'void' ? '' : ZERO[returnType];
            this.functions.push(`${returnType} ${name}(${params.join(',')}){\n${body.split(DEFAULT_RETURN).join(fallback)}${fallback ? `return ${fallback};\n` : ''}}`);
            Object.assign(this, saved);
            fn = {name, returnType};
            this.procedures.set(key, fn);
        }
        const values = args.filter(a => a.type !== 'string').map(a => a.code);
        return {code: `${fn.name}(${values.join(',')})`, returnType: fn.returnType};
    }
    returnStatement (b) {
        const v = this.input(b, 'VALUE');
        if (!this.fn.returnType) {
            if (v.type === 'string' || v.type === 'invalid') {
                this.error(b, `A custom block on the GPU can report numbers, booleans and vectors, not ${typeName(v.type)}.`);
            }
            this.fn.returnType = v.type;
        }
        return `return ${this.coerce(v, this.fn.returnType, b, this.fn.label ? 'This report' : 'A GPU block')};\n`;
    }
    loop (count, body) {
        const i = this.serial++;
        return `for(int loop${i}=0,count${i}=${count};loop${i}<count${i};loop${i}++){\n${body(i)}}\n`;
    }
    stack (id) {
        let code = '';
        const seen = new Set();
        while (id) {
            const b = this.block(id);
            if (seen.has(id)) this.error(b, 'This script loops back into itself.');
            seen.add(id);
            const op = b.opcode;
            const input = k => this.input(b, k);
            const sub = k => this.stack(b.inputs[k] && b.inputs[k].block);
            const condition = () => this.coerce(input('CONDITION'), 'bool', b, 'The condition');
            if (op === 'procedures_return') {
                code += this.returnStatement(b);
                break;
            } else if (op === 'data_setvariableto' || op === 'data_changevariableby') {
                const field = b.fields.VARIABLE;
                let value = input('VALUE');
                if (op === 'data_changevariableby') {
                    value = this.numeric(value, b);
                    const target = this.variable(field, b);
                    if (!target.code) this.error(b, `“${field.value}” holds text on the CPU, so it cannot be changed on the GPU.`);
                    if (target.type !== 'float' && !(isVector(target.type) && (value.type === 'float' || value.type === target.type))) {
                        this.error(b, `“${field.value}” is ${typeName(target.type)}, so it cannot be changed by ${typeName(value.type)}.`);
                    }
                    code += `${target.code}+=${target.type === 'float' ? this.coerce(value, 'float', b) : value.code};\n`;
                } else {
                    if (value.type === 'string' && isNumeric(value.constant)) value = constant(Cast.toNumber(value.constant));
                    const target = this.writeVariable(field, value, b);
                    code += `${target.code}=${this.coerce(value, target.type, b, `“${field.value}”`)};\n`;
                }
            } else if (LIST_WRITES.includes(op)) {
                code += this.listStatement(b);
            } else if (op === 'control_repeat') {
                const count = this.coerce(input('TIMES'), 'float', b, 'The count');
                code += this.loop(`int(clamp(floor(${count}+0.5),0.0,${LOOP_LIMIT}.0))`, () => sub('SUBSTACK'));
            } else if (op === 'control_repeat_until' || op === 'control_while') {
                const test = op === 'control_while' ? `!${condition()}` : condition();
                code += this.loop(String(LOOP_LIMIT), () => `if(${test})break;\n${sub('SUBSTACK')}`);
            } else if (op === 'control_forever') {
                code += this.loop(String(LOOP_LIMIT), () => sub('SUBSTACK'));
            } else if (op === 'control_for_each') {
                const count = this.coerce(input('VALUE'), 'float', b, 'The count');
                const target = this.writeVariable(b.fields.VARIABLE, constant(0), b);
                if (target.type !== 'float') this.error(b, `“${b.fields.VARIABLE.value}” is ${typeName(target.type)}, so it cannot count.`);
                code += this.loop(
                    `int(clamp(ceil(${count}),0.0,${LOOP_LIMIT}.0))`,
                    i => `${target.code}=float(loop${i}+1);\n${sub('SUBSTACK')}`
                );
            } else if (op === 'control_if' || op === 'control_if_else') {
                code += `if(${condition()}){\n${sub('SUBSTACK')}}${op === 'control_if_else' ? `else{\n${sub('SUBSTACK2')}}` : ''}\n`;
            } else if (op === 'control_all_at_once') {
                code += sub('SUBSTACK');
            } else if (op === 'control_wait' || op === 'control_wait_until') {
                // Every pixel runs at once, so waiting does nothing.
            } else if (op === 'control_stop') {
                const option = b.fields.STOP_OPTION.value;
                if (option !== 'this script') {
                    this.error(b, `“stop ${option}” would stop other scripts, which a GPU block cannot do. Use “stop this script”.`);
                }
                code += `return ${DEFAULT_RETURN};\n`;
                break;
            } else if (op === 'procedures_call') {
                code += `${this.callProcedure(b).code};\n`;
            } else if (SIDE_EFFECT.test(op)) {
                this.error(b, 'This block changes the project, which a GPU block cannot do. GPU blocks only compute a color for each pixel.');
            } else this.error(b, 'This block cannot run inside a GPU block.');
            id = b.next;
        }
        return code;
    }
}
GPUCompiler.readDefinition = readDefinition;
/**
 * Read every CPU value a compiled GPU block depends on.
 * @param {object} compiled Result of compile().
 * @param {object} env Project access (see readSlot).
 * @returns {{values: Array, signature: string}} Values and their types; recompile when the signature changes.
 */
GPUCompiler.sample = (compiled, env) => {
    const values = compiled.slots.map(s => readSlot(s, env));
    return {values, signature: compiled.slots.map((s, i) => slotType(s, values[i])).join('|')};
};
/**
 * Uniforms for the sampled CPU values.
 * @param {object} compiled Result of compile().
 * @param {Array} values Values from sample().
 * @returns {object} Uniform name -> {type, value}.
 */
GPUCompiler.uniforms = (compiled, values) => {
    const uniforms = {};
    compiled.slots.forEach((s, i) => {
        const value = values[i];
        if (!s.uniform) return;
        if (s.type === 'list') {
            // Four items per texel; text items read as 0, as in Scratch arithmetic.
            const texels = Math.max(1, Math.ceil(value.length / 4));
            const width = Math.min(texels, 2048);
            const height = Math.ceil(texels / width);
            const data = new Float32Array(width * height * 4);
            value.forEach((item, k) => {
                data[k] = Cast.toNumber(item);
            });
            uniforms[s.uniform] = {type: 'list', value: data, width, height};
            uniforms[`${s.uniform}_length`] = {type: 'int', value: value.length};
        } else if (s.type === 'Hit') {
            for (const [k, type] of Object.entries(HIT_FIELDS)) {
                uniforms[`${s.uniform}.${k}`] = {type, value: type === 'bool' ? !!value[k] : (type === 'float' ? Number(value[k]) : value[k])};
            }
        } else if (s.type === 'bool') {
            uniforms[s.uniform] = {type: 'bool', value: Cast.toBoolean(value)};
        } else if (s.type === 'float') {
            uniforms[s.uniform] = {type: 'float', value: Cast.toNumber(value)};
        } else {
            uniforms[s.uniform] = {type: s.type, value};
        }
    });
    return uniforms;
};
module.exports = GPUCompiler;
