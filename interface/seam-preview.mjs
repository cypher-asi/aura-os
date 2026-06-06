import sharp from "sharp";

function build({ W, H, kr, ky, gap, endOff, soOff, filo, name }) {
  const VBW = 400,
    VBH = 360;
  const kx = W / 2;
  const R = kr + gap;
  const endYo = ky - endOff;
  const So = ky + soOff;
  const dx = Math.sqrt(R * R - (ky - endYo) ** 2);
  const exLo = kx - dx,
    exRo = kx + dx;
  const shLo = exLo - filo,
    shRo = exRo + filo;
  const X = (o) => ((o * VBW) / W).toFixed(1);
  const Y = (o) => ((o * VBH) / H).toFixed(1);
  const rxD = ((R * VBW) / W).toFixed(1),
    ryD = ((R * VBH) / H).toFixed(1);
  const rxF = ((filo * VBW) / W).toFixed(1),
    ryF = ((filo * VBH) / H).toFixed(1);
  const path = `M0 360 L0 ${Y(So)} L${X(shLo)} ${Y(So)} A${rxF} ${ryF} 0 0 0 ${X(exLo)} ${Y(endYo)} A${rxD} ${ryD} 0 0 1 ${X(exRo)} ${Y(endYo)} A${rxF} ${ryF} 0 0 0 ${X(shRo)} ${Y(So)} L400 ${Y(So)} L400 360 Z`;
  console.log(name + ":", path);
}

// Desktop: compact controls plate (no waveform). gap:23 -> dome rises around
// the knob and contains the tick ring (ticks sit at knob r + 12). W includes
// the ::before's -7px side bleed (controls content width 503 + 14) so the
// plate fills the rounded bottom corners. ky (knob center from top) is
// unchanged by the caption since it only grows the plate's bottom.
// H = padTop16 + knobMt20 + knob100 + knobMb16 + caption36 + padBottom28
build({ W: 517, H: 216, kr: 50, ky: 86, gap: 23, endOff: 12, soOff: 4, filo: 14, name: "desktop" });
// Mobile: compact controls plate (knobwrap inherits 20/16, knob 84). gap:19.
// W includes the ::before's -7px side bleed (318 + 14).
// H = padTop14 + knobMt20 + knob84 + knobMb16 + caption36 + padBottom24
build({ W: 332, H: 194, kr: 42, ky: 76, gap: 19, endOff: 10, soOff: 4, filo: 12, name: "mobile" });
