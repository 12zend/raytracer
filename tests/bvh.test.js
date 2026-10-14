const test = require('node:test');
const assert = require('node:assert/strict');
const BVH = require('../scratch-vm/src/raytracer/bvh');
const {reflect, refract} = require('../scratch-vm/src/raytracer/math');
const triangle = (z) => ({
    a: [-1, -1, z],
    b: [1, -1, z],
    c: [0, 1, z],
    color: [0.2, 0.4, 0.6, 1]
});
test('nearest hit, parallel slab and miss', () => {
    const b = new BVH([triangle(0), triangle(2)]);
    const hit = b.trace([0, 0, 5], [0, 0, -1]);
    assert.equal(hit.distance, 3);
    assert.equal(hit.hit_position.z, 2);
    assert.equal(hit.diffuse.y, 0.4);
    assert.equal(b.trace([4, 0, 5], [0, 0, -1]).hit, false);
    assert.equal(b.trace([0, 0, 5], [0, 0, 0]).hit, false);
});
test('empty scene and packed traversal escape indices', () => {
    assert.equal(new BVH().trace([0, 0, 1], [0, 0, -1]).hit, false);
    const b = new BVH(Array.from({length: 101}, (_, i) => triangle(i)));
    assert.equal(b.nodes.length, 201);
    assert.equal(b.nodes[0].escape, 201);
    assert.equal(b.pack().triangles.length, 2424);
    assert.equal(b.trace([0, 0, 110], [0, 0, -1]).distance, 10);
});
test('reflection and total internal reflection', () => {
    assert.deepEqual(reflect({x: 1, y: -1, z: 0}, {x: 0, y: 1, z: 0}), {
        x: 1,
        y: 1,
        z: 0
    });
    assert.deepEqual(refract({x: 1, y: 0, z: 0}, {x: 0, y: 1, z: 0}, 2), {
        x: 0,
        y: 0,
        z: 0
    });
});
test('BVH agrees with brute force across oblique rays', () => {
    const ts = Array.from({length: 60}, (_, i) => {
        const t = triangle(i / 5);
        for (const p of [t.a, t.b, t.c]) p[0] += Math.sin(i) * 2;
        return t;
    });
    const tree = new BVH(ts);
    for (let i = 0; i < 100; i++) {
        const o = [Math.sin(i) * 3, Math.cos(i) * 2, 20],
            d = [0.01, -0.02, -1];
        const hits = ts
            .map((t) => new BVH([t]).trace(o, d))
            .filter((h) => h.hit)
            .sort((a, b) => a.distance - b.distance);
        const h = tree.trace(o, d);
        assert.equal(h.hit, !!hits.length);
        if (h.hit) assert.ok(Math.abs(h.distance - hits[0].distance) < 1e-9);
    }
});
