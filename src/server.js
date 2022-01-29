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
import oauthPlugin from 'fastify-oauth2'
import got from 'got'

const pump = promisify(pipeline)
let sanityClient
const server = Fastify({
  logger: {
    prettyPrint: {
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname'
    }
  }
})

server
  .register(fastifyEnv, {
    dotenv: true,
    schema: {
      type: 'object',
      required: ['SANITY_TOKEN', 'ENVIRONMENT', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'BASE_URL'],
      properties: {
        SANITY_TOKEN: { type: 'string' },
        ENVIRONMENT: { type: 'string', default: 'development' },
        GITHUB_OAUTH_CLIENT_ID: { type: 'string' },
        GITHUB_OAUTH_CLIENT_SECRET: { type: 'string' },
        PORT: { type: 'string', default: '3012' },
        BASE_URL: { type: 'string' }
      }
    }
  })
server.register(cors, function () {
  return { origin: ['http://localhost:3011', server.config.BASE_URL], credentials: true, optionsSuccessStatus: 200 }
})
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
  .register(oauthPlugin, function () {
    return {
      name: 'githubOAuth2',
      credentials: {
        client: {
          id: server.config.GITHUB_OAUTH_CLIENT_ID,
          secret: server.config.GITHUB_OAUTH_CLIENT_SECRET
        },
        auth: oauthPlugin.GITHUB_CONFIGURATION
      },
      startRedirectPath: '/login/github',
      callbackUri: `${server.config.BASE_URL}/login/github/callback`
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
const userQuery = groq`*[_type == 'user' && !(_id in path('drafts.**')) && github_id == $githubId]`

server.get('/login/github/callback', async function loginGithubCb (request) {
  const token = await this.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
  const { id } = await got.get('https://api.github.com/user', {
    headers: { Authorization: `token ${token.access_token}` }
  }).json()

  if (!id) throw new Error('User id not found from Github')
  console.log('find user id in sanity', id)
  let user = await sanityClient.fetch(userQuery, { githubId: id })

  if (!user) {
    user = await User.createUserFromGithub(id, token.access_token)
  }

  return (user)
})

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
    200: {
      type: 'object',
      properties: {
        vaneId: {
          type: 'string'
        }
      }
    }
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
    const doc = await sanityClient.patch(vaneId).setIfMissing({ log: [] }).append(
      'log', [{ _key: nanoid(), timestamp: timestamp.toISOString(), day: date.format('YYYY-MM-DD') }]
    ).commit()
    console.log(doc)
    return { vaneId, log: doc.log, message: 'logged' }
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
      error: "Can't untrack vane"
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
        transaction.create({ _type: 'vane', title: row.HABIT, log: row.log })
      })
      .on('end', (rowCount) => {
        transaction.commit().then((transactionRes) => {
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
    await server.ready()
    await server.listen(server.config.PORT)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()
