import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createReadStream, promises as fs } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.DIRECTOR_EXPORT_PORT || 8787)
const ffmpeg = process.env.DIRECTOR_FFMPEG || 'ffmpeg'
const root = resolve(process.env.DIRECTOR_EXPORT_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '.data'))
const jobs = new Map()
const MAX_BODY = 64 * 1024 * 1024
const MAX_LOG = 12_000

await fs.mkdir(root, { recursive: true })

function json(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-job-id, x-artifact-path',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS'
  })
  res.end(JSON.stringify(value))
}

function fail(res, status, message) {
  json(res, status, { ok: false, error: message })
}

function safePart(value, fallback = 'item') {
  const clean = String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, '_')
  return clean || fallback
}

function virtualPath(value) {
  const raw = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '')
  const withoutScheme = raw.startsWith('director://') ? raw.slice('director://'.length) : raw
  const parts = withoutScheme.split('/').filter(Boolean)
  if (!parts.length || parts.some((part) => part === '..' || part === '.')) throw new Error('Invalid export path.')
  const projectId = safePart(parts.shift(), 'web-project')
  const pathParts = parts.map((part) => safePart(part))
  const key = [projectId, ...pathParts].join('/')
  const absolute = resolve(root, 'projects', ...key.split('/'))
  const projectsRoot = resolve(root, 'projects') + sep
  if (!absolute.startsWith(projectsRoot)) throw new Error('Export path escapes the artifact root.')
  return { key, absolute, projectId, relative: pathParts.join('/') }
}

function jobPath(jobId) {
  return safePart(jobId, 'job')
}

function mimeType(path) {
  const extension = extname(path).toLowerCase()
  return ({
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.zip': 'application/zip'
  })[extension] || 'application/octet-stream'
}

async function requestBody(req, limit = MAX_BODY) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('Request body is too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function requestJson(req) {
  const body = await requestBody(req, 2 * 1024 * 1024)
  return body.length ? JSON.parse(body.toString('utf8')) : {}
}

function appendLog(job, value) {
  if (!value) return
  job.log = `${job.log}${String(value)}`.slice(-MAX_LOG)
}

async function collectFiles(directory) {
  const result = []
  async function walk(current) {
    let entries = []
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) {
        const stat = await fs.stat(absolute)
        result.push({ absolute, name: relative(directory, absolute).split(sep).join('/'), size: stat.size, mimeType: mimeType(absolute) })
      }
    }
  }
  await walk(directory)
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

function artifactPayload(job, file) {
  return {
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
    url: `/exports/${encodeURIComponent(job.id)}/files/${file.name.split('/').map(encodeURIComponent).join('/')}`
  }
}

async function jobArtifacts(job) {
  const files = await collectFiles(job.packageDirectory)
  return files.map((file) => artifactPayload(job, file))
}

function startFfmpeg(job) {
  const { fps, width, height } = job.options
  const output = job.output.absolute
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
    '-vf', 'vflip', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output
  ]
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] })
  job.child = child
  child.stderr.on('data', (chunk) => appendLog(job, chunk.toString()))
  job.exitPromise = once(child, 'close').then(([code, signal]) => ({ code: typeof code === 'number' ? code : -1, signal }))
  child.on('error', (error) => appendLog(job, `${error.message}\n`))
}

async function waitForJob(job) {
  if (job.finished) return job.result
  const exit = await job.exitPromise
  job.finished = true
  const artifacts = await jobArtifacts(job)
  job.result = { ok: exit.code === 0, code: exit.code, log: job.log, artifacts }
  return job.result
}

async function writeArtifact(jobId, pathValue, body, contentType) {
  const path = virtualPath(pathValue)
  await fs.mkdir(dirname(path.absolute), { recursive: true })
  await fs.writeFile(path.absolute, body)
  const job = jobs.get(jobId)
  if (job && path.key.startsWith(`${job.projectId}/`) && path.key.startsWith(`${job.packageKey}/`)) {
    job.result = null
  }
  return { ok: true, name: path.relative, size: body.byteLength, mimeType: contentType || mimeType(path.absolute) }
}

async function concatFiles(job, outPath, inputPaths) {
  const output = virtualPath(outPath)
  const inputs = inputPaths.map((item) => virtualPath(item))
  await fs.mkdir(dirname(output.absolute), { recursive: true })
  const listPath = join(root, `concat-${safePart(job?.id || crypto.randomUUID())}.txt`)
  await fs.writeFile(listPath, inputs.map((item) => `file '${item.absolute.replaceAll("'", "'\\''")}'`).join('\n') + '\n')
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', output.absolute], { stdio: ['ignore', 'ignore', 'pipe'] })
  let log = ''
  child.stderr.on('data', (chunk) => { log = `${log}${chunk}`.slice(-MAX_LOG) })
  const [code] = await once(child, 'close')
  await fs.rm(listPath, { force: true })
  if (code !== 0) return { ok: false, error: `ffmpeg exited ${code}: ${log.slice(-500)}` }
  if (job) job.result = null
  return { ok: true, name: output.relative, log }
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zipStore(files) {
  const local = []
  const central = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const data = file.data
    const crc = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(0, 10)
    header.writeUInt16LE(0, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    header.writeUInt16LE(0, 28)
    local.push(header, name, data)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(0, 8)
    directory.writeUInt16LE(0, 10)
    directory.writeUInt16LE(0, 12)
    directory.writeUInt16LE(0, 14)
    directory.writeUInt32LE(crc, 16)
    directory.writeUInt32LE(data.length, 20)
    directory.writeUInt32LE(data.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt16LE(0, 30)
    directory.writeUInt16LE(0, 32)
    directory.writeUInt16LE(0, 34)
    directory.writeUInt16LE(0, 36)
    directory.writeUInt32LE(0, 38)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, name)
    offset += header.length + name.length + data.length
  }
  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, centralBuffer, end])
}

