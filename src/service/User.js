import { nanoid } from 'nanoid'

export class User {
  static _userDoc (githubId, token) {
    return {
      _type: 'user',
      uid: nanoid(),
      github_id: githubId,
      auth_token: token
    }
  }

  static async createUserFromGithub (id, token) {
    const user = await sanityClient.create(User._userDoc(id, token))
    return user
  }
}
