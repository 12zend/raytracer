/* WebGL2 full-screen fragment programs. Buffers ping-pong so reads never alias writes. */
class RayBuffers {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2', {
            alpha: false,
            preserveDrawingBuffer: true
        });
        if (!this.gl) throw new Error('This browser does not support WebGL 2, which the raytracer needs.');
        this.float = !!this.gl.getExtension('EXT_color_buffer_float');
        if (!this.float)
            throw new Error('This GPU cannot render to floating-point buffers (EXT_color_buffer_float), which the raytracer needs.');
        this.width = 480;
        this.height = 360;
        this.buffers = new Map();
        this.programs = new Map();
        this.sceneTextures = [];
        this.dispatchIndex = 0;
        this.vao = this.gl.createVertexArray();
    }
    resolution(w, h) {
        w = Number(w);
        h = Number(h);
        const max = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
        if (
            !Number.isInteger(w) ||
            !Number.isInteger(h) ||
            w < 1 ||
            h < 1 ||
            w > max ||
            h > max
        )
            throw new Error(`Buffer resolution must be whole numbers from 1 to ${max}.`);
        this.width = w;
        this.height = h;
        for (const name of this.buffers.keys()) this.add(name);
    }
    texture(data, w, h) {
        const g = this.gl,
            t = g.createTexture();
        g.bindTexture(g.TEXTURE_2D, t);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        g.texImage2D(
            g.TEXTURE_2D,
            0,
            g.RGBA32F,
            w,
            h,
            0,
            g.RGBA,
            g.FLOAT,
            data
        );
        return t;
    }
    add(name) {
        name = String(name);
        const g = this.gl,
            old = this.buffers.get(name);
        if (old) for (const t of old.textures) g.deleteTexture(t);
        if (old) g.deleteFramebuffer(old.fbo);
        const b = {
            textures: [
                this.texture(null, this.width, this.height),
                this.texture(null, this.width, this.height)
            ],
            front: 0,
            fbo: g.createFramebuffer()
        };
        this.buffers.set(name, b);
        for (const t of b.textures) {
            this.attach(b, t);
            g.clearColor(0, 0, 0, 0);
            g.clear(g.COLOR_BUFFER_BIT);
        }
    }
    attach(b, t) {
        const g = this.gl;
        g.bindFramebuffer(g.FRAMEBUFFER, b.fbo);
        g.framebufferTexture2D(
            g.FRAMEBUFFER,
            g.COLOR_ATTACHMENT0,
            g.TEXTURE_2D,
            t,
            0
        );
        if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE)
            throw new Error('The GPU could not create this buffer. Try a smaller resolution.');
    }
    clear() {
        for (const name of this.buffers.keys()) this.add(name);
    }
    require(name) {
        const b = this.buffers.get(String(name));
        if (!b) throw new Error(`Buffer “${name}” does not exist. Create it with “Add buffer” first.`);
        return b;
    }
    program(fragment) {
        if (this.programs.has(fragment)) return this.programs.get(fragment);
        const g = this.gl;
        const shader = (type, source) => {
            const s = g.createShader(type);
            g.shaderSource(s, source);
            g.compileShader(s);
            if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
                const e = g.getShaderInfoLog(s);
                g.deleteShader(s);
                throw new Error(`The GPU could not compile this GPU block: ${e.trim().split('\n')[0]}`);
            }
            return s;
        };
        const v = shader(
            g.VERTEX_SHADER,
            '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}'
        );
        const f = shader(g.FRAGMENT_SHADER, fragment),
            p = g.createProgram();
        g.attachShader(p, v);
        g.attachShader(p, f);
        g.linkProgram(p);
        g.deleteShader(v);
        g.deleteShader(f);
        if (!g.getProgramParameter(p, g.LINK_STATUS)) {
            const e = g.getProgramInfoLog(p);
            g.deleteProgram(p);
            throw new Error(`The GPU could not link this GPU block: ${e.trim().split('\n')[0]}`);
        }
        // Keep a bounded cache while scripts are edited.
        if (this.programs.size >= 32) {
            const key = this.programs.keys().next().value;
            g.deleteProgram(this.programs.get(key));
            this.programs.delete(key);
        }
        this.programs.set(fragment, p);
        return p;
    }
    scene(packed, atlas) {
        const g = this.gl;
        for (const t of this.sceneTextures) g.deleteTexture(t);
        const max = g.getParameter(g.MAX_TEXTURE_SIZE);
        this.sceneTextures = [packed.nodes, packed.triangles].map((data) => {
            const count = data.length / 4,
                w = Math.min(max, count),
                h = Math.ceil(count / w);
            if (h > max) throw new Error('The scene is too large for this GPU. Use fewer or simpler objects.');
            const padded = new Float32Array(w * h * 4);
            padded.set(data);
            return this.texture(padded, w, h);
        });
        this.nodeCount = packed.nodeCount;
        if (this.atlas) g.deleteTexture(this.atlas);
        this.atlas = g.createTexture();
        g.bindTexture(g.TEXTURE_2D, this.atlas);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        if (atlas)
            g.texImage2D(
                g.TEXTURE_2D,
                0,
                g.RGBA,
                g.RGBA,
                g.UNSIGNED_BYTE,
                atlas
            );
        else
            g.texImage2D(
                g.TEXTURE_2D,
                0,
                g.RGBA,
                1,
                1,
                0,
                g.RGBA,
                g.UNSIGNED_BYTE,
                new Uint8Array([255, 255, 255, 255])
            );
    }
    bindTexture(p, name, t, unit) {
        const g = this.gl;
        g.activeTexture(g.TEXTURE0 + unit);
        g.bindTexture(g.TEXTURE_2D, t);
        g.uniform1i(g.getUniformLocation(p, name), unit);
    }
    run(name, source, uniforms = {}) {
        const b = this.require(name),
            g = this.gl,
            p = this.program(source);
        this.attach(b, b.textures[1 - b.front]);
        g.viewport(0, 0, this.width, this.height);
        g.useProgram(p);
        g.bindVertexArray(this.vao);
        g.uniform1f(g.getUniformLocation(p, 'sampleSeed'), this.dispatchIndex++);
        g.uniform2f(
            g.getUniformLocation(p, 'resolution'),
            this.width,
            this.height
        );
        this.bindTexture(p, 'previousBuffer', b.textures[b.front], 0);
        this.sceneTextures.forEach((t, i) =>
            this.bindTexture(p, i ? 'triangles' : 'nodes', t, i + 1)
        );
        g.uniform1i(g.getUniformLocation(p, 'nodeCount'), this.nodeCount || 0);
        if (this.atlas) this.bindTexture(p, 'mediaAtlas', this.atlas, 3);
        // Lists arrive as packed float data; their textures live for this draw only.
        const temporary = [];
        for (const [key, u] of Object.entries(uniforms)) {
            const loc = g.getUniformLocation(p, key),
                v = u.value;
            if (u.type === 'list') {
                const t = this.texture(v, u.width, u.height);
                temporary.push(t);
                this.bindTexture(p, key, t, 3 + temporary.length);
            } else if (u.type === 'float') g.uniform1f(loc, Number(v));
            else if (u.type === 'int' || u.type === 'bool') g.uniform1i(loc, Number(v));
            else
                g[`uniform${u.type.slice(3)}fv`](
                    loc,
                    Array.isArray(v)
                        ? v
                        : ['x', 'y', 'z', 'w']
                              .slice(0, Number(u.type.slice(3)))
                              .map((k) => Number(v[k]) || 0)
                );
        }
        g.drawArrays(g.TRIANGLES, 0, 3);
        for (const t of temporary) g.deleteTexture(t);
        b.front = 1 - b.front;
    }
    pixel(name, uv, color) {
        const b = this.require(name),
            x = Math.floor(uv.x * this.width),
            y = Math.floor(uv.y * this.height);
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
        const g = this.gl;
        g.bindTexture(g.TEXTURE_2D, b.textures[b.front]);
        g.texSubImage2D(
            g.TEXTURE_2D,
            0,
            x,
            y,
            1,
            1,
            g.RGBA,
            g.FLOAT,
            new Float32Array([color.x, color.y, color.z, color.w])
        );
    }
    render(name) {
        const b = this.require(name),
            g = this.gl;
        const p = this.program(
            '#version 300 es\nprecision highp float;uniform sampler2D previousBuffer;uniform vec2 resolution;out vec4 color;void main(){vec4 c=texture(previousBuffer,gl_FragCoord.xy/resolution);color=vec4(pow(max(c.rgb,vec3(0)),vec3(1.0/2.2)),c.a);}'
        );
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        g.viewport(0, 0, this.width, this.height);
        g.useProgram(p);
        g.bindVertexArray(this.vao);
        this.bindTexture(p, 'previousBuffer', b.textures[b.front], 0);
        g.uniform2f(
            g.getUniformLocation(p, 'resolution'),
            this.width,
            this.height
        );
        g.drawArrays(g.TRIANGLES, 0, 3);
        return this.canvas;
    }
    dispose() {
        const g = this.gl;
        for (const b of this.buffers.values()) {
            b.textures.forEach((t) => g.deleteTexture(t));
            g.deleteFramebuffer(b.fbo);
        }
        this.sceneTextures.forEach((t) => g.deleteTexture(t));
        for (const p of this.programs.values()) g.deleteProgram(p);
        if (this.atlas) g.deleteTexture(this.atlas);
        g.deleteVertexArray(this.vao);
        this.buffers.clear();
        this.programs.clear();
    }
}
module.exports = RayBuffers;
