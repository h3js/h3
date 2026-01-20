# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## v2.0.1-rc.11

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.10...v2.0.1-rc.11)

### 📦 Build

- Fix types bundling ([e32d9e6](https://github.com/h3js/h3/commit/e32d9e6))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v2.0.1-rc.10

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.9...v2.0.1-rc.10)

### 📦 Build

- Move fetchdts to dependencies due to bundle issues ([0d753cf](https://github.com/h3js/h3/commit/0d753cf))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v2.0.1-rc.9

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.8...v2.0.1-rc.9)

### 🩹 Fixes

- **basic-auth:** Use jitter and  constant-time string comparison ([#1283](https://github.com/h3js/h3/pull/1283))

### 🌊 Types

- **onResponse:** Allow returning any value ([#1277](https://github.com/h3js/h3/pull/1277))

### 🏡 Chore

- Update deps ([b85db16](https://github.com/h3js/h3/commit/b85db16))
- Update undocs ([3fc60f2](https://github.com/h3js/h3/commit/3fc60f2))
- Update deps ([4d87e29](https://github.com/h3js/h3/commit/4d87e29))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Huseeiin ([@huseeiin](https://github.com/huseeiin))

## v2.0.1-rc.8

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.7...v2.0.1-rc.8)

### 🩹 Fixes

- **fromNodeHandler:** Pipe responses once ([#1273](https://github.com/h3js/h3/pull/1273))

### 💅 Refactors

- Avoid unnecessary `    Error.captureStackTrace` ([652e883](https://github.com/h3js/h3/commit/652e883))

### 🏡 Chore

- Update deps ([1dfe739](https://github.com/h3js/h3/commit/1dfe739))
- Lint ([2ec1eea](https://github.com/h3js/h3/commit/2ec1eea))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v2.0.1-rc.7

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.6...v2.0.1-rc.7)

### 🚀 Enhancements

- Experimental tracing support ([#1251](https://github.com/h3js/h3/pull/1251))
- Customizable validation errors ([#1146](https://github.com/h3js/h3/pull/1146))

### 🩹 Fixes

- **mockEvent:** Make sure `duplex` option is properly set ([eb83aad](https://github.com/h3js/h3/commit/eb83aad))
- **handleCacheHeaders:** Round `modifiedTime` to seconds ([#1262](https://github.com/h3js/h3/pull/1262))

### 🏡 Chore

- Fix typo in jsdocs ([#1263](https://github.com/h3js/h3/pull/1263))
- Update deps ([fcd9ff9](https://github.com/h3js/h3/commit/fcd9ff9))
- Update srvx to 0.10 ([0385342](https://github.com/h3js/h3/commit/0385342))

### ❤️ Contributors

- Minsu Lee ([@amondnet](https://github.com/amondnet))
- Sandro Circi ([@sandros94](https://github.com/sandros94))
- Abdelrahman Awad ([@logaretm](https://github.com/logaretm))
- Pooya Parsa ([@pi0](https://github.com/pi0))
- Huseeiin ([@huseeiin](https://github.com/huseeiin))

## v2.0.1-rc.6

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.5...v2.0.1-rc.6)

### 🚀 Enhancements

- **defineWebSocketHandler:** Support callback with `event` ([#1242](https://github.com/h3js/h3/pull/1242))

### 🩹 Fixes

- **proxy:** Strip `transfer-encoding` header from proxied response ([#1248](https://github.com/h3js/h3/pull/1248))
- Clear `event.res` after prepare ([#1259](https://github.com/h3js/h3/pull/1259))

### 📖 Documentation

- Add `H3ravel` to the community section ([#1239](https://github.com/h3js/h3/pull/1239))
- Add intlify to community integrations ([#1244](https://github.com/h3js/h3/pull/1244))

### 🏡 Chore

- Lint ([4218cbe](https://github.com/h3js/h3/commit/4218cbe))
- Update deps ([bb10838](https://github.com/h3js/h3/commit/bb10838))
- Update build config ([504e878](https://github.com/h3js/h3/commit/504e878))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Dardan Bujupaj ([@dardanbujupaj](https://github.com/dardanbujupaj))
- Minsu Lee ([@amondnet](https://github.com/amondnet))
- Kazuya Kawaguchi <kawakazu80@gmail.com>
- Legacy ([@3m1n3nc3](https://github.com/3m1n3nc3))

## v2.0.1-rc.5

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.4...v2.0.1-rc.5)

### 🚀 Enhancements

- `toMiddleware` util ([#1234](https://github.com/h3js/h3/pull/1234))

### 🩹 Fixes

- **assertBodySize:** Disallow both `content-length` and `transfer-encoding` headers ([9ccd301](https://github.com/h3js/h3/commit/9ccd301))
- Adjust pathname for mounted sub-app routed middleware ([#1232](https://github.com/h3js/h3/pull/1232))
- **middleware:** Allow returning 404 response in middleware ([#1231](https://github.com/h3js/h3/pull/1231))

### 💅 Refactors

- ⚠️  Slim down `H3Core` ([#1233](https://github.com/h3js/h3/pull/1233))
- Hide internals with `~` ([#1236](https://github.com/h3js/h3/pull/1236))
- Fix typo ([a68a754](https://github.com/h3js/h3/commit/a68a754))

### 📦 Build

- Export `toMiddleware` ([0f2e568](https://github.com/h3js/h3/commit/0f2e568))
- Reduce dist size by stripping comments ([#1235](https://github.com/h3js/h3/pull/1235))
- Include bundled types ([d833afb](https://github.com/h3js/h3/commit/d833afb))
- Inline rou3 related types ([5d3a274](https://github.com/h3js/h3/commit/5d3a274))
- Export `RouterContext` and `MatchedRoute` types ([fd7dc8f](https://github.com/h3js/h3/commit/fd7dc8f))

### 🌊 Types

- Fix `_getMiddleware` route typed ([e090a76](https://github.com/h3js/h3/commit/e090a76))

### 🏡 Chore

- Update deps ([17cbbe0](https://github.com/h3js/h3/commit/17cbbe0))

### ✅ Tests

- Add case for middleware with 404 Response support ([8791818](https://github.com/h3js/h3/commit/8791818))
- Add coverage exclude ([5558575](https://github.com/h3js/h3/commit/5558575))

### 🤖 CI

- Fix nightly version bump ([630bbb8](https://github.com/h3js/h3/commit/630bbb8))

#### ⚠️ Breaking Changes

- ⚠️  Slim down `H3Core` ([#1233](https://github.com/h3js/h3/pull/1233))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Kricsleo ([@kricsleo](https://github.com/kricsleo))
- Minsu Lee ([@amondnet](https://github.com/amondnet))

## v2.0.1-rc.4

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.3...v2.0.1-rc.4)

### 🚀 Enhancements

- Add `assertBodySize` util and `bodyLimit` middleware ([#1222](https://github.com/h3js/h3/pull/1222))

### 🩹 Fixes

- Support happy-dom environment ([#1230](https://github.com/h3js/h3/pull/1230))

### 🏡 Chore

- Update deps ([6d8204a](https://github.com/h3js/h3/commit/6d8204a))

### ❤️ Contributors

- Reve ([@aquapi](https://github.com/aquapi))
- Pooya Parsa ([@pi0](https://github.com/pi0))

## v2.0.1-rc.3

[compare changes](https://github.com/h3js/h3/compare/v2.0.1-rc.2...v2.0.1-rc.3)

### 🩹 Fixes

- Freeze default response headers ([#1227](https://github.com/h3js/h3/pull/1227))
- **response:** Do not double merge prepared headers in nested error handler ([#1226](https://github.com/h3js/h3/pull/1226))
- ⚠️  Avoid merging prepared headers when a `Response` is not ok ([#1228](https://github.com/h3js/h3/pull/1228))

### 💅 Refactors

- Update to srvx 0.9 ([#1224](https://github.com/h3js/h3/pull/1224))
- **proxy:** ⚠️  Keep header entries as-is ([#1225](https://github.com/h3js/h3/pull/1225))

### 📖 Documentation

- Remove beta tag ([#1223](https://github.com/h3js/h3/pull/1223))

### 📦 Build

- Reduce external dependencies ([#1219](https://github.com/h3js/h3/pull/1219))

### 🌊 Types

- Merge custom `body` in `HTTPError.toJSON` result ([#1216](https://github.com/h3js/h3/pull/1216))
- Fix types for legacy `defineEventHandler`, `eventHandler`, `lazyEventHandler` ([f185ce6](https://github.com/h3js/h3/commit/f185ce6))

### 🏡 Chore

- Update deps ([3e92a35](https://github.com/h3js/h3/commit/3e92a35))
- Update deps ([d546f2d](https://github.com/h3js/h3/commit/d546f2d))
- Update bench ([7632fc3](https://github.com/h3js/h3/commit/7632fc3))

#### ⚠️ Breaking Changes

- ⚠️  Avoid merging prepared headers when a `Response` is not ok ([#1228](https://github.com/h3js/h3/pull/1228))
- **proxy:** ⚠️  Keep header entries as-is ([#1225](https://github.com/h3js/h3/pull/1225))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Abeer0 ([@iiio2](https://github.com/iiio2))
- Валентин Степанов ([@teleskop150750](https://github.com/teleskop150750))

## v2.0.1-rc.2

[compare changes](https://github.com/h3js/h3/compare/v2.0.0-rc.1...v2.0.1-rc.2)

### 💅 Refactors

- Deprecate and move `toNodeHandler` to `h3/node` ([#1215](https://github.com/h3js/h3/pull/1215))

### 🏡 Chore

- Update deps ([e6d666a](https://github.com/h3js/h3/commit/e6d666a))
- Release as `2.0.1-rc.1` ([fe27148](https://github.com/h3js/h3/commit/fe27148))
- Update deps ([cd298c6](https://github.com/h3js/h3/commit/cd298c6))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v2.0.0-rc.1

[compare changes](https://github.com/h3js/h3/compare/v2.0.0-beta.5...v2.0.0-rc.1)

### 🚀 Enhancements

- ⚠️  `HTTPResponse` ([#1212](https://github.com/h3js/h3/pull/1212))

### 🔥 Performance

- Try avoid cloning response for meriging headers ([#1214](https://github.com/h3js/h3/pull/1214))

### 🩹 Fixes

- **cors:** Use defaults in handleCors ([#1161](https://github.com/h3js/h3/pull/1161))

### 💅 Refactors

- Hide internal `event._res` and `event.res._headers` ([#1185](https://github.com/h3js/h3/pull/1185))

### 📦 Build

- Add missing exports ([#1211](https://github.com/h3js/h3/pull/1211))

### 🏡 Chore

- Update deps ([6396029](https://github.com/h3js/h3/commit/6396029))
- Prepare for rc ([#1213](https://github.com/h3js/h3/pull/1213))
- Update srvx ([4c1eefc](https://github.com/h3js/h3/commit/4c1eefc))

#### ⚠️ Breaking Changes

- ⚠️  `HTTPResponse` ([#1212](https://github.com/h3js/h3/pull/1212))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Ilya Semenov ([@IlyaSemenov](https://github.com/IlyaSemenov))
- Huseeiin ([@huseeiin](https://github.com/huseeiin))
- Sandro Circi ([@sandros94](https://github.com/sandros94))

## v2.0.0-beta.5

[compare changes](https://github.com/h3js/h3/compare/v2.0.0-beta.4...v2.0.0-beta.5)

### 🚀 Enhancements

- Support universal `{ fetch }` handlers ([#1210](https://github.com/h3js/h3/pull/1210))
- Support fetchable object for dynamic handlers ([0da8e4a](https://github.com/h3js/h3/commit/0da8e4a))
- `toEventHandler` and `HTTPHandler` ([38be512](https://github.com/h3js/h3/commit/38be512))
- `toMiddleware` and `defineLazyMiddleware` utils ([2737f62](https://github.com/h3js/h3/commit/2737f62))

### 🔥 Performance

- Slightly improve `getRequestIP` performances ([#1197](https://github.com/h3js/h3/pull/1197))

### 💅 Refactors

- Allow overriding middleware resolution ([f45dd27](https://github.com/h3js/h3/commit/f45dd27))
- Move middleware normalization out of core ([b2ce1af](https://github.com/h3js/h3/commit/b2ce1af))
- Pass `event` to `_getMiddleware` ([3f766a5](https://github.com/h3js/h3/commit/3f766a5))
- Remove `toMiddleware` and `defineLazyMiddleware` (unreleased) ([f16f954](https://github.com/h3js/h3/commit/f16f954))
- Avoid anonymous functions ([e4bb27a](https://github.com/h3js/h3/commit/e4bb27a))

### 📖 Documentation

- Correct h3 method ([#1206](https://github.com/h3js/h3/pull/1206))
- Fix description of`handleCors`'s return value ([#1167](https://github.com/h3js/h3/pull/1167))

### 🌊 Types

- Export websocket related types ([#1202](https://github.com/h3js/h3/pull/1202))

### 🏡 Chore

- Import `ProxyOptions` separately ([#1199](https://github.com/h3js/h3/pull/1199))
- Fix typo in docs ([#1201](https://github.com/h3js/h3/pull/1201))
- Update undocs ([f2fd0e8](https://github.com/h3js/h3/commit/f2fd0e8))
- Add `pnpm-lock.yaml` ([8f75d2f](https://github.com/h3js/h3/commit/8f75d2f))
- **examples:** Fix typo ([#1205](https://github.com/h3js/h3/pull/1205))
- Update deps ([2d32dd9](https://github.com/h3js/h3/commit/2d32dd9))
- Update srvx ([c272021](https://github.com/h3js/h3/commit/c272021))
- Update ci ([0dfb4fe](https://github.com/h3js/h3/commit/0dfb4fe))
- Update ci ([8e451e8](https://github.com/h3js/h3/commit/8e451e8))
- Update ci ([4480127](https://github.com/h3js/h3/commit/4480127))
- Add prepack script ([920a331](https://github.com/h3js/h3/commit/920a331))
- Update deps ([e945618](https://github.com/h3js/h3/commit/e945618))

### ✅ Tests

- Update statusText tests ([e2f9a9d](https://github.com/h3js/h3/commit/e2f9a9d))
- Update test ([a4b0079](https://github.com/h3js/h3/commit/a4b0079))
- Update snapshot ([a0cee89](https://github.com/h3js/h3/commit/a0cee89))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Kricsleo ([@kricsleo](https://github.com/kricsleo))
- Rijk Van Zanten ([@rijkvanzanten](https://github.com/rijkvanzanten))
- Homersimpsons <guillaume.alabre@gmail.com>
- Abeer0 ([@iiio2](https://github.com/iiio2))
- Christian Höhne ([@bombur51](https://github.com/bombur51))
- Vladimir Ivakhno ([@wvovaw](https://github.com/wvovaw))

## v2.0.0-beta.4

[compare changes](https://github.com/h3js/h3/compare/v2.0.0-beta.3...v2.0.0-beta.4)

### 🚀 Enhancements

- Support thenable values ([#1193](https://github.com/h3js/h3/pull/1193))
- Inherit `req.context` and `ServerRequestContext` types ([#1194](https://github.com/h3js/h3/pull/1194))
- `HTTPEvent` for more agnostic usage ([#1195](https://github.com/h3js/h3/pull/1195))
- Export `toRequest` ([55a2c9b](https://github.com/h3js/h3/commit/55a2c9b))
- Support chunked cookies and use for session ([#1102](https://github.com/h3js/h3/pull/1102))
- **EventStream:** Support comment event ([#1169](https://github.com/h3js/h3/pull/1169))

### 🩹 Fixes

- Use `H3RouteMeta` in `RouteDefinition` type ([#1181](https://github.com/h3js/h3/pull/1181))
- **proxy:** Fix proxy headers filter ([#1188](https://github.com/h3js/h3/pull/1188))
- Return a `Response` for no-content ([#1177](https://github.com/h3js/h3/pull/1177))

### 📖 Documentation

- Update logo to cube style ([#1183](https://github.com/h3js/h3/pull/1183))

### 🏡 Chore

- **docs:** Lowercase `srvx` ([#1186](https://github.com/h3js/h3/pull/1186))
- Use native node typescript support ([#1191](https://github.com/h3js/h3/pull/1191))
- Update benchmarks ([b3ede4e](https://github.com/h3js/h3/commit/b3ede4e))
- Update deps ([4af9fd7](https://github.com/h3js/h3/commit/4af9fd7))
- Fix type issues related to `BufferSource` ([9040219](https://github.com/h3js/h3/commit/9040219))

### ✅ Tests

- Add test for `app.request(unicode)` ([1f874ee](https://github.com/h3js/h3/commit/1f874ee))

### ❤️ Contributors

- Hugo Muller ([@HugoMuller](https://github.com/HugoMuller))
- David De Sloovere ([@DavidDeSloovere](https://github.com/DavidDeSloovere))
- Pooya Parsa ([@pi0](https://github.com/pi0))
- Shun Git <kwokshungit@gmail.com>
- Kricsleo ([@kricsleo](https://github.com/kricsleo))
- Abeer0 ([@iiio2](https://github.com/iiio2))
- Sébastien Chopin <seb@nuxtjs.com>
- Lucas Nørgård ([@luxass](https://github.com/luxass))

## v2.0.0-beta.3

[compare changes](https://github.com/h3js/h3/compare/v2.0.0-beta.2...v2.0.0-beta.3)

### 🚀 Enhancements

- ⚠️  `app.request` ([#1176](https://github.com/h3js/h3/pull/1176))

### 💅 Refactors

- ⚠️  Only accept `req` for `H3` and `EventHandlerWithFetch` fetch ([#1096](https://github.com/h3js/h3/pull/1096))

#### ⚠️ Breaking Changes

- ⚠️  `app.request` ([#1176](https://github.com/h3js/h3/pull/1176))
- ⚠️  Only accept `req` for `H3` and `EventHandlerWithFetch` fetch ([#1096](https://github.com/h3js/h3/pull/1096))

### ❤️ Contributors

- Pooya Parsa <pyapar@gmail.com>

## v2.0.0-beta.2

[compare changes](https://github.com/h3js/h3/compare/v2.0.0-beta.1...v2.0.0-beta.2)

### 🚀 Enhancements

- Experimental `defineRoute` ([#1143](https://github.com/h3js/h3/pull/1143))
- **middleware:** Allow passthrough response without enforcing explicit return ([#1174](https://github.com/h3js/h3/pull/1174))
- Log unhandled errors ([#1152](https://github.com/h3js/h3/pull/1152))

### 🩹 Fixes

- **proxy:** ⚠️  Only inherit runtime context for sub-requests ([#1142](https://github.com/h3js/h3/pull/1142))
- Safer `HTTPError` check ([#1145](https://github.com/h3js/h3/pull/1145))
- **defineValidatedHandler:** Accept all `EventHandlerObject` props ([#1147](https://github.com/h3js/h3/pull/1147))
- Change "h://_" to "http://_" ([90226b8](https://github.com/h3js/h3/commit/90226b8))

### 📖 Documentation

- Fix noContent example ([#1171](https://github.com/h3js/h3/pull/1171))

### 🏡 Chore

- Update deps ([256e29d](https://github.com/h3js/h3/commit/256e29d))

### ✅ Tests

- Update snapshot ([8d52a83](https://github.com/h3js/h3/commit/8d52a83))

#### ⚠️ Breaking Changes

- **proxy:** ⚠️  Only inherit runtime context for sub-requests ([#1142](https://github.com/h3js/h3/pull/1142))

### ❤️ Contributors

- Huseeiin ([@huseeiin](https://github.com/huseeiin))
- Kricsleo ([@kricsleo](https://github.com/kricsleo))
- Pooya Parsa ([@pi0](https://github.com/pi0))
- Shun Git <kwokshungit@gmail.com>
- Wind <hi@productdevbook.com>

## v2.0.0-beta.1

[compare changes](https://github.com/h3js/h3/compare/v2.0.0-beta.0...v2.0.0-beta.1)

### 🚀 Enhancements

- Optional route meta ([#1118](https://github.com/h3js/h3/pull/1118))
- Add `readMultipartFormData` for backward compatibility ([#1120](https://github.com/h3js/h3/pull/1120))
- Export `H3Core` ([#1127](https://github.com/h3js/h3/pull/1127))
- Natively mount h3 as sub-app ([#1129](https://github.com/h3js/h3/pull/1129))
- Support typed `req.headers` ([#1130](https://github.com/h3js/h3/pull/1130))
- **serveStatic:** Support default and custom mimes ([#1137](https://github.com/h3js/h3/pull/1137))
- Expose `H3Event.app` ([#1139](https://github.com/h3js/h3/pull/1139))
- Freeze app routes and config after server init ([#1140](https://github.com/h3js/h3/pull/1140))
- **proxy:** Use native `fetch` + `event.app.fetch` ([#1141](https://github.com/h3js/h3/pull/1141))

### 🩹 Fixes

- **isEvent:** Safer check for bun compatibility ([5a984da](https://github.com/h3js/h3/commit/5a984da))
- **response:** Only add `content-disposition` for `File` with name ([#1133](https://github.com/h3js/h3/pull/1133))

### 💅 Refactors

- Merge `H3Event` with types ([eaeb1e1](https://github.com/h3js/h3/commit/eaeb1e1))
- ⚠️  Explicit use of handlers or middleware ([#1128](https://github.com/h3js/h3/pull/1128))

### 📖 Documentation

- V2-beta ([#1073](https://github.com/h3js/h3/pull/1073))
- Add apitally to community integrations ([#1113](https://github.com/h3js/h3/pull/1113))
- Fix route meta example ([#1124](https://github.com/h3js/h3/pull/1124))
- Update visualization for dispatch request lifecycle ([#1115](https://github.com/h3js/h3/pull/1115))
- Fix typo `event.req` is instance of request ([#1125](https://github.com/h3js/h3/pull/1125))
- Add nested apps section ([#1131](https://github.com/h3js/h3/pull/1131))

### 📦 Build

- Expose `toResponse` util ([febb832](https://github.com/h3js/h3/commit/febb832))

### 🌊 Types

- **defineValidatedHandler:** Return value should be fetchable ([b759670](https://github.com/h3js/h3/commit/b759670))

### 🏡 Chore

- Update playground ([76e791f](https://github.com/h3js/h3/commit/76e791f))
- Update playground ([dd3cb27](https://github.com/h3js/h3/commit/dd3cb27))
- Update docs ([ef7a8db](https://github.com/h3js/h3/commit/ef7a8db))
- Add back build.config ([74c9174](https://github.com/h3js/h3/commit/74c9174))
- Fix internal typo ([#1109](https://github.com/h3js/h3/pull/1109))
- Update deps ([6b78d5a](https://github.com/h3js/h3/commit/6b78d5a))
- Update rou3 to 0.7 ([ba15aaa](https://github.com/h3js/h3/commit/ba15aaa))
- Update deps ([4a6d71a](https://github.com/h3js/h3/commit/4a6d71a))
- Update deps ([01d4506](https://github.com/h3js/h3/commit/01d4506))
- Update deps ([6ca1c1c](https://github.com/h3js/h3/commit/6ca1c1c))
- Update h3-nightly dep ([84e0420](https://github.com/h3js/h3/commit/84e0420))
- Update release script ([da374e3](https://github.com/h3js/h3/commit/da374e3))

### ✅ Tests

- Add `h3-compiled` to bench ([57f4ab5](https://github.com/h3js/h3/commit/57f4ab5))
- Enable sse test for web ([e43571e](https://github.com/h3js/h3/commit/e43571e))
- Update test ([a09fd14](https://github.com/h3js/h3/commit/a09fd14))

#### ⚠️ Breaking Changes

- ⚠️  Explicit use of handlers or middleware ([#1128](https://github.com/h3js/h3/pull/1128))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Gene ._. ([@outslept](https://github.com/outslept))
- Daniel Roe ([@danielroe](https://github.com/danielroe))
- 87xie ([@87xie](https://github.com/87xie))
- Wuiyang <wuiyang@live.com>
- Kricsleo ([@kricsleo](https://github.com/kricsleo))
- Ckvv ([@ckvv](https://github.com/ckvv))
- Simon Gurcke ([@itssimon](https://github.com/itssimon))
- Nils K ([@septatrix](https://github.com/septatrix))

## v1.12.0

[compare changes](https://github.com/h3js/h3/compare/v1.11.1...v1.12.0)

### 🚀 Enhancements

- Improve typed headers ([#625](https://github.com/h3js/h3/pull/625))
- Export event-stream types ([112fa33](https://github.com/h3js/h3/commit/112fa33))

### 🩹 Fixes

- **getRequestUrl:** Forward opts to `getRequestProtocol` ([#776](https://github.com/h3js/h3/pull/776))
- **readRawBody:** Read chunked body ([#652](https://github.com/h3js/h3/pull/652))
- **proxy:** Better error when upstream proxy fails ([#746](https://github.com/h3js/h3/pull/746))
- **node:** Make sure `onBeforeResponse` and `onAfterResponse` are called with error code ([#756](https://github.com/h3js/h3/pull/756))
- **sse:** Prevent `onClosed` from firing twice in `EventStream` ([#704](https://github.com/h3js/h3/pull/704))
- **plain:** Avoid import from unenv internals ([#781](https://github.com/h3js/h3/pull/781))

### 💅 Refactors

- **session:** Remove unnecessary async for clear ([#729](https://github.com/h3js/h3/pull/729))
- Update unenv import ([76736ea](https://github.com/h3js/h3/commit/76736ea))

### 📖 Documentation

- Fix typo ([#699](https://github.com/h3js/h3/pull/699))
- Fix typo ([#707](https://github.com/h3js/h3/pull/707))
- Fix typo ([#712](https://github.com/h3js/h3/pull/712))
- Fix typo ([#730](https://github.com/h3js/h3/pull/730))
- Fix typo ([#732](https://github.com/h3js/h3/pull/732))
- Remove extra space ([#718](https://github.com/h3js/h3/pull/718))
- Add semi ([#710](https://github.com/h3js/h3/pull/710))
- **event-handler:** Fix typo ([#684](https://github.com/h3js/h3/pull/684))
- Add jsdoc examples for response utils ([#677](https://github.com/h3js/h3/pull/677))
- Add note for getRequestIP return value ([#726](https://github.com/h3js/h3/pull/726))
- Fix session example ([#702](https://github.com/h3js/h3/pull/702))
- Add jsdoc examples for request utils ([#680](https://github.com/h3js/h3/pull/680))
- Fix typo ([#734](https://github.com/h3js/h3/pull/734))
- Correct zod validation example ([#735](https://github.com/h3js/h3/pull/735))
- Fix typos ([#738](https://github.com/h3js/h3/pull/738))
- Fix typo ([#758](https://github.com/h3js/h3/pull/758))
- Add usage example for `handleCors` ([#747](https://github.com/h3js/h3/pull/747))
- Fix typo for `text/html` content-type ([#764](https://github.com/h3js/h3/pull/764))
- Update mogen example to use `combined` log format ([#771](https://github.com/h3js/h3/pull/771))
- Fix typo for plain adapter example ([#766](https://github.com/h3js/h3/pull/766))
- **examples:** Add cors example ([#700](https://github.com/h3js/h3/pull/700))
- Fix `respondWith` event object ([#775](https://github.com/h3js/h3/pull/775))
- Provide `async` for request body ([#777](https://github.com/h3js/h3/pull/777))
- **error-handling:** Add string vs object errors and update `createError` jsdoc ([#762](https://github.com/h3js/h3/pull/762))

### 🏡 Chore

- Fix lint issue ([107ec8e](https://github.com/h3js/h3/commit/107ec8e))
- Update deps ([9777596](https://github.com/h3js/h3/commit/9777596))
- **docs:** Remove unnecessary asterisks ([#724](https://github.com/h3js/h3/pull/724))
- Update eslint ([8ffe898](https://github.com/h3js/h3/commit/8ffe898))
- **docs:** Lint bun and deno page ([#678](https://github.com/h3js/h3/pull/678))
- Fix typos ([23d9047](https://github.com/h3js/h3/commit/23d9047))
- Remove duplicate test ([53ee4fd](https://github.com/h3js/h3/commit/53ee4fd))
- Apply automated updates ([617c8cb](https://github.com/h3js/h3/commit/617c8cb))
- Update dependencies ([1776ac4](https://github.com/h3js/h3/commit/1776ac4))
- Lint ([5af045b](https://github.com/h3js/h3/commit/5af045b))
- Update supertest to v7 ([44db181](https://github.com/h3js/h3/commit/44db181))
- Fix typos ([#772](https://github.com/h3js/h3/pull/772))
- Apply automated updates ([3249ca7](https://github.com/h3js/h3/commit/3249ca7))
- Prepare v1 branch ([9cb2537](https://github.com/h3js/h3/commit/9cb2537))

### 🤖 CI

- Remove node 16 from test matrix ([458cfac](https://github.com/h3js/h3/commit/458cfac))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Joshua Sosso ([@joshmossas](http://github.com/joshmossas))
- Yusuf Mansur Özer <ymansurozer@gmail.com>
- Daniel Slepov <danil.slepov@gmail.com>
- Alexander Lichter ([@manniL](http://github.com/manniL))
- Haruaki OTAKE <aaharu@hotmail.com>
- @beer ([@iiio2](http://github.com/iiio2))
- Sébastien Chopin <seb@nuxtjs.com>
- Michael Brevard <yonshi29@gmail.com>
- Matthias Zaunseder <matthias.zaunseder@hotmail.de>
- Torsten Dittmann <torsten.dittmann@googlemail.com>
- Guten <ywzhaifei@gmail.com>
- JoLo ([@jolo-dev](http://github.com/jolo-dev))
- Xjccc ([@xjccc](http://github.com/xjccc))
- Nozomu Ikuta ([@NozomuIkuta](http://github.com/NozomuIkuta))
- Dog ([@dgxo](http://github.com/dgxo))
- Israel Ortuño <ai.ortuno@gmail.com>
- Eckhardt (Kaizen) Dreyer <eckhardt.dreyer@gmail.com>
- Estéban ([@Barbapapazes](http://github.com/Barbapapazes))
- Mathieu Derelle <mathieu.derelle@gmail.com>
- Deth <gabriel@rosa.dev.br>
- Michel Edighoffer <m.edighoffer@france-solar.fr>
- Evgenii Troinov
- Kongmoumou ([@kongmoumou](http://github.com/kongmoumou))
- Remonke ([@remonke](http://github.com/remonke))
- Shyam Chen <shyamchen1994@gmail.com>
- KobZ ([@devseckobz](http://github.com/devseckobz))
- \_lmmmmmm <lmmmmmm12138@gmail.com>
- Vladimir Kutepov ([@frenzzy](http://github.com/frenzzy))

## v1.11.1

[compare changes](https://github.com/h3js/h3/compare/v1.11.0...v1.11.1)

### 🩹 Fixes

- **ws:** Resolve pathname for matching ([4f211f8](https://github.com/h3js/h3/commit/4f211f8))

### 📖 Documentation

- Update bun ws example ([da464c3](https://github.com/h3js/h3/commit/da464c3))

### 🏡 Chore

- Update crossws ([a61f98a](https://github.com/h3js/h3/commit/a61f98a))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v1.11.0

[compare changes](https://github.com/h3js/h3/compare/v1.10.2...v1.11.0)

### 🚀 Enhancements

- Add utilities for server sent events ([#586](https://github.com/h3js/h3/pull/586))
- **response:** Add `sendIterable` util ([#655](https://github.com/h3js/h3/pull/655))
- Handler resolver ([#669](https://github.com/h3js/h3/pull/669))
- Websocket support ([#671](https://github.com/h3js/h3/pull/671))

### 🩹 Fixes

- **serveStatic:** Ensure `etag` header is set before sending 304 response ([#653](https://github.com/h3js/h3/pull/653))

### 📖 Documentation

- Add basic jsdocs for utils ([c8aa150](https://github.com/h3js/h3/commit/c8aa150))
- Fix typo ([#668](https://github.com/h3js/h3/pull/668))
- Fix typos ([#665](https://github.com/h3js/h3/pull/665))
- Fix typo ([#662](https://github.com/h3js/h3/pull/662))
- Fix typos ([#661](https://github.com/h3js/h3/pull/661))
- Fix import name ([#658](https://github.com/h3js/h3/pull/658))
- **examples/from-expressjs-to-h3:** Add node middleware usage ([#663](https://github.com/h3js/h3/pull/663))
- Refine function usages ([#667](https://github.com/h3js/h3/pull/667))
- Remove unwanted `console.log` ([#675](https://github.com/h3js/h3/pull/675))
- Add jsdoc examples ([#672](https://github.com/h3js/h3/pull/672))
- Update jsdocs example for route utils ([#673](https://github.com/h3js/h3/pull/673))

### 🏡 Chore

- **release:** V1.10.2 ([a58d7c9](https://github.com/h3js/h3/commit/a58d7c9))
- Apply automated fixes ([f5a89fc](https://github.com/h3js/h3/commit/f5a89fc))
- Fix does issues ([#657](https://github.com/h3js/h3/pull/657))
- Integrate automd ([5212f01](https://github.com/h3js/h3/commit/5212f01))
- Lint ([ddffb0e](https://github.com/h3js/h3/commit/ddffb0e))
- Update docs ([1d8b389](https://github.com/h3js/h3/commit/1d8b389))
- Update docs ([5e3b5e5](https://github.com/h3js/h3/commit/5e3b5e5))
- Update lockfiles ([272e1be](https://github.com/h3js/h3/commit/272e1be))
- Apply automated updates ([96eda87](https://github.com/h3js/h3/commit/96eda87))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Estéban ([@Barbapapazes](http://github.com/Barbapapazes))
- Bram Kamies
- Joshua Sosso ([@joshmossas](http://github.com/joshmossas))
- Nozomu Ikuta
- Markthree ([@markthree](http://github.com/markthree))
- Sacha Stafyniak ([@stafyniaksacha](http://github.com/stafyniaksacha))
- Meir Lamdan
- Joshua
- Matej Černý
- Amit Gurbani ([@AmitGurbani](http://github.com/AmitGurbani))
- Neil Richter ([@noook](http://github.com/noook))

## v1.10.2

[compare changes](https://github.com/h3js/h3/compare/v1.10.1...v1.10.2)

### 🩹 Fixes

- **proxy:** Ignore incoming `accept` header ([#646](https://github.com/h3js/h3/pull/646))

### ❤️ Contributors

- Daniel Roe ([@danielroe](http://github.com/danielroe))

## v1.10.1

[compare changes](https://github.com/h3js/h3/compare/v1.10.0...v1.10.1)

### 🩹 Fixes

- **setResponseHeaders:** Fix types to allow partial header names ([#607](https://github.com/h3js/h3/pull/607))
- **setCookie:** Allow cookies with the same name but different options ([#606](https://github.com/h3js/h3/pull/606))
- **getRequestWebStream:** Reuse buffered body if available ([#616](https://github.com/h3js/h3/pull/616))
- **getSession:** Use semaphore lock for unseal operation ([#612](https://github.com/h3js/h3/pull/612))
- **getRequestIP:** Use first address of `x-forwarded-for` header ([#618](https://github.com/h3js/h3/pull/618))
- Avoid setting default `content-type` for responses with 304 status ([#641](https://github.com/h3js/h3/pull/641))

### 💅 Refactors

- Use `H3Event.node.res` for internal types ([#626](https://github.com/h3js/h3/pull/626))

### 📖 Documentation

- Fix `getRequestHeaders` signuture ([#613](https://github.com/h3js/h3/pull/613))
- Fix typo in examples ([#631](https://github.com/h3js/h3/pull/631))

### 🏡 Chore

- **release:** V1.10.0 ([ae91fc8](https://github.com/h3js/h3/commit/ae91fc8))
- Update lockfile ([1f9393d](https://github.com/h3js/h3/commit/1f9393d))
- Rename vitest config file to suppress warn ([8345c1f](https://github.com/h3js/h3/commit/8345c1f))
- Update lockfile ([87119a1](https://github.com/h3js/h3/commit/87119a1))

### ✅ Tests

- Add basic tests for session ([22807f2](https://github.com/h3js/h3/commit/22807f2))
- Update session test ([ba275c3](https://github.com/h3js/h3/commit/ba275c3))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Estéban ([@Barbapapazes](http://github.com/Barbapapazes))
- Michael Brevard <yonshi29@gmail.com>
- Jaden <me@jaden.bio>
- Oscar Beaumont ([@oscartbeaumont](http://github.com/oscartbeaumont))
- Kamil Kuczmera
- Jonas Thelemann <e-mail@jonas-thelemann.de>

## v1.10.0

[compare changes](https://github.com/h3js/h3/compare/v1.9.0...v1.10.0)

### 🚀 Enhancements

- **validate:** Provide validate error in `data` ([#594](https://github.com/h3js/h3/pull/594))

### 🩹 Fixes

- **readRawBody:** Check `req.rawBody` before `req.body` ([#604](https://github.com/h3js/h3/pull/604))

### 📖 Documentation

- Add `h3-compression` to community packages ([#524](https://github.com/h3js/h3/pull/524))
- Add examples ([#539](https://github.com/h3js/h3/pull/539))

### 🌊 Types

- Add generics to `isError` and update `DataT` default generic param ([#582](https://github.com/h3js/h3/pull/582))
- **setResponseHeaders:** Add autocompletion for header names ([#601](https://github.com/h3js/h3/pull/601))

### 🏡 Chore

- **release:** V1.9.0 ([09b49d5](https://github.com/h3js/h3/commit/09b49d5))
- Update vitest and lockfile ([62100fb](https://github.com/h3js/h3/commit/62100fb))
- Update vitest typecheck ([39f9434](https://github.com/h3js/h3/commit/39f9434))

### 🤖 CI

- Fix nightly release job conditional ([#587](https://github.com/h3js/h3/pull/587))

### ❤️ Contributors

- Michael Brevard <yonshi29@gmail.com>
- Pooya Parsa ([@pi0](http://github.com/pi0))
- Estéban ([@Barbapapazes](http://github.com/Barbapapazes))
- Gregor Becker ([@CodeDredd](http://github.com/CodeDredd))
- Bobbie Goede <bobbiegoede@gmail.com>
- Sébastien Chopin <seb@nuxtjs.com>
- Damian Głowala ([@DamianGlowala](http://github.com/DamianGlowala))

## v1.9.0

[compare changes](https://github.com/h3js/h3/compare/v1.8.2...v1.9.0)

### 🚀 Enhancements

- Support auto complete for http header names ([#542](https://github.com/h3js/h3/pull/542))
- Add `getValidatedRouterParams` util ([#573](https://github.com/h3js/h3/pull/573))
- `decode` option for `getRouterParam` ([#556](https://github.com/h3js/h3/pull/556))
- Add `getRequestFingerprint` util ([#564](https://github.com/h3js/h3/pull/564))

### 🩹 Fixes

- **sendNoContent:** Preserve custom status code if already set ([#577](https://github.com/h3js/h3/pull/577))

### 📖 Documentation

- Add `@intlify/h3` to community packages ([#559](https://github.com/h3js/h3/pull/559))
- Improve jsdocs ([#574](https://github.com/h3js/h3/pull/574))
- Add package pronunciation ([#569](https://github.com/h3js/h3/pull/569))

### 🌊 Types

- Add generics to `H3Error` data and `createError` ([#566](https://github.com/h3js/h3/pull/566))

### 🏡 Chore

- Update lockfile ([0ff34bc](https://github.com/h3js/h3/commit/0ff34bc))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Nandi95
- Horu
- Damian Głowala ([@DamianGlowala](http://github.com/DamianGlowala))
- Nozomu Ikuta
- Alexander Lichter ([@manniL](http://github.com/manniL))
- Łukasz Wołodkiewicz
- Kazuya Kawaguchi <kawakazu80@gmail.com>
- Michael Brevard <yonshi29@gmail.com>

## v1.8.2

[compare changes](https://github.com/h3js/h3/compare/v1.8.1...v1.8.2)

### 🩹 Fixes

- **getRequestProtocol:** Conditionally check `connection?.encrypted` ([#532](https://github.com/h3js/h3/pull/532))

### 🏡 Chore

- Update playground dependency ([90f64e9](https://github.com/h3js/h3/commit/90f64e9))
- Update lockfile ([4994334](https://github.com/h3js/h3/commit/4994334))
- Revert codecov-action to v3 ([de01f41](https://github.com/h3js/h3/commit/de01f41))
- Update dependencies ([d18f56b](https://github.com/h3js/h3/commit/d18f56b))
- Fix type issue with unenv ([498a540](https://github.com/h3js/h3/commit/498a540))
- Apply automated lint fixes ([0610b52](https://github.com/h3js/h3/commit/0610b52))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Michael J. Roberts

## v1.8.1

[compare changes](https://github.com/h3js/h3/compare/v1.8.0...v1.8.1)

### 🩹 Fixes

- Use safe property checks ([#521](https://github.com/h3js/h3/pull/521))

### 💅 Refactors

- Use native `Headers` and `Response` for legacy polyfills ([#523](https://github.com/h3js/h3/pull/523))

### 📖 Documentation

- Typo for getValidatedQuery ([164f68e](https://github.com/h3js/h3/commit/164f68e))

### 🏡 Chore

- Update dependencies ([c8e29b0](https://github.com/h3js/h3/commit/c8e29b0))
- Update listhen to 1.4.1 ([8166bb0](https://github.com/h3js/h3/commit/8166bb0))
- Update lockfile ([ba11c04](https://github.com/h3js/h3/commit/ba11c04))

### ✅ Tests

- **proxy:** Add additional test to make sure json response is sent as is ([#512](https://github.com/h3js/h3/pull/512))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Sébastien Chopin ([@Atinux](http://github.com/Atinux))
- Arkadiusz Sygulski <arkadiusz@sygulski.pl>

## v1.8.0

[compare changes](https://github.com/h3js/h3/compare/v1.8.0-rc.3...v1.8.0)

### 🚀 Enhancements

- **router:** Expose `event.context.matchedRoute` ([#500](https://github.com/h3js/h3/pull/500))
- **web:** Add `fromWebHandler` ([#490](https://github.com/h3js/h3/pull/490))
- Support `fromPlainHandler` ([bc2ca33](https://github.com/h3js/h3/commit/bc2ca33))
- Util `getRequestIP` ([#503](https://github.com/h3js/h3/pull/503))
- `defineRequestMidleware`, `defineResponseMiddleware` and rename object synctax hooks ([#507](https://github.com/h3js/h3/pull/507))

### 🩹 Fixes

- **sanitizeStatusCode:** Input is optional ([67a4132](https://github.com/h3js/h3/commit/67a4132))
- **sendNoContent:** Avoid overriding status code if event is already handled ([3f6d99e](https://github.com/h3js/h3/commit/3f6d99e))
- **router:** Use default behavior for no-content handling ([e3c9f96](https://github.com/h3js/h3/commit/e3c9f96))

### 💅 Refactors

- **app:** Use `sendNoContent` for null handling ([a72a4b8](https://github.com/h3js/h3/commit/a72a4b8))
- **event:** Rename `event.body` to `event.rawBody` ([563313d](https://github.com/h3js/h3/commit/563313d))
- Cleanup event interface ([#506](https://github.com/h3js/h3/pull/506))
- Rename `beforeResponse` to `onBeforeResponse` ([7cebec2](https://github.com/h3js/h3/commit/7cebec2))

### 🏡 Chore

- Update lockfile ([f605b9d](https://github.com/h3js/h3/commit/f605b9d))
- Fix type issue ([383ea43](https://github.com/h3js/h3/commit/383ea43))
- Apply automated lint fixes ([aa2e5d9](https://github.com/h3js/h3/commit/aa2e5d9))
- Fix import ([af96497](https://github.com/h3js/h3/commit/af96497))
- Apply automated lint fixes ([f3d0bc9](https://github.com/h3js/h3/commit/f3d0bc9))
- Upgrade dev dependencies ([3f9c8b6](https://github.com/h3js/h3/commit/3f9c8b6))
- Sync package description ([6ad4bd0](https://github.com/h3js/h3/commit/6ad4bd0))

### 🎨 Styles

- Format all repo with prettier ([ffab809](https://github.com/h3js/h3/commit/ffab809))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Harlan Wilton ([@harlan-zw](http://github.com/harlan-zw))
- Iain Sproat

## v1.8.0-rc.3

[compare changes](https://github.com/h3js/h3/compare/v1.8.0-rc.2...v1.8.0-rc.3)

### 🚀 Enhancements

- Object-syntax event handlers ([#485](https://github.com/h3js/h3/pull/485))
- **event:** Add default stringify with method and url for better dx ([#493](https://github.com/h3js/h3/pull/493))
- Support react pipeable streams ([#494](https://github.com/h3js/h3/pull/494))

### 🩹 Fixes

- **app:** Use response.body instead of initial returned val ([0434358](https://github.com/h3js/h3/commit/0434358))
- Make request and response types explicit ([#489](https://github.com/h3js/h3/pull/489))
- **web:** Use `null` for null body responses ([#495](https://github.com/h3js/h3/pull/495))

### 📖 Documentation

- Fix `deleteCookie` description ([#487](https://github.com/h3js/h3/pull/487))

### 🏡 Chore

- Update dependencies ([21a2c6c](https://github.com/h3js/h3/commit/21a2c6c))
- Update playground ([7cb2de6](https://github.com/h3js/h3/commit/7cb2de6))
- Update listhen ([7fc1d8b](https://github.com/h3js/h3/commit/7fc1d8b))
- Add valibot to community packages ([#491](https://github.com/h3js/h3/pull/491))

### 🎨 Styles

- Format with prettier v3 ([da225b9](https://github.com/h3js/h3/commit/da225b9))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Daniel Roe <daniel@roe.dev>
- Michel EDIGHOFFER <edimitchel@gmail.com>
- Conner ([@Intevel](http://github.com/Intevel))

## v1.8.0-rc.2

[compare changes](https://github.com/h3js/h3/compare/v1.8.0-rc.1...v1.8.0-rc.2)

### 🚀 Enhancements

- **app:** Handle bigint return types ([#474](https://github.com/h3js/h3/pull/474))
- Preserve and make error cause accessible ([#479](https://github.com/h3js/h3/pull/479))
- Platform agnostic `serveStatic` utility ([#480](https://github.com/h3js/h3/pull/480))
- **app:** `onRequest`, `onBeforeResponse` and `onAfterResponse` global hooks ([#482](https://github.com/h3js/h3/pull/482))
- `plain` and `web` adapters ([#483](https://github.com/h3js/h3/pull/483))

### 🩹 Fixes

- **app:** Handle directly `node.res.end()` returned value ([7b18fa0](https://github.com/h3js/h3/commit/7b18fa0))
- **stream:** Improve node.js readable stream check ([cdd2680](https://github.com/h3js/h3/commit/cdd2680))
- **proxy:** Merge overridden headers with different case ([#476](https://github.com/h3js/h3/pull/476))
- **readbody:** Accept additional options for urlencoded header ([#437](https://github.com/h3js/h3/pull/437))
- **app:** Throw error when trying to return function or symbol as response ([6e58103](https://github.com/h3js/h3/commit/6e58103))
- **app:** Use default error handler if `onError` does not handles response ([#478](https://github.com/h3js/h3/pull/478))
- **proxyRequest:** Only attempt to read body if incoming request can contain body ([a26579f](https://github.com/h3js/h3/commit/a26579f))
- **app:** Make sure resolved val is also not undefined before calling hooks ([cfe397e](https://github.com/h3js/h3/commit/cfe397e))

### 💅 Refactors

- **app:** Extract handler returned response handling ([#473](https://github.com/h3js/h3/pull/473))
- **event:** Always normalize `event.method` ([7585861](https://github.com/h3js/h3/commit/7585861))
- Deprecate `getMethod` to prefer `event.method` ([bc202c0](https://github.com/h3js/h3/commit/bc202c0))
- **event:** Use `sendWebResponse` for `event.respondWith` ([#481](https://github.com/h3js/h3/pull/481))

### 🏡 Chore

- Remove extra log in tests ([06d1bc1](https://github.com/h3js/h3/commit/06d1bc1))

### ✅ Tests

- **proxy:** Remove external request to speedup ([d4f5440](https://github.com/h3js/h3/commit/d4f5440))
- Add evetHandler wrapper ([d351ba9](https://github.com/h3js/h3/commit/d351ba9))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v1.8.0-rc.1

[compare changes](https://github.com/h3js/h3/compare/v1.8.0-rc.0...v1.8.0-rc.1)

### 🩹 Fixes

- Revert #452 ([#452](https://github.com/h3js/h3/issues/452))

### 🏡 Chore

- Add `release-rc` script ([98d2fa5](https://github.com/h3js/h3/commit/98d2fa5))
- Fix rc release script ([551987a](https://github.com/h3js/h3/commit/551987a))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v1.8.0-rc.0

[compare changes](https://github.com/h3js/h3/compare/v1.7.1...v1.8.0-rc.0)

### 🚀 Enhancements

- Support web streams ([#432](https://github.com/h3js/h3/pull/432))
- Add `event.method` and `event.headers` ([#429](https://github.com/h3js/h3/pull/429))
- Support blob responses ([#422](https://github.com/h3js/h3/pull/422))
- Web responses with streaming support ([#436](https://github.com/h3js/h3/pull/436))
- **readBody:** Validate requests with `application/json` content type ([#207](https://github.com/h3js/h3/pull/207))
- **event:** Support `event.url` ([#455](https://github.com/h3js/h3/pull/455))
- **event:** `event.body` with readable stream ([#457](https://github.com/h3js/h3/pull/457))
- **event:** `event.request` getter to access web request ([#454](https://github.com/h3js/h3/pull/454))
- Add `readFormData` util ([#421](https://github.com/h3js/h3/pull/421))
- **proxy:** Stream request body with `streamRequest` option ([#374](https://github.com/h3js/h3/pull/374))
- `readValidatedBody` and `getValidatedQuery` utils ([#459](https://github.com/h3js/h3/pull/459))
- Add `removeResponseHeader` and `clearResponseHeaders` utils ([#427](https://github.com/h3js/h3/pull/427))
- Add event handler generics for typed request body and query ([#417](https://github.com/h3js/h3/pull/417))

### 🩹 Fixes

- **proxy:** Handle responses with no content ([#433](https://github.com/h3js/h3/pull/433))
- Split `set-cookie` value when handling web responses ([#445](https://github.com/h3js/h3/pull/445))
- **defineLazyEventHandler:** Infer return type ([#442](https://github.com/h3js/h3/pull/442))
- **proxy:** Respect `fetchOptions.method` over incoming request method ([#441](https://github.com/h3js/h3/pull/441))
- Append `set-cookie` headers in web response ([#453](https://github.com/h3js/h3/pull/453))
- **proxy:** Avoid decoding request body as utf8 ([#440](https://github.com/h3js/h3/pull/440))
- **readMultipartFormData:** Handle utf8 encoding for `name` and `filename` ([#416](https://github.com/h3js/h3/pull/416))
- **event:** Do not remove double slashes from query ([#462](https://github.com/h3js/h3/pull/462))
- **router:** Fallback for method-shadowed routes ([#461](https://github.com/h3js/h3/pull/461))
- **proxy:** Transparently forward errors when passing ofetch ([#466](https://github.com/h3js/h3/pull/466))
- Keep backward compatibility with `event.node.req.url` ([#471](https://github.com/h3js/h3/pull/471))
- **getRequestPath:** Avoid double normalization ([0181d33](https://github.com/h3js/h3/commit/0181d33))

### 💅 Refactors

- **app::** Split return type conditions ([#434](https://github.com/h3js/h3/pull/434))
- Use `event.path` instead of `event.node.req.url` for internal utils ([#438](https://github.com/h3js/h3/pull/438))
- Type `event.node.req.originalUrl` ([6c87d87](https://github.com/h3js/h3/commit/6c87d87))
- Alias `isEventHandler` to `isEvent` ([#452](https://github.com/h3js/h3/pull/452))

### 📖 Documentation

- Update link to how it works ([3dd2376](https://github.com/h3js/h3/commit/3dd2376))
- Split readme into subsection and document missing helpers ([#428](https://github.com/h3js/h3/pull/428))
- Improve nightly release usage section ([#468](https://github.com/h3js/h3/pull/468))

### 🏡 Chore

- Ignore eslint warning ([4c609b2](https://github.com/h3js/h3/commit/4c609b2))
- **release:** V1.7.1 ([7273ab4](https://github.com/h3js/h3/commit/7273ab4))
- Add autofix ci ([e359f5f](https://github.com/h3js/h3/commit/e359f5f))
- Online stackblitz playground ([#451](https://github.com/h3js/h3/pull/451))
- Add link to example for nested routers ([0968902](https://github.com/h3js/h3/commit/0968902))
- Setup nightly releases ([#467](https://github.com/h3js/h3/pull/467))

### ✅ Tests

- **proxy:** Disable keep alive to run faster ([8783ab6](https://github.com/h3js/h3/commit/8783ab6))
- **proxy:** Avoid consuming body in interceptor ([b960a74](https://github.com/h3js/h3/commit/b960a74))
- Add polyfills to run all tests against node.js 16 ([#456](https://github.com/h3js/h3/pull/456))

### 🤖 CI

- Use conventional commits for autofix ([#470](https://github.com/h3js/h3/pull/470))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Daniel Roe <daniel@roe.dev>
- Heb ([@Hebilicious](http://github.com/Hebilicious))
- Arkadiusz Sygulski <arkadiusz@sygulski.pl>
- Iain Sproat
- Zhiyuanzmj
- Ngob <ngobenoit@gmail.com>
- Emīls Gulbis ([@emilsgulbis](http://github.com/emilsgulbis))
- Tobias Diez <code@tobiasdiez.com>
- Javad Mnjd ([@jd1378](http://github.com/jd1378))
- Hebilicious ([@Hebilicious](http://github.com/Hebilicious))
- Valentin Dzhankhotov <vushe@yandex.ru>

## v1.7.1

[compare changes](https://github.com/h3js/h3/compare/v1.7.0...v1.7.1)

### 🩹 Fixes

- **fetchWithEvent:** Allow customizing fetch impl type ([#414](https://github.com/h3js/h3/pull/414))

### 💅 Refactors

- Improve `H3Error` ([#415](https://github.com/h3js/h3/pull/415))

### 📖 Documentation

- Update link to how it works ([3dd2376](https://github.com/h3js/h3/commit/3dd2376))

### 🏡 Chore

- **release:** V1.7.0 ([709708f](https://github.com/h3js/h3/commit/709708f))
- Add codecov.yml ([33f434f](https://github.com/h3js/h3/commit/33f434f))
- Ignore eslint warning ([4c609b2](https://github.com/h3js/h3/commit/4c609b2))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Daniel Roe <daniel@roe.dev>
- Med Talhaouy

## v1.7.0

[compare changes](https://github.com/h3js/h3/compare/v1.6.6...v1.7.0)

### 🚀 Enhancements

- **proxy:** Support `onResponse` callback ([#368](https://github.com/h3js/h3/pull/368))
- **useSession:** Support custom session id generator ([#390](https://github.com/h3js/h3/pull/390))
- `event.handled` flag ([#410](https://github.com/h3js/h3/pull/410))

### 🩹 Fixes

- **types:** Type for get router parameter utils ([#400](https://github.com/h3js/h3/pull/400))
- **proxy:** Split cookie headers properly with native node fetch ([#408](https://github.com/h3js/h3/pull/408))
- **readRawBody:** Handle body as object ([#403](https://github.com/h3js/h3/pull/403))
- **router:** Send 204 with empty string in preemptive mode instead of 404 ([#409](https://github.com/h3js/h3/pull/409))
- **cache, proxy, response:** Avoid sending handled events ([#411](https://github.com/h3js/h3/pull/411))

### 📖 Documentation

- Add event as first arg for proxyRequest ([3e5f427](https://github.com/h3js/h3/commit/3e5f427))

### 🏡 Chore

- Update dependencies ([8468b90](https://github.com/h3js/h3/commit/8468b90))
- Lint ([3494084](https://github.com/h3js/h3/commit/3494084))
- Update destr to v2 ([bb59c69](https://github.com/h3js/h3/commit/bb59c69))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- 魔王少年 ([@maou-shonen](http://github.com/maou-shonen))
- Ígor Jacaúna
- Enkot ([@enkot](http://github.com/enkot))
- Cerino Ligutom III ([@zeferinix](http://github.com/zeferinix))
- Sébastien Chopin <seb@nuxtjs.com>

## v1.6.6

[compare changes](https://github.com/h3js/h3/compare/v1.6.5...v1.6.6)

### 🩹 Fixes

- **getRequestURL:** Normalize double slashes ([b5d2972](https://github.com/h3js/h3/commit/b5d2972))
- **getRequestURL:** Make `x-forwarded-host` support opt-in ([2fce169](https://github.com/h3js/h3/commit/2fce169))
- **event:** Normalize `event.path` ([981c89f](https://github.com/h3js/h3/commit/981c89f))

### 🏡 Chore

- Fix eslint issue ([9b968ba](https://github.com/h3js/h3/commit/9b968ba))
- Update dependencies ([b7126b8](https://github.com/h3js/h3/commit/b7126b8))
- Remove unused interface ([aadec3d](https://github.com/h3js/h3/commit/aadec3d))

### ✅ Tests

- Add tests for `getRequestURL` ([d510483](https://github.com/h3js/h3/commit/d510483))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v1.6.5

[compare changes](https://github.com/h3js/h3/compare/v1.6.4...v1.6.5)

### 🩹 Fixes

- **readRawBody:** Resolve cached promise before normalizing buffer ([2e472e8](https://github.com/h3js/h3/commit/2e472e8))

### 🏡 Chore

- Update dependencies ([a6ccd2c](https://github.com/h3js/h3/commit/a6ccd2c))
- Lint ([e437f55](https://github.com/h3js/h3/commit/e437f55))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v1.6.4

[compare changes](https://github.com/h3js/h3/compare/v1.6.3...v1.6.4)

### 🩹 Fixes

- **readRawBody:** Always return buffer without encoding ([19d133d](https://github.com/h3js/h3/commit/19d133d))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v1.6.3

[compare changes](https://github.com/h3js/h3/compare/v1.6.2...v1.6.3)

### 🩹 Fixes

- **readBody, readRawBody:** Handle raw body as buffer ([#366](https://github.com/h3js/h3/pull/366))

### 📖 Documentation

- Missing parentheses ([#362](https://github.com/h3js/h3/pull/362))

### 🏡 Chore

- Update changelog ([e199df3](https://github.com/h3js/h3/commit/e199df3))

### ❤️ Contributors

- Johann Schopplich ([@johannschopplich](http://github.com/johannschopplich))
- Roger!
- Pooya Parsa ([@pi0](http://github.com/pi0))

## v1.6.2

[compare changes](https://github.com/h3js/h3/compare/v1.6.1...v1.6.2)

### 🩹 Fixes

- **setResponseStatus:** Mark `code` type as optional ([#359](https://github.com/h3js/h3/pull/359))
- Sanitize utils and sanitize all response code and messages ([#358](https://github.com/h3js/h3/pull/358))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Daniel Roe <daniel@roe.dev>

## v1.6.1

[compare changes](https://github.com/h3js/h3/compare/v1.6.0...v1.6.1)

### 🩹 Fixes

- Sanitize `statusMessage` of disallowed chars ([#357](https://github.com/h3js/h3/pull/357))

### ❤️ Contributors

- Daniel Roe <daniel@roe.dev>

## v1.6.0

[compare changes](https://github.com/h3js/h3/compare/v1.5.0...v1.6.0)

### 🚀 Enhancements

- Expose `splitCookiesString` utility ([#343](https://github.com/h3js/h3/pull/343))
- `getRequestHost`, `getRequestProtocol` and `getRequestURL` utils ([#351](https://github.com/h3js/h3/pull/351))

### 🩹 Fixes

- **clearSession:** Accept partial session config ([#328](https://github.com/h3js/h3/pull/328))
- **useSession:** Add types for `data` property ([#346](https://github.com/h3js/h3/pull/346))
- **fetchWithEvent:** Handle undefined `init` ([c84c811](https://github.com/h3js/h3/commit/c84c811))

### 🏡 Chore

- Replace deprecated methods in test and jsdocs ([#341](https://github.com/h3js/h3/pull/341))
- Fix lint error ([#342](https://github.com/h3js/h3/pull/342))
- **readme:** Update badges ([7afa753](https://github.com/h3js/h3/commit/7afa753))
- **readme:** Use correct link ([a5e9fcd](https://github.com/h3js/h3/commit/a5e9fcd))
- Update dev dependencies ([f0075c7](https://github.com/h3js/h3/commit/f0075c7))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Sébastien Chopin <seb@nuxtjs.com>
- 魔王少年 ([@mao-shonen](http://github.com/mao-shonen))
- Oleg Khalin
- Yuki Tsujimoto
- Zhiyuanzmj

## v1.5.0

[compare changes](https://github.com/h3js/h3/compare/v1.4.0...v1.5.0)

### 🚀 Enhancements

- Add cors utils ([#322](https://github.com/h3js/h3/pull/322))
- **proxy:** Support `cookieDomainRewrite` and `cookiePathRewrite` ([#313](https://github.com/h3js/h3/pull/313))

### 🩹 Fixes

- **proxy:** Separate multiple cookie headers ([#319](https://github.com/h3js/h3/pull/319))

### 📖 Documentation

- Update build status badge url ([#331](https://github.com/h3js/h3/pull/331))

### 🌊 Types

- Export `MultiPartData` ([#332](https://github.com/h3js/h3/pull/332))

### 🏡 Chore

- Improve `lint` npm script ([#329](https://github.com/h3js/h3/pull/329))
- Update ufo dependency ([bdca859](https://github.com/h3js/h3/commit/bdca859))

### ❤️ Contributors

- Pooya Parsa <pooya@pi0.io>
- Enkot <taras.batenkov@gmail.com>
- Nozomu Ikuta
- Martin Meixger <martin@meixger.com>
- Divyansh Singh

## v1.4.0

[compare changes](https://github.com/h3js/h3/compare/v1.3.0...v1.4.0)

### 🚀 Enhancements

- Session support improvements ([#325](https://github.com/h3js/h3/pull/325))

### ❤️ Contributors

- Pooya Parsa <pyapar@gmail.com>

## v1.3.0

[compare changes](https://github.com/h3js/h3/compare/v1.2.1...v1.3.0)

### 🚀 Enhancements

- `fetchWithEvent` and `getProxyRequestHeaders` utils ([#323](https://github.com/h3js/h3/pull/323))

### 🩹 Fixes

- **proxy:** Handle consumed responses ([#321](https://github.com/h3js/h3/pull/321))
- **proxy:** Handle consumed json body ([#324](https://github.com/h3js/h3/pull/324))

### 💅 Refactors

- **session:** Use upstream `iron-webcrypto` ([a4b6f0d](https://github.com/h3js/h3/commit/a4b6f0d))

### 🌊 Types

- **proxy:** Req can be url too ([e13663b](https://github.com/h3js/h3/commit/e13663b))
- **session:** Session data values can be any pojo passing to `JSON.stringify` ([22d116c](https://github.com/h3js/h3/commit/22d116c))

### ❤️ Contributors

- Pooya Parsa <pooya@pi0.io>

## v1.2.1

[compare changes](https://github.com/h3js/h3/compare/v1.2.0...v1.2.1)

### 📦 Build

- Inline `iron-webcrypto` to remove buffer polyfill ([c50505b](https://github.com/h3js/h3/commit/c50505b))

### 🏡 Chore

- Ignore lib from eslint ([ac28a37](https://github.com/h3js/h3/commit/ac28a37))

### ❤️ Contributors

- Pooya Parsa <pooya@pi0.io>

## v1.2.0

[compare changes](https://github.com/h3js/h3/compare/v1.1.0...v1.2.0)

### 🚀 Enhancements

- Session support ([#315](https://github.com/h3js/h3/pull/315))

### 🩹 Fixes

- **setCookie:** Override existing `set-cookie` header with same name ([#316](https://github.com/h3js/h3/pull/316))
- **proxy:** Add `host` to ignored headers ([d4f863f](https://github.com/h3js/h3/commit/d4f863f))

### 📖 Documentation

- Improvements ([#297](https://github.com/h3js/h3/pull/297))

### ✅ Tests

- Replace useCookies with parseCookies in test ([#314](https://github.com/h3js/h3/pull/314))

### ❤️ Contributors

- Pooya Parsa <pooya@pi0.io>
- Yuki Tsujimoto
- Ryan Frantz <ryanleefrantz@gmail.com>

## v1.1.0

[compare changes](https://github.com/h3js/h3/compare/v1.0.2...v1.1.0)

### 🚀 Enhancements

- Utils to get and set response status ([c8b4d85](https://github.com/h3js/h3/commit/c8b4d85))
- Add `readMultipartFormData` to parse `multipart/form-data` ([#280](https://github.com/h3js/h3/pull/280))
- Add`sendNoContent` utility to create a 204 response ([#250](https://github.com/h3js/h3/pull/250))

### 🏡 Chore

- Add full mit text for multipart util ([42cfb99](https://github.com/h3js/h3/commit/42cfb99))

### ❤️ Contributors

- Pooya Parsa <pooya@pi0.io>
- Tobias Diez <code@tobiasdiez.com>
- Daniel Roe <daniel@roe.dev>

## v1.0.2

[compare changes](https://github.com/h3js/h3/compare/v1.0.1...v1.0.2)

### 🩹 Fixes

- Correct types for `readRawBody` ([#277](https://github.com/h3js/h3/pull/277))
- **readBody:** Handle top-level arrays in url-encoded data ([#278](https://github.com/h3js/h3/pull/278))

### 💅 Refactors

- Update `@deprecated` comment ([#245](https://github.com/h3js/h3/pull/245))
- **createRouter:** Deprecate misspelled `preemptive` option ([#256](https://github.com/h3js/h3/pull/256))

### 📖 Documentation

- Fix deprecated methods ([#238](https://github.com/h3js/h3/pull/238))

### 🏡 Chore

- Add section to readme for community packages ([#262](https://github.com/h3js/h3/pull/262))
- Update eslint config ([0812e81](https://github.com/h3js/h3/commit/0812e81))
- Format with prettier ([a0e21c1](https://github.com/h3js/h3/commit/a0e21c1))
- Fix type issue ([a9b3187](https://github.com/h3js/h3/commit/a9b3187))

### ✅ Tests

- Fix legacy middleware test ([408f3f2](https://github.com/h3js/h3/commit/408f3f2))

### ❤️ Contributors

- Pooya Parsa <pooya@pi0.io>
- Daniel Roe <daniel@roe.dev>
- Nozomu Ikuta <nick.0508.nick@gmail.com>
- Larry Williamson <l422y@l422y.com>

### [1.0.1](https://github.com/h3js/h3/compare/v1.0.0...v1.0.1) (2022-11-15)

## [1.0.0](https://github.com/h3js/h3/compare/v0.8.6...v1.0.0) (2022-11-15)

### ⚠ BREAKING CHANGES

- drop deprecated util aliases

### Features

- add `proxyRequest` util ([#226](https://github.com/h3js/h3/issues/226)) ([501f0c6](https://github.com/h3js/h3/commit/501f0c6e623ea827d47691046f3c7319f5ac4651))

### Bug Fixes

- import type from correct location ([#219](https://github.com/h3js/h3/issues/219)) ([8b89f39](https://github.com/h3js/h3/commit/8b89f3927faed6cdd4cce6650f54d7b0ee77c229))
- **router:** throw 404 for intermediate matches ([43db151](https://github.com/h3js/h3/commit/43db151e32dece4d98a8a361de98a28b232efad9))

- drop deprecated util aliases ([dc8ee81](https://github.com/h3js/h3/commit/dc8ee81799bf93148ef686b3434287858afdafa0))

### [0.7.17](https://github.com/h3js/h3/compare/v0.7.16...v0.7.17) (2022-08-30)

### Bug Fixes

- **sendRedirect:** always encode location uri ([01476ac](https://github.com/h3js/h3/commit/01476acb98a248d36544573febb562d2cd5fee09))

### [0.7.16](https://github.com/h3js/h3/compare/v0.7.15...v0.7.16) (2022-08-23)

### Bug Fixes

- `context` type for `CompatibilityRequestProps` ([#164](https://github.com/h3js/h3/issues/164)) ([984a42b](https://github.com/h3js/h3/commit/984a42b99d6204b40b942861d72592b53139b4d6))
- added missing patch router method ([#166](https://github.com/h3js/h3/issues/166)) ([dff2211](https://github.com/h3js/h3/commit/dff22112d89c8f556301172ae8ee2720b036dae9))

### [0.7.15](https://github.com/h3js/h3/compare/v0.7.14...v0.7.15) (2022-08-10)

### Bug Fixes

- **createError:** preserve original error stack ([#161](https://github.com/h3js/h3/issues/161)) ([8213421](https://github.com/h3js/h3/commit/8213421bfdc816b48c204b727e6df1b52abe8e08))
- don not log errors when `onError` is provided ([#162](https://github.com/h3js/h3/issues/162)) ([ccc9c7e](https://github.com/h3js/h3/commit/ccc9c7e66076aae3d8ba5ba4cf117a68917024f2))

### [0.7.14](https://github.com/h3js/h3/compare/v0.7.13...v0.7.14) (2022-08-08)

### Features

- add utilities for http headers ([#157](https://github.com/h3js/h3/issues/157)) ([272f883](https://github.com/h3js/h3/commit/272f883c3e6413a632e871de3a796d62e6c5da43))
- add utility for router params ([#120](https://github.com/h3js/h3/issues/120)) ([#158](https://github.com/h3js/h3/issues/158)) ([4b83bdf](https://github.com/h3js/h3/commit/4b83bdf83b94da3f66018378d39c5cc24afdf43f))

### [0.7.13](https://github.com/h3js/h3/compare/v0.7.12...v0.7.13) (2022-08-01)

### Features

- send 204 response if null is returned from handler ([#154](https://github.com/h3js/h3/issues/154)) ([dbd465f](https://github.com/h3js/h3/commit/dbd465f644274775de8b4322cb5238171780033c))
- **sendRedirect:** add refresh meta fallback for static generated responses ([#153](https://github.com/h3js/h3/issues/153)) ([606de3b](https://github.com/h3js/h3/commit/606de3bb3abeacc44debc164d23677853066a4e0))

### [0.7.12](https://github.com/h3js/h3/compare/v0.7.11...v0.7.12) (2022-07-21)

### Bug Fixes

- **isError:** use `__h3_error__` class property to detect error ([968bfee](https://github.com/h3js/h3/commit/968bfeef8ea728497bf432c421bbb73f3e9de6e7))

### [0.7.11](https://github.com/h3js/h3/compare/v0.7.10...v0.7.11) (2022-07-21)

### Features

- **createError:** support `fatal` and `unhandled` ([#148](https://github.com/h3js/h3/issues/148)) ([8579f1c](https://github.com/h3js/h3/commit/8579f1c9b055a38003f05a2592704027fb460778))

### Bug Fixes

- **handleCacheHeaders:** add `max-age` to the final object ([#142](https://github.com/h3js/h3/issues/142)) ([991d099](https://github.com/h3js/h3/commit/991d099c4f43fd034393feb202827399e2cdcd25))

### [0.7.10](https://github.com/h3js/h3/compare/v0.7.9...v0.7.10) (2022-06-17)

### [0.7.9](https://github.com/h3js/h3/compare/v0.7.8...v0.7.9) (2022-06-10)

### Features

- add `H3EventContext` for type augmentation ([#124](https://github.com/h3js/h3/issues/124)) ([5042e92](https://github.com/h3js/h3/commit/5042e92e9ef8b22a143990027ca75454f0560e44))
- **createError:** support string as error source ([#132](https://github.com/h3js/h3/issues/132)) ([8eb9969](https://github.com/h3js/h3/commit/8eb9969ed3077b0dcdfc57754fcb05678ff6ee8b))
- handle error cause ([#131](https://github.com/h3js/h3/issues/131)) ([3c3b6bd](https://github.com/h3js/h3/commit/3c3b6bdc8072a112c7bc2c2fc2c36066a75dd54b))

### Bug Fixes

- **pkg:** add `types` to the exports ([#125](https://github.com/h3js/h3/issues/125)) ([bf8a329](https://github.com/h3js/h3/commit/bf8a329389977e23e27135444a7e2d1b1bde237e))

### [0.7.8](https://github.com/h3js/h3/compare/v0.7.7...v0.7.8) (2022-05-04)

### Bug Fixes

- handle typed `H3Response` ([62aebf8](https://github.com/h3js/h3/commit/62aebf80983042a91e829e99de6e5a807b978682))

### [0.7.7](https://github.com/h3js/h3/compare/v0.7.6...v0.7.7) (2022-05-04)

### Bug Fixes

- disable typecheck for h3 response (resolves [#112](https://github.com/h3js/h3/issues/112)) ([8db0195](https://github.com/h3js/h3/commit/8db0195c28750e9ba3e47648da963c65095402c4))

### [0.7.6](https://github.com/h3js/h3/compare/v0.7.5...v0.7.6) (2022-04-29)

### Bug Fixes

- **types:** nullables object props for response ([#111](https://github.com/h3js/h3/issues/111)) ([182b224](https://github.com/h3js/h3/commit/182b224af53288ba0cec1f81570271cb5457e8ce))

### [0.7.5](https://github.com/h3js/h3/compare/v0.7.4...v0.7.5) (2022-04-27)

### Bug Fixes

- **types:** fix `JSONValue` type ([#106](https://github.com/h3js/h3/issues/106)) ([e9a07cb](https://github.com/h3js/h3/commit/e9a07cbef57df04c104fa169af5fef7f2613daae))

### [0.7.4](https://github.com/h3js/h3/compare/v0.7.3...v0.7.4) (2022-04-14)

### Bug Fixes

- **handleCacheHeaders:** small improvements ([4fb9745](https://github.com/h3js/h3/commit/4fb9745505d5b0c8eea69b67f15b3b1614901869))

### [0.7.3](https://github.com/h3js/h3/compare/v0.7.2...v0.7.3) (2022-04-12)

### Features

- **router:** allow registering multiple methods at once ([#92](https://github.com/h3js/h3/issues/92)) ([c26bd46](https://github.com/h3js/h3/commit/c26bd4682ecf6fc939f47fa8f2f6414278b45b36))

### [0.7.2](https://github.com/h3js/h3/compare/v0.7.1...v0.7.2) (2022-04-08)

### Features

- add generic response type support for eventHandler ([6fcdc22](https://github.com/h3js/h3/commit/6fcdc22dd20df731cd31b99ebac0cdb473541297))

### Bug Fixes

- add missing `PATCH` method to types ([#88](https://github.com/h3js/h3/issues/88)) ([884460b](https://github.com/h3js/h3/commit/884460bffd210de9042cd9ebe3b84d1c07b40a06))

### [0.7.1](https://github.com/h3js/h3/compare/v0.7.0...v0.7.1) (2022-04-07)

### Bug Fixes

- **router:** compatibility matched params ([07930bc](https://github.com/h3js/h3/commit/07930bcfe0f5b09714058b7d5f0e3505c25175ad))

## [0.7.0](https://github.com/h3js/h3/compare/v0.6.0...v0.7.0) (2022-04-07)

### ⚠ BREAKING CHANGES

- move router params to `event.context.params`

- move router params to `event.context.params` ([6fe32e2](https://github.com/h3js/h3/commit/6fe32e27b3f22b6a2ac0db1ab60d40ec1cd8ac51))

## [0.6.0](https://github.com/h3js/h3/compare/v0.5.7...v0.6.0) (2022-04-06)

### ⚠ BREAKING CHANGES

- set default path for `setCookie` to `/`

### Features

- set default path for `setCookie` to `/` ([1bd6a45](https://github.com/h3js/h3/commit/1bd6a45aa463182b2adda48688795e6257cf5f09))

### [0.5.7](https://github.com/h3js/h3/compare/v0.5.6...v0.5.7) (2022-04-06)

### Bug Fixes

- remove `ServerResponse` from `CompatibilityEvent` possibilities ([b285659](https://github.com/h3js/h3/commit/b2856598e1432796ce7aadac2be1c11837f766d8))

### [0.5.6](https://github.com/h3js/h3/compare/v0.5.5...v0.5.6) (2022-04-06)

### Features

- `handleCacheHeaders` utility ([4a71a3f](https://github.com/h3js/h3/commit/4a71a3f02a38d6a35743f55f4c2904801cf2b463))

### Bug Fixes

- add `params` to compatibility layer for `req` ([63dd55c](https://github.com/h3js/h3/commit/63dd55c629b6a36021c6799365c05512e4b04b6f))

### [0.5.5](https://github.com/h3js/h3/compare/v0.5.4...v0.5.5) (2022-04-04)

### Features

- `dynamicEventHandler` ([ce98257](https://github.com/h3js/h3/commit/ce982571bec238396dcc574134d60e93296ec512))

### [0.5.4](https://github.com/h3js/h3/compare/v0.5.3...v0.5.4) (2022-04-01)

### Bug Fixes

- throw wrapped error with legacy middleware ([27e9477](https://github.com/h3js/h3/commit/27e9477b63b33a54b953067ae4fc2d30fb74bb2e))

### [0.5.3](https://github.com/h3js/h3/compare/v0.5.2...v0.5.3) (2022-03-31)

### Features

- **useBody:** support `application/x-www-form-urlencoded` ([73f090b](https://github.com/h3js/h3/commit/73f090b4a584f6b93299ab4e7f3f73b86727e8c3)), closes [#44](https://github.com/h3js/h3/issues/44)

### Bug Fixes

- initialise `res.req` ([#80](https://github.com/h3js/h3/issues/80)) ([57db02d](https://github.com/h3js/h3/commit/57db02deac3bd190f91838a900d71169fb9ceb18))
- revert back support for legacy middleware ([b3e4f5b](https://github.com/h3js/h3/commit/b3e4f5b2cf27196f0a2c7468dd7e706e12a6da89))

### [0.5.2](https://github.com/h3js/h3/compare/v0.5.1...v0.5.2) (2022-03-31)

### Bug Fixes

- add `[h3]` prefix to console error ([2f4859c](https://github.com/h3js/h3/commit/2f4859c9210e1eb79fc1681942af5a9678e2e8c0))
- improve `writableEnded` guard ([ba5084c](https://github.com/h3js/h3/commit/ba5084c7fce225e09536003f025ff9f46f005e03))
- make console error for thrown unknown errors ([1552219](https://github.com/h3js/h3/commit/1552219cdbd515a47ad9f6b51d4ba6f31ffea0b4))
- skip built-in error handler if `onError` provided ([2c25aa1](https://github.com/h3js/h3/commit/2c25aa10e6d872ba87926e97f77fffcc96f4d203))

### [0.5.1](https://github.com/h3js/h3/compare/v0.5.0...v0.5.1) (2022-03-29)

### Features

- expose toNodeHandle and add backward compat with layer as `handle` ([54a944c](https://github.com/h3js/h3/commit/54a944c6dff731c104c0a42964d57ccfd342dec3))
- support lazy event handlers ([333a4ca](https://github.com/h3js/h3/commit/333a4cab3c278d3749c1e3bdfd78b9fc6c4cefe9))
- typecheck handler to be a function ([38493eb](https://github.com/h3js/h3/commit/38493eb9f65ba2a2811ba36379ad0b897a6f6e5a))

### Bug Fixes

- add missing types export ([53f0b58](https://github.com/h3js/h3/commit/53f0b58b66c9d181b2bca40dcfd27305014ff758))
- refine toNodeHandle type as we always return promise ([1ba6019](https://github.com/h3js/h3/commit/1ba6019c35c8a76e368859e83790369233a7c301))

## [0.5.0](https://github.com/h3js/h3/compare/v0.4.2...v0.5.0) (2022-03-29)

### ⚠ BREAKING CHANGES

- All `handle` exports and properties are renamed to `handler` with some backward compatibilities.
- Legacy handlers are promisified by default
- opt-in using event format using `defineEventHandler` (#74)

### Features

- **app:** use node handler signature ([c722091](https://github.com/h3js/h3/commit/c7220910e15b446a1515c37bf42c7824c3eb36b7))
- opt-in using event format using `defineEventHandler` ([#74](https://github.com/h3js/h3/issues/74)) ([cdf9b7c](https://github.com/h3js/h3/commit/cdf9b7c24e9c68b0ba192f5a42c9c95d490cb72a))

### Bug Fixes

- check for null data for stream detection ([#69](https://github.com/h3js/h3/issues/69)) ([70f03fe](https://github.com/h3js/h3/commit/70f03fe548ded7e9628fc717a89e5dd12cdb6007))
- router issue with query params ([#77](https://github.com/h3js/h3/issues/77)) ([#78](https://github.com/h3js/h3/issues/78)) ([229964e](https://github.com/h3js/h3/commit/229964e6ad5d29646feff50461de0dc34cce14c8))
- **router:** req.params compatibility ([1d9fca0](https://github.com/h3js/h3/commit/1d9fca09f1f66e53811a0414ab7f53dbb158d72f))

- use events api for utils with compatibility layer ([#75](https://github.com/h3js/h3/issues/75)) ([2cf0f4b](https://github.com/h3js/h3/commit/2cf0f4b50914dea62d5f1d80dafe6aefdfd1bbd9))

### [0.4.2](https://github.com/h3js/h3/compare/v0.4.1...v0.4.2) (2022-03-16)

### Features

- add stream pipe response ([#68](https://github.com/h3js/h3/issues/68)) ([c3eb8ea](https://github.com/h3js/h3/commit/c3eb8eae05218e853da5ee6f2f9783e8dad14d1a))

### Bug Fixes

- **send:** add explicit return type ([2736b3a](https://github.com/h3js/h3/commit/2736b3ac0e65669e3bbed7766bf0c0a40b7ba25d))

### [0.4.1](https://github.com/h3js/h3/compare/v0.4.0...v0.4.1) (2022-03-11)

### Features

- add `deleteCookie` utility ([#66](https://github.com/h3js/h3/issues/66)) ([dd3c855](https://github.com/h3js/h3/commit/dd3c855f3cfe7b4ae457cd44a6898b28b1892b5a))

### Bug Fixes

- allow returning, number and boolean as well ([#65](https://github.com/h3js/h3/issues/65)) ([9a01465](https://github.com/h3js/h3/commit/9a0146577b6fe9399bfafd7ec531b8be5bb82909))
- use `cookie-es` to avoid esm bundling issues ([ceedbbc](https://github.com/h3js/h3/commit/ceedbbc88e98a49df60d0fd7630abd7d66661092))

## [0.4.0](https://github.com/h3js/h3/compare/v0.3.9...v0.4.0) (2022-03-09)

### ⚠ BREAKING CHANGES

- update repo

### Features

- add router support ([#64](https://github.com/h3js/h3/issues/64)) ([4035cca](https://github.com/h3js/h3/commit/4035cca1ddf0dd65e94a9a5c3d78c0c32098a8d9))

- update repo ([5dd59f1](https://github.com/h3js/h3/commit/5dd59f1ab055d595f58a483edb4bfc82637b47ac))

### [0.3.9](https://github.com/h3js/h3/compare/v0.3.8...v0.3.9) (2022-01-18)

### Bug Fixes

- don't lowercase routes when normalizing layers ([#60](https://github.com/h3js/h3/issues/60)) ([5bb05ce](https://github.com/h3js/h3/commit/5bb05ce584229916881da8a5bbe8012dd003b665))

### [0.3.8](https://github.com/h3js/h3/compare/v0.3.7...v0.3.8) (2021-12-04)

### Bug Fixes

- **useBody:** allow body with `DELETE` method (resolves [#50](https://github.com/h3js/h3/issues/50)) ([bd90f66](https://github.com/h3js/h3/commit/bd90f662d5e73e2c410e1cf432f17cccfef29e57))

### [0.3.7](https://github.com/h3js/h3/compare/v0.3.6...v0.3.7) (2021-12-01)

### Bug Fixes

- unenv uses `req.body` prop ([a31d12f](https://github.com/h3js/h3/commit/a31d12f338184b0ca0351dd96422ccc7044524f0))

### [0.3.6](https://github.com/h3js/h3/compare/v0.3.5...v0.3.6) (2021-12-01)

### Features

- assert method is valid before attempting to read body ([92f67f0](https://github.com/h3js/h3/commit/92f67f076aae2f69d8c9ed05fa94c0dfe38badf2))

### Bug Fixes

- avoid race-condition for calling useBody on same rew ([0633804](https://github.com/h3js/h3/commit/0633804a722bd1d16228fc0187d0e6dea2b15da1))
- handle body with falsy values ([6236fc2](https://github.com/h3js/h3/commit/6236fc24f77c56be7efc5c41573b65a7fca0ad75))

### [0.3.5](https://github.com/h3js/h3/compare/v0.3.4...v0.3.5) (2021-11-24)

### Bug Fixes

- **useBody:** support `req._body` ([0d0cd61](https://github.com/h3js/h3/commit/0d0cd614f78038df3bfe3006be3281b8854bc445))

### [0.3.4](https://github.com/h3js/h3/compare/v0.3.3...v0.3.4) (2021-11-24)

### Features

- `useMethod`/`isMethod`/`assertMethod` ([c45278d](https://github.com/h3js/h3/commit/c45278da64dca61147b54ee05cdbff87dbb14345))
- add `defineHandle` and `defineMiddleware` type helpers ([#47](https://github.com/h3js/h3/issues/47)) ([8260887](https://github.com/h3js/h3/commit/8260887f9efee5521de5c3653df82b24cb692377))

### [0.3.3](https://github.com/h3js/h3/compare/v0.3.2...v0.3.3) (2021-10-14)

### [0.3.2](https://github.com/h3js/h3/compare/v0.3.1...v0.3.2) (2021-10-14)

### [0.3.1](https://github.com/h3js/h3/compare/v0.3.0...v0.3.1) (2021-09-09)

### Bug Fixes

- return 'false' and 'null' values as JSON strings ([#33](https://github.com/h3js/h3/issues/33)) ([5613c54](https://github.com/h3js/h3/commit/5613c54e8a5d6681c29fa172f533381cf11a8fd3))

## [0.3.0](https://github.com/h3js/h3/compare/v0.2.12...v0.3.0) (2021-07-27)

### ⚠ BREAKING CHANGES

- `useAsync` is removed. use `use` instead

### Features

- automatically promisify legacyMiddleware with `use` ([2805d4c](https://github.com/h3js/h3/commit/2805d4cc42d22c22c7798a41514aca5cceeb8e19)), closes [#27](https://github.com/h3js/h3/issues/27)
- handle returned errors (closes [#28](https://github.com/h3js/h3/issues/28)) ([991fcff](https://github.com/h3js/h3/commit/991fcff606b659035d5a23bd4ae97d3750e730cd))

### [0.2.12](https://github.com/h3js/h3/compare/v0.2.11...v0.2.12) (2021-07-02)

### Features

- **pkg:** add exports field ([998d872](https://github.com/h3js/h3/commit/998d8723870650a742bdeefb57c1d9acfc407692))

### [0.2.11](https://github.com/h3js/h3/compare/v0.2.10...v0.2.11) (2021-06-23)

### Bug Fixes

- createError fallback to statusMessage ([#25](https://github.com/h3js/h3/issues/25)) ([2f792f5](https://github.com/h3js/h3/commit/2f792f5cf64d87aeb41e387bae6cfad1112b3d05))

### [0.2.10](https://github.com/h3js/h3/compare/v0.2.9...v0.2.10) (2021-04-21)

### Bug Fixes

- fallback for setImmediate ([6cf61f6](https://github.com/h3js/h3/commit/6cf61f601d206a9d3cdcf368cb700ebd5c2e22de))

### [0.2.9](https://github.com/h3js/h3/compare/v0.2.8...v0.2.9) (2021-04-06)

### Bug Fixes

- resolve handle when send was called ([fb58e5b](https://github.com/h3js/h3/commit/fb58e5b274272ba55df4bb38b874a688b617d541))

### [0.2.8](https://github.com/h3js/h3/compare/v0.2.7...v0.2.8) (2021-03-27)

### Bug Fixes

- **app:** custom options passed to useAsync ([3c328a4](https://github.com/h3js/h3/commit/3c328a4dc0dbc215d2da82cd0abc1e8ede006665))

### [0.2.7](https://github.com/h3js/h3/compare/v0.2.6...v0.2.7) (2021-03-27)

### [0.2.6](https://github.com/h3js/h3/compare/v0.2.5...v0.2.6) (2021-03-27)

### [0.2.5](https://github.com/h3js/h3/compare/v0.2.4...v0.2.5) (2021-02-19)

### [0.2.4](https://github.com/h3js/h3/compare/v0.2.3...v0.2.4) (2021-01-22)

### Bug Fixes

- always restore req.url for each layer to avoid mutation ([aae5787](https://github.com/h3js/h3/commit/aae57876a1bad3972bec86cee385db308ac69764))

### [0.2.3](https://github.com/h3js/h3/compare/v0.2.2...v0.2.3) (2021-01-20)

### Bug Fixes

- improve internal error handling ([b38d450](https://github.com/h3js/h3/commit/b38d450e39101104333f33516d75869cd2427f9d))

### [0.2.2](https://github.com/h3js/h3/compare/v0.2.1...v0.2.2) (2021-01-20)

### Bug Fixes

- capture stacktrace from createError ([1441784](https://github.com/h3js/h3/commit/14417846554f81f44ae677bfd609517dcfd3c291))
- handle thrown errors by each layer ([62fd25a](https://github.com/h3js/h3/commit/62fd25a572de72a1f555b8f43e5e4798c392b74b))

### [0.2.1](https://github.com/h3js/h3/compare/v0.2.0...v0.2.1) (2021-01-12)

## [0.2.0](https://github.com/h3js/h3/compare/v0.0.15...v0.2.0) (2020-12-15)

### ⚠ BREAKING CHANGES

- rename useBodyJSON to useBody and unexposed cached value

### Features

- `useCookie`, `useCookies` and `setCookie` utilities ([088f413](https://github.com/h3js/h3/commit/088f413434a619a9888bfd9d1b189e56a7d00124)), closes [#17](https://github.com/h3js/h3/issues/17)
- appendHeader utility ([84be904](https://github.com/h3js/h3/commit/84be9040e2c52b625a47591e8f5107793da29f72))
- rename useBodyJSON to useBody and unexposed cached value ([d8d39a0](https://github.com/h3js/h3/commit/d8d39a0eefbc22c8d3af8e7dcee5ee8964da07e3))

### [0.0.15](https://github.com/h3js/h3/compare/v0.0.14...v0.0.15) (2020-12-12)

### Features

- add request and response utils ([#15](https://github.com/h3js/h3/issues/15)) ([648e9b9](https://github.com/h3js/h3/commit/648e9b9ceff3a8658a7e3705164d5139e6f95c99))
- custom error handler ([ad3515f](https://github.com/h3js/h3/commit/ad3515f0da8bb37d3f82a6527c459aa86a63e338))

### Bug Fixes

- don't override internal flag ([a5ee318](https://github.com/h3js/h3/commit/a5ee31888101cbe7458d7a63527d0cf07845d2a6))
- hide 404 error ([38fb027](https://github.com/h3js/h3/commit/38fb027bb5a2d3d369f7d3e333edc1342cf32914))
- preserve error message in console ([3002b27](https://github.com/h3js/h3/commit/3002b27aace50cf6d39c289b8500bb92a065fe7a))

### [0.0.14](https://github.com/h3js/h3/compare/v0.0.13...v0.0.14) (2020-12-05)

### Bug Fixes

- **app:** handle buffer ([09c9c6d](https://github.com/h3js/h3/commit/09c9c6da5bcd00ff49e815cae3c74893d4b4806d))
- **utils:** avoid setting falsy type ([df5e92b](https://github.com/h3js/h3/commit/df5e92b07ca2c096fb078c0deff50b613245c0db))

### [0.0.13](https://github.com/h3js/h3/compare/v0.0.12...v0.0.13) (2020-12-05)

### Bug Fixes

- enable debug by default ([010cdfe](https://github.com/h3js/h3/commit/010cdfe32ce80b2453489f8839c5f3d946d027a1))

### [0.0.12](https://github.com/h3js/h3/compare/v0.0.11...v0.0.12) (2020-11-23)

### Features

- allow chaining use statements ([#9](https://github.com/h3js/h3/issues/9)) ([e30ea79](https://github.com/h3js/h3/commit/e30ea7911ed378866f2c61b0ece3f332e113e821)), closes [#5](https://github.com/h3js/h3/issues/5)

### Bug Fixes

- correctly expose route and middleware types ([#10](https://github.com/h3js/h3/issues/10)) ([bb6cd4c](https://github.com/h3js/h3/commit/bb6cd4c6971fc269d6a313ebc07910898b32f178)), closes [#11](https://github.com/h3js/h3/issues/11) [#11](https://github.com/h3js/h3/issues/11)
- ensure correct url is used when used as a sub-app ([0e4770a](https://github.com/h3js/h3/commit/0e4770af89757c274b1d3e6d7c54b973a7bf9bef))
- mark app.\_handle as private to avoid sub-app detection ([1439f35](https://github.com/h3js/h3/commit/1439f354a7e9238113f6d8bc7687df8a5fe7bd10))

### [0.0.11](https://github.com/h3js/h3/compare/v0.0.10...v0.0.11) (2020-11-21)

### Features

- `useAsync` ([236e979](https://github.com/h3js/h3/commit/236e97953ac014dffa8977c4bf8cd6f2fa369eb7))
- custom matcher and improved docs ([1c4f9d1](https://github.com/h3js/h3/commit/1c4f9d138dde212486d1aa7acb0e2df9a8cb8aca))

### [0.0.10](https://github.com/h3js/h3/compare/v0.0.9...v0.0.10) (2020-11-20)

### Features

- rewrite with much sexier API ([0d3680e](https://github.com/h3js/h3/commit/0d3680eacab44d6a40c10b94cfba2036afc571d9))

### [0.0.9](https://github.com/h3js/h3/compare/v0.0.8...v0.0.9) (2020-11-20)

### Features

- createError ([1a80bd9](https://github.com/h3js/h3/commit/1a80bd9432b0585a474d6888e7035636307eead8))

### Bug Fixes

- throw 404 only when writableEnded is not set ([1c42a07](https://github.com/h3js/h3/commit/1c42a07e3ecc175c96dff026967298a107314f5e))

### [0.0.8](https://github.com/h3js/h3/compare/v0.0.7...v0.0.8) (2020-11-19)

### Bug Fixes

- don't log 404 ([541edge0](https://github.com/h3js/h3/commit/541ede03edc6526b953c8a0bb7f31f0dc5fc21d3))

### [0.0.7](https://github.com/h3js/h3/compare/v0.0.6...v0.0.7) (2020-11-19)

### [0.0.6](https://github.com/h3js/h3/compare/v0.0.5...v0.0.6) (2020-11-19)

### Features

- add debug option to app ([b0891cd](https://github.com/h3js/h3/commit/b0891cd13d4a7b8ed0fb981ae878185c6728b618))

### [0.0.5](https://github.com/h3js/h3/compare/v0.0.4...v0.0.5) (2020-11-19)

### Features

- expose unsafeHandle ([f1245f1](https://github.com/h3js/h3/commit/f1245f13c1a4ec1f9e1ecb4b0b73c50047ee4d3a))

### [0.0.4](https://github.com/h3js/h3/compare/v0.0.3...v0.0.4) (2020-11-19)

### Features

- rewrite promisify logic ([a40aa81](https://github.com/h3js/h3/commit/a40aa81aa80da3ba418061338bcaa6286357ab67))

### Bug Fixes

- keep top level trailing slash ([2fb92ef](https://github.com/h3js/h3/commit/2fb92efdf462f3c4098af3cac6594599839f7cde))
- stop middleware when writableEnded flag is set ([d87d8e5](https://github.com/h3js/h3/commit/d87d8e5f7a426409565d1a008b8231c793ec61ef))

### [0.0.3](https://github.com/h3js/h3/compare/v0.0.2...v0.0.3) (2020-11-19)

### Features

- improve error util ([5504f4e](https://github.com/h3js/h3/commit/5504f4e53dfb19cceb6580b00077f8c80d0b5dc5))

### [0.0.2](https://github.com/h3js/h3/compare/v0.0.1...v0.0.2) (2020-11-19)

### Bug Fixes

- remove dependency on process.env ([eb018f5](https://github.com/h3js/h3/commit/eb018f5e23a5f797a4b5d24fdbfe591994c39aef))

### 0.0.1 (2020-11-18)

### Features

- de-default loazy handles ([0cb8c0c](https://github.com/h3js/h3/commit/0cb8c0c74647278806a53f7920f8678bb47749e5))
- update docs and caller utility ([0ef0020](https://github.com/h3js/h3/commit/0ef0020da1931b8c08344008253703b91b318559))

### Bug Fixes

- **app:** handle returning promise ([2169f92](https://github.com/h3js/h3/commit/2169f92142d2e92e143913fff945628f17203779))
- **writable:** set writableEnded and writableFinished ([7058fdc](https://github.com/h3js/h3/commit/7058fdcf38a31edd1ce2afe4b05eb0b050adea78))
