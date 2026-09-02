---
icon: ph:arrow-right
---

# Sessions

> Remember your users using a session.

A session is a way to remember users using cookies. It is a very common method for authenticating users or saving data about them, such as their language or preferences on the web.

H3 provides many utilities to handle sessions:

- `useSession` initializes a session and returns a wrapper to control it.
- `getSession` retrieves the current user session, without starting one.
- `updateSession` updates the data of the current session.
- `clearSession` clears the current session.

Most of the time, you will use `useSession` to manipulate the session.

## Initialize a Session

To initialize a session, you need to use `useSession` in an [event handler](/guide/basics/handler):

```js
import { useSession } from "h3";

app.use(async (event) => {
  const session = await useSession(event, {
    password: "80d42cfb-1cd2-462c-8f17-e3237d9027e9",
  });

  // do something...
});
```

> [!WARNING]
> The `password` seals every session cookie, and its **entropy is the real security boundary**. A stolen session cookie carries the salt and integrity digest in plaintext, so a weak or guessable password can be brute-forced offline — increasing PBKDF2 iterations only slows this, it does not fix a low-entropy secret. Always generate the password from a cryptographically secure random source, for example:
>
> ```sh
> node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
> ```
>
> The examples below use a hardcoded value so they stay readable, but in a real app load a randomly generated secret of at least 32 characters from an environment variable such as `process.env.SESSION_PASSWORD`, and never commit it to source control. A guessable passphrase (even one ≥32 characters) is not safe.

This will initialize a session and return an header `Set-Cookie` with a cookie named `h3` and an encrypted content.

If the request contains a cookie named `h3` or a header named `x-h3-session`, the session will be initialized with the content of the cookie or the header.

> [!NOTE]
> The header take precedence over the cookie.

## Get Data from a Session

To get data from a session, we will still use `useSession`. Under the hood, it will use `getSession` to get the session.

```js
import { useSession } from "h3";

app.use(async (event) => {
  const session = await useSession(event, {
    password: "80d42cfb-1cd2-462c-8f17-e3237d9027e9",
  });

  return session.data;
});
```

Data are stored in the `data` property of the session. If there is no data, it will be an empty object.

## Add Data to a Session

To add data to a session, we will still use `useSession`. Under the hood, it will use `updateSession` to update the session.

```js
import { useSession } from "h3";

app.use(async (event) => {
  const session = await useSession(event, {
    password: "80d42cfb-1cd2-462c-8f17-e3237d9027e9",
  });

  const count = (session.data.count || 0) + 1;
  await session.update({
    count: count,
  });

  return count === 0 ? "Hello world!" : `Hello world! You have visited this page ${count} times.`;
});
```

What is happening here?

We try to get a session from the request. If there is no session, a new one will be created. Then, we increment the `count` property of the session and we update the session with the new value. Finally, we return a message with the number of times the user visited the page.

Try to visit the page multiple times and you will see the number of times you visited the page.

> [!NOTE]
> If you use a CLI tool like `curl` to test this example, you will not see the number of times you visited the page because the CLI tool does not save cookies. You must get the cookie from the response and send it back to the server.

## Clear a Session

To clear a session, we will still use `useSession`. Under the hood, it will use `clearSession` to clear the session.

```js
import { useSession } from "h3";

app.use("/clear", async (event) => {
  const session = await useSession(event, {
    password: "80d42cfb-1cd2-462c-8f17-e3237d9027e9",
  });

  await session.clear();

  return "Session cleared";
});
```

H3 will send a header `Set-Cookie` with an empty cookie named `h3` to clear the session.

## Options

When to use `useSession`, you can pass an object with options as the second argument to configure the session:

```js
import { useSession } from "h3";

app.use(async (event) => {
  const session = await useSession(event, {
    name: "my-session",
    password: "80d42cfb-1cd2-462c-8f17-e3237d9027e9",
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    },
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return session.data;
});
```

