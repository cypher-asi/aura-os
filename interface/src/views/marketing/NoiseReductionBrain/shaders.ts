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
 *   RIGHT — color & creativity. The vessels drift through a saturated,
 *           multi-hue paint-splatter palette with a wide colorful aura
 *           blooming into the black glass — the abstract/art hemisphere.
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

// Reference palette: warm orange -> hot coral -> magenta-pink -> vivid
// periwinkle, topped by a saturated hot gold (NOT near-white) so even the
// brightest pulses stay colorful instead of washing out to white.
vec3 palette(float v) {
  vec3 cA = vec3(0.98, 0.42, 0.10);  // warm orange
  vec3 cB = vec3(1.00, 0.32, 0.34);  // hot coral
  vec3 cC = vec3(0.86, 0.24, 0.64);  // magenta / pink
  vec3 cD = vec3(0.40, 0.42, 0.98);  // vivid periwinkle
  vec3 cHot = vec3(1.00, 0.68, 0.22); // saturated hot gold crest

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

  // ----- RIGHT hemisphere: color, abstract paint, creativity -----------
  // Drive the palette by a faster drift + the local pulse so hue races,
  // and add an fbm hue offset so the field reads as abstract paint splatter
  // (many hues bleeding together) rather than one smooth gradient.
  float splat = fbm(uv * 4.0 + vec2(t * 0.15, -t * 0.1));
  float v = clamp(0.30 + 0.5 * flow + 0.22 * sin(t * 0.5) + 0.3 * pulse, 0.0, 1.0);
  v = clamp(v + 0.45 * (splat - 0.5), 0.0, 1.0);
  vec3 rightCol = palette(v);
  // Push saturation so the right reads vivid against the mono left.
  float rLum = dot(rightCol, vec3(0.299, 0.587, 0.114));
  rightCol = clamp(mix(vec3(rLum), rightCol, 1.4), 0.0, 1.0);
  // Hue floor: a small, pulse-independent palette term so the right vessels
  // always carry color even between pulses (they never collapse to grey/black).
  vec3 rightBase = rightCol;
  rightCol *= energy;
  rightCol += rightBase * mask * 0.5;

  // Crest on the brightest pulse fronts + spark flashes. A saturated hot hue
  // (NOT near-white) so peaks read as glowing color instead of washing the
  // right hemisphere out to white.
  vec3 crestCol = vec3(1.0, 0.55, 0.15);
  rightCol += crestCol * pow(mask * pulse * travel, 2.0) * 1.3;
  rightCol += crestCol * mask * spark * 1.0;

  // Wide multi-hue aura: drifting paint blooming into the black glass.
  vec3 auraCol = palette(clamp(0.55 + 0.28 * sin(t * 0.45) + 0.4 * (splat - 0.5), 0.0, 1.0));
  rightCol += auraCol * aura * 1.4;
  // Broad pulsating outer halo: a colorful glow spreading into the black
  // backdrop around the brain.
  vec3 haloCol = palette(clamp(0.5 + 0.35 * sin(t * 0.6 + 1.5), 0.0, 1.0));
  rightCol += haloCol * outerGlow * 1.2;

  // Final re-saturation: after all additions, pull the right firmly back
  // toward saturated color so bright peaks can't desaturate toward grey.
  float rLum2 = dot(rightCol, vec3(0.299, 0.587, 0.114));
  rightCol = max(mix(vec3(rLum2), rightCol, 1.5), 0.0);

  // Hue-preserving tone cap: when a vessel is over-bright (energy > 1 pushes
  // channels past 1), scale ALL channels down together so the brightest tops
  // out at 1.0. This keeps the color saturated at peak intensity instead of
  // each channel clamping independently to white.
  float rMax = max(rightCol.r, max(rightCol.g, rightCol.b));
  rightCol = rMax > 1.0 ? rightCol / rMax : rightCol;

  float rightAlpha = clamp(mask * 1.3 + bloom * 0.7 + aura * 0.95 + outerGlow * 0.7, 0.0, 1.0);

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
