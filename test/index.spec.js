/* eslint-disable no-undef */

import { expect } from 'chai'
import { PassThrough } from 'stream'
import Docker from 'dockerode-promise'
import GDB from '../lib'

let container
let docker = new Docker({ socketPath: '/var/run/docker.sock' })

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

describe('state consistency', () => {
  before(async () => {
    // XXX: 404 Not Found
    // await docker.pull('baygeldin/gdb-examples')
    container = await docker.createContainer({
      Image: 'baygeldin/gdb-examples',
      Cmd: ['sleep', '100']
    })
    await container.start()
  })

  after(async () => {
    await container.remove({ v: true, force: true })
  })

  it('saves frame correctly', async () => {
    let gdb = await createGDB('hello-world')
    let frameUpdate = new Promise((resolve, reject) => {
      setTimeout(reject, 10000)
      gdb.once('update:frame', resolve)
    })

    await gdb.break('main')
    await gdb.run()
    await frameUpdate

    expect(gdb.frame).to.deep.equal({
      file: '/examples/hello-world/hello.c',
      line: '4'
    })
  })
})
