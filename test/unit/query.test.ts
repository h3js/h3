/**
Based on https://github.com/anonrig/fast-querystring/commit/9dcbaf
Copyright (c) 2022 Yagiz Nizipli
https://github.com/anonrig/fast-querystring/blob/main/LICENSE
*/

import { assert, describe, test } from "vitest";
import vm from "node:vm";
import { parseQuery } from "../../src/utils/internal/query.ts";

function extendedFunction() {}
extendedFunction.prototype = { a: "b" };

function createWithNoPrototype(properties: any) {
  const noProto = Object.create(null);
  for (const property of properties) {
    noProto[property.key] = property.value;
  }
  return noProto;
}
export const foreignObject: any = vm.runInNewContext('({"foo": ["bar", "baz"]})');

const qsNoMungeTestCases = [
  ["", {}],
  ["foo=bar&foo=baz", { foo: ["bar", "baz"] }],
  ["foo=bar&foo=baz", foreignObject],
  ["blah=burp", { blah: "burp" }],
  ["a=!-._~'()*", { a: "!-._~'()*" }],
  ["a=abcdefghijklmnopqrstuvwxyz", { a: "abcdefghijklmnopqrstuvwxyz" }],
  ["a=ABCDEFGHIJKLMNOPQRSTUVWXYZ", { a: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" }],
  ["a=0123456789", { a: "0123456789" }],
  ["gragh=1&gragh=3&goo=2", { gragh: ["1", "3"], goo: "2" }],
  [
    "frappucino=muffin&goat%5B%5D=scone&pond=moose",
    { frappucino: "muffin", "goat[]": "scone", pond: "moose" },
  ],
  ["trololol=yes&lololo=no", { trololol: "yes", lololo: "no" }],
];

const qsTestCases = [
  ["__proto__=1", "__proto__=1", createWithNoPrototype([{ key: "__proto__", value: "1" }])],
  ["__defineGetter__=asdf", "__defineGetter__=asdf", JSON.parse('{"__defineGetter__":"asdf"}')],
  [
    "foo=918854443121279438895193",
    "foo=918854443121279438895193",
    { foo: "918854443121279438895193" },
  ],
  ["foo=bar", "foo=bar", { foo: "bar" }],
  ["foo=bar&foo=quux", "foo=bar&foo=quux", { foo: ["bar", "quux"] }],
  ["foo=1&bar=2", "foo=1&bar=2", { foo: "1", bar: "2" }],
  [
    "my+weird+field=q1%212%22%27w%245%267%2Fz8%29%3F",
    "my%20weird%20field=q1!2%22'w%245%267%2Fz8)%3F",
    { "my weird field": "q1!2\"'w$5&7/z8)?" },
  ],
  ["foo%3Dbaz=bar", "foo%3Dbaz=bar", { "foo=baz": "bar" }],
  ["foo=baz=bar", "foo=baz%3Dbar", { foo: "baz=bar" }],
  [
    "str=foo&arr=1&arr=2&arr=3&somenull=&undef=",
    "str=foo&arr=1&arr=2&arr=3&somenull=&undef=",
    {
      str: "foo",
      arr: ["1", "2", "3"],
      somenull: "",
      undef: "",
    },
  ],
  [" foo = bar ", "%20foo%20=%20bar%20", { " foo ": " bar " }],
  ["foo=%zx", "foo=%25zx", { foo: "%zx" }],
  ["foo=%EF%BF%BD", "foo=%EF%BF%BD", { foo: "\uFFFD" }],
  // See: https://github.com/joyent/node/issues/1707
  [
    "hasOwnProperty=x&toString=foo&valueOf=bar&__defineGetter__=baz",
    "hasOwnProperty=x&toString=foo&valueOf=bar&__defineGetter__=baz",
    {
      hasOwnProperty: "x",
      toString: "foo",
      valueOf: "bar",
      __defineGetter__: "baz",
    },
  ],
  // See: https://github.com/joyent/node/issues/3058
  ["foo&bar=baz", "foo=&bar=baz", { foo: "", bar: "baz" }],
  ["a=b&c&d=e", "a=b&c=&d=e", { a: "b", c: "", d: "e" }],
  ["a=b&c=&d=e", "a=b&c=&d=e", { a: "b", c: "", d: "e" }],
  ["a=b&=c&d=e", "a=b&=c&d=e", { a: "b", "": "c", d: "e" }],
  ["a=b&=&c=d", "a=b&=&c=d", { a: "b", "": "", c: "d" }],
  ["&&foo=bar&&", "foo=bar", { foo: "bar" }],
  ["&", "", {}],
  ["&&&&", "", {}],
  ["&=&", "=", { "": "" }],
  ["&=&=", "=&=", { "": ["", ""] }],
  ["=", "=", { "": "" }],
  ["+", "%20=", { " ": "" }],
  ["+=", "%20=", { " ": "" }],
  ["+&", "%20=", { " ": "" }],
  ["=+", "=%20", { "": " " }],
  ["+=&", "%20=", { " ": "" }],
  ["a&&b", "a=&b=", { a: "", b: "" }],
  ["a=a&&b=b", "a=a&b=b", { a: "a", b: "b" }],
  ["&a", "a=", { a: "" }],
  ["&=", "=", { "": "" }],
  ["a&a&", "a=&a=", { a: ["", ""] }],
  ["a&a&a&", "a=&a=&a=", { a: ["", "", ""] }],
  ["a&a&a&a&", "a=&a=&a=&a=", { a: ["", "", "", ""] }],
  ["a=&a=value&a=", "a=&a=value&a=", { a: ["", "value", ""] }],
  ["foo+bar=baz+quux", "foo%20bar=baz%20quux", { "foo bar": "baz quux" }],
  ["+foo=+bar", "%20foo=%20bar", { " foo": " bar" }],
  ["a+", "a%20=", { "a ": "" }],
  ["=a+", "=a%20", { "": "a " }],
  ["a+&", "a%20=", { "a ": "" }],
  ["=a+&", "=a%20", { "": "a " }],
  ["%20+", "%20%20=", { "  ": "" }],
  ["=%20+", "=%20%20", { "": "  " }],
  ["%20+&", "%20%20=", { "  ": "" }],
  ["=%20+&", "=%20%20", { "": "  " }],
  [null, "", {}],
  [undefined, "", {}],
];

const qsWeirdObjects = [
  [{ regexp: /./g }, "regexp=", { regexp: "" }],
  [{ regexp: /./g }, "regexp=", { regexp: "" }],
  [{ fn: () => {} }, "fn=", { fn: "" }],
  [{ fn: new Function("") }, "fn=", { fn: "" }],
  [{ math: Math }, "math=", { math: "" }],
  [{ e: extendedFunction }, "e=", { e: "" }],
  [{ d: new Date() }, "d=", { d: "" }],
  [{ d: Date }, "d=", { d: "" }],
  [{ f: Boolean(false), t: Boolean(true) }, "f=&t=", { f: "", t: "" }],
  [{ f: false, t: true }, "f=false&t=true", { f: "false", t: "true" }],
  [{ n: null }, "n=", { n: "" }],
  [{ nan: Number.NaN }, "nan=", { nan: "" }],
  [{ inf: Number.POSITIVE_INFINITY }, "inf=", { inf: "" }],
  [{ a: [], b: [] }, "", {}],
  [{ a: 1, b: [] }, "a=1", { a: "1" }],
];

describe("node.js tests", () => {
  describe("qs", () => {
    for (const t of qsTestCases) {
      test(t[0], () => {
        assert.deepEqual(parseQuery(t[0]), t[2]);
      });
    }
  });

  describe("no mangle", () => {
    for (const t of qsNoMungeTestCases) {
      test(t[0], () => {
        assert.deepEqual(parseQuery(t[0]), t[1]);
      });
    }
  });

  describe("weird", () => {
    for (const t of qsWeirdObjects)
      test(JSON.stringify(t[1]), () => {
        assert.deepEqual(parseQuery(t[1] as string), t[2] as Record<string, unknown>);
      });
  });
});

test("handles & on first/last character", () => {
  assert.deepEqual(parseQuery("&hello=world"), { hello: "world" });
  assert.deepEqual(parseQuery("hello=world&"), { hello: "world" });
});

test("handles ? on first character", () => {
  // This aligns with `node:querystring` functionality
  assert.deepEqual(parseQuery("?hello=world"), { "?hello": "world" });
});

test("handles + character", () => {
  assert.deepEqual(parseQuery("author=Yagiz+Nizipli"), {
    author: "Yagiz Nizipli",
  });
});

test("should accept pairs with missing values", () => {
  assert.deepEqual(parseQuery("foo=bar&hey"), { foo: "bar", hey: "" });
  assert.deepEqual(parseQuery("hey"), { hey: "" });
});

test("should decode key", () => {
  assert.deepEqual(parseQuery("invalid%key=hello"), { "invalid%key": "hello" });
  assert.deepEqual(parseQuery("full%20name=Yagiz"), { "full name": "Yagiz" });
});

test("should handle really large object", () => {
  const q = new URLSearchParams();
  for (let i = 0; i < 2000; i++) {
    q.set(i.toString(), i.toString());
  }
  const url = q.toString();
  assert.strictEqual(Object.keys(parseQuery(url)).length, 2000);
});

test("should parse large numbers", () => {
  assert.strictEqual(parseQuery("id=918854443121279438895193").id, "918854443121279438895193");
});
