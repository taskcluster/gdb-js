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

function escape (script) {
  return script.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/"/g, '\\"')
}

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

  get process () {
    return this._process
  }

  async init () {
    for (let script of scripts) {
      let src = escape(script.src)
      await this.execMI(`-interpreter-exec console "python\\n${src}"`)
    }
  }

  async set (param, value) {
    await this.execMI(`-gdb-set ${param} ${value}`)
  }

  async attachOnFork () {
    // Note that it will make sense only for systems
    // that support fork and vfork. It won't work for Windows.
    await this.set('detach-on-fork', 'off')
  }

  async enableAsync () {
    try {
      await this.set('mi-async', 'on')
    } catch (e) {
      // For gdb <= 7.7.
      await this.set('target-async', 'on')
    }
    await this.set('non-stop', 'on')
    this._async = true
  }

  async attach (pid) {
    await this.execMI('-target-attach ' + pid)
  }

  async detach (pid) {
    await this.execMI('-target-detach ' + pid)
  }

  async interrupt (arg) {
    if (!this._async) {
      this._process.kill('SIGINT')
    } else {
      let options = typeof arg === 'number'
        ? '--thread ' + arg : arg ? '--thread-group ' + arg : '--all'
      await this.execMI('-exec-interrupt ' + options)
    }
  }

  async threads () {
    let res = await this.execMI('-thread-info')
    return res.threads
  }

  async thread (id) {
    let res = await this.execMI('-thread-info ' + id)
    return res.threads[1]
  }

  async threadGroups (all) {
    let options = all ? '--available' : ''
    let res = await this.execMI('-list-thread-groups ' + options)
    return res.groups
  }

  async break (file, pos, thread) {
    let res = await this.execMI(`-break-insert ${file}:${pos}`, thread)
    return res.bkpt
  }

  async removeBreak (id) {
    await this.execMI('-break-delete ' + id)
  }

  async stepIn (thread) {
    await this.execMI('-exec-step', thread)
  }

  async stepOut (thread) {
    await this.execMI('-exec-finish', thread)
  }

  async next (thread) {
    await this.execMI('-exec-next', thread)
  }

  async run (thread) {
    await this.execMI('-exec-run', thread)
  }

  async continue (thread) {
    await this.execMI('-exec-continue', thread)
  }

  async vars (thread) {
    let res = await this.execCLI('info context', thread)
    return JSON.parse(res)
  }

  // XXX: global information like source files and symbol tables
  // makes more sense for thread groups than just threads actually...
  async globals (thread) {
    if (!this._globals) {
      // Getting all globals is currently only possible
      // through parsing the symbol table. Symbol table is
      // exported to Python only partially, thus we need
      // to parse it manually.
      let res = await this.execCLI('info variables', thread)
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

  async callstack (thread) {
    let res = await this.execMI('-stack-list-frames', thread)
    return res.stack.map((frame) => frame.value)
  }

  async sourceFiles (thread) {
    let res = await this.execMI('-file-list-exec-source-files', thread)
    return res.files
  }

  async eval (expr, thread) {
    let res = await this.execMI('-data-evaluate-expression ' + expr, thread)
    return res.value
  }

  async exit () {
    await this.execMI('-gdb-exit')
  }

  async execPy (src, thread) {
    assert(src, 'You must provide a script')
    let script = escape(src)
    assert(script.length < MAX_SCRIPT, 'Your script is too long')
    return await this.execCLI(`python\\n${script}`, thread)
  }

  async execCLI (cmd, thread) {
    return await this._exec(thread ? `thread apply ${thread} ${cmd}` : cmd, 'cli')
  }

  async execMI (cmd, thread) {
    let parts = cmd.split(/ (.+)/)
    let options = parts.length > 1 ? parts[1] : ''
    return await this._exec(thread ? `${parts[0]} --thread ${thread} ${options}` : cmd, 'mi')
  }

  async _exec (cmd, interpreter) {
    debugInput(cmd)
    cmd = interpreter === 'cli'
      ? `-interpreter-exec console "concat ${this._token} ${cmd}"` : cmd
    this._process.stdin.write(cmd + '\n', { binary: true })
    return await new Promise((resolve, reject) => {
      this._queue.write({ cmd, interpreter, resolve, reject })
    })
  }
}
