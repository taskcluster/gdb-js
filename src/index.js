import assert from 'assert'
import createDebugger from 'debug'
import { EventEmitter } from 'events'
import _ from 'highland'
import { parse as parseMI } from './mi-parser'
import { parse as parseInfo } from './info-parser'
import scripts from './scripts'

const MAX_SCRIPT = 3500
const TOKEN = 'GDBJS^'

let debugCLIResluts = createDebugger('gdb-js:results:cli')
let debugMIResluts = createDebugger('gdb-js:results:mi')
let debugOutput = createDebugger('gdb-js:output')
let debugInput = createDebugger('gdb-js:input')

export default class GDB extends EventEmitter {
  constructor (childProcess, options) {
    super()

    this.options = Object.assign({}, options, { token: TOKEN })

    this._process = childProcess
    this._queue = _()
    this._token = this.options.token

    let stream = _(this._process.stdout)
      .map((chunk) => chunk.toString())
      .splitBy('\n')
      .tap(debugOutput)
      .map(parseMI)

    stream.fork()
      .filter((msg) => !['result', 'log'].includes(msg.type))
      // exec, notify, status, console and target records are emitted
      .each((msg) => { this.emit(msg.state || msg.type, msg.data) })

    // Here, the stream should NOT be forked, but observed instead!
    // It's important, because zipping streams that are forked from
    // the single source may cause blocking.
    let cliOutput = stream.observe()
      .filter((msg) => msg.type === 'console' && msg.data.startsWith(this._token))
      .map((msg) => msg.data.slice(this._token.length))
      .tap(debugCLIResluts)

    let results = stream.fork()
      .filter((msg) => msg.type === 'result')
      .zip(this._queue)
      .map((msg) => Object.assign({}, msg[0], msg[1]))

    results.fork()
      .filter((msg) => msg.state === 'error')
      .each((msg) => {
        let { data, cmd, reject } = msg
        let text = `Error while executing "${cmd}". ${data.msg}`
        let err = new Error(text)
        err.code = data.code
        err.cmd = cmd
        reject(err)
      })

    let success = results.fork()
      .filter((msg) => msg.state !== 'error')

    success.fork()
      .filter((msg) => msg.interpreter === 'mi')
      .tap((msg) => debugMIResluts(msg.data))
      .each((msg) => { msg.resolve(msg.data) })

    success.fork()
      .filter((msg) => msg.interpreter === 'cli')
      .zip(cliOutput)
      .each((msg) => { msg[0].resolve(msg[1]) })
  }

  async init () {
    for (let script of scripts) await this.execPy(script.src)
  }

  async break (file, pos) {
    let res = await this.execMI(`-break-insert ${file}:${pos}`)
    return res.bkpt
  }

  async removeBreak (id) {
    await this.execMI('-break-delete ' + id)
  }

  async stepIn () {
    await this.execMI('-exec-step')
  }

  async stepOut () {
    await this.execMI('-exec-finish')
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
    let res = await this.execCLI('info context')
    return JSON.parse(res)
  }

  async globals () {
    if (!this._globals) {
      // Getting all globals is currently only possible
      // through parsing the symbol table. Symbol table is
      // exported to Python only partially, thus we need
      // to parse it manually.
      let res = await this.execCLI('info variables')
      this._globals = parseInfo(res)
    }

    let res = []

    for (let v of this._globals) {
      // TODO: instead of making multiple requests
      // it's better to do it with a single python function
      let value = await this.eval(v.name)
      res.push(Object.assign({}, v, { value }))
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
    let script = src.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/"/g, '\\"')
    assert(script.length < MAX_SCRIPT, 'Your script is too long')
    return await this._exec(`-interpreter-exec console "python\\n${script}"`, 'mi')
  }

  async execCLI (cmd) {
    return await this._exec(`-interpreter-exec console "concat ${this._token} ${cmd}"`, 'cli')
  }

  async execMI (cmd) {
    return await this._exec(cmd, 'mi')
  }

  async _exec (cmd, interpreter) {
    debugInput(cmd)
    this._process.stdin.write(cmd + '\n', { binary: true })
    return await new Promise((resolve, reject) => {
      this._queue.write({ cmd, interpreter, resolve, reject })
    })
  }
}
