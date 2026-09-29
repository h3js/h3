# h3-v2

Alias package for [h3](https://h3.dev) v2.

Some projects depend on h3 v2 through an npm alias (`"h3-v2": "npm:h3@^2"`), and some package managers wrongly try to fetch `h3-v2` from the registry as a real package. This package re-exports [`h3`](https://www.npmjs.com/package/h3) so those installs still resolve to h3 v2.

You should depend on `h3` directly:

```sh
npm i h3@^2
```

## Subpaths

All `h3` subpaths are re-exported:

`h3-v2`, `h3-v2/node`, `h3-v2/bun`, `h3-v2/deno`, `h3-v2/cloudflare`, `h3-v2/service-worker`, `h3-v2/generic`, `h3-v2/tracing`, `h3-v2/rules`, `h3-v2/rules/cache`, `h3-v2/rules/proxy`, `h3-v2/rules/compiler`

## License

MIT