Every option is optional except `password`. The `name` option is worth calling out: it sets the cookie used to store the session and defaults to `h3`. H3 also reads the session from a request header derived from `name`, which it normalizes to lowercase as `x-${name.toLowerCase()}-session`, so the default name `h3` produces the `x-h3-session` header seen earlier. A mixed-case `name` like `MyApp` still resolves to a lowercase `x-myapp-session` header, while the cookie keeps the original casing. That default is why the earlier examples set a cookie named `h3`.

> [!NOTE]
> The session cookie defaults to `secure: true`, `httpOnly: true`, `sameSite: "lax"`, and `path: "/"`. Any of these can be overridden via `cookie`.

> [!NOTE]
> The `secure: true` option tells the browser to only store and send the cookie over HTTPS. When developing locally over plain HTTP, compliant browsers (notably Safari and iOS, and Chrome on some local domains) silently drop the cookie, so the session will not persist. Set `cookie: { secure: false }` during local development to work around this.

## Expiration

Sessions have two independent expiration controls, and you can use either or both:

- `maxAge` is an **absolute** lifetime, counted from when the session was created. It is reached however active the user is.
- `idleTimeout` is a **sliding** lifetime, counted from the last request. An active user stays signed in; an idle one is signed out.

```js
const session = await useSession(event, {
  password: "80d42cfb-1cd2-462c-8f17-e3237d9027e9",
  idleTimeout: 60 * 30, // signed out after 30 minutes of inactivity...
  maxAge: 60 * 60 * 24 * 7, // ...and after 7 days regardless
});
```

With `idleTimeout` set, H3 moves the idle window forward by resealing the session cookie with the reseal time stamped into it. `createdAt` is left untouched, which is what lets `maxAge` still act as a hard cap on top. The cookie `Expires` is set to whichever limit runs out first.

If you are coming from `express-session` or `koa-session`, `idleTimeout` is their `rolling` option. The difference is that it carries its own duration instead of reinterpreting `maxAge`, so enabling it does not cost you the absolute limit.

Resealing is the expensive part of a session, so H3 does not do it on every request: it reseals only once more than half the window has been used, and updating the session counts as a reseal. An active user therefore never gets signed out, but the recorded last-seen time can trail the real one by up to half the window:

```js
// idleTimeout: 60 * 30
// Sign-out happens 15 to 30 minutes after the last request, never later.
```

Halve `idleTimeout` if you need the shorter end of that range to be your real limit.

> [!NOTE]
> Only cookie sessions slide. A session sent through the `x-{name}-session` header cannot be resealed, so it expires `idleTimeout` after its seal was issued.

> [!IMPORTANT]
> Because the session lives in the cookie, a request that only reads the session writes it back when it slides the window. If such a request overlaps with one that writes the session, whichever response the browser applies last wins, so the write can be lost. Without `idleTimeout` a read-only request sets no cookie and cannot clobber a concurrent write.

> [!NOTE]
> A request that slides the window pays for an extra seal and puts a `Set-Cookie` header on its response — shared caches and CDNs often refuse to store those. Requests that only read the session inside the throttle window set no cookie at all.

The session cookie is also applied to error responses, so a request that throws still slides the window and still persists a session created during it.

## Use Multiple Sessions

Because each session is stored under its own `name`, you can run several independent sessions on the same request. They live in separate cookies and never overwrite each other, which is useful for keeping unrelated concerns apart, such as a long-lived auth session and a short-lived flash message:

```js
import { useSession } from "h3";

app.use(async (event) => {
  const auth = await useSession(event, {
    name: "auth",
    password: "80d42cfb-1cd2-462c-8f17-e3237d9027e9",
  });

  const flash = await useSession(event, {
    name: "flash",
    password: "80d42cfb-1cd2-462c-8f17-e3237d9027e9",
  });

  await flash.update({ message: "Saved!" });

  // `auth` and `flash` are backed by different cookies, so they stay separate
  return { user: auth.data.user, flash: flash.data.message };
});
```

> [!NOTE]
> Give each session a distinct `name`. Two sessions that share a name share the same cookie, so the last write wins.
