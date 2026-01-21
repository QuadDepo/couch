import net from "node:net";

export function isValidIp(ip: string): boolean {
  return net.isIP(ip) !== 0;
}