import Fastify from 'fastify'
import fastifyMultipart from 'fastify-multipart'
import fastifyEnv from 'fastify-env'
import cors from 'fastify-cors'
import oauthPlugin from 'fastify-oauth2'
import routes from './routes/routes.js'
import sanity from '@sanity/client'
import fp from 'fastify-plugin'

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
  .register(cors, function () {
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
  .register(fp(function (fastify, options, done) {
    fastify.decorate('sanity',
      sanity({
        apiVersion: 'v2021-03-25',
        projectId: 'k4ho43fa',
        dataset: server.config.ENVIRONMENT,
        token: server.config.SANITY_TOKEN,
        useCdn: false
      })
    )
    done()
  }))
  .register(routes)
  .ready((err) => {
    if (err) console.error(err)
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
