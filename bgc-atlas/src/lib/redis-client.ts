import Redis from 'ioredis'

const client = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10),
})

client.on('error', (err) => {
  console.error('Redis client error:', err)
})

export default client

