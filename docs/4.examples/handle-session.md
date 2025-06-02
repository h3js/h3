---
icon: ph:arrow-right
---

# Sessions

> Remember your users using a session.

A session is a way to remember users using cookies. It is a very common method for authenticating users or saving data about them, such as their language or preferences on the web.

h3 provides many utilities to handle sessions:

- `useSession` initializes a session and returns a wrapper to control it.
- `getSession` initializes or retrieves the current user session.
- `updateSession` updates the data of the current session.
- `clearSession` clears the current session.

Most of the time, you will use `useSession` to manipulate the session.

## Initialize a Session

To initialize a session, you need to use `useSession` in an [event handler](/guide/handler):

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
> You must provide a password to encrypt the session.

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

  return count === 0
    ? "Hello world!"
    : `Hello world! You have visited this page ${count} times.`;
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

h3 will send a header `Set-Cookie` with an empty cookie named `h3` to clear the session.

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
