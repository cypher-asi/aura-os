/*
 * GLSL ES 3.00 source for the WebGL2 AURA orb. The orb is a single
 * procedural full-screen effect that recreates the look of the legacy
 * `/AURA_visual_loop.mp4`: a warm pink/red core, a purple mid-band, and
 * cooler blue/indigo outer lobes, wrapped in faint concentric rings that
 * slowly drift and breathe. Colors were sampled from frames of the
 * original video so the shader reads as a drop-in replacement.
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

  // Faint concentric rings that drift and wobble with the angle.
  float rings = 0.5 + 0.5 * sin(r * 38.0 - t * 1.2 + sin(ang * 3.0 + t * 0.3) * 1.5);
  rings = pow(rings, 6.0);
  float ringMask = smoothstep(0.60, 0.15, r) * smoothstep(0.05, 0.20, r);
  intensity += rings * ringMask * 0.25;

  // Organic shimmer from animated fbm noise.
  float n = fbm(p * 3.0 + vec2(t * 0.1, -t * 0.08));
  intensity *= 0.85 + 0.3 * n;

  // Two cooler side lobes echoing the original video's halo.
  float lobe = exp(-pow((r - 0.55) * 3.5, 2.0)) * (0.5 + 0.5 * cos(ang * 2.0));
  col = mix(col, colHalo * 1.2, lobe * 0.4 * breath);

  col *= intensity;

  // Fade to black toward the edges; the CSS mask softens it further.
  col *= smoothstep(1.10, 0.20, r);

  fragColor = vec4(col, 1.0);
}
`;
