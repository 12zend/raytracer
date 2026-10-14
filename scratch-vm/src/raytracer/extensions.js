const getRuntime = require('./runtime');
const {vector, xyz, reflect, refract} = require('./math');
const {RaytracerError} = require('./errors');
const arg = (value = '') => ({type: 'string', defaultValue: value});
const number = (value = 0) => ({type: 'number', defaultValue: value});
const command = (opcode, text, args = {}) => ({
    opcode,
    text,
    blockType: 'command',
    arguments: args
});
const reporter = (opcode, text, args = {}) => ({
    ...command(opcode, text, args),
    blockType: 'reporter',
    disableMonitor: true
});
const definitions = {
    rtobject: {
        name: 'Object',
        // Gray: these blocks are everywhere, so they should blend in.
        color1: '#8a8a99',
        blocks: [
            reporter('get', 'Get prop [OBJ] . [PROP]', {
                OBJ: arg(),
                PROP: arg('x')
            }),
            reporter('insert', 'Insert prop [OBJ] [IDX] = [PROP]', {
                OBJ: arg(),
                IDX: arg('key'),
                PROP: arg()
            }),
            ...[2, 3, 4].map(n =>
                reporter(
                    `vec${n}`,
                    `vec${n} ${['X', 'Y', 'Z', 'W']
                        .slice(0, n)
                        .map(k => `[${k}]`)
                        .join(' ')}`,
                    Object.fromEntries(
                        ['X', 'Y', 'Z', 'W']
                            .slice(0, n)
                            .map(k => [k, number(k === 'W' ? 1 : 0)])
                    )
                )
            )
        ]
    },
    rt3d: {
        name: '3D',
        color1: '#387fc6',
        blocks: [
            command('clear', 'Clear Scene'),
            command(
                'add',
                'Add Object [MEDIA] position: [POS] rotation: [ROTATION] [ORDER] scale [SIZE] % [SCALE] frame: [FRAME]',
                {
                    MEDIA: arg(),
                    POS: arg(),
                    ROTATION: arg(),
                    ORDER: {type: 'string', menu: 'order', defaultValue: 'XYZ'},
                    SIZE: number(100),
                    SCALE: arg(),
                    FRAME: number()
                }
            ),
            command(
                'motion',
                'Apply motion / pose [MEDIA] to object [INDEX] frame [FRAME]',
                {MEDIA: arg(), INDEX: number(), FRAME: number()}
            )
        ],
        menus: {
            order: {
                acceptReporters: false,
                items: ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX']
            }
        }
    },
    rtray: {
        name: 'Ray',
        color1: '#ce8730',
        blocks: [
            reporter('trace', 'get ray origin: [ORIGIN] direction: [DIRECTION]', {
                ORIGIN: arg(),
                DIRECTION: arg()
            }),
            // Boolean so it fits if / repeat until conditions (Get prop is a round reporter).
            {...reporter('hit', '[RAY] hit?', {RAY: arg()}), blockType: 'Boolean'},
            reporter('reflect', 'reflect [I] [N]', {I: arg(), N: arg()}),
            reporter('refract', 'refract [I] [N] [IOR]', {
                I: arg(),
                N: arg(),
                IOR: number(0.66667)
            })
        ]
    },
    rtbuffer: {
        name: 'Buffer',
        color1: '#269b92',
        blocks: [
            command('clear', 'Clear buffer'),
            command('resolution', 'Set buffer resolution [W] [H]', {
                W: number(480),
                H: number(360)
            }),
            command('add', 'Add buffer [NAME]', {NAME: arg('main')}),
            command('render', 'Render buffer [NAME]', {NAME: arg('main')}),
            command('pixel', 'Set pixel [NAME] uv: [UV] color: [COLOR]', {
                NAME: arg('main'),
                UV: arg(),
                COLOR: arg()
            })
        ]
    },
    rtgpu: {
        name: 'GPU',
        color1: '#d84d83',
        blocks: [
            {blockType: 'button', text: 'Make a GPU block', func: 'create'},
            reporter('normalize', 'normalize [V]', {V: arg()}),
            reporter('dot', 'dot [A] [B]', {A: arg(), B: arg()}),
            {
                // Rendered by scratch-blocks/raytracer from the definition's mutation.
                ...command('call', 'GPU'),
                hideFromPalette: true
            }
        ]
    }
};
const vec3 = (v, label) => {
    if (!v || typeof v !== 'object' || !['x', 'y', 'z'].every(k => k in v)) {
        throw new RaytracerError(`${label} must be a vec3. Use the vec3 block.`);
    }
    return xyz(v).map(Number);
};
const validObject = v =>
    (v && typeof v === 'object' ? v : Object.create(null));
