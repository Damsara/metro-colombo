import { Effect } from "effect";
import { WebSocket } from "ws";
import { SocketError, type SocketShape } from "@metro/core";

// The URL carries the session token, so no message ever names it.
const didNotOpen = () => new SocketError({ message: "socket did not open" });

export const wsSocket: SocketShape = {
  connect: (url, headers, onText) =>
    Effect.callback<void, SocketError>((resume) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url, {
          headers: { ...headers },
          handshakeTimeout: 15_000,
          maxPayload: 2 * 1024 * 1024,
          followRedirects: false,
        });
      } catch {
        resume(Effect.fail(didNotOpen()));
        return;
      }
      let opened = false;
      socket.on("open", () => {
        opened = true;
      });
      socket.on("message", (data, isBinary) => {
        if (!isBinary) onText(data.toString());
      });
      // 'close' always follows 'error'.
      socket.on("error", () => {});
      socket.on("close", () =>
        resume(opened ? Effect.void : Effect.fail(didNotOpen())),
      );
      return Effect.sync(() => socket.terminate());
    }),
};
