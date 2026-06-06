/*
 * GLSL ES 3.00 source for the WebGL2 animated SPLIT brain that lives in the
 * NoiseReductionCard's top "screen" (the spec bento below "Expertise without
 * ego. ... from coding to science to creativity.").
 *
 * Rather than draw a brain from scratch, this samples the existing
 * `/noise-reduction-brain.png` angiography as a luminance MASK (bright =
 * vessel, black = background) and brings it to life, then splits it down the
 * anatomical midline (image UV x = 0.5, softly feathered):
 *
 *   LEFT  — black & white. Monochrome vessels read like an ink/blueprint
 *           line-drawing over a faint, slowly scrolling backdrop of real
 *           code and mathematics (sampled from `u_code`). This is the
 *           analytical "coding to science" hemisphere.
 *   RIGHT — orange neon structure over purple matter. Glowing orange neon
 *           lines (the vessels) are the brain's inner structure, set over a
 *           purple "matter" field filling the regions. This base gently
 *           pulsates while discrete bright signals travel region-to-region
 *           along axes on top — the abstract/creative hemisphere.
 *
 * Energy pulses travel along the vessels and the whole thing breathes on
 * both sides. Alpha follows the lit vessels + aura so the screen's black
 * glass shows through the empty space — the canvas blends over the static
 * fallback img.
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
uniform sampler2D u_tex;       // brain angiography (vessel mask)
uniform sampler2D u_code;      // generated code/math glyph texture (left bg)
uniform vec2 u_codeResolution; // code texture natural size

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

  // Tight bloom (close neighbors) so the vessels themselves read as
  // emissive rather than flat lines.
  vec2 px = 1.5 / u_texResolution;
  float bloom = mask;
  bloom += maskAt(uv + vec2(px.x, 0.0));
  bloom += maskAt(uv + vec2(-px.x, 0.0));
  bloom += maskAt(uv + vec2(0.0, px.y));
  bloom += maskAt(uv + vec2(0.0, -px.y));
  bloom += maskAt(uv + px * 2.0);
  bloom += maskAt(uv - px * 2.0);
  bloom /= 7.0;

  // Wide soft AURA: average the mask over expanding rings so the glow
  // blooms far beyond the vessels into the black glass, wrapping the whole
  // brain in a luminous energy field.
  vec2 ap = 1.0 / u_texResolution;
  float aura = 0.0;
  const int AURA_TAPS = 10;
  for (int i = 0; i < AURA_TAPS; i++) {
    float a = (float(i) / float(AURA_TAPS)) * 6.2831853;
    vec2 dir = vec2(cos(a), sin(a));
    aura += maskAt(uv + dir * ap * 16.0);
    aura += maskAt(uv + dir * ap * 38.0);
    aura += maskAt(uv + dir * ap * 66.0);
    aura += maskAt(uv + dir * ap * 100.0);
  }
  aura /= float(AURA_TAPS * 4);
  // Throb the aura so the whole field surges in and out.
  aura *= 0.8 + 0.7 * (0.5 + 0.5 * sin(t * 1.7));

  // Wide outer HALO: average the mask over much larger rings so a soft glow
  // spreads far beyond the brain into the surrounding black, wrapping the
  // whole image in a luminous backdrop. Slower, deeper pulsation than the
  // tight aura so it reads as an ambient field breathing behind the brain.
  float halo = 0.0;
  const int HALO_TAPS = 14;
  for (int i = 0; i < HALO_TAPS; i++) {
    float a = (float(i) / float(HALO_TAPS)) * 6.2831853;
    vec2 dir = vec2(cos(a), sin(a));
    halo += maskAt(uv + dir * ap * 140.0);
    halo += maskAt(uv + dir * ap * 210.0);
    halo += maskAt(uv + dir * ap * 300.0);
    halo += maskAt(uv + dir * ap * 410.0);
  }
  halo /= float(HALO_TAPS * 4);
  // Lift + soften so the halo reads as a broad cloud rather than rings.
  halo = pow(clamp(halo * 2.2, 0.0, 1.0), 0.65);
  // Deep, slow pulsation so the backdrop swells in and out.
  float haloPulse = 0.45 + 0.55 * (0.5 + 0.5 * sin(t * 0.9));
  float outerGlow = halo * haloPulse;

  // Fast, churning flow field so the vasculature looks busy and restless.
  vec2 flowP = uv * 7.0;
  float flow = fbm(flowP + vec2(-t * 0.7, t * 0.42));
  flow = fbm(flowP + 3.5 * vec2(flow, fbm(flowP - t * 0.34)));

  // Sharp moving crests = bright pulse fronts running through vessels.
  float pulse = pow(clamp(flow * 1.45, 0.0, 1.0), 1.7);

  // Several overlapping pulse trains in different directions/speeds so the
  // brain fires everywhere at once instead of a single sweeping wave.
  float travel = 0.0;
  travel += sin((uv.x + uv.y) * 24.0 - t * 5.5 + flow * 9.0);
  travel += sin((uv.x - uv.y) * 19.0 - t * 3.7 + flow * 7.0);
  travel += sin(length(uv - 0.5) * 34.0 - t * 6.5);
  travel = 0.5 + 0.5 * (travel / 3.0);

  // High-frequency firing sparkles igniting along the vessels.
  float spark = fbm(uv * 46.0 + vec2(t * 2.6, -t * 1.9));
  spark = pow(clamp(spark, 0.0, 1.0), 5.0);

  // Faster, deeper global breathing (shared by both hemispheres).
  float breathe = 0.9 + 0.28 * sin(t * 1.3);

  // Shared vessel intensity: hotter base, pulse fronts and sparks blowing
  // out to white. Drives both the colorful right and the mono left.
  float energy = mask * (0.85 + 1.5 * pulse * travel);
  energy += mask * spark * 2.2;       // firing sparkles
  energy += bloom * 0.6;              // emissive vessels
  energy *= breathe;

  // ----- RIGHT hemisphere: orange neon structure + purple matter --------
  // Base look (stays put, gently pulsates): glowing orange neon lines are the
  // brain's inner structure (the vessels), set over purple "matter" filling
  // the regions around and between them. This base layer only breathes -- the
  // motion comes from the communication signals layered on top.
  float basePulse = 0.82 + 0.18 * sin(t * 1.2 + length(uv - 0.5) * 5.0);

  vec3 neonOrange = vec3(1.0, 0.46, 0.12);
  vec3 matterPurple = vec3(0.46, 0.20, 0.80);

  // Purple matter: broad soft tissue from the aura/halo fields so the regions
  // glow even away from the vessels.
  float matter = clamp(aura * 1.3 + outerGlow * 0.9 + bloom * 0.35, 0.0, 1.0);
  vec3 rightCol = matterPurple * matter * basePulse;

  // Orange neon inner structure: emissive vessels, plus a hot core on the
  // densest junctions so they read as bright soma nodes.
  float structure = (mask * 1.25 + bloom * 0.85) * basePulse;
  rightCol += neonOrange * structure;
  rightCol += vec3(1.0, 0.72, 0.30) * pow(mask, 3.0) * basePulse * 0.9;

  // ----- Pulsating communication signals --------------------------------
  // Discrete bright "items" travelling region-to-region along several axes.
  // Each axis projects UV onto a direction (warped by the flow field so the
  // path bends organically); fract() makes a repeating train and a tight
  // gaussian isolates each into a compact moving packet. Gated by the vessel
  // mask so the signals ride the neon structure like real impulses.
  float comm = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ang = fi * 1.7 + 0.5;
    vec2 axis = vec2(cos(ang), sin(ang));
    float proj = dot(uv - 0.5, axis) + 0.18 * flow;
    float freq = 5.0 + 1.6 * fi;
    float speed = 0.55 + 0.18 * fi;
    float ph = fract(proj * freq - t * speed);
    comm += exp(-pow(ph - 0.5, 2.0) * 320.0);
  }
  comm *= clamp(mask + bloom * 0.5, 0.0, 1.0);

  // Signals flash a hot near-white orange so they pop along the lines.
  rightCol += vec3(1.0, 0.80, 0.45) * comm * 1.9;

  // Hue-preserving tone cap: scale all channels down together when over-bright
  // so peaks stay saturated color instead of clamping to white.
  float rMax = max(rightCol.r, max(rightCol.g, rightCol.b));
  rightCol = rMax > 1.0 ? rightCol / rMax : rightCol;

  float rightAlpha = clamp(
    mask * 1.3 + bloom * 0.7 + matter * 0.95 + comm * 0.85, 0.0, 1.0);

  // ----- LEFT hemisphere: black & white code + mathematics --------------
  // Vessels as a near-white ink line-drawing (strictly grayscale).
  float mono = clamp(energy, 0.0, 1.6);
  vec3 leftCol = vec3(0.94, 0.96, 1.0) * mono;
  leftCol += vec3(1.0) * pow(mask * pulse * travel, 2.0) * 1.2;  // mono crest

  // Faint, slowly scrolling backdrop of real code/math, concentrated in the
  // empty space so the vessel line-art stays the dominant read. The code
  // texture tiles and drifts upward like a calm matrix readout.
  vec2 codeUv = uv * vec2(2.4, 2.4) + vec2(0.0, -t * 0.03);
  float code = texture(u_code, fract(codeUv)).r;
  float backdrop = code * (0.85 - 0.7 * clamp(aura * 1.5, 0.0, 1.0));
  leftCol += vec3(0.62, 0.66, 0.72) * backdrop * 0.5;
  // Broad pulsating outer halo (monochrome) glowing into the backdrop.
  leftCol += vec3(0.74, 0.79, 0.9) * outerGlow * 0.9;

  float leftAlpha = clamp(mask * 1.3 + bloom * 0.7 + aura * 0.5 + backdrop * 0.4 + outerGlow * 0.6, 0.0, 1.0);

  // ----- Split + feathered seam ----------------------------------------
  // 0 = left hemisphere, 1 = right hemisphere, blended across the midline.
  float side = smoothstep(0.46, 0.54, uv.x);
  vec3 col = mix(leftCol, rightCol, side);
  float alpha = mix(leftAlpha, rightAlpha, side);

  // Soft luminous divider down the midline where the two worlds meet.
  float seamGlow = smoothstep(0.03, 0.0, abs(uv.x - 0.5)) * (mask * 1.2 + aura);
  col += vec3(0.9, 0.92, 1.0) * seamGlow * 0.5;
  alpha = clamp(alpha + seamGlow * 0.4, 0.0, 1.0);

  fragColor = vec4(col, alpha);
}
`;
