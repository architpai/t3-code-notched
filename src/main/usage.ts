import WebSocket from "ws";
import { z } from "zod";
import { localOrigin } from "./http";
import { usageConfigSchema, type UsagePreview } from "../shared/usage";

// T3 uses Effect RPC's JSON envelope. This socket only reads server.getConfig.
export function readUsage(
  origin: string,
  token: string,
  signal: AbortSignal,
): Promise<UsagePreview> {
  const url = new URL("/ws", localOrigin(origin));
  url.protocol = "ws:";
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ providers: [], error: "Usage unavailable. Reconnect to T3." });
      return;
    }
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}` },
      maxPayload: 8 * 1024 * 1024,
      handshakeTimeout: 10_000,
      followRedirects: false,
    });
    let done = false;
    const finish = (result: UsagePreview) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", fail);
      socket.terminate();
      resolve(result);
    };
    const fail = () =>
      finish({
        providers: [],
        error: "Usage unavailable. Check T3's provider usage support.",
      });
    const timer = setTimeout(fail, 10_000);
    signal.addEventListener("abort", fail, { once: true });
    socket.on("error", fail);
    socket.on("close", fail);
    socket.on("open", () =>
      socket.send(
        JSON.stringify({
          _tag: "Request",
          id: "1",
          tag: "server.getConfig",
          payload: {},
          headers: [],
        }),
      ),
    );
    socket.on("message", (data, binary) => {
      try {
        if (binary) return fail();
        const message = z
          .object({
            _tag: z.literal("Exit"),
            requestId: z.literal("1"),
            exit: z.object({
              _tag: z.literal("Success"),
              value: usageConfigSchema,
            }),
          })
          .parse(JSON.parse(data.toString()));
        finish({ providers: message.exit.value.providers, error: null });
      } catch {
        fail();
      }
    });
  });
}