const methods = {
    rtobject: {
        get: a => {
            const o = validObject(a.OBJ);
            const aliases = {r: 'x', g: 'y', b: 'z', a: 'w'};
            const k = Object.prototype.hasOwnProperty.call(o, a.PROP) ?
                a.PROP :
                aliases[a.PROP];
            return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : '';
        },
        insert: a => {
            if (Array.isArray(a.OBJ)) {
                const out = a.OBJ.slice();
                const idx = Number(a.IDX);
                if (!Number.isInteger(idx) || idx < 0 || idx > out.length) {
                    throw new Error(`Index must be a whole number from 0 to ${out.length} (it starts at 0).`);
                }
                out.splice(idx, 0, a.PROP);
                return out;
            }
            const out = Object.assign(Object.create(null), validObject(a.OBJ));
            // r, g, b, a name vector components, matching Get prop and the GPU.
            const key = String(a.IDX);
            const isVector = 'x' in out && 'y' in out;
            out[(isVector && {r: 'x', g: 'y', b: 'z', a: 'w'}[key]) || key] = a.PROP;
            return out;
        },
        ...Object.fromEntries(
            [2, 3, 4].map(n => [
                `vec${n}`,
                a =>
                    vector(
                        n,
                        ['X', 'Y', 'Z', 'W'].map(k => a[k])
                    )
            ])
        )
    },
    rtray: {
        trace: (a, r) => {
            const origin = vec3(a.ORIGIN, 'Origin');
            const direction = vec3(a.DIRECTION, 'Direction');
            return r.scene.build().trace(origin, direction);
        },
        hit: a => !!(a.RAY && typeof a.RAY === 'object' && a.RAY.hit),
        reflect: a => reflect(a.I, a.N),
        refract: a => refract(a.I, a.N, a.IOR)
    },
    rt3d: {
        clear: (a, r) => r.scene.clear(),
        add: async (a, r, util) => {
            if (!r.scene.items.some(item => item.id === a.MEDIA || item.name === a.MEDIA)) {
                const costume = util.target.getCostumes().find(item => item.name === a.MEDIA);
                if (costume && costume.asset) {
                    const imported = await r.scene.import(`${costume.name}.${costume.dataFormat}`, costume.asset.data);
                    imported.name = costume.name;
                }
            }
            return r.scene.add(
                a.MEDIA,
                typeof a.POS === 'object' ? a.POS : vector(3, [0, 0, 0]),
                typeof a.ROTATION === 'object' ?
                    a.ROTATION :
                    vector(3, [0, 0, 0]),
                a.ORDER,
                Number(a.SIZE),
                typeof a.SCALE === 'object' ? a.SCALE : vector(3, [1, 1, 1]),
                a.FRAME
            );
        },
        motion: (a, r) => r.scene.applyMotion(a.MEDIA, a.INDEX, a.FRAME)
    },
    rtbuffer: {
        clear: (a, r) => r.gpu().clear(),
        resolution: (a, r) => r.gpu().resolution(a.W, a.H),
        add: (a, r) => r.gpu().add(a.NAME),
        render: (a, r) => r.render(a.NAME),
        pixel: (a, r) => r.gpu().pixel(a.NAME, a.UV, a.COLOR)
    },
    rtgpu: {
        create: (a, r) => r.runtime.emit('RAYTRACER_CREATE_GPU'),
        normalize: a => {
            const keys = Object.keys(a.V);
            const len = Math.hypot(...keys.map(k => a.V[k]));
            return Object.fromEntries(
                keys.map(k => [k, len ? a.V[k] / len : 0])
            );
        },
        dot: a =>
            Object.keys(a.A).reduce((sum, k) => sum + a.A[k] * a.B[k], 0),
        call: (a, r, u) => r.call(a, u)
    }
};
module.exports = Object.fromEntries(
    Object.entries(definitions).map(([id, info]) => [
        id,
        class {
            constructor (runtime) {
                this.rt = getRuntime(runtime);
                for (const [name, fn] of Object.entries(methods[id])) {
                    this[name] = (a, u) =>
                        this.rt.safe(() => fn(a, this.rt, u), u);
                }
            }
            getInfo () {
                return {id, color2: info.color1, color3: info.color1, ...info};
            }
        }
    ])
);
