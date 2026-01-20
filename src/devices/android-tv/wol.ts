import { logger } from "../../utils/logger";

const WOL_PORT = 9;
const WOL_WAIT_MS = 3000;

function createMagicPacket(mac: string): Buffer {
  const macBytes = mac
    .replace(/[:-]/g, "")
    .match(/.{2}/g)!
    .map((byte) => parseInt(byte, 16));

  const packet = Buffer.alloc(102);

  // 6 bytes of 0xFF
  for (let i = 0; i < 6; i++) {
    packet[i] = 0xff;
  }

  // MAC address repeated 16 times
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 6; j++) {
      packet[6 + i * 6 + j] = macBytes[j]!;
    }
  }

  return packet;
}

export async function sendWakeOnLan(mac: string): Promise<void> {
  logger.info("wol", `Sending WoL packet to ${mac}`);

  const packet = createMagicPacket(mac);

  const socket = await Bun.udpSocket({
    socket: {
      data() {},
    },
  });

  try {
    socket.send(packet, WOL_PORT, "255.255.255.255");
    logger.info("wol", `WoL packet sent, waiting ${WOL_WAIT_MS}ms for TV to wake`);
    await Bun.sleep(WOL_WAIT_MS);
  } finally {
    socket.close();
  }
}
