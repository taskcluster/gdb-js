/* eslint-disable no-undef */

import { expect } from 'chai'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import Docker from 'dockerode-promise'
import GDB from '../lib'

let container

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

  let child = new EventEmitter()
  Object.assign(child, { stdin: stream, stdout, stderr })
  exec.inspect((err, data) => {
    if (!err && !data.Running) child.emit('exit', data.ExitCode)
  })

  return new GDB(child)
}

// TESTS ARE TEMPORARILY DISABLED

describe('state consistency', () => {
  before(async () => {
    // XXX: 404 Not Found
    // await docker.pull('baygeldin/gdb-examples')
    let docker = new Docker({ socketPath: '/var/run/docker.sock' })

    container = await docker.createContainer({
      Image: 'baygeldin/gdb-examples',
      OpenStdin: true
    })

    await container.attach()
    await container.start()
  })

  after(async () => {
    await container.remove({ force: true })
  })

  xit('saves frame correctly', async () => {
    let gdb = await createGDB('hello-world')
    let frameUpdate = new Promise((resolve, reject) => {
      setTimeout(reject, 10000)
      gdb.once('update:frame', resolve)
    })

    await gdb.break(4)
    await gdb.run()
    await frameUpdate

    expect(gdb.frame).to.deep.equal({
      file: '/examples/hello-world/hello.c',
      line: '4'
    })
  })

  xit('saves breakpoints correctly', async () => {
    let gdb = await createGDB('hello-world')
    let breakpointsUpdate = new Promise((resolve, reject) => {
      let times = 0
      setTimeout(reject, 10000)
      gdb.on('update:breakpoints', () => { if (++times === 2) resolve() })
    })

    let file = '/examples/hello-world/hello.c'

    await gdb.break(file, 'main')
    await gdb.break(file, 5)
    await breakpointsUpdate

    expect(gdb.breakpoints).to.deep.equal([
      { id: 1, file, line: 4, func: 'main', status: true, times: 0 },
      { id: 2, file, line: 5, func: 'main', status: true, times: 0 }
    ])
  })
})
