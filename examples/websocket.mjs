import { H3, serve, html, defineWebSocketHandler } from "h3";
import { plugin as ws } from "crossws/server";

export const app = new H3();

// A single route serves both the playground page (plain HTTP) and the
// WebSocket endpoint (upgrade requests). The page connects back to itself.
app.get(
  "/",
  defineWebSocketHandler(
    {
      open(peer) {
        console.log("[open]", peer);

        // Send welcome to the new client
        peer.send("Welcome to the server!");

        // Join new client to the "chat" channel
        peer.subscribe("chat");

        // Notify every other connected client
        peer.publish("chat", `[system] ${peer} joined!`);
      },

      message(peer, message) {
        console.log("[message]", peer);

        if (message.text() === "ping") {
          // Reply to the client with a ping response
          peer.send("pong");
          return;
        }

        // The server re-broadcasts incoming messages to everyone
        peer.publish("chat", `[${peer}] ${message}`);

        // Echo the message back to the sender
        peer.send(message);
      },

      close(peer) {
        console.log("[close]", peer);
        peer.publish("chat", `[system] ${peer} has left the chat!`);
        peer.unsubscribe("chat");
      },
    },
    // Non-upgrade requests get a minimal WebSocket playground.
    () => html`<!doctype html>
      <title>H3 WebSocket Playground</title>
      <h1>H3 WebSocket Playground</h1>
      <form id="form">
        <input id="input" placeholder="Type a message..." autocomplete="off" autofocus />
        <button type="submit">Send</button>
      </form>
      <div id="log"></div>
      <script type="module">
        const log = (msg) => {
          const line = document.createElement("div");
          line.textContent = msg;
          document.getElementById("log").append(line);
        };
        const url = location.href.replace(/^http/, "ws");
        const ws = new WebSocket(url);
        ws.addEventListener("open", () => log("[open] connected to " + url));
        ws.addEventListener("message", (e) => log("[message] " + e.data));
        ws.addEventListener("close", () => log("[close] disconnected"));
        document.getElementById("form").addEventListener("submit", (e) => {
          e.preventDefault();
          const input = document.getElementById("input");
          ws.send(input.value);
          input.value = "";
        });
      </script>`,
  ),
);

serve(app, {
  plugins: [ws({ resolve: async (req) => (await app.fetch(req)).crossws })],
});
