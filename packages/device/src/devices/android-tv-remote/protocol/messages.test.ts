import { expect, test } from "bun:test";
import { parseMessage } from "./messages";

// A length-delimited field that claims more bytes than the buffer contains is
// malformed; parseMessage must reject it rather than return a truncated payload.
test("parseMessage rejects a length-delimited payload that overruns the buffer", () => {
  // tag = fieldTag(41, WIRE_LENGTH_DELIMITED) = (41<<3)|2 = 330 -> varint [0xCA,0x02].
  // Declared payload length 10 (0x0A) but only 2 payload bytes are present.
  const truncated = new Uint8Array([0xca, 0x02, 0x0a, 0xaa, 0xbb]);

  expect(parseMessage(truncated)).toBeNull();
});

// Required envelope fields (protocolVersion field 1, status field 2) must be
// present for pairing frames, not silently defaulted to 0 when a frame omits
// them. The strict envelope check is the default.
test("parseMessage rejects a frame missing the required protocol/status fields", () => {
  // Only the type field (41), a valid 2-byte payload, and NO field 1 / field 2.
  const noEnvelope = new Uint8Array([0xca, 0x02, 0x02, 0xaa, 0xbb]);

  expect(parseMessage(noEnvelope)).toBeNull();
});

// The remote envelope (RemoteMessage) has no protocol_version/status fields: a
// real REMOTE_CONFIGURE frame is just field 1 (length-delimited) with no field
// 1/2 varints. With requireEnvelope:false, such a bare frame must parse (its
// absent envelope fields defaulting to 0) rather than being rejected.
test("parseMessage accepts a bare remote frame when the envelope is not required", () => {
  // field1(REMOTE_CONFIGURE, length-delimited) = [0xAA,0xBB]; no field 1/2 varints.
  // tag = fieldTag(1, WIRE_LENGTH_DELIMITED) = (1<<3)|2 = 0x0A.
  const bareRemote = new Uint8Array([0x0a, 0x02, 0xaa, 0xbb]);

  // The default strict mode rejects it; the remote path must opt out.
  expect(parseMessage(bareRemote)).toBeNull();

  const message = parseMessage(bareRemote, { requireEnvelope: false });
  expect(message).not.toBeNull();
  expect(message?.type).toBe(1);
  expect(message?.payload.length).toBe(2);
  expect(message?.protocolVersion).toBe(0);
  expect(message?.status).toBe(0);
});

// A length varint that decodes to a negative 32-bit int (5-byte varint with bit
// 31 set) must be rejected. Left unchecked it slips past the overrun bounds
// check, drives offset backward, and wedges the parse loop (~1e8 iterations) --
// a DoS an untrusted peer could trigger.
test("parseMessage rejects a length-delimited field with a negative length varint", () => {
  // tag = fieldTag(41, WIRE_LENGTH_DELIMITED) = [0xCA,0x02].
  // length varint [0x80,0x80,0x80,0x80,0x0f] decodes to 0x0F<<28 = -268435456.
  const negativeLength = new Uint8Array([0xca, 0x02, 0x80, 0x80, 0x80, 0x80, 0x0f]);

  expect(parseMessage(negativeLength, { requireEnvelope: false })).toBeNull();
});

// Guard (not a bug pin): a well-formed envelope must still parse. A fix for F7
// must not reject valid frames.
test("parseMessage accepts a well-formed envelope", () => {
  // field1(version)=2, field2(status)=200, field41(payload)= [0xAA,0xBB]
  // v: tag (1<<3)|0 = 0x08, value 0x02
  // status: tag (2<<3)|0 = 0x10, value 200 -> varint [0xC8,0x01]
  // payload: tag [0xCA,0x02], len 0x02, [0xAA,0xBB]
  const wellFormed = new Uint8Array([0x08, 0x02, 0x10, 0xc8, 0x01, 0xca, 0x02, 0x02, 0xaa, 0xbb]);
  const message = parseMessage(wellFormed);

  expect(message).not.toBeNull();
  expect(message?.protocolVersion).toBe(2);
  expect(message?.status).toBe(200);
  expect(message?.type).toBe(41);
  expect(message?.payload.length).toBe(2);
});
