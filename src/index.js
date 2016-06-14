import assert from 'assert'
import createDebugger from 'debug'
import { EventEmitter } from 'events'
import _ from 'highland'
import { parse as parseMI } from './mi-parser'
import { parse as parseInfo } from './info-parser'
import scripts from './scripts'

const MAX_SCRIPT = 3500

let debug = createDebugger('gdb-js')

export default class GDB extends EventEmitter {
  constructor (childProcess) {
    super()

    this._process = childProcess
    this._queue = _()

    let cliOutput = []

    let stream = _(this._process.stdout)
      .map((chunk) => chunk.toString())
      .splitBy('\n')
      .map(parseMI)

    this._process.stdout.on('data', (data) => { debug(data.toString()) })

    stream.fork()
      .filter((msg) => msg.type === 'result')
      .zip(this._queue)
      .each((msg) => {
        let { state, data } = msg[0]
        let { cmd, interpreter, resolve, reject } = msg[1]

        if (state === 'error') {
          let msg = `Error while executing "${cmd}". ${data.msg}`
          let err = new Error(msg)
          err.code = data.code
          err.cmd = cmd
          reject(err)
        } else {
          if (interpreter === 'cli') {
            data = cliOutput.reduce((prev, next) => prev + next)
          }
          debug('Resolve: %s', JSON.stringify(data))
          resolve(data)
        }
      })

    stream.fork()
      .filter((msg) => msg.type === 'prompt')
      .each((msg) => { cliOutput = [] })

    stream.fork()
      .filter((msg) => msg.type === 'console')
      .each((msg) => { cliOutput.push(msg.data) })

    stream.fork()
      .filter((msg) => !['result', 'console', 'log'].includes(msg.type))
      .each((msg) => {
        // exec, notify, status and target output are emitted
        this.emit(msg.state || msg.type, msg.data)
      })
  }

  async break (file, pos) {
    let res = await this.execMI(`-break-insert ${file}:${pos}`)
    return res.bkpt
  }

  async removeBreak () {
    // await this.exec('-whatever-...')
  }

  async stepIn () {
    // await this.exec('-exec-...')
  }

  async stepOut () {
    // await this.exec('-exec-...')
  }

  async next () {
    await this.execMI('-exec-next')
  }

  async run () {
    await this.execMI('-exec-run')
  }

  async continue () {
    await this.execMI('-exec-continue')
  }

  async vars () {
    let res = await this.execPy(scripts.vars)
    return JSON.parse(res)
  }

  async globals () {
    if (!this._globals) {
      let res = await this.execCLI('info variables', 'cli')
      this._globals = parseInfo(res)
    }

    let res = []

    for (let v of this._globals) {
      let value = await this.eval(v.name)
      res.push(Object.assign({}, v, { value }))
      debug(v, value)
    }

    return res
  }

  async callstack () {
    let res = await this.execMI('-stack-list-frames')
    return res.stack.map((frame) => frame.value)
  }

  async sourceFiles () {
    let res = await this.execMI('-file-list-exec-source-files')
    return res.files
  }

  async eval (expr) {
    let res = await this.execMI('-data-evaluate-expression ' + expr)
    return res.value
  }

  async exit () {
    await this.execMI('-gdb-exit')
  }

  async execPy (src) {
    assert(src, 'You must provide a script')
    assert(src.length < MAX_SCRIPT, 'Your script is too long')
    let script = src.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    return await this.execCLI('python\\n' + script)
  }

  async execCLI (cmd) {
    let command = `-interpreter-exec console "${cmd}"`
    return await this._exec(command, 'cli')
  }

  async execMI (cmd) {
    return await this._exec(cmd, 'mi')
  }

  async _exec (cmd, interpreter) {
    debug('Command execution: %s', cmd)
    this._process.stdin.write(cmd + '\n', { binary: true })
    return await new Promise((resolve, reject) => {
      this._queue.write({ cmd, interpreter, resolve, reject })
    })
  }
}
