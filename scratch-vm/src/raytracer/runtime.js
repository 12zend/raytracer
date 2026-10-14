const MediaScene = require('./media');
const GPUCompiler = require('./compiler');
const Cast = require('../util/cast');
const RayBuffers = require('scratch-render/src/raytracer/buffers');
const VECTOR_KEYS = ['x', 'y', 'z', 'w'];
/**
 * Convert a block value into a typed GPU uniform.
 * @param {*} value Value passed to the GPU block.
 * @param {string} kind Procedure argument kind: 's' / 'n' or 'b'.
 * @param {string} name Argument name for diagnostics.
 * @returns {{type: string, value: *}} Uniform type and value.
 */
const argumentValue = (value, kind, name) => {
    if (kind === 'b') return {type: 'bool', value: Cast.toBoolean(value)};
    if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        const size = keys.length;
        if (size < 2 || size > 4 || keys.some((k, i) => k !== VECTOR_KEYS[i])) {
            throw new Error(`GPU argument ${name} must be a number or vec2/vec3/vec4`);
        }
        return {type: `vec${size}`, value: keys.map(k => Cast.toNumber(value[k]))};
    }
    return {type: 'float', value: Cast.toNumber(value)};
};
class RayRuntime {
    constructor (runtime) {
        this.runtime = runtime;
        this.scene = new MediaScene();
        // Model textures uploaded through the Media (costume) list are matched by file name.
        this.scene.companion = name => {
            const base = name.replace(/\.[^.]+$/, '');
            for (const target of runtime.targets) {
                const costume = target.isOriginal && target.getCostumes()
                    .find(c => `${c.name}.${c.dataFormat}` === name || c.name === base);
                if (costume && costume.asset) return costume.asset.data;
            }
            return null;
        };
        this.buffers = null;
        this.sceneVersion = -1;
        this.kernels = new WeakMap();
        this.skin = null;
        this.drawable = null;
    }
    gpu () {
        if (!this.buffers) {
            this.buffers = new RayBuffers(document.createElement('canvas'));
        }
        return this.buffers;
    }
    upload () {
        const b = this.scene.build();
        if (this.sceneVersion !== this.scene.version) {
            this.gpu().scene(b.pack(), this.scene.atlas);
            this.sceneVersion = this.scene.version;
        }
        return b;
    }
    call (args, util) {
        const blocks = util.target.blocks;
        const mutation = blocks.getBlock(util.thread.peekStack()).mutation;
        const definition = blocks.getScripts()
            .map(id => blocks.getBlock(id))
            .find(b => {
                if (b.opcode !== 'procedures_definition' || !b.inputs.custom_block) return false;
                const prototype = blocks.getBlock(b.inputs.custom_block.block);
                return prototype && prototype.mutation && String(prototype.mutation.gpu) === 'true' &&
                    prototype.mutation.proccode === mutation.proccode;
            });
        if (!definition) throw new Error(`Missing GPU definition: ${mutation.proccode}`);
        const layout = GPUCompiler.readDefinition(blocks, definition);
        // Argument types follow the values passed in, so one definition accepts float or vec inputs.
        const values = layout.ids.map((id, i) => argumentValue(args[id], layout.kinds[i], layout.names[i]));
        const types = values.map(v => v.type);
        const cacheKey = blocks._cache.compiledScripts;
        let cache = this.kernels.get(cacheKey);
        if (!cache) {
            cache = new Map();
            this.kernels.set(cacheKey, cache);
        }
        const key = `${definition.id}:${types.join()}`;
        let compiled = cache.get(key);
        if (!compiled) {
            compiled = new GPUCompiler().compile(blocks, definition, types);
            cache.set(key, compiled);
        }
        const uniforms = {};
        values.forEach((v, i) => {
            uniforms[`arg${i}`] = v;
        });
        this.upload();
        this.gpu().run(args[layout.bufferId], compiled.source, uniforms);
    }
    render (name) {
        const rendered = this.gpu().render(name);
        const canvas = this.displayCanvas || (this.displayCanvas = document.createElement('canvas'));
        canvas.width = rendered.width; canvas.height = rendered.height;
        canvas.getContext('2d').drawImage(rendered, 0, 0);
        const renderer = this.runtime.renderer;
        if (!renderer) return;
        if (this.skin === null) {
            this.skin = renderer.createBitmapSkin(canvas, 1);
            this.drawable = renderer.createDrawable('sprite');
            renderer.updateDrawableSkinId(this.drawable, this.skin);
        } else renderer.updateBitmapSkin(this.skin, canvas, 1);
        renderer.updateDrawablePosition(this.drawable, [0, 0]);
        renderer.updateDrawableScale(this.drawable, [
            (this.runtime.stageWidth / canvas.width) * 100,
            (this.runtime.stageHeight / canvas.height) * 100
        ]);
        renderer.setDrawableOrder(this.drawable, Infinity, 'sprite');
        this.runtime.requestRedraw();
    }
    reset () {
        this.scene.clear();
        this.sceneVersion = -1;
        if (this.buffers) {
            this.buffers.dispose();
            this.buffers = null;
        }
        if (this.runtime.renderer && this.skin !== null) {
            this.runtime.renderer.destroyDrawable(this.drawable, 'sprite');
            this.runtime.renderer.destroySkin(this.skin);
        }
        this.skin = null;
        this.drawable = null;
    }
    safe (fn) {
        try {
            const value = fn();
            return value && value.catch ?
                value.catch(e => {
                    this.runtime.emit('RAYTRACER_ERROR', e.message);
                    throw e;
                }) :
                value;
        } catch (e) {
            this.runtime.emit('RAYTRACER_ERROR', e.message);
            throw e;
        }
    }
}
module.exports = runtime =>
    runtime.raytracer || (runtime.raytracer = new RayRuntime(runtime));
