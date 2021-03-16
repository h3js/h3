[![d](https://img.shields.io/npm/dm/h3.svg?style=flat-square)](https://npmjs.com/package/h3)
[![v](https://img.shields.io/npm/v/h3/latest.svg?style=flat-square)](https://npmjs.com/package/h3)
[![b](https://img.shields.io/bundlephobia/min/h3/latest.svg?style=flat-square)](https://bundlephobia.com/result?p=h3)
[![a](https://img.shields.io/github/workflow/status/nuxt-contrib/h3/ci/main?style=flat-square)](https://github.com/nuxt-contrib/h3/actions)
[![c](https://img.shields.io/codecov/c/gh/nuxt-contrib/h3/main?style=flat-square)](https://codecov.io/gh/nuxt-contrib/h3)

![h3 - Tiny JavaScript Server](.github/banner.svg)

**What?**

- Works perfectly with Serverless, Workers and NodeJS
- Compatible with connect/express middleware
- Tree-shakable and zero-dependency
- Promise and `aync/await` support
- Lazy loading
- Quick prefix router
- Custom route matcher

> See [un](https://github.com/nuxt-contrib/un) for workers support

## Install

```bash
yarn add h3
# or
npm install h3
```

## Usage

**Using [listhen](https://github.com/nuxt-contrib/listhen):**

```js
const { createApp } = require('h3')
const { listen } = require('listhen')

const app = createApp()
app.use('/', () => 'Hello world!')

listen(app)
```

**Using plain node:**

```js
const { Server } = require('http')
const { createApp } = require('h3')

const app = createApp()

// Handle can directly return object or Promise<object> for JSON response
app.use('/api', (req) => ({ url: req.url }))

// You can have better matching other than quick prefix match
app.use('/odd', () => 'Is odd!', { match: url => url.substr(1) % 2 })

// Handle can directly return string for HTML response
app.use(() => '<h1>Hello world!</h1>')

// You can chain calls to .use()
app.use('/1', () => '<h1>Hello world!</h1>').use('/2', () => '<h1>Goodbye!</h1>')

// If handle is already async, using useAsync to avoid unnecessary promisify wrapper
// (Shortcut to pass { promisify: false })
// app.useAsync(async () => {})

// Lazy loading routes using { lazy: true }
// app.use('/big', () => import('./big'), { lazy: true })

const port = process.env.PORT || 3000
const server = new Server(app)

server.listen(port, () => {
  console.log(`Listening on: http://localhost:${port}`)
})
```

## Technical

There are two vital parts that make it working: Stack Runner (`App`), and `promisifyHandle`.

### App

App is basically a http server handle with `req, res` and attached utilities that runs a stack
 of middleware/handles in parallel. It will stop when the `writableEnded` flag is set on a response
 (which means that `res.end` has been called) and throw a 404 if `writableEnded` flag has not been set by the end.

Additionally the app has a quick prefix matcher and will automatically call `res.end` if any stack layers return a value.

### `promisifyHandle`

Converts a classic middleware (`req, res, next?`) into a promisified version ready to use with App

- If middleware has 3rd next/callback param, promise will `resolve/reject` when called
- If middleware returns a promise, it will be **chained** to main promise
- If calling middleware throws an immediate error, promise will be rejected
- On `close` and `error` events of res, promise will `resolve/reject` (to ensure if middleware simply calls `res.end`)

When calling `app.use`, middleware will be automatically promisified.

If you are already making an async aware middleware, you can use `app.useAsync`

## License

MIT
