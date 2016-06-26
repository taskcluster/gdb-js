import assert from 'assert'
import createDebugger from 'debug'
import { EventEmitter } from 'events'
import _ from 'highland'

// Parser for the GDB/MI output syntax.
import { parse as parseMI } from './mi-parser'
// Parser for the output of `info` GDB command.
import { parse as parseInfo } from './info-parser'
// An array of python scripts (JSON file).
import scripts from './scripts'

// Default prefix for results of CLI commands.
const TOKEN = 'GDBJS^'

let debugCLIResluts = createDebugger('gdb-js:results:cli')
let debugMIResluts = createDebugger('gdb-js:results:mi')
let debugOutput = createDebugger('gdb-js:output')
let debugInput = createDebugger('gdb-js:input')

/**
 * Escapes symbols in python code so that we can send it using inline mode.
 *
 * @param {string} script Python script.
 * @returns {string} Escaped python script.
 * @ignore
 */
function escape (script) {
  return script.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/"/g, '\\"')
}

/**
 * Class representing an internal GDB error.
 *
 * @extends Error
 */
class GDBError extends Error {
  /**
   * Create a GDBError.
   *
   * @param {string} cmd Command that led to this error.
   * @param {string} msg Error message.
   * @param {number} [code] Error code.
   */
  constructor (cmd, msg, code) {
    super(msg)

    this.name = 'GDBError'
    /**
     * Command that led to this error.
     *
     * @type {string}
     **/
    this.command = cmd
    /**
     * Error message.
     *
     * @type {string}
     **/
    this.message = msg
    /**
     * Error code.
     *
     * @type {number}
     **/
    this.code = code
  }
}

/**
 * This event is emitted when target or one of its threads has stopped due to some reason.
 * The event object is a JSON representation of GDB/MI message.
 *
 * @event GDB#stopped
 * @type {object}
 * @property {string} reason The reason of why target has stopped.
 */

/**
 * This event is emitted when target changes state to running.
 * The event object is a JSON representation of GDB/MI message.
 *
 * @event GDB#running
 * @type {object}
 */

/**
 * GDB emits all notifications from GDB. Please, see
 * {@link https://sourceware.org/gdb/onlinedocs/gdb/GDB_002fMI-Async-Records.html|
 * the official GDB/MI documentation}.
 *
 * @example
 * gdb.on('thread-group-added', handler)
 * gdb.on('breakpoint-modified', handler)
 *
 * @event GDB#[notifications]
 * @type {object}
 */

/**
 * GDB emits all status notifications from GDB. Contains on-going status information
 * about the progress of a slow operation.
 *
 * @event GDB#[status]
 * @type {Object}
 */

/**
 * Output that should be displayed as is in the console.
 *
 * @event GDB#console
 * @type {string}
 */

/**
 * Output produced by the target program. Please, note that it's currently impossible
 * to distinguish the target and the MI output correctly due to a bug in GDB/MI. Thus,
 * it's recommended to use `--tty` option with your GDB.
 *
 * @event GDB#target
 * @type {string}
 */

/**
 * Class representing a GDB abstraction.
 *
 * @extends EventEmitter
 * @public
 */
