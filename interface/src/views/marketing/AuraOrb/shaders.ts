/*
 * GLSL ES 3.00 source for the WebGL2 AURA orb. The orb is a single
 * procedural full-screen effect that recreates the look of the legacy
 * `/AURA_visual_loop.mp4`: a warm pink/red core, a purple mid-band, and
 * cooler blue/indigo outer lobes, wrapped in crisp overlapping orbit
 * rings that visibly expand and contract. Colors were sampled from frames
 * of the original video so the shader reads as a drop-in replacement.
 */

// Full-screen triangle generated from `gl_VertexID` alone, so no vertex
// buffer / attribute plumbing is needed (we draw 3 vertices).
export const VERTEX_SHADER = `#version 300 es
precision highp float;
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// A family of thin elliptical orbit lines that share a slow breathing
// pulse, so the whole set visibly expands and contracts. Each ring is a
// crisp line (not a soft glow) and is slightly rotated / stretched, which
// recreates the overlapping "spirograph" orbits of the original video.
float ringField(vec2 p, float t, float breathe) {
  float acc = 0.0;
  const int COUNT = 8;
  for (int i = 0; i < COUNT; i++) {
    float fi = float(i);
    // Per-ring eccentricity + rotation so the orbits overlap instead of
    // sitting as perfect concentric circles.
    float rot = fi * 0.7 + t * 0.05;
    float ca = cos(rot);
    float sa = sin(rot);
    vec2 q = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
    q.x *= 1.0 + 0.18 * sin(fi * 1.3);
    float er = length(q);

    // Base radius breathes in and out; a gentle outward drift keeps the
    // set alive without losing the distinct expand/contract pulse.
    float base = (fi + 1.0) * 0.085;
    float rad = base * breathe + 0.03 * sin(t * 0.6 + fi);

    float d = abs(er - rad);
    float w = 0.0045; // crisp, thin line
    float line = smoothstep(w, 0.0, d);
    // Brighter near the core, fading outward.
    float fade = smoothstep(0.95, 0.05, rad);
    acc += line * fade;
  }
  return acc;
}

void main() {
  // Aspect-correct, y-normalized coordinates centered on the orb.
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;

  // Slow breathing of the whole orb.
  float breath = 0.5 + 0.5 * sin(t * 0.5);
  float scale = 1.0 + 0.06 * sin(t * 0.4);
  vec2 p = uv * scale;

  float r = length(p);
  float ang = atan(p.y, p.x);

  // Palette sampled from AURA_visual_loop.mp4.
  vec3 colCore = vec3(1.0, 0.45, 0.62);   // hot pink center
  vec3 colInner = vec3(0.92, 0.27, 0.36); // red
  vec3 colMid = vec3(0.55, 0.18, 0.62);   // purple
  vec3 colHalo = vec3(0.20, 0.16, 0.60);  // indigo / blue

  // Radial color ramp from core out to the cool halo.
  vec3 col = colCore;
  col = mix(col, colInner, smoothstep(0.0, 0.28, r));
  col = mix(col, colMid, smoothstep(0.22, 0.50, r));
  col = mix(col, colHalo, smoothstep(0.45, 0.85, r));

  // Brightness: a tight bright core plus a broad soft glow.
  float core = exp(-r * r * 4.0);
  float glow = exp(-r * 1.8);
  float intensity = core * 1.2 + glow * 0.6;

  // Soft organic shimmer from animated fbm noise. Applied to the base
  // glow ONLY (before the rings are added) so the rings stay crisp
  // instead of being muddied by the noise.
  float n = fbm(p * 3.0 + vec2(t * 0.1, -t * 0.08));
  intensity *= 0.85 + 0.3 * n;

  // Two cooler side lobes echoing the original video's halo.
  float lobe = exp(-pow((r - 0.55) * 3.5, 2.0)) * (0.5 + 0.5 * cos(ang * 2.0));
  col = mix(col, colHalo * 1.2, lobe * 0.4 * breath);

  col *= intensity;

  // Distinct overlapping orbit rings, layered on TOP of the finished
  // glow so they stay crisp instead of being washed out. breathPulse
  // expands and contracts the whole ring set; the high-frequency, thin
  // ringField lines read as sharp arcs like the original video.
  float breathPulse = 1.0 + 0.22 * sin(t * 0.9);
  float rings = ringField(p, t, breathPulse);
  vec3 ringColor = vec3(1.0, 0.66, 0.62); // bright warm highlight
  col += ringColor * rings * (0.5 + 0.35 * breath) * smoothstep(1.05, 0.06, r);

  // Fade to black toward the edges; the CSS mask softens it further.
  col *= smoothstep(1.10, 0.20, r);

  fragColor = vec4(col, 1.0);
}
`;
