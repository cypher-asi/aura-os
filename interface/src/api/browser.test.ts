import { describe, it, expect } from "vitest";
import {
  decodeBinaryFrame,
  encodeFrameAck,
  FRAME_HEADER_LEN,
  FRAME_OPCODE,
  isBrowserServerTextEvent,
} from "./browser";

function makeFrameBuffer(seq: number, w: number, h: number, payload: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_HEADER_LEN + payload.length);
  const view = new DataView(buf);
  view.setUint8(0, FRAME_OPCODE);
  view.setUint32(1, seq, true);
  view.setUint16(5, w, true);
  view.setUint16(7, h, true);
  new Uint8Array(buf, FRAME_HEADER_LEN).set(payload);
  return buf;
}

describe("decodeBinaryFrame", () => {
  it("parses header and exposes payload", () => {
    const payload = new Uint8Array([0xff, 0xd8, 0xff]);
    const frame = decodeBinaryFrame(makeFrameBuffer(7, 1280, 800, payload));
    expect(frame).not.toBeNull();
    expect(frame!.header).toEqual({ seq: 7, width: 1280, height: 800 });
    expect(Array.from(frame!.jpeg)).toEqual(Array.from(payload));
  });

  it("returns null on short buffers", () => {
    expect(decodeBinaryFrame(new ArrayBuffer(3))).toBeNull();
  });

  it("returns null on wrong opcode", () => {
    const buf = new ArrayBuffer(FRAME_HEADER_LEN);
    new DataView(buf).setUint8(0, 0x99);
    expect(decodeBinaryFrame(buf)).toBeNull();
  });
});

describe("encodeFrameAck", () => {
  it("encodes the sequence number as LE u32", () => {
    const buf = encodeFrameAck(0xdeadbeef);
    const view = new DataView(buf);
    expect(view.getUint32(0, true)).toBe(0xdeadbeef);
  });
});

describe("isBrowserServerTextEvent", () => {
  it("accepts a nav event", () => {
    expect(
      isBrowserServerTextEvent({
        type: "nav",
        nav: { url: "http://localhost", title: null, can_go_back: false, can_go_forward: false, loading: false },
      }),
    ).toBe(true);
  });

  it("accepts an exit event", () => {
    expect(isBrowserServerTextEvent({ type: "exit", code: 0 })).toBe(true);
  });

  it("rejects garbage", () => {
    expect(isBrowserServerTextEvent(null)).toBe(false);
    expect(isBrowserServerTextEvent({ type: "other" })).toBe(false);
    expect(isBrowserServerTextEvent({ type: "nav" })).toBe(false);
  });
});
