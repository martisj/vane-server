import Fastify from 'fastify'
import groq from 'groq'
import { client } from './sanityClient.js'
import cors from 'fastify-cors'
import { nanoid } from 'nanoid'
import dayjs from 'dayjs'

const server = Fastify({ logger: true })
server.register(cors, { origin: ['http://localhost:3000', 'http://localhost:3001'], credentials: true, optionsSuccessStatus: 200 })

const vanesQuery = groq`*[_type == 'vane' && !(_id in path('drafts.**'))] | order(_createdAt desc)`

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

  const doc = await client.create({ _type: 'vane', title })
  return doc
})

server.delete('/vane/:id', {
  response: {
    204: {}
  }
}, async function (request, reply) {
  const { id } = request.params

  try {
    await client.delete(id)
    reply.status(204)
    return {}
  } catch (e) {
    reply.status(404)
    return { error: 'not found' }
  }
})

server.post('/vane/log', {
  schema: {
    body: {
      type: 'object',
      required: ['vaneId', 'day'],
      additionalProperties: false,
      properties: {
        vaneId: { type: 'string' },
        day: { type: 'string' }
      }
    }
  },
  response: {
    200: {}
  }
},
async function (request, reply) {
  const timestamp = dayjs()
  const { vaneId, day } = request.body
  const date = dayjs(day)
  try {
    const update = await client.patch(vaneId).setIfMissing({ log: [] }).append(
      'log', [{ _key: nanoid(), timestamp: timestamp.toISOString(), day: date.format('YYYY-MM-DD') }]
    ).commit()
    console.log(update)
    return { vaneId, message: 'logged' }
  } catch (e) {
    console.error(e)
    reply.status(400)
    return {
      error: "Can't track vane"
    }
  }
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
