import { H3, serve, getCookie, setCookie } from "h3";

export const app = new H3();

app
  .get("/", (event) => {
    const testCookie = getCookie(event, "testCookie");
    return `testCookie is ${JSON.stringify(testCookie)} (go to /set to set it)`;
  })
  .get("/set", (event) => {
    // By default, path is set to `/`. You can use any of the options supported by the Set-Cookie header.
    // @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
    setCookie(event, "testCookie", "bar", { httpOnly: true });
    return "TestCookie is set. Go back to / to see it!";
  });

serve(app);
