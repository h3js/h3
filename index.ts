import { TypedResponse } from "fetchdts"
import {defineHandler } from './src'

type TypedJSONString<T> = string & { __type: T };

declare global {
  interface JSON {
    stringify<T>(value: T, replacer?: (key: string, value: any) => any, space?: string | number): TypedJSONString<T>;
  }
}

declare let Response: {
  new<Body, Headers extends Record<string, string>>(body: TypedJSONString<Body>, init?: Omit<ResponseInit, 'headers'> & { headers: Headers }): TypedResponse<Body, Headers>;
}



// TODO: Also Response.json({})

const init = JSON.stringify({ hello: "world" })

const r = new Response(init)
await r.json()

const res = new Response(init, {
  headers: {
    "content-type": "application/json;charset=UTF-8",
  },
});

export {}

const handler = defineHandler(() => {
  return new Response(JSON.stringify({ hello: "world" }), {
    headers: {
      "x-hi-there": "application/json;charset=UTF-8",
    },
  });
})

const res = await handler.fetch("").then(res => [res.json(), res.headers.get('')])


