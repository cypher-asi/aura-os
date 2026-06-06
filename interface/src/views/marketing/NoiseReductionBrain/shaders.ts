/*
 * GLSL ES 3.00 source for the WebGL2 animated brain that lives in the
 * NoiseReductionCard's top "screen" (the DELE deep-learning noise-reduction
 * plugin mini-UI in the spec bento below "Expertise without ego.").
 *
 * Rather than draw a brain from scratch, this samples the existing
 * `/noise-reduction-brain.png` angiography as a luminance MASK (bright =
 * vessel, black = background) and brings it to life: energy pulses travel
 * along the vessels, the whole thing breathes, and the color slowly drifts
 * through the reference palette (warm orange -> coral -> mauve -> soft
 * lavender). Alpha follows the mask so the screen's black glass shows
 * through the empty space — the canvas blends over the static fallback img.
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

uniform vec2 u_resolution;     // canvas size in device px
uniform vec2 u_texResolution;  // brain image natural size
uniform float u_time;
uniform sampler2D u_tex;

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

// Reference palette: warm orange -> coral -> dusty mauve -> soft
// lavender/periwinkle, with a near-white hot crest so the brightest
// pulses read as glowing.
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

// Luminance of the brain texture at a given UV, clamped to the image so
// "contain" letterbox bands read as background (0).
float maskAt(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  vec3 c = texture(u_tex, uv).rgb;
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  // object-fit: contain — map the canvas frag coord into the brain image's
  // UV space, preserving the image aspect and centering it (letterbox).
  vec2 uvScreen = gl_FragCoord.xy / u_resolution;
  float canvasAspect = u_resolution.x / u_resolution.y;
  float imageAspect = u_texResolution.x / u_texResolution.y;
  vec2 scale = canvasAspect > imageAspect
    ? vec2(imageAspect / canvasAspect, 1.0)   // pillarbox
    : vec2(1.0, canvasAspect / imageAspect);  // letterbox
  vec2 uv = (uvScreen - 0.5) / scale + 0.5;

  float t = u_time;

  // Vessel mask from the source angiography.
  float mask = maskAt(uv);

  // A soft bloom of the mask (sample a few neighbors) so glow leaks just
  // past the vessels, giving them an emissive halo on the black glass.
  vec2 px = 1.5 / u_texResolution;
  float bloom = mask;
  bloom += maskAt(uv + vec2(px.x, 0.0));
  bloom += maskAt(uv + vec2(-px.x, 0.0));
  bloom += maskAt(uv + vec2(0.0, px.y));
  bloom += maskAt(uv + vec2(0.0, -px.y));
  bloom += maskAt(uv + px * 2.0);
  bloom += maskAt(uv - px * 2.0);
  bloom /= 7.0;

  // Energy traveling along the vessels: a flowing noise field scrolled over
  // time, gated by the mask so it only lights up where there is vasculature.
  vec2 flowP = uv * 6.0;
  float flow = fbm(flowP + vec2(-t * 0.35, t * 0.18));
  flow = fbm(flowP + 3.0 * vec2(flow, fbm(flowP - t * 0.12)));

  // Sharp moving crests = the bright pulse fronts running through vessels.
  float pulse = pow(clamp(flow * 1.2, 0.0, 1.0), 2.2);
  float travel = 0.5 + 0.5 * sin((uv.x + uv.y) * 14.0 - t * 2.0 + flow * 6.2831);

  // Slow global breathing of the whole brain.
  float breathe = 0.85 + 0.15 * sin(t * 0.9);

  // Drive the palette by a slow drift + the local pulse so hue travels.
  float v = clamp(0.30 + 0.45 * flow + 0.20 * sin(t * 0.25) + 0.25 * pulse, 0.0, 1.0);
  vec3 col = palette(v);

  // Intensity: base vessels lit, pulse fronts blowing out toward white.
  float energy = mask * (0.55 + 0.75 * pulse * travel);
  energy += bloom * 0.35;            // emissive halo around vessels
  energy *= breathe;
  col *= energy;

  // Hot crest on the brightest pulse fronts so they read as electric.
  col += vec3(1.0, 0.9, 0.78) * pow(mask * pulse * travel, 2.0) * 0.9;

  // Alpha follows the lit vessels (+ a faint halo) so the black background
  // stays transparent and the screen's glass shows through.
  float alpha = clamp(mask * 1.2 + bloom * 0.5, 0.0, 1.0);

  fragColor = vec4(col, alpha);
}
`;
