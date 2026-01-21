import { serve } from 'bun'
import { join } from 'path'
import { readFile } from 'fs/promises'

const root = join(import.meta.dir, '../..')

serve({
  port: 1234,
  async fetch(req) {
    let path = new URL(req.url).pathname
    if (path === '/') path = '/index.html'
    
    const filePath = join(root, path)
    try {
      const file = Bun.file(filePath)
      return new Response(file)
    } catch (e) {
      return new Response('Not Found', { status: 404 })
    }
  }
})

console.log('Server running on http://localhost:1234')
