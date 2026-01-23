import { H3, serve, defineWebSocketHandler } from "h3";
import { plugin as ws } from "crossws/server";

export const app = new H3();

const demoURL =
  "https://raw.githubusercontent.com/h3js/crossws/refs/heads/main/playground/public/index.html";

app.get("/", () =>
  fetch(demoURL).then(
    (res) => new Response(res.body, { headers: { "Content-Type": "text/html" } }),
  ),
);

app.get(
  "/_ws",
  defineWebSocketHandler({
    // upgrade(req) {},
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
  }),
);

serve(app, {
  plugins: [ws({ resolve: async (req) => (await app.fetch(req)).crossws })],
});
