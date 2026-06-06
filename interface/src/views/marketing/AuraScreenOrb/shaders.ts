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
