import Fastify from 'fastify'
import fastifyMultipart from 'fastify-multipart'
import fastifyEnv from 'fastify-env'
import groq from 'groq'
import cors from 'fastify-cors'
import { nanoid } from 'nanoid'
import dayjs from 'dayjs'
import { parse } from '@fast-csv/parse'
import { pipeline } from 'stream'
import { promisify } from 'util'
import sanity from '@sanity/client'

const pump = promisify(pipeline)
let sanityClient
const server = Fastify({ logger: true })
server
  .register(fastifyEnv, {
    dotenv: true,
    schema: {
      type: 'object',
      required: ['SANITY_TOKEN', 'ENVIRONMENT'],
      properties: {
        SANITY_TOKEN: { type: 'string' },
        ENVIRONMENT: { type: 'string', default: 'development' }
      }
    }
  })
  .register(cors, { origin: ['http://localhost:3000', 'http://localhost:3001'], credentials: true, optionsSuccessStatus: 200 })
  .register(fastifyMultipart, {
    limits: {
      fieldNameSize: 100, // Max field name size in bytes
      fieldSize: 100, // Max field value size in bytes
      fields: 10, // Max number of non-file fields
      fileSize: 10000000, // For multipart forms, the max file size in bytes
      files: 1, // Max number of file fields
      headerPairs: 2000 // Max number of header key=>value pairs
    }
  })
  .ready((err) => {
    if (err) console.error(err)

    sanityClient = sanity({
      apiVersion: 'v2021-03-25',
      projectId: 'k4ho43fa',
      dataset: server.config.ENVIRONMENT,
      token: server.config.SANITY_TOKEN,
      useCdn: false
    })
  })

const vanesQuery = groq`*[_type == 'vane' && !(_id in path('drafts.**'))] | order(_createdAt desc)`

server.get('/vanes', async function getVanes () {
  const vanes = await sanityClient.fetch(vanesQuery)
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
}, async function postVane (request) {
  const { title } = request.body

  const doc = await sanityClient.create({ _type: 'vane', title })
  return doc
})

server.delete('/vane/:id', {
  response: {
    204: {}
  }
}, async function deleteVaneById (request, reply) {
  const { id } = request.params

  try {
    await sanityClient.delete(id)
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
async function postVaneLog (request, reply) {
  const timestamp = dayjs()
  const { vaneId, day } = request.body
  const date = dayjs(day)
  try {
    const update = await sanityClient.patch(vaneId).setIfMissing({ log: [] }).append(
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

server.post('/vane/unlog', {
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
async function postVaneUnlog (request, reply) {
  const { vaneId, day } = request.body
  const date = dayjs(day)
  try {
    const update = await sanityClient.patch(vaneId).unset([`log[day == "${date.format('YYYY-MM-DD')}"]`]).commit()
    console.log(update)
    return { vaneId, message: 'unlogged' }
  } catch (e) {
    console.error(e)
    reply.status(400)
    return {
      error: "Can't track vane"
    }
  }
})

server.post('/data/import', async function postDataImport (req, res) {
  try {
    const data = await req.file()
    const transaction = sanityClient.transaction()
    const csvStream = parse({ headers: true })
      .transform((data) => {
        return Object.keys(data).reduce((acc, curr) => {
          if (curr === '' || data[curr] === '') return acc
          const d = dayjs(curr, 'DD MMM YYYY')
          if (d.isValid()) {
            acc.log = acc.log || []
            if (data[curr] === 'TRUE') {
              acc.log.push({ _key: nanoid(), timestamp: dayjs().toISOString(), day: d.format('YYYY-MM-DD') })
            }
          } else {
            acc[curr] = data[curr]
          }
          return acc
        }, {})
      })
      .on('error', error => console.error(error))
      .on('data', row => {
        console.log(row)
        transaction.create({ _type: 'vane', title: row.HABIT, log: row.log })
      })
      .on('end', (rowCount) => {
        transaction.commit().then((transactionRes) => {
          console.log('parsed and created all habits')
          res.send(`Parsed ${rowCount} rows`)
        })
          .catch((err) => {
            console.error('Transaction failed: ', err.message)
          })
      })
    await pump(data.file, csvStream)
  } catch (e) {
    res.send('CSV is not valid')
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
