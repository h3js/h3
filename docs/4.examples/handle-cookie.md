---
icon: ph:arrow-right
---

# Cookies

> Use cookies to store data on the client.

Handling cookies with H3 is straightforward. There is three utilities to handle cookies:

- `setCookie` to attach a cookie to the response.
- `getCookie` to get a cookie from the request.
- `deleteCookie` to clear a cookie from the response.

## Set a Cookie

To set a cookie, you need to use `setCookie` in an event handler:

```ts
import { setCookie } from "h3";

app.use(async (event) => {
  setCookie(event, "name", "value", { maxAge: 60 * 60 * 24 * 7 });
  return "";
});
```

In the options, you can configure the [cookie flags](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie):

- `maxAge` to set the expiration date of the cookie in seconds.
- `expires` to set the expiration date of the cookie in a `Date` object.
- `path` to set the path of the cookie.
- `domain` to set the domain of the cookie.
- `secure` to set the `Secure` flag of the cookie.
- `httpOnly` to set the `HttpOnly` flag of the cookie.
- `sameSite` to set the `SameSite` flag of the cookie.

:read-more{to="/utils"}

## Get a Cookie

To get a cookie, you need to use `getCookie` in an event handler.

```ts
import { getCookie } from "h3";

app.use(async (event) => {
  const name = getCookie(event, "name");

  // do something...

  return "";
});
```

This will return the value of the cookie if it exists, or `undefined` otherwise.

## Delete a Cookie

To delete a cookie, you need to use `deleteCookie` in an event handler:

```ts
import { deleteCookie } from "h3";

app.use(async (event) => {
  deleteCookie(event, "name");
  return "";
});
```

The utility `deleteCookie` is a wrapper around `setCookie` with the value set to `""` and the `maxAge` set to `0`.

This will erase the cookie from the client.
