const {dot, sub, cross, vector, xyz} = require('./math');
const miss = () => ({hit: false, hit_position: vector(3,[0,0,0]), normal: vector(3,[0,0,0]), diffuse: vector(4,[0,0,0,0]), distance: -1, object_id: -1});
// In-place median selection avoids sorting every subtree. Leaves contain one triangle.
const select = (a, lo, hi, k, axis) => {
    const key = t => (t.a[axis]+t.b[axis]+t.c[axis])/3;
    while (lo < hi) {
        const pivot = key(a[(lo+hi)>>1]); let i=lo; let j=hi;
        while(i<=j) { while(key(a[i])<pivot)i++; while(key(a[j])>pivot)j--; if(i<=j){[a[i],a[j]]=[a[j],a[i]];i++;j--;} }
        if(k<=j)hi=j; else if(k>=i)lo=i; else return;
    }
};
class BVH {
    constructor (triangles=[]) { this.build(triangles); }
    build (triangles) {
        this.triangles = triangles.slice(); this.nodes=[];
        const visit=(lo,hi)=>{
            const index=this.nodes.length;
            const node={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],triangle:-1,escape:0};
            this.nodes.push(node);
            for(let i=lo;i<hi;i++)for(const p of [this.triangles[i].a,this.triangles[i].b,this.triangles[i].c])for(let k=0;k<3;k++){node.min[k]=Math.min(node.min[k],p[k]);node.max[k]=Math.max(node.max[k],p[k]);}
            if(hi-lo===1)node.triangle=lo;
            else {
                const size=sub(node.max,node.min); const axis=size.indexOf(Math.max(...size)); const mid=(lo+hi)>>1;
                select(this.triangles,lo,hi-1,mid,axis);visit(lo,mid);visit(mid,hi);
            }
            node.escape=this.nodes.length;
        };
        if(triangles.length)visit(0,triangles.length);
        return this;
    }
    pack () {
        const nodes=new Float32Array(Math.max(1,this.nodes.length)*12);
        this.nodes.forEach((n,i)=>nodes.set([...n.min,n.triangle,...n.max,n.escape,0,0,0,0],i*12));
        const triangles=new Float32Array(Math.max(1,this.triangles.length)*16);
        this.triangles.forEach((t,i)=>triangles.set([...t.a,t.objectId||0,...t.b,0,...t.c,0,...(t.color||[1,1,1,1])],i*16));
        return {nodes,triangles,nodeCount:this.nodes.length};
    }
    trace (origin,direction) {
        const o=xyz(origin),d=xyz(direction);let nearest=Infinity;let result=miss();
        if(!d.every(Number.isFinite)||dot(d,d)===0)return result;
        let index=0;
        while(index<this.nodes.length){
            const n=this.nodes[index];let low=0.00001,high=nearest;
            for(let k=0;k<3;k++){
                if(Math.abs(d[k])<1e-12){if(o[k]<n.min[k]||o[k]>n.max[k])high=-1;}
                else{let a=(n.min[k]-o[k])/d[k],b=(n.max[k]-o[k])/d[k];low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));}
            }
            if(high<low){index=n.escape;continue;}
            if(n.triangle>=0){
                const t=this.triangles[n.triangle],e1=sub(t.b,t.a),e2=sub(t.c,t.a),p=cross(d,e2),det=dot(e1,p);
                if(Math.abs(det)>1e-9){const s=sub(o,t.a),u=dot(s,p)/det,q=cross(s,e1),v=dot(d,q)/det,dist=dot(e2,q)/det;
                    if(u>=0&&v>=0&&u+v<=1&&dist>1e-5&&dist<nearest){
                        nearest=dist;const normal=cross(e1,e2),len=Math.sqrt(dot(normal,normal));
                        result={hit:true,hit_position:vector(3,o.map((x,k)=>x+dist*d[k])),normal:vector(3,normal.map(x=>x/len)),diffuse:vector(4,t.color||[1,1,1,1]),distance:dist,object_id:t.objectId||0};
                    }
                }
            }
            index++;
        }
        return result;
    }
}
module.exports=BVH;
