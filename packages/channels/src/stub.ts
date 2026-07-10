import type { ChannelAdapter, ChannelId } from "@personacode/contracts";

/** "Coming soon" placeholder — the server lists it but never starts it. */
export function stubAdapter(id: ChannelId): ChannelAdapter {
  return {
    id,
    available: false,
    async start() {
      throw new Error(`${id} channel is not implemented yet`);
    },
    async send() {
      throw new Error(`${id} channel is not implemented yet`);
    },
    async stop() {},
  };
}
