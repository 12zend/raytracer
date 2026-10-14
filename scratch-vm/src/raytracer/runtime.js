const MediaScene = require('./media');
const GPUCompiler = require('./compiler');
const RayBuffers = require('scratch-render/src/raytracer/buffers');
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
        const block = util.target.blocks.getBlock(util.thread.peekStack());
        const mutation = block.mutation;
        const definition = util.target.blocks
            .getScripts()
            .map(id => util.target.blocks.getBlock(id))
            .find(
                b =>
                    b.opcode === 'rtgpu_define' &&
                    b.mutation &&
                    b.mutation.name === mutation.name
            );
        if (!definition) {
            throw new Error(`Missing GPU definition: ${mutation.name}`);
        }
        const cacheKey = util.target.blocks._cache.compiledScripts;
        let cache = this.kernels.get(cacheKey);
        if (!cache) {
            cache = new Map(); this.kernels.set(cacheKey, cache);
        }
        let compiled = cache.get(definition.id);
        if (!compiled) {
            compiled = new GPUCompiler().compile(util.target.blocks, definition);
            cache.set(definition.id, compiled);
        }
        const uniforms = {};
        compiled.params.forEach((p, i) => {
            uniforms[`arg${i}`] = {type: p.type, value: args[`ARG${i}`]};
        });
        this.upload();
        this.gpu().run(args.BUFFER, compiled.source, uniforms);
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
