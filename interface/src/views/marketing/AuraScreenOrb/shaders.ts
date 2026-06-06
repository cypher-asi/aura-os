/*
 * GLSL ES 3.00 source for the WebGL2 "agent screen" orb that lives on the
 * AgentConsole device's top circular readout. Rather than a centered
 * radial "eye", this is a flowing, domain-warped noise field — liquid
 * marbled plasma that drifts and folds across the whole disc, so it reads
 * as a restless moving pattern (an AGI thinking) instead of a glowing
 * pupil. Color is driven by the flow value, not distance from center,
 * cycling through the reference palette (warm orange -> coral -> mauve ->
 * soft lavender/periwinkle). The disc fades to transparent at the rim so
 * it blends into the black glass well of the screen.
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

export const SCREEN_FRAGMENT_SHADER = `#version 300 es
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

// Map a 0..1 flow value to the reference palette: warm orange -> coral
// -> dusty mauve -> soft lavender/periwinkle, with a near-white hot
// crest at the very top so bright folds read as glowing.
vec3 palette(float v) {
  vec3 cA = vec3(0.98, 0.46, 0.14);  // warm orange
  vec3 cB = vec3(1.00, 0.50, 0.40);  // coral / salmon
  vec3 cC = vec3(0.80, 0.56, 0.66);  // dusty mauve
  vec3 cD = vec3(0.66, 0.71, 0.94);  // soft lavender / periwinkle
  vec3 cHot = vec3(1.00, 0.93, 0.82); // near-white crest

  vec3 col = mix(cA, cB, smoothstep(0.0, 0.35, v));
  col = mix(col, cC, smoothstep(0.30, 0.62, v));
  col = mix(col, cD, smoothstep(0.58, 0.86, v));
  col = mix(col, cHot, smoothstep(0.86, 1.0, v));
  return col;
}

// Signed distance to a rounded box (negative inside, 0 on the outline).
// With radius = min(halfW, halfH) the rounded box collapses into an exact
// stadium/pill, so the vignette and edge feather hug the very same shape
// CSS clips the screen to — no squared-off corners at the rounded ends.
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  // Aspect-correct, y-normalized coordinates centered on the screen.
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;

  // Domain warping: fold the coordinate space through layers of flowing
  // noise so the pattern marbles and churns across the whole disc rather
  // than radiating from the center. Each layer is offset by the previous
  // one and pushed along its own drift direction.
  vec2 p = uv * 2.3;

  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0) + vec2(t * 0.12, t * 0.05)),
    fbm(p + vec2(5.2, 1.3) + vec2(-t * 0.10, t * 0.08))
  );

  vec2 s = vec2(
    fbm(p + 3.5 * q + vec2(1.7, 9.2) + vec2(t * 0.06, -t * 0.09)),
    fbm(p + 3.5 * q + vec2(8.3, 2.8) - vec2(t * 0.07, t * 0.04))
  );

  float flow = fbm(p + 4.0 * s + vec2(-t * 0.05, t * 0.03));

  // Spread the flow value across the full 0..1 palette range and give it
  // a slow global breathing shift so the whole pattern drifts in hue.
  float v = clamp(flow * 1.35 + 0.12 * sin(t * 0.4), 0.0, 1.0);
  vec3 col = palette(v);

  // Glowing ridges: bright filaments where the warped layers stack up,
  // pulsing on their own slow beat so highlights travel through the
  // pattern like thought moving through it.
  float ridge = pow(clamp(dot(q, s) + 0.5, 0.0, 1.0), 1.8);
  float pulse = 0.6 + 0.4 * sin(t * 1.2 + flow * 6.2831);
  col += vec3(1.0, 0.85, 0.7) * ridge * 0.45 * pulse;

  // Gentle overall luminance lift so the pattern reads as emissive on the
  // black glass, modulated by the flow so it shimmers as it moves.
  col *= 0.78 + 0.55 * flow + 0.18 * pulse;

  // Vignette + edge feather that follow the pill outline (not a square),
  // so the inner dark band hugs the rounded ends and the bright field
  // never gets cut off in the corners. sdRoundBox gives the stadium SDF
  // in pixel space; we darken toward the bezel and feather the last pixel.
  vec2 fragP = gl_FragCoord.xy - 0.5 * u_resolution;
  vec2 halfRes = 0.5 * u_resolution;
  float radius = min(halfRes.x, halfRes.y);
  float sd = sdRoundBox(fragP, halfRes, radius);

  // -sd/radius is 0 at the edge and 1 at the deepest interior point.
  float inset = clamp(-sd / radius, 0.0, 1.0);
  col *= mix(0.48, 1.0, smoothstep(0.0, 0.5, inset));

  // Feather only the last ~1.5px under the bezel; CSS clips the same pill.
  float alpha = smoothstep(1.5, -1.5, sd);

  fragColor = vec4(col, alpha);
}
`;

/**
 * Radial variant for the tiny circular "+" attach-button well on the
 * marketing mock LLM input. The shared SCREEN shader's domain-warped fbm
 * is far too fine-grained to read at ~24px, so this one works in polar
 * space: a few big, slow flowing bands ripple outward from the center,
 * a bright rim makes the disc edge glow, and a radial vignette darkens
 * the core so the well reads as inset into the page. Reuses the same warm
 * palette as the screen shader for visual continuity.
 */