function matchPath(url) {
  const path = url.pathname
  const exportMatch = path.match(/^\/exports\/([^/]+)(?:\/(.*))?$/)
  if (!exportMatch) return null
  return { jobId: decodeURIComponent(exportMatch[1]), rest: exportMatch[2] ? decodeURIComponent(exportMatch[2]) : '' }
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'director-export-service', ffmpeg, root })

    if (req.method === 'POST' && url.pathname === '/exports') {
      const body = await requestJson(req)
      const id = safePart(body.jobId, `job-${Date.now()}`)
      if (jobs.has(id)) throw new Error(`Export job already exists: ${id}`)
      const output = virtualPath(body.outPath)
      const options = body.opts || {}
      const width = Number(options.width)
      const height = Number(options.height)
      const fps = Number(options.fps)
      if (![width, height, fps].every((value) => Number.isFinite(value) && value > 0)) throw new Error('fps, width and height are required.')
      await fs.mkdir(dirname(output.absolute), { recursive: true })
      const job = { id, projectId: output.projectId, packageKey: output.key.slice(0, output.key.lastIndexOf('/')) || output.projectId, packageDirectory: dirname(output.absolute), output, options: { fps, width, height, framesExpected: Number(options.framesExpected) || 0 }, log: '', finished: false, result: null }
      jobs.set(id, job)
      startFfmpeg(job)
      return json(res, 200, { ok: true, jobId: id })
    }

    const exportPath = matchPath(url)
    if (exportPath) {
      const job = jobs.get(exportPath.jobId)
      if (!job) return fail(res, 404, 'Export job not found.')
      if (req.method === 'POST' && exportPath.rest === 'frames') {
        if (job.finished || !job.child?.stdin) throw new Error('Export job is closed.')
        const frame = await requestBody(req)
        const expected = job.options.width * job.options.height * 4
        if (frame.length !== expected) throw new Error(`Frame size mismatch: expected ${expected}, got ${frame.length}.`)
        if (!job.child.stdin.write(frame)) await once(job.child.stdin, 'drain')
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && exportPath.rest === 'end') {
        if (!job.finished) job.child.stdin.end()
        const result = await waitForJob(job)
        return json(res, 200, result)
      }
      if (req.method === 'POST' && exportPath.rest === 'cancel') {
        if (!job.finished) {
          job.child.stdin.destroy()
          job.child.kill()
          job.finished = true
          job.result = { ok: false, code: -1, log: `${job.log}cancelled`, artifacts: [] }
        }
        return json(res, 200, job.result || { ok: false, code: -1, log: 'cancelled', artifacts: [] })
      }
      if (req.method === 'GET' && exportPath.rest === 'artifacts') return json(res, 200, { ok: true, jobId: job.id, artifacts: await jobArtifacts(job) })
      if (req.method === 'GET' && exportPath.rest === 'package.zip') {
        const files = await collectFiles(job.packageDirectory)
        const archive = zipStore(await Promise.all(files.map(async (file) => ({ name: file.name, data: await fs.readFile(file.absolute) }))))
        res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="director-${job.id}.zip"`, 'access-control-allow-origin': '*' })
        return res.end(archive)
      }
      if (req.method === 'GET' && exportPath.rest.startsWith('files/')) {
        const name = exportPath.rest.slice('files/'.length).replaceAll('\\', '/')
        if (!name || name.split('/').some((part) => part === '..' || part === '.')) throw new Error('Invalid artifact name.')
        const absolute = resolve(job.packageDirectory, name)
        if (!absolute.startsWith(resolve(job.packageDirectory) + sep)) throw new Error('Artifact path escapes the package.')
        const stat = await fs.stat(absolute)
        res.writeHead(200, { 'content-type': mimeType(absolute), 'content-length': stat.size, 'access-control-allow-origin': '*' })
        return createReadStream(absolute).pipe(res)
      }
    }

    if (req.method === 'PUT' && url.pathname === '/files') {
      const path = url.searchParams.get('path') || req.headers['x-artifact-path']
      if (!path) throw new Error('path is required.')
      const jobId = url.searchParams.get('jobId') || String(req.headers['x-job-id'] || '')
      const body = await requestBody(req)
      return json(res, 200, await writeArtifact(jobId, path, body, String(req.headers['content-type'] || '')))
    }

    if (req.method === 'POST' && url.pathname === '/concat') {
      const body = await requestJson(req)
      const job = jobs.get(String(body.jobId || ''))
      const result = await concatFiles(job, body.outPath, Array.isArray(body.inputPaths) ? body.inputPaths : [])
      return json(res, result.ok ? 200 : 500, result)
    }

    return fail(res, 404, 'Not found.')
  } catch (error) {
    return fail(res, 400, error instanceof Error ? error.message : String(error))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[director-export-service] listening on http://127.0.0.1:${port}`)
  console.log(`[director-export-service] ffmpeg: ${ffmpeg}`)
})
