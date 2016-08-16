/* eslint-env mocha */

import { expect } from 'chai'
import { PassThrough } from 'stream'
import Docker from 'dockerode-promise'
import { GDB, Thread, ThreadGroup, Breakpoint, Frame } from '../lib'

let docker = new Docker({ socketPath: '/var/run/docker.sock' })
let container = docker.getContainer('gdb-js')

/**
 * Create a GDB wrapper instance for the specified example.
 *
 * @param {string} example Name of the folder with example in the Docker container.
 *
 * @returns {GDB} GDB wrapper instance.
 */
async function createGDB (example) {
  let exec = await container.exec({
    // Working directory is necessary for multi-process examples!
    Cmd: ['gdb', '-i=mi', '--cd=/examples/' + example, 'main'],
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

  it('can exit gdb', async () => {
    let gdb = await createGDB('hello-world')
    await gdb.exit()
  })

  it('executes mi commands and return results', async () => {
    let gdb = await createGDB('hello-world')
    let { features } = await gdb.execMI('-list-features')
    await gdb.exit()

    expect(features).to.include('python')
  })

  it('executes cli commands and returns results', async () => {
    let gdb = await createGDB('hello-world')
    await gdb.init()
    let res = await gdb.execCLI('echo Hello World!')
    await gdb.exit()

    expect(res).to.equal('Hello World!')
  })

  it('executes custom python code and returns results', async () => {
    let gdb = await createGDB('hello-world')
    await gdb.init()
    let res = await gdb.execPy('print("Hello\\nWorld!")')
    await gdb.exit()

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
    await gdb.exit()

    expect(hit.breakpoint.id).to.equal(bp.id)
  })

  it('removes a breakpoint', async () => {
    let gdb = await createGDB('hello-world')
    let bp = await gdb.addBreak('hello.c', 'main')
    await gdb.removeBreak(bp)
    await gdb.exit()
  })

  it('returns callstack', async () => {
    let gdb = await createGDB('factorial')
    await gdb.addBreak('factorial.c', 'factorial')
    await gdb.run()
    let res = await gdb.callstack()
    await gdb.exit()

    expect(res).to.deep.equal([
      { level: 0, file: '/examples/factorial/factorial.c', line: 14 },
      { level: 1, file: '/examples/factorial/factorial.c', line: 8 }
    ])
  })

  it('returns list of source files', async () => {
    let gdb = await createGDB('factorial')
    let res = await gdb.sourceFiles()
    await gdb.exit()

    expect(res).to.deep.equal(['/examples/factorial/factorial.c'])
  })

  it('searches for source files using regex', async () => {
    let gdb = await createGDB('hello-world')
    await gdb.init()
    let res = await gdb.sourceFiles('hello.c$')
    await gdb.exit()

    expect(res).to.deep.equal(['/examples/hello-world/hello.c'])
  })

  it('evaluates the expression', async () => {
    let gdb = await createGDB('hello-world')
    let res = await gdb.evaluate('0xdeadbeef')
    await gdb.exit()

    expect(res).to.equal('3735928559')
  })

  it('has support for multithreaded targets', async () => {
    let gdb = await createGDB('tickets')
    await gdb.enableAsync()
    await gdb.addBreak('tickets.c', 31)
    let stopped = new Promise((resolve, reject) => {
      gdb.once('stopped', resolve)
    })
    await gdb.run()
    await stopped
    await gdb.interrupt()
    let res = await gdb.threads()
    await gdb.exit()

    expect(res.length).to.equal(6)
  })

  it('fires stopped event', async () => {
    let gdb = await createGDB('hello-world')
    let stopped = new Promise((resolve, reject) => {
      gdb.once('stopped', resolve)
    })
    await gdb.run()
    let res = await stopped
    await gdb.exit()

    expect(res).to.deep.equal({ reason: 'exited-normally' })
  })

  it('adds additional info to the stopped event', async () => {
    let gdb = await createGDB('hello-world')
    await gdb.addBreak('hello.c', 5)
    let stopped = new Promise((resolve, reject) => {
      gdb.once('stopped', resolve)
    })
    await gdb.run()
    let res = await stopped
    await gdb.exit()

    expect(res).to.deep.equal({
      reason: 'breakpoint-hit',
      thread: {
        id: 1,
        frame: {
          file: '/examples/hello-world/hello.c',
          line: 5
        }
      },
      breakpoint: { id: 1 }
    })
  })

  it('fires running event', async () => {
    let gdb = await createGDB('tickets')
    await gdb.enableAsync()
    await gdb.addBreak('tickets.c', 31)
    let stopped = new Promise((resolve, reject) => {
      gdb.once('stopped', resolve)
    })
    await gdb.run()
    await stopped
    await gdb.interrupt()
    let threads = await gdb.threads()
    let running = new Promise((resolve, reject) => {
      gdb.once('running', resolve)
    })
    await gdb.proceed(threads[0])
    let res = await running
    await gdb.exit()

    expect(res).to.deep.equal({ thread: { id: threads[0].id } })
  })

  it('fires thread-created and thread-exited events', async () => {
    let gdb = await createGDB('hello-world')
    let threadCreated = new Promise((resolve, reject) => {
      gdb.once('thread-created', resolve)
    })
    let threadExited = new Promise((resolve, reject) => {
      gdb.once('thread-exited', resolve)
    })
    await gdb.run()
    let thread0 = await threadCreated
    let thread1 = await threadExited

    expect(thread0).to.deep.equal(thread1)
  })

  it('emits raw stream records', async () => {
    let gdb = await createGDB('hello-world')
    let consoleRecord = new Promise((resolve, reject) => {
      gdb.once('console', resolve)
    })
    await gdb.run()
    let res = await consoleRecord

    expect(res).to.equal('GNU gdb (Debian 7.7.1+dfsg-5) 7.7.1\n')
  })

  it('emits raw async records', async () => {
    let gdb = await createGDB('hello-world')
    let notifyRecord = new Promise((resolve, reject) => {
      gdb.on('notify', (msg) => {
        if (msg.state === 'breakpoint-modified') resolve(msg.data)
      })
    })
    await gdb.addBreak('hello.c', 'main')
    await gdb.run()
    let res = await notifyRecord

    expect(res.bkpt.number).to.equal('1')
  })

  it('returns all global variables', async () => {
    let gdb = await createGDB('factorial')
    await gdb.init()
    let globals = await gdb.globals()
    await gdb.exit()

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
    await gdb.exit()

    expect(context).to.deep.equal([
      { value: '0', name: 'i', scope: 'local', type: 'int' }
    ])
  })
})