export const RADIAL_FRAGMENT_SHADER = `#version 300 es
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

// Coarse fbm: only 3 octaves so folds stay large and legible at small size.
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

vec3 palette(float v) {
  vec3 cA = vec3(0.98, 0.46, 0.14);  // warm orange
  vec3 cB = vec3(1.00, 0.50, 0.40);  // coral / salmon
  vec3 cC = vec3(0.80, 0.56, 0.66);  // dusty mauve
  vec3 cD = vec3(0.66, 0.71, 0.94);  // soft lavender / periwinkle
  vec3 cHot = vec3(1.00, 0.93, 0.82); // near-white crest

  vec3 col = mix(cA, cB, smoothstep(0.0, 0.35, v));
  col = mix(col, cC, smoothstep(0.30, 0.62, v));
  col = mix(col, cD, smoothstep(0.58, 0.86, v));
  col = mix(col, cHot, smoothstep(0.86, 1.0, v));
  return col;
}

void main() {
  // Normalize so the disc radius is ~1.0 regardless of pixel size.
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / (0.5 * min(u_resolution.x, u_resolution.y));
  float t = u_time;

  float r = length(uv);
  float angle = atan(uv.y, uv.x);

  // Polar domain: low frequency along the angle (broad lobes) and along
  // the radius (a few concentric bands), so the whole pattern is built
  // from big shapes rather than tiny speckle.
  vec2 polar = vec2(angle * 1.4, r * 2.2);

  // Two cheap warp layers that swirl the bands and drift them outward
  // from the center, so the field flows radially.
  vec2 q = vec2(
    fbm(polar + vec2(0.0, -t * 0.30)),
    fbm(polar + vec2(3.7, 1.2) + vec2(t * 0.12, -t * 0.22))
  );
  float flow = fbm(polar + 2.0 * q + vec2(0.6 * sin(t * 0.25), -t * 0.18));

  float v = clamp(flow * 1.35 + 0.12 * sin(t * 0.4 + r * 3.0), 0.0, 1.0);
  vec3 col = palette(v);

  // Glowing rim: a bright ring that peaks near the disc edge so the
  // circle reads as an emissive, edge-lit well.
  float rim = smoothstep(0.55, 0.98, r) * (0.7 + 0.3 * sin(t * 1.1 + angle * 2.0));
  col += vec3(1.0, 0.86, 0.72) * rim * 0.55;

  // Radial vignette: darken toward the core and lift toward the rim so
  // the well looks sunk into the surface (inset), then a soft emissive
  // breathing so the whole field shimmers as it flows.
  col *= mix(0.42, 1.05, smoothstep(0.0, 0.85, r));
  col *= 0.85 + 0.4 * flow;

  // Feather alpha to 0 at the disc edge; CSS also clips to the circle.
  float alpha = smoothstep(1.0, 0.86, r);

  fragColor = vec4(col, alpha);
}
`;
