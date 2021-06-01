module.exports = {
  env: {
    es2021: true,
    node: true
  },
  extends: [
    'plugin:@asbjorn/groq/recommended',
    'standard'
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module'
  },
  rules: {
  }
}
