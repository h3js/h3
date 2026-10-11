---
icon: ph:arrow-right
---

# Static Assets

> Serve static assets such as HTML, images, CSS, JavaScript, etc.

H3 can serve static assets such as HTML, images, CSS, JavaScript, etc.

To serve a static directory, you can use the `serveStatic` utility.

```ts
import { H3, serveStatic } from "h3";

const app = new H3();

app.use("/public/**", (event) => {
  return serveStatic(event, {
    getContents: (id) => {
      // TODO
    },
    getMeta: (id) => {
      // TODO
    },
  });
});
```

This does not serve any files yet. You need to implement the `getContents` and `getMeta` methods.

- `getContents` is used to read the contents of a file. It should return a `Promise` that resolves to the contents of the file or `undefined` if the file does not exist.
- `getMeta` is used to get the metadata of a file. It should return a `Promise` that resolves to the metadata of the file or `undefined` if the file does not exist.

They are separated to allow H3 to respond to `HEAD` requests without reading the contents of the file and to use the `Last-Modified` header.

## Read files

Now, create a `index.html` file in the `public` directory with a simple message.

Then, we can create the `getContents` and `getMeta` methods:

```ts
import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { H3, serve, serveStatic } from "h3";

const app = new H3();

// `id` is the request path (e.g. `/public/index.html`), so strip the `/public` prefix to get the file path
const toFilePath = (id: string) => join("public", id.slice("/public".length));

app.use("/public/**", (event) => {
  return serveStatic(event, {
    indexNames: ["/index.html"],
    getContents: (id) => readFile(toFilePath(id)),
    getMeta: async (id) => {
      const stats = await stat(toFilePath(id)).catch(() => {});
      if (stats?.isFile()) {
        return {
          size: stats.size,
          mtime: stats.mtimeMs,
        };
      }
    },
  });
});

serve(app);
```

Open your browser to http://localhost:3000/public/ and you should see the message.

The `getContents` reads the file and returns its contents, pretty simple. The `getMeta` uses `fs.stat` to get the file metadata. If the file does not exist or is not a file, it returns `undefined`. Otherwise, it returns the file size and the last modification time.

The file size and last modification time are used to create an etag to send a `304 Not Modified` response if the file has not been modified since the last request. This is useful to avoid sending the same file multiple times if it has not changed.
