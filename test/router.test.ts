import supertest, { SuperTest, Test } from 'supertest'
import { describe, it, expect, beforeEach } from 'vitest'
import { createApp, createRouter, App, Router, getRouterParams, getRouterParam } from '../src'

describe('router', () => {
  let app: App
  let router: Router
  let request: SuperTest<Test>

  beforeEach(() => {
    app = createApp({ debug: false })
    router = createRouter()
      .add('/', () => 'Hello')
      .add('/test/?/a', () => '/test/?/a')
      .add('/many/routes', () => 'many routes', ['get', 'post'])
      .get('/test', () => 'Test (GET)')
      .post('/test', () => 'Test (POST)')

    app.use(router)
    request = supertest(app)
  })

  it('Handle route', async () => {
    const res = await request.get('/')
    expect(res.text).toEqual('Hello')
  })

  it('Handle different methods', async () => {
    const res1 = await request.get('/test')
    expect(res1.text).toEqual('Test (GET)')
    const res2 = await request.post('/test')
    expect(res2.text).toEqual('Test (POST)')
  })
  it('Handle url with query parameters', async () => {
    const res = await request.get('/test?title=test')
    expect(res.status).toEqual(200)
  })

  it('Handle url with query parameters, include "?" in url path', async () => {
    const res = await request.get('/test/?/a?title=test')
    expect(res.status).toEqual(200)
  })

  it('Handle many methods (get)', async () => {
    const res = await request.get('/many/routes')
    expect(res.status).toEqual(200)
  })

  it('Handle many methods (post)', async () => {
    const res = await request.post('/many/routes')
    expect(res.status).toEqual(200)
  })

  it('Not matching route', async () => {
    const res = await request.get('/404')
    expect(res.status).toEqual(404)
  })

  it('Not matching route method', async () => {
    const res = await request.head('/test')
    expect(res.status).toEqual(405)
  })
})

describe('getRouterParams', () => {
  let app: App
  let request: SuperTest<Test>

  beforeEach(() => {
    app = createApp({ debug: false })
    request = supertest(app)
  })

  describe('with router', () => {
    it('can return router params', async () => {
      const router = createRouter().get('/test/params/:name', (request) => {
        expect(getRouterParams(request)).toMatchObject({ name: 'string' })
        return '200'
      })
      app.use(router)
      const result = await request.get('/test/params/string')

      expect(result.text).toBe('200')
    })
  })

  describe('without router', () => {
    it('can return an empty object if router is not used', async () => {
      app.use('/', (request) => {
        expect(getRouterParams(request)).toMatchObject({})
        return '200'
      })
      const result = await request.get('/test/empty/params')

      expect(result.text).toBe('200')
    })
  })
})

describe('getRouterParam', () => {
  let app: App
  let request: SuperTest<Test>

  beforeEach(() => {
    app = createApp({ debug: false })
    request = supertest(app)
  })

  describe('with router', () => {
    it('can return a value of router params corresponding to the given name', async () => {
      const router = createRouter().get('/test/params/:name', (request) => {
        expect(getRouterParam(request, 'name')).toEqual('string')
        return '200'
      })
      app.use(router)
      const result = await request.get('/test/params/string')

      expect(result.text).toBe('200')
    })
  })

  describe('without router', () => {
    it('can return `undefined` for any keys', async () => {
      app.use('/', (request) => {
        expect(getRouterParam(request, 'name')).toEqual(undefined)
        return '200'
      })
      const result = await request.get('/test/empty/params')

      expect(result.text).toBe('200')
    })
  })
})
