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
  stream.on('end', async () => {
    let data = await exec.inspect()
    if (!data.Running) child.emit('exit', data.ExitCode)
  })

  return new GDB(child)
}

describe('gdb-js', () => {
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

  it('returns all global variables', async () => {
    let gdb = await createGDB('factorial')
    let globals = await gdb.globals()
    expect(globals).to.deep.equal([
      { value: '10', name: 'my_global', file: 'factorial.c', type: 'int' }
    ])
  })
})
