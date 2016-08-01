/* eslint-disable no-undef */

import { expect } from 'chai'
import { PassThrough } from 'stream'
import Docker from 'dockerode-promise'
import GDB from '../lib'

let container

/**
 * Create a GDB wrapper instance for the specified example.
 *
 * @param {string} example Name of the folder with example in the Docker container.
 *
 * @returns {GDB} GDB wrapper instance.
 */
async function createGDB (example) {
  let exec = await container.exec({
    Cmd: ['gdb', '--interpreter=mi', `./${example}/main`],
    AttachStdout: true,
    AttachSterr: true,
    AttachStdin: true,
    Tty: false
  })

  let stream = await exec.start({
    stream: true,
    stdin: true,
    stdout: true,
    stderr: true
  })

  let stdout = new PassThrough()
  let stderr = new PassThrough()
  container.modem.demuxStream(stream, stdout, stderr)

  return new GDB({ stdin: stream, stdout, stderr })
}

describe('gdb-js', () => {
  before(async () => {
    let docker = new Docker({ socketPath: '/var/run/docker.sock' })

    container = await docker.createContainer({
      Image: 'baygeldin/gdb-examples',
      OpenStdin: true
    })

    // When we attach to the container it lives forever
    // until we kill it manually. There's no need for a `sleep` hack.
    await container.attach()
    await container.start()
  })

  after(async () => {
    await container.remove({ force: true })
  })

  it('executes mi commands and return results', async () => {
    let gdb = await createGDB('hello-world')
    let { features } = await gdb.execMI('-list-features')
    expect(features).to.include('python')
  })

  it('executes cli commands and returns results', async () => {
    let gdb = await createGDB('hello-world')
    await gdb.init()
    let res = await gdb.execCLI('echo Hello World!')
    expect(res).to.equal('Hello World!')
  })

  it('executes custom python code and returns results', async () => {
    let gdb = await createGDB('hello-world')
    await gdb.init()
    let res = await gdb.execPy('print("Hello\\nWorld!")')
    expect(res).to.equal('Hello\nWorld!\n')
  })

  it('inserts a breakpoint', async () => {
    let gdb = await createGDB('hello-world')
    let bp = await gdb.addBreak('hello.c', 4)
    let bpHit = new Promise((resolve, reject) => {
      gdb.once('stopped', (data) => {
        let err = new Error('No breakpoint hit')
        if (data.reason !== 'breakpoint-hit') reject(err)
        resolve(data)
      })
    })
    await gdb.run()
    let hit = await bpHit
    expect(hit.breakpoint.id).to.equal(bp.id)
  })

  it('removes a breakpoint', async () => {
    let gdb = await createGDB('hello-world')
    let bp = await gdb.addBreak('hello.c', 'main')
    await gdb.removeBreak(bp)
  })

  it('returns callstack', async () => {
    let gdb = await createGDB('factorial')
    await gdb.addBreak('factorial.c', 'factorial')
    await gdb.run()
    let res = await gdb.callstack()
    expect(res).to.deep.equal([
      { level: 0, file: '/examples/factorial/factorial.c', line: 14 },
      { level: 1, file: '/examples/factorial/factorial.c', line: 8 }
    ])
  })

  it('returns list of source files', async () => {
    // TODO: the example with multiple files will make more sense
    let gdb = await createGDB('factorial')
    let res = await gdb.sourceFiles()
    expect(res).to.deep.equal(['/examples/factorial/factorial.c'])
  })

  it('evaluates the expression', async () => {
    let gdb = await createGDB('hello-world')
    let res = await gdb.evaluate('0xdeadbeef')
    expect(res).to.equal('3735928559')
  })

  it('fires stopped event', async () => {
    let gdb = await createGDB('hello-world')
    let stopped = new Promise((resolve, reject) => {
      gdb.once('stopped', resolve)
    })
    await gdb.run()
    let res = await stopped
    expect(res).to.deep.equal({ reason: 'exited-normally' })
  })

  it('returns all global variables', async () => {
    let gdb = await createGDB('factorial')
    await gdb.init()
    let globals = await gdb.globals()
    expect(globals).to.deep.equal([
      { value: '10', name: 'my_global', file: 'factorial.c', type: 'int' }
    ])
  })

  it('returns all variables in the current context', async () => {
    let gdb = await createGDB('hello-world')
    await gdb.init()
    await gdb.addBreak('hello.c', 'main')
    await gdb.run()
    let context = await gdb.context()
    expect(context).to.deep.equal([
      { value: '0', name: 'i', scope: 'local', type: 'int' }
    ])
  })

  it('has support for multithreaded targets', async () => {
    let gdb = await createGDB('tickets')
    await gdb.init()
    await gdb.enableAsync()
    await gdb.addBreak('tickets.c', 31)
    await gdb.run()
    await new Promise((resolve, reject) => {
      gdb.once('stopped', resolve)
    })
    await gdb.interrupt()
    let res = await gdb.threads()
    expect(res.length).to.equal(6)
  })

  it('can exit gdb', async () => {
    let gdb = await createGDB('hello-world')
    await gdb.exit()
  })
})
