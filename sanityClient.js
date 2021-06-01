
import sanity from '@sanity/client'

export const client = sanity({
  apiVersion: 'v2021-03-25',
  projectId: 'k4ho43fa',
  dataset: 'production',
  token:
      'skrCjwqOk1vmzzjVhdHkaEjdr9IoBLlkOf1qY0BICw0MtIEFHBLpfq4FVJR1JnCwD4JuCJgA2sziVqCJe0vAYgk2SgkVqUAQFvWOhoKr0XFhbh9nikijXfoxskhHzth5LwbFSM2mC2YhW6uqJz90gHfx0BWyI84lk8yx5cuS82UUh5goMXPQ',
  useCdn: false
})
