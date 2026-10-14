// set_x(v, f) .. set_w(v, f): copy of v with one component replaced (Insert prop on a vector).
const setters = [2, 3, 4]
    .map(n => ['x', 'y', 'z', 'w'].slice(0, n)
        .map(k => `vec${n} set_${k}(vec${n} v,float f){v.${k}=f;return v;}`)
        .join('\n'))
    .join('\n');
module.exports = `
struct Hit { bool hit; vec3 hit_position; vec3 normal; vec4 diffuse; float distance; float object_id; };
uniform sampler2D mediaAtlas;
uniform sampler2D nodes;
uniform sampler2D triangles;
uniform sampler2D previousBuffer;
uniform int nodeCount;
uniform vec2 resolution;
uniform float sampleSeed;
float seed;
${setters}
float randomFloat(){seed+=1.0;return fract(sin(dot(gl_FragCoord.xy+vec2(seed,seed*0.37),vec2(12.9898,78.233)))*43758.5453);}
// pick random: mode 0 decimal, 1 whole numbers, 2 whole numbers when both ends are whole (as Scratch).
float randomBetween(float a,float b,int mode){
 float lo=min(a,b),hi=max(a,b);if(lo==hi)return lo;
 if(mode==1||(mode==2&&fract(a)==0.0&&fract(b)==0.0))return lo+floor(randomFloat()*(hi+1.0-lo));
 return lo+randomFloat()*(hi-lo);
}
vec4 fetchData(sampler2D tex,int i){int w=textureSize(tex,0).x;return texelFetch(tex,ivec2(i%w,i/w),0);}
bool boxHit(vec3 o,vec3 d,vec3 low,vec3 high,float nearest){
 float lo=0.00001,hi=nearest;
 for(int k=0;k<3;k++){if(abs(d[k])<1e-12){if(o[k]<low[k]||o[k]>high[k])return false;}
 else{float a=(low[k]-o[k])/d[k],b=(high[k]-o[k])/d[k];lo=max(lo,min(a,b));hi=min(hi,max(a,b));}}
 return hi>=lo;
}
Hit traceRay(vec3 o,vec3 d){
 Hit h=Hit(false,vec3(0),vec3(0),vec4(0),-1.0,-1.0);float nearest=1e30;int index=0;
 while(index<nodeCount){
  vec4 low=fetchData(nodes,index*3),high=fetchData(nodes,index*3+1);
  if(!boxHit(o,d,low.xyz,high.xyz,nearest)){index=int(high.w);continue;}
  int t=int(low.w);
  if(t>=0){vec4 a=fetchData(triangles,t*6);vec3 b=fetchData(triangles,t*6+1).xyz,c=fetchData(triangles,t*6+2).xyz;
   vec3 e1=b-a.xyz,e2=c-a.xyz,p=cross(d,e2);float det=dot(e1,p);
   if(abs(det)>1e-9){vec3 s=o-a.xyz,q=cross(s,e1);float u=dot(s,p)/det,v=dot(d,q)/det,dist=dot(e2,q)/det;
    if(u>=0.0&&v>=0.0&&u+v<=1.0&&dist>0.00001&&dist<nearest){nearest=dist;vec4 color=fetchData(triangles,t*6+3);vec4 uv01=fetchData(triangles,t*6+4);vec2 uv2=fetchData(triangles,t*6+5).xy;if(uv01.x>=0.0){vec4 tex=texture(mediaAtlas,uv01.xy*(1.0-u-v)+uv01.zw*u+uv2*v);color*=vec4(pow(tex.rgb,vec3(2.2)),tex.a);}h=Hit(true,o+dist*d,normalize(cross(e1,e2)),color,dist,a.w);}}
  }index++;
 }return h;
}
`;
