const THREE = require('three');
const {OBJLoader} = require('three/examples/jsm/loaders/OBJLoader');
const {FBXLoader} = require('three/examples/jsm/loaders/FBXLoader');
const {GLTFLoader} = require('three/examples/jsm/loaders/GLTFLoader');
const {MMDLoader} = require('three/examples/jsm/loaders/MMDLoader');
const {
    MMDAnimationHelper
} = require('three/examples/jsm/animation/MMDAnimationHelper');
const {clone} = require('three/examples/jsm/utils/SkeletonUtils');
const BVH = require('./bvh');
const FORMATS = [
    'obj',
    'fbx',
    'glb',
    'pmx',
    'vmd',
    'vpd',
    'png',
    'jpg',
    'jpeg',
    'svg',
    'mp4',
    'ttf',
    'otf',
    'woff',
    'woff2'
];
const encode = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 16384) {
        s += String.fromCharCode(...bytes.subarray(i, i + 16384));
    }
    return btoa(s);
};
const WHITE_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const decode = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
class MediaScene {
    constructor () {
        this.items = [];
        this.objects = [];
        this.version = 0;
        this.bvh = new BVH();
        this.builtVersion = -1;
        // Optional (name) => Uint8Array resolver for textures stored outside Media.
        this.companion = null;
        // Optional callback when the asset list changes (import, rename, remove, restore).
        this.onItemsChange = null;
    }
    itemsChanged () {
        if (this.onItemsChange) this.onItemsChange();
    }
    async import (name, bytes) {
        const format = name.split('.').pop()
            .toLowerCase();
        if (!FORMATS.includes(format)) {
            throw new Error(`“.${format}” files are not supported.`);
        }
        const item = {
            id: `media-${Date.now()}-${Math.random().toString(36)
                .slice(2)}`,
            name,
            format,
            data: encode(new Uint8Array(bytes))
        };
        await this.load(item);
        this.items.push(item);
        this.itemsChanged();
        return item;
    }
    async load (item) {
        const bytes = decode(item.data);
        const buffer = bytes.buffer;
        const manager = new THREE.LoadingManager();
        const urls = [];
        let loading = false;
        let resolveTextures;
        let rejectTextures;
        const texturesReady = new Promise((resolve, reject) => {
            resolveTextures = resolve;
            rejectTextures = reject;
        });
        manager.onStart = () => {
            loading = true;
        };
        manager.onLoad = () => resolveTextures();
        manager.onError = url =>
            rejectTextures(new Error(`Cannot load texture: ${url}`));
        // Companion textures are copied into the model item, so saved projects stay self-contained.
        // Lookup order: bytes stored with the model, other Media, then the resolver (costumes).
        item.companions = item.companions || {};
        item.missing = [];
        manager.setURLModifier(url => {
            if (url.startsWith('blob:') || url.startsWith('data:')) return url;
            const name = decodeURIComponent(url.split(/[\\/]/).pop());
            if (!item.companions[name]) {
                const match = this.items.find(m => m.name === name);
                const bytesFound = match ? decode(match.data) : this.companion && this.companion(name);
                if (bytesFound) item.companions[name] = encode(new Uint8Array(bytesFound));
            }
            if (!item.companions[name]) {
                // Render untextured instead of failing the whole model.
                if (!item.missing.includes(name)) item.missing.push(name);
                return WHITE_PIXEL;
            }
            const u = URL.createObjectURL(new Blob([decode(item.companions[name])]));
            urls.push(u);
            return u;
        });
        const text = () => new TextDecoder().decode(bytes);
        try {
            if (item.format === 'obj') {
                item.object = new OBJLoader(manager).parse(text());
            } else if (item.format === 'fbx') {
                item.object = new FBXLoader(manager).parse(buffer, '');
            } else if (item.format === 'glb') {
                const gltf = await new Promise((resolve, reject) =>
                    new GLTFLoader(manager).parse(buffer, '', resolve, reject)
                );
                // The item is private to this import until load() resolves.
                // eslint-disable-next-line require-atomic-updates
                item.object = gltf.scene;
                // eslint-disable-next-line require-atomic-updates
                item.object.animations = gltf.animations;
            } else if (item.format === 'pmx') {
                const loader = new MMDLoader(manager);
                const parser = loader._getParser();
                item.object = loader.meshBuilder.build(
                    parser.parsePmx(buffer, true),
                    ''
                );
            } else if (item.format === 'vmd') {
                item.motion = new MMDLoader(manager)
                    ._getParser()
                    .parseVmd(buffer, true);
            } else if (item.format === 'vpd') {
                item.pose = new MMDLoader(manager)
                    ._getParser()
                    .parseVpd(new TextDecoder('shift-jis').decode(bytes), true);
            } else if (['ttf', 'otf', 'woff', 'woff2'].includes(item.format)) {
                item.font = new FontFace(
                    item.name.replace(/\.[^.]+$/, ''),
                    buffer
                );
                await item.font.load();
                document.fonts.add(item.font);
            } else {
                item.url = URL.createObjectURL(
                    new Blob([bytes], {
                        type: {
                            svg: 'image/svg+xml',
                            png: 'image/png',
                            jpg: 'image/jpeg',
                            jpeg: 'image/jpeg',
                            mp4: 'video/mp4'
                        }[item.format]
                    })
                );
                if (item.format === 'mp4') {
                    item.element = document.createElement('video');
                    item.element.muted = true;
                    item.element.preload = 'auto';
                    item.element.src = item.url;
                    await new Promise((resolve, reject) => {
                        item.element.onloadeddata = resolve;
                        item.element.onerror = () =>
                            reject(new Error(`Cannot decode ${item.name}`));
                    });
                } else {
                    item.element = new Image();
                    item.element.src = item.url;
                    await item.element.decode();
                }
            }
            if (loading) await texturesReady;
        } finally {
            urls.forEach(u => URL.revokeObjectURL(u));
        }
        return item;
    }
    find (name) {
        const item = this.items.find(i => i.id === name || i.name === name);
        if (!item) throw new Error(`There is no costume or 3D asset named “${name}”.`);
        return item;
    }
    clear () {
        this.objects = [];
        this.version++;
    }
    async add (name, pos, rotation, order, size, scale, frame) {
        const item = this.find(name);
        let object;
        if (item.object) object = clone(item.object);
        else if (item.element) {
            if (item.format === 'mp4') {
                const t = Math.max(
                    0,
                    Math.min(Number(frame) / 30, item.element.duration || 0)
                );
                if (Math.abs(item.element.currentTime - t) > 0.001) {
                    await new Promise((resolve, reject) => {
                        item.element.onseeked = resolve;
                        item.element.onerror = reject;
                        item.element.currentTime = t;
                    });
                }
            }
            const w = item.element.videoWidth || item.element.naturalWidth;
            const h = item.element.videoHeight || item.element.naturalHeight;
            const snapshot = document.createElement('canvas');
            snapshot.width = w; snapshot.height = h;
            snapshot.getContext('2d').drawImage(item.element, 0, 0);
            object = new THREE.Mesh(
                new THREE.PlaneGeometry(w / h, 1),
                new THREE.MeshBasicMaterial({
                    map: new THREE.Texture(snapshot)
                })
            );
        } else throw new Error(`“${item.name}” cannot be added to the scene. Add Object needs a model, image or video.`);
        if (!['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'].includes(order)) {
            throw new Error('Rotation order must be one of XYZ, XZY, YXZ, YZX, ZXY or ZYX.');
        }
        object.position.set(pos.x, pos.y, pos.z);
        object.rotation.set(
            (rotation.x * Math.PI) / 180,
            (rotation.y * Math.PI) / 180,
            (rotation.z * Math.PI) / 180,
            order
        );
        object.scale.set(
            (scale.x * size) / 100,
            (scale.y * size) / 100,
            (scale.z * size) / 100
        );
        if (
            item.object &&
            item.object.animations &&
            item.object.animations.length
        ) {
            const mixer = new THREE.AnimationMixer(object);
            mixer.clipAction(item.object.animations[0]).play();
            mixer.setTime(Math.max(0, Number(frame)) / 30);
        }
        object.updateMatrixWorld(true);
        this.objects.push(object);
        this.version++;
    }
    applyMotion (name, index, frame) {
        const item = this.find(name);
        const mesh = this.objects[Number(index)];
        if (!mesh || !mesh.isSkinnedMesh) {
            throw new Error(`Scene object ${index} is not a PMX model. Objects are numbered from 0 in the order they were added.`);
        }
        if (item.pose) new MMDAnimationHelper().pose(mesh, item.pose);
        else if (item.motion) {
            const clip = new MMDLoader().animationBuilder.build(
                item.motion,
                mesh
            );
            const mixer = new THREE.AnimationMixer(mesh);
            mixer.clipAction(clip).play();
            mixer.setTime(Number(frame) / 30);
        } else throw new Error(`“${item.name}” is not a VMD motion or VPD pose.`);
        mesh.updateMatrixWorld(true);
        this.version++;
    }
    build () {
        if (this.version === this.builtVersion) return this.bvh;
        const triangles = [];
        const v = new THREE.Vector3();
        const atlas = document.createElement('canvas');
        atlas.width = 2048;
        atlas.height = 2048;
        const context = atlas.getContext('2d');
        const tiles = new Map();
        const textureUV = (mat, geo, ids) => {
            if (!mat || !mat.map || !mat.map.image || !geo.attributes.uv) {
                return null;
            }
            const image = mat.map.image;
            if (!tiles.has(image)) {
                const slot = tiles.size;
                if (slot >= 64) {
                    throw new Error('A scene can use at most 64 different textures.');
                }
                const x = (slot % 8) * 256;
                const y = Math.floor(slot / 8) * 256;
                context.drawImage(image, x + 1, y + 1, 254, 254);
                tiles.set(image, [x, y]);
            }
            const [x, y] = tiles.get(image);
            return ids.flatMap(i => {
                const uv = new THREE.Vector2().fromBufferAttribute(
                    geo.attributes.uv,
                    i
                );
                mat.map.updateMatrix();
                mat.map.transformUv(uv);
                return [
                    (x + 1 + uv.x * 254) / 2048,
                    (y + 1 + uv.y * 254) / 2048
                ];
            });
        };
        this.objects.forEach((root, objectId) =>
            root.traverse(mesh => {
                if (!mesh.isMesh) return;
                mesh.updateWorldMatrix(true, false);
                if (mesh.skeleton) mesh.skeleton.update();
                const geo = mesh.geometry;
                const p = geo.attributes.position;
                const index = geo.index;
                const position = i => {
                    mesh.getVertexPosition(i, v);
                    return v.applyMatrix4(mesh.matrixWorld).toArray();
                };
                const materials = Array.isArray(mesh.material) ?
                    mesh.material :
                    [mesh.material];
                for (let i = 0; i < (index ? index.count : p.count); i += 3) {
                    const ids = [0, 1, 2].map(k =>
                        (index ? index.getX(i + k) : i + k)
                    );
                    const group = geo.groups.find(
                        g => i >= g.start && i < g.start + g.count
                    );
                    const mat = materials[group ? group.materialIndex : 0];
                    const color =
                        mat && mat.color ? mat.color.toArray() : [1, 1, 1];
                    triangles.push({
                        a: position(ids[0]),
                        b: position(ids[1]),
                        c: position(ids[2]),
                        color: [...color, mat ? mat.opacity : 1],
                        uv: textureUV(mat, geo, ids),
                        objectId
                    });
                }
            })
        );
        this.atlas = atlas;
        this.bvh.build(triangles);
        this.builtVersion = this.version;
        return this.bvh;
    }
    serialize () {
        return this.items.map(({id, name, format, data, companions}) => ({
            id,
            name,
            format,
            data,
            companions
        }));
    }
    async restore (items) {
        this.dispose();
        for (const item of items || []) {
            if (!FORMATS.includes(item.format)) {
                throw new Error(`This project contains an unsupported 3D asset (“${item.name}”).`);
            }
            await this.load(item);
            this.items.push(item);
        }
        this.clear();
        this.itemsChanged();
    }
    release (i) {
        if (i.url) URL.revokeObjectURL(i.url);
        if (i.font) document.fonts.delete(i.font);
        if (i.element && i.format === 'mp4') {
            i.element.pause();
            i.element.removeAttribute('src');
            i.element.load();
        }
        if (i.object) {
            i.object.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    for (const m of Array.isArray(o.material) ?
                        o.material :
                        [o.material]) {
                        if (m.map) m.map.dispose();
                        m.dispose();
                    }
                }
            });
        }
    }
    blob (id) {
        return new Blob([decode(this.find(id).data)]);
    }
    remove (id) {
        const item = this.find(id);
        this.release(item);
        this.items = this.items.filter(i => i !== item);
        this.clear();
        this.itemsChanged();
    }
    dispose () {
        for (const i of this.items) this.release(i);
        this.items = [];
        this.clear();
    }
}
MediaScene.FORMATS = FORMATS;
module.exports = MediaScene;
