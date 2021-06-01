import Fastify from 'fastify'
import groq from 'groq'
import { client } from './sanityClient.js'
import cors from 'fastify-cors'

const server = Fastify({ logger: true })
server.register(cors, { origin: ['http://localhost:3000', 'http://localhost:3001'], credentials: true, optionsSuccessStatus: 200 })

const vanesQuery = groq`*[_type == 'vane']`

server.get('/vanes', async function () {
  const vanes = await client.fetch(vanesQuery)
  return { vanes }
})

server.post('/vane', {
  preHandler: async function (request) {
    const { vane } = request.body
    if (!vane) {
      throw new Error('Invalid Vane')
    }
  }
}, async function (request) {
  const { vane } = request.body

  const doc = await client.create({ _type: 'vane', title: vane })
  return doc
})

async function start () {
  try {
    await server.listen(3001)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()
