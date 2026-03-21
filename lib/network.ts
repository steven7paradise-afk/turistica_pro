import os from "os";
import type { NetworkAddress } from "@/app/turnistica/_lib/types";

const DEFAULT_PORT = Number(process.env.PORT || "3001");

export function getLocalNetworkAddresses(port = DEFAULT_PORT): NetworkAddress[] {
  const addresses = os.networkInterfaces();
  const unique = new Map<string, NetworkAddress>();

  Object.values(addresses).forEach((group) => {
    group?.forEach((address) => {
      if (address.family !== "IPv4" || address.internal) {
        return;
      }

      const label = address.address.startsWith("192.168.") ? "Wi-Fi / LAN" : "Rete locale";
      const url = `http://${address.address}:${port}`;
      unique.set(url, { label, url });
    });
  });

  return [...unique.values()].sort((left, right) => left.url.localeCompare(right.url));
}
