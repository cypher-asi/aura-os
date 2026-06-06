/*
 * GLSL ES 3.00 source for the WebGL2 "agent screen" orb that lives on the
 * AgentConsole device's top circular readout. Unlike the large AuraOrb,
 * this is a tight, contained energy field meant to feel alive — like an
 * AGI thinking behind glass: a hot near-white core that breathes, a warm
 * orange/coral body, drifting plasma noise, and a couple of slowly
 * wandering bright nuclei, all fading out into a soft lavender/periwinkle
 * halo. Palette sampled from the reference gradient (warm orange ->
 * soft lavender). The whole field fades to transparent at the rim so it
 * blends into the black glass well of the screen.
 */

// Full-screen triangle generated from `gl_VertexID` alone — no vertex
// buffer / attribute plumbing needed (we draw 3 vertices).
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

// A wandering bright nucleus: a soft radial blob whose center drifts on
// its own slow elliptical path. Returns an intensity falloff so several
// can be summed to make the field's energy roam restlessly.
float nucleus(vec2 p, vec2 center, float radius) {
  float d = length(p - center);
  return exp(-pow(d / radius, 2.0));
}

void main() {
  // Aspect-correct, y-normalized coordinates centered on the screen.
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;

  // Whole-field breathing: a slow pulse that scales the coordinates so
  // the orb visibly swells and contracts, like a held breath.
  float breath = 0.5 + 0.5 * sin(t * 0.8);
  float scale = 1.0 - 0.10 * breath;
  vec2 p = uv * scale;

  float r = length(p);

  // Drifting plasma so the body never sits still — two octaves of fbm
  // sliding in different directions warp the radial field.
  float plasma = fbm(p * 2.6 + vec2(t * 0.18, -t * 0.12));
  plasma += 0.5 * fbm(p * 5.0 - vec2(t * 0.09, t * 0.15));
  float warped = r - 0.10 * plasma;

  // Palette sampled from the reference gradient.
  vec3 colHot = vec3(1.00, 0.92, 0.80);   // near-white hot spot
  vec3 colCore = vec3(1.00, 0.55, 0.18);  // warm orange core
  vec3 colBody = vec3(1.00, 0.45, 0.36);  // coral / salmon
  vec3 colMid = vec3(0.78, 0.55, 0.62);   // dusty mauve transition
  vec3 colHalo = vec3(0.68, 0.71, 0.92);  // soft lavender / periwinkle

  // Radial color ramp from the hot core out to the cool lavender halo.
  vec3 col = colHot;
  col = mix(col, colCore, smoothstep(0.0, 0.18, warped));
  col = mix(col, colBody, smoothstep(0.12, 0.34, warped));
  col = mix(col, colMid, smoothstep(0.30, 0.55, warped));
  col = mix(col, colHalo, smoothstep(0.48, 0.85, warped));

  // Two slowly wandering nuclei keep the energy roaming so it reads as
  // "thinking" rather than a static gradient. Their paths are slow,
  // irrational-ratio ellipses so they never repeat in an obvious loop.
  vec2 c1 = 0.20 * vec2(cos(t * 0.41), sin(t * 0.33));
  vec2 c2 = 0.26 * vec2(cos(-t * 0.27 + 1.7), sin(t * 0.37 + 0.5));
  float nuclei = nucleus(p, c1, 0.30) * (0.6 + 0.4 * sin(t * 1.3));
  nuclei += nucleus(p, c2, 0.24) * (0.6 + 0.4 * sin(t * 0.9 + 2.0));

  // Brightness: a tight breathing core plus a broad soft glow, lifted by
  // the wandering nuclei and modulated by the plasma shimmer.
  float core = exp(-warped * warped * 7.0);
  float glow = exp(-r * 2.4);
  float intensity = core * (1.1 + 0.5 * breath) + glow * 0.55 + nuclei * 0.7;
  intensity *= 0.82 + 0.30 * plasma;

  col *= intensity;

  // Soft pulsing rim light in lavender — a thin breathing halo that
  // catches the edge of the field.
  float rimPulse = 1.0 + 0.18 * sin(t * 1.1);
  float rim = smoothstep(0.06, 0.0, abs(r - 0.62 * rimPulse));
  col += colHalo * rim * 0.35 * (0.5 + 0.5 * breath);

  // Fade the whole field to transparent toward the rim so it melts into
  // the black glass well instead of showing a hard canvas square.
  float alpha = smoothstep(0.95, 0.20, r) * clamp(intensity, 0.0, 1.0);
  alpha = clamp(alpha + core * 0.6 + nuclei * 0.4, 0.0, 1.0);

  fragColor = vec4(col, alpha);
}
`;
