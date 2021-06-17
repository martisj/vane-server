import Fastify from 'fastify'
import groq from 'groq'
import { client } from './sanityClient.js'
import cors from 'fastify-cors'

const server = Fastify({ logger: true })
server.register(cors, { origin: ['http://localhost:3000', 'http://localhost:3001'], credentials: true, optionsSuccessStatus: 200 })

const vanesQuery = groq`*[_type == 'vane'] | order(_createdAt desc)`

server.get('/vanes', async function () {
  const vanes = await client.fetch(vanesQuery)
  return { vanes }
})

server.post('/vane', {
  schema: {
    body: {
      type: 'object',
      required: ['title'],
      additionalProperties: false,
      properties: {
        title: { type: 'string' }
      }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        _id: { type: 'string' }
      }
    }
  }
}, async function (request) {
  const { title } = request.body
  console.log(title)

  const doc = await client.create({ _type: 'vane', title })
  console.log(doc)
  return doc
})

server.delete('/vane/:id', {
  response: {
    204: {}
  }
}, async function (request) {
  const { id } = request.params
  console.log(id)

  const apiResponse = await client.delete(id)
  console.log(apiResponse)
  return {}
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
