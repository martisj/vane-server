import groq from 'groq'
import { nanoid } from 'nanoid'
import dayjs from 'dayjs'
import { parse } from '@fast-csv/parse'
import { pipeline } from 'stream'
import { promisify } from 'util'
import got from 'got'
import { User } from '../services/User.js'

const pump = promisify(pipeline)

const vanesQuery = groq`*[_type == 'vane' && !(_id in path('drafts.**'))] | order(_createdAt desc)`
const userQuery = groq`*[_type == 'user' && !(_id in path('drafts.**')) && github_id == $githubId][0]`

export default async function routes (fastify, options, done) {
  fastify.get('/login/github/callback', async function loginGithubCb (request) {
    const token = await this.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
    const { id } = await got.get('https://api.github.com/user', {
      headers: { Authorization: `token ${token.access_token}` }
    }).json()

    if (!id) throw new Error('User id not found from Github')
    console.log('find user id in sanity', id)
    let user = await fastify.sanity.fetch(userQuery, { githubId: id })

    console.log('user in sanity', user)
    if (!user) {
      const UserService = new User(fastify)
      user = await UserService.createUserFromGithub(id, token.access_token)
    }

    return (user)
  })

  fastify.get('/vanes', async function getVanes () {
    const vanes = await fastify.sanity.fetch(vanesQuery)
    return { vanes }
  })

  fastify.post('/vane', {
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

    const doc = await fastify.sanity.create({ _type: 'vane', title })
    return doc
  })

  fastify.delete('/vane/:id', {
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
      await fastify.sanity.delete(id)
      reply.status(204)
      return {}
    } catch (e) {
      reply.status(404)
      return { error: 'not found' }
    }
  })

  fastify.post('/vane/log', {
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
      const doc = await fastify.sanity.patch(vaneId).setIfMissing({ log: [] }).append(
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

  fastify.post('/vane/unlog', {
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
      const update = await fastify.sanity.patch(vaneId).unset([`log[day == "${date.format('YYYY-MM-DD')}"]`]).commit()
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

  fastify.post('/data/import', async function postDataImport (req, res) {
    try {
      const data = await req.file()
      const transaction = fastify.sanity.transaction()
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

  done()
}
