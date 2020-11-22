import { Server } from 'http'
import supertest, { SuperTest, Test } from 'supertest'
import getPort from 'get-port'

import { createApp, App } from '../src'

describe('server', () => {
  let app: App
  let request: SuperTest<Test>
  let server: Server

  beforeEach(async () => {
    app = createApp()
    server = new Server(app)
    const port = await getPort()
    server.listen(port)
    request = supertest(`http://localhost:${port}`)
  })

  afterEach(() => {
    server.close()
  })

  it('can serve requests', async () => {
    app.use(() => 'sample')
    const result = await request.get('/')
    expect(result.text).toBe('sample')
  })

  it('can return 404s', async () => {
    const result = await request.get('/')
    expect(result.status).toBe(404)
  })

  it('can return 500s', async () => {
    app.use(() => { throw new Error('Unknown') })
    const result = await request.get('/')
    expect(result.status).toBe(500)
  })
})