class GDB extends EventEmitter {
  /**
   * Create a GDB wrapper.
   *
   * @param {object} childProcess A Node.js child process or just an
   *   object with `stdin`, `stdout`, `stderr` properties that are Node.js streams.
   *   If you're using GDB all-stop mode, then it should also have implementation of
   *   `kill` method that is able to send signals (such as `SIGINT`).
   * @param {object} [options] An options object.
   * @param {string} [options.token] Prefix for the results of CLI commands.
   *
   * @fires GDB#stopped
   * @fires GDB#running
   * @fires GDB#[noifications]
   * @fires GDB#[status]
   * @fires GDB#console
   * @fires GDB#target
   */
  constructor (childProcess, options) {
    super()

    this.options = Object.assign({}, options, { token: TOKEN })

    this._process = childProcess
    this._token = this.options.token
    /**
     * The main queue of commands sent to GDB.
     *
     * @ignore
     */
    this._queue = _()

    let stream = _(this._process.stdout)
      .map((chunk) => chunk.toString())
      .splitBy('\n')
      .tap(debugOutput)
      .map(parseMI)

    // Basically, we're just branching our stream to the messages that should
    // be emitted and the results which we then zip with the sent commands.
    // Results can be either result records or console records with the specified prefix.

    stream.fork()
      .filter((msg) => !['result', 'log'].includes(msg.type))
      // Only exec, notify, status, console and target records are emitted.
      .each((msg) => { this.emit(msg.state || msg.type, msg.data) })

    // Here, the stream should NOT be forked, but observed instead!
    // It's important, because zipping streams that are forked from
    // the same source may cause blocking.
    let cliOutput = stream.observe()
      // We consider as the result of CLI operation
      // only those console records that starts with our token.
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
        let err = new GDBError(cmd, text, parseInt(data.code, 10))
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

  /**
   * Get the child process object.
   *
   * @type {object}
   * @readonly
   */
  get process () {
    return this._process
  }

  /**
   * Extend GDB CLI interface with some useful commands that are
   * necessary for executing some methods of this GDB wrapper
   * (e.g. {@link GDB#vars|vars}, {@link GDB#execCLI|execCli}).
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async init () {
    for (let script of scripts) {
      let src = escape(script.src)
      await this.execMI(`-interpreter-exec console "python\\n${src}"`)
    }
  }

  /**
   * Set internal GDB variable.
   *
   * @param {string} param Name of GDB variable.
   * @param {string} value Value of GDB variable.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async set (param, value) {
    await this.execMI(`-gdb-set ${param} ${value}`)
  }

  /**
   * Enable the `detach-on-fork` option which will automatically
   * attach GDB to any of forked processes. Please, note that it makes
   * sense only for systems that support `fork` and `vfork` calls.
   * It won't work for Windows, for example.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async attachOnFork () {
    await this.set('detach-on-fork', 'off')
  }

  /**
   * Enable async and non-stop modes in GDB. This mode is *highly* recommended!
   * Also, it changes the behaviour of {@link GDB#interrupt|interrupt} method.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async enableAsync () {
    try {
      await this.set('mi-async', 'on')
    } catch (e) {
      // For gdb <= 7.7 (which not support `mi-async`).
      await this.set('target-async', 'on')
    }
    await this.set('non-stop', 'on')
    this._async = true
  }

  /**
   * Attache a new target (inferior) to GDB.
   *
   * @param {number} pid Process id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async attach (pid) {
    await this.execMI('-target-attach ' + pid)
  }

  /**
   * Detache a target (inferior) from GDB.
   *
   * @param {number} pid Process id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async detach (pid) {
    await this.execMI('-target-detach ' + pid)
  }

  /**
   * Interrupt the target. In all-stop mode and in non-stop mode without arguments
   * it interrupts all threads. In non-stop mode it can interrupt only specific thread or
   * a thread group.
   *
   * @param {number|string} [arg] Thread number or thread-group id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async interrupt (arg) {
    if (!this._async) {
      this._process.kill('SIGINT')
    } else {
      let options = typeof arg === 'number'
        ? '--thread ' + arg : arg ? '--thread-group ' + arg : '--all'
      await this.execMI('-exec-interrupt ' + options)
    }
  }

  /**
   * Get the information about all the threads.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<object[]>} A promise that resolves with an array of JSON
   *   representations of GDB/MI thread.
   */
  async threads () {
    let res = await this.execMI('-thread-info')
    return res.threads
  }

  /**
   * Get the information about specific thread.
   *
   * @param {number} id Thread number.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<object>} A promise that resolves with a JSON
   *   representation of GDB/MI thread.
   */
  async thread (id) {
    let res = await this.execMI('-thread-info ' + id)
    return res.threads[1]
  }

  /**
   * Get thread groups.
   *
   * @param {boolean} all Display all available thread groups or not.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<object[]>} A promise that resolves with an array
   * of JSON representations of GDB/MI thread groups.
   */
  async threadGroups (all) {
    let options = all ? '--available' : ''
    let res = await this.execMI('-list-thread-groups ' + options)
    return res.groups
  }

  /**
   * Insert a breakpoint at the specified position.
   *
   * @param {string} file A full name or just a file name.
   * @param {number|string} pos A function name or a line number.
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<object>} A promise that resolves with a JSON
   * representation of GDB/MI breakpoint.
   */
  async break (file, pos, thread) {
    let res = await this.execMI(`-break-insert ${file}:${pos}`, thread)
    return res.bkpt
  }

  /**
   * Removes a specific breakpoint.
   *
   * @param {number} id A breakpoint id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async removeBreak (id) {
    await this.execMI('-break-delete ' + id)
  }

  /**
   * Step in.
   *
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async stepIn (thread) {
    await this.execMI('-exec-step', thread)
  }

  /**
   * Step out.
   *
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async stepOut (thread) {
    await this.execMI('-exec-finish', thread)
  }

  /**
   * Execute to the next line.
   *
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async next (thread) {
    await this.execMI('-exec-next', thread)
  }

  /**
   * Run the target.
   *
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async run (thread) {
    await this.execMI('-exec-run', thread)
  }

  /**
   * Continue executeion.
   *
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async continue (thread) {
    await this.execMI('-exec-continue', thread)
  }

  /**
   * A variable representation.
   * @typedef {object} Variable
   * @property {string} name Name of the variable.
   * @property {string} type Type of the variable.
   * @property {string} scope Scope of the variable.
   * @property {string} value Value of the variable.
   */

  /**
   * List all variables in the current context (i.e. all global, static, local
   * variables in the current file).
   *
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<Variable[]>} A promise that resolves with an array of variables.
   */
  async vars (thread) {
    let res = await this.execCLI('gdbjs-context', thread)
    return JSON.parse(res)
  }

  /**
   * List all global variables. It uses the symbol table to achieve this.
   *
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<Variable[]>} A promise that resolves with an array of variables.
   */
  async globals (thread) {
    // XXX: global information like source files and symbol tables
    // makes more sense for thread groups than just threads actually...
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

  /**
   * Get the callstack.
   *
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<object[]>} A promise that resolves with an array
   * of JSON representations of GDB/MI frames.
   */
  async callstack (thread) {
    let res = await this.execMI('-stack-list-frames', thread)
    return res.stack.map((frame) => frame.value)
  }

  /**
   * Get information about source files. Please, note that it doesn't return sources.
   *
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<object[]>} A promise that resolves with an array
   * of JSON representations of GDB/MI source files.
   */
  async sourceFiles (thread) {
    let res = await this.execMI('-file-list-exec-source-files', thread)
    return res.files
  }

  /**
   * Evaluate a GDB expression.
   *
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<string>} A promise that resolves with the result of expression.
   */
  async eval (expr, thread) {
    let res = await this.execMI('-data-evaluate-expression ' + expr, thread)
    return res.value
  }

  /**
   * Exit GDB.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise} A promise that resolves/rejects after completion of a GDB/MI command.
   */
  async exit () {
    await this.execMI('-gdb-exit')
  }

  /**
   * Execute a custom python script.
   *
   * @param {string} src Python script.
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<string>} A promise that resolves with the output of python script execution.
   */
  async execPy (src, thread) {
    assert(src, 'You must provide a script')
    return await this.execCLI(`python\\n${escape(src)}`, thread)
  }

  /**
   * Execute a CLI command.
   *
   * @param {string} cmd CLI command.
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<string>} A promise that resolves with the result of command execution.
   */
  async execCLI (cmd, thread) {
    return await this._exec(thread ? `thread apply ${thread} ${cmd}` : cmd, 'cli')
  }

  /**
   * Execute a MI command.
   *
   * @param {string} cmd MI command.
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<object>} A promise that resolves with the result of command execution.
   */
  async execMI (cmd, thread) {
    let parts = cmd.split(/ (.+)/)
    let options = parts.length > 1 ? parts[1] : ''
    // Most of GDB/MI commands support `--thread` option.
    // However, in order to work it should be the first option.
    return await this._exec(thread ? `${parts[0]} --thread ${thread} ${options}` : cmd, 'mi')
  }

  /**
   * Internal method that executes a MI command and add it to the queue where it
   * waits for the results of execution.
   *
   * @param {string} cmd MI command.
   * @param {number} [thread] A thread id.
   *
   * @throws {GDBError} Internal GDB errors that arise in the MI interface.
   * @returns {Promise<object>} A promise that resolves with the result of command execution.
   *
   * @ignore
   */
  async _exec (cmd, interpreter) {
    debugInput(cmd)
    // All CLI commands are actually executed within MI interface.
    // And all of them are executed with the support of `concat` command that is defined
    // in the `init` method. `concat` makes it possible to view whole output of a CLI command
    // in the single console record.
    cmd = interpreter === 'cli'
      ? `-interpreter-exec console "gdbjs-concat ${this._token} ${cmd}"` : cmd
    this._process.stdin.write(cmd + '\n', { binary: true })
    return await new Promise((resolve, reject) => {
      this._queue.write({ cmd, interpreter, resolve, reject })
    })
  }
}

export default GDB

