---
icon: ph:arrow-right
---

# Stream Response

> Stream response to the client.

Using stream responses It allows you to send data to the client as soon as you have it. This is useful for large files or long running responses.

## Create a Stream

To stream a response, you first need to create a stream using the [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) API:

```ts
const stream = new ReadableStream();
```

For the example, we will create a start function that will send a random number every 100 milliseconds. After 1000 milliseconds, it will close the stream:

```ts
let interval: NodeJS.Timeout;
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue("<ul>");

    interval = setInterval(() => {
      controller.enqueue("<li>" + Math.random() + "</li>");
    }, 100);

    setTimeout(() => {
      clearInterval(interval);
      controller.close();
    }, 1000);
  },
  cancel() {
    clearInterval(interval);
  },
});
```

## Send a Stream

```ts
import { H3 } from "h3";

export const app = new H3();

app.use((event) => {
  // Set to response header to tell to the client that we are sending a stream.
  event.res.headers.set("Content-Type", "text/html");
  event.res.headers.set("Cache-Control", "no-cache");
  event.res.headers.set("Transfer-Encoding", "chunked");

  let interval: NodeJS.Timeout;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("<ul>");

      interval = setInterval(() => {
        controller.enqueue("<li>" + Math.random() + "</li>");
      }, 100);

      setTimeout(() => {
        clearInterval(interval);
        controller.close();
      }, 1000);
    },
    cancel() {
      clearInterval(interval);
    },
  });

  return stream;
});
```

Open your browser to http://localhost:3000 and you should see a list of random numbers appearing every 100 milliseconds.

Magic! 🎉
