import { expect, test } from "bun:test";
import { createFrameReader } from "./framing";

// Invalid framing (a varint whose continuation bit never clears) can never be
// made valid by more input, so read() must surface it as an error rather than
// silently returning null and retaining the bytes forever.
test("read() surfaces an error for definitively-invalid framing", () => {
  const reader = createFrameReader();
  // 6 continuation-flagged bytes overflow the 35-bit varint limit -> invalid,
  // unrecoverable framing (decodeVarint throws "Varint too long").
  reader.append(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));

  expect(() => reader.read()).toThrow();
});

// Invalid framing must not jam the buffer: a valid frame appended afterwards
// still has to be delivered once the unrecoverable bytes are discarded.
test("read() does not permanently swallow a valid frame stuck behind invalid framing", () => {
  const reader = createFrameReader();
  reader.append(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
  try {
    reader.read();
  } catch {
    // A fix may throw here; that is acceptable -- the point is it must not
    // silently return null and keep the buffer wedged.
  }
  // A single-byte length prefix (2) plus its 2 body bytes: a complete, valid frame.
  reader.append(new Uint8Array([0x02, 0xaa, 0xbb]));

  // On current code this returns null forever because the invalid prefix is
  // still buffered ahead of the valid frame.
  const message = reader.read();
  expect(message).not.toBeNull();
});

// Guard (not a bug pin): genuinely-incomplete input must still return null and
// wait for more bytes. A fix for F6 must not over-correct and reject this.
test("read() returns null for an incomplete (but valid) frame", () => {
  const reader = createFrameReader();
  // Declares length 10 but only 3 body bytes are present so far.
  reader.append(new Uint8Array([0x0a, 0x01, 0x02, 0x03]));

  expect(reader.read()).toBeNull();
});
