import { nanoid } from 'nanoid'

export class User {
  constructor (fastify) {
    this.f = fastify
  }

  static _userDoc (githubId, token) {
    return {
      _type: 'user',
      uid: nanoid(),
      github_id: githubId.toString(),
      auth_token: token
    }
  }

  async createUserFromGithub (id, token) {
    const user = await this.f.sanity.create(User._userDoc(id, token))
    return user
  }
}
