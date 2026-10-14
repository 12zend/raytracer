const vector = (n, values) => Object.fromEntries(['x', 'y', 'z', 'w'].slice(0, n).map((k, i) => [k, Number(values[i]) || 0]));
const xyz = v => Array.isArray(v) ? v : [v.x, v.y, v.z];
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const reflect = (i, n) => { i = xyz(i); n = xyz(n); return vector(3, i.map((x, k) => x - 2 * dot(i,n) * n[k])); };
const refract = (i, n, eta) => {
    i = xyz(i); n = xyz(n); eta = Number(eta);
    const d = dot(i,n); const k = 1 - eta*eta*(1-d*d);
    return vector(3, k < 0 ? [0,0,0] : i.map((x,j) => eta*x-(eta*d+Math.sqrt(k))*n[j]));
};
module.exports = {vector, xyz, dot, sub, cross, reflect, refract};
