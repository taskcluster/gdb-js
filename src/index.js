import { EventEmitter } from 'events'
import _ from 'highland'
import { parse } from './parser'

export default class GDB extends EventEmitter {
  constructor (childProcess) {
    super()

    this._process = childProcess
    this._queue = _()

    let stream = _(this._process.stdout)
      .map((chunk) => chunk.toString())
      .splitBy('\n')
      .map(parse)

    stream.fork()
      .filter((msg) => msg.type === 'result')
      .zip(this._queue)
      .each((msg) => {
        let { state, data } = msg[0]
        let { resolve, reject } = msg[1]
        state !== 'error' ? resolve(data) : reject(data.msg)
      })

    stream.fork()
      .filter((msg) => msg.type !== 'result')
      .each((msg) => this.emit(msg.state || msg.type, msg.data))
  }

  async break (file, pos) {
    let res = await this.exec(`-break-insert ${file}:${pos}`)
    return res.bkpt
  }

  async removeBreak () {
  }

  async stepIn () {
    // await this.exec('-exec-...')
  }

  async stepOut () {
    // await this.exec('-exec-...')
  }

  async next () {
    await this.exec('-exec-next')
  }

  async run () {
    await this.exec('-exec-run')
  }

  async continue () {
    await this.exec('-exec-continue')
  }

  async locals () {
    // args?
    let res = await this.exec('-stack-list-locals 1')
    return res.locals
  }

  async globals () {
    // let res = await this.exec('-stack-list-variables')
  }

  async callstack () {
    let res = await this.exec('-stack-list-frames')
    return res.stack.map((frame) => frame.value)
  }

  async sourceFiles () {
    let res = await this.exec('-file-list-exec-source-files')
    return res.files
  }

  async exit () {
    await this.exec('-gdb-exit')
  }

  // async execNotMi()
  // for commands that MI doesn't support

  async exec (cmd) {
    try {
      this._process.stdin.write(cmd + '\n', { binary: true })
      return await new Promise((resolve, reject) => {
        this._queue.write({ cmd, resolve, reject })
      })
    } catch (msg) {
      throw new Error(`Error while executing "${cmd}". ${msg}`)
    }
  }
}
