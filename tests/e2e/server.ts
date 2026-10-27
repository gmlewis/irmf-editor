import { serve } from 'bun'
import { join, normalize, sep } from 'path'
import { readFile } from 'fs/promises'

const root = join(import.meta.dir, '../..')
// Mount the canonical example corpus. The repo lives in different places on
// different machines, so require the env var rather than guessing.
const examplesDir = process.env.IRMF_EXAMPLES_DIR
  ? normalize(process.env.IRMF_EXAMPLES_DIR)
  : ''

function underExamples(path: string): string | null {
  if (!examplesDir) return null
  // Strip the /examples prefix and resolve inside the examples root.
  const rest = path.replace(/^\/examples\/?/, '')
  const filePath = normalize(join(examplesDir, 'examples', rest))
  if (filePath !== examplesDir && !filePath.startsWith(examplesDir + sep)) {
    return null
  }
  if (!filePath.startsWith(normalize(join(examplesDir, 'examples')))) return null
  return filePath
}

serve({
  port: 1234,
  async fetch(req) {
    let path = new URL(req.url).pathname
    if (path.startsWith('/examples/')) {
      const filePath = underExamples(path)
      if (!filePath) {
        return new Response(
          examplesDir
            ? 'Forbidden'
            : 'IRMF_EXAMPLES_DIR is not set; /examples is not mounted',
          { status: examplesDir ? 403 : 404 }
        )
      }
      try {
        return new Response(await readFile(filePath))
      } catch (e) {
        return new Response('Not Found', { status: 404 })
      }
    }
    if (path === '/') path = '/index.html'

    // Prevent path traversal outside the editor root.
    const filePath = normalize(join(root, path))
    if (!filePath.startsWith(normalize(root))) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const file = Bun.file(filePath)
      return new Response(file)
    } catch (e) {
      return new Response('Not Found', { status: 404 })
    }
  },
})

console.log('Server running on http://localhost:1234')
if (!examplesDir) {
  console.log('IRMF_EXAMPLES_DIR is not set; example-mount tests will be skipped.')
}
