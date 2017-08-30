import createDebugger from 'debug'
import { EventEmitter } from 'events'
import _ from 'highland'

// Custom error class.
import GDBError from './error.js'
// Thread object class.
import Thread from './thread.js'
// Thread group object class.
import ThreadGroup from './group.js'
// Breakpoint object class.
import Breakpoint from './breakpoint.js'
// Frame object class.
import Frame from './frame.js'
// Variable object class.
import Variable from './variable.js'
// Parser for the GDB/MI output syntax.
import { parse as parseMI } from './parsers/gdbmi.pegjs'
// Base class for custom GDB commands.
import baseCommand from './scripts/base.py'
// Command that executes CLI commands and returns them as a string.
import execCommand from './scripts/exec.py'
// Command that lists all symbols (e.g. locals, globals) in the current context.
import contextCommand from './scripts/context.py'
// Command that searches source files using regex.
import sourcesCommand from './scripts/sources.py'
// Command that returns the current thread group.
import groupCommand from './scripts/group.py'
// Command that returns the current thread.
import threadCommand from './scripts/thread.py'
// Base handler for custom GDB events.
import baseEvent from './scripts/event.py'
// Event that emits when new objfile is added.
import objfileEvent from './scripts/objfile.py'

// Debug logging.
let debugOutput = createDebugger('gdb-js:output')
let debugCLIInput = createDebugger('gdb-js:input:cli')
let debugMIInput = createDebugger('gdb-js:input:mi')
let debugCLIResluts = createDebugger('gdb-js:results:cli')
let debugMIResluts = createDebugger('gdb-js:results:mi')
let debugEvents = createDebugger('gdb-js:events')

/**
 * Converts string to integer.
 *
 * @param {string} str The input string.
 * @returns {number} The output integer.
 *
 * @ignore
 */
function toInt (str) {
  return parseInt(str, 10)
}

/**
 * Escapes symbols in python code so that we can send it using inline mode.
 *
 * @param {string} script The Python script.
 * @returns {string} The escaped python script.
 *
 * @ignore
 */
function escape (script) {
  return script.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/"/g, '\\"')
}

/**
 * Task to execute.
 *
 * @name Task
 * @function
 * @returns {Promise<any, GDBError>|any} Whatever.
 *
 * @ignore
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
   */
  constructor (childProcess) {
    super()

    this._process = childProcess
    /**
     * The main queue of commands sent to GDB.
     *
     * @ignore
     */
    this._queue = _()
    /**
     * The mutex to make simultaneous execution of public methods impossible.
     *
     * @ignore
     */
    this._lock = Promise.resolve()

    let stream = _(this._process.stdout)
      .map((chunk) => chunk.toString())
      .splitBy(/\r\n|\n/)
      .tap(debugOutput)
      .map(parseMI)

    // Basically, we're just branching our stream to the messages that should
    // be emitted and the results which we then zip with the sent commands.
    // Results can be either result records or framed console records.

    let results = stream.observe()
      .filter((msg) => msg.type === 'result')
      .zip(this._queue)
      .map((msg) => Object.assign({}, msg[0], msg[1]))

    results.fork()
      .filter((msg) => msg.state === 'error')
      .each((msg) => {
        let { data, cmd, reject } = msg
        let text = `Error while executing "${cmd}". ${data.msg}`
        let err = new GDBError(cmd, text, toInt(data.code))
        reject(err)
      })

    let success = results.fork()
      .filter((msg) => msg.state !== 'error')

    success.fork()
      .filter((msg) => msg.interpreter === 'mi')
      .tap((msg) => debugMIResluts(msg.data))
      .each((msg) => { msg.resolve(msg.data) })

    let commands = stream.observe()
      .filter((msg) => msg.type === 'console')
      // It's not possible for a command message to be split into multiple
      // console records, so we can safely just regex every record.
      .map((msg) => /<gdbjs:cmd:[a-z-]+ (.*?) [a-z-]+:cmd:gdbjs>/.exec(msg.data))
      .compact()
      .map((msg) => JSON.parse(msg[1]))
      .tap(debugCLIResluts)

    success.observe()
      .filter((msg) => msg.interpreter === 'cli')
      .zip(commands)
      .each((msg) => { msg[0].resolve(msg[1]) })

    // Emitting raw async records.

    /**
     * Raw output of GDB/MI notify records.
     * Contains supplementary information that the client should handle.
     * Please, see
     * {@link https://sourceware.org/gdb/onlinedocs/gdb/GDB_002fMI-Async-Records.html|the official GDB/MI documentation}.
     *
     * @event GDB#notify
     * @type {object}
     * @property {string} state The class of the notify record (e.g. `thread-created`).
     * @property {object} data JSON representation of GDB/MI message.
     */

    /**
     * Raw output of GDB/MI status records.
     * Contains on-going status information about the progress of a slow operation.
     *
     * @event GDB#status
     * @type {object}
     * @property {string} state The class of the status record.
     * @property {object} data JSON representation of GDB/MI message.
     */

    /**
     * Raw output of GDB/MI exec records.
     * Contains asynchronous state change on the target.
     *
     * @event GDB#exec
     * @type {object}
     * @property {string} state The class of the exec record (e.g. `stopped`).
     * @property {object} data JSON representation of GDB/MI message.
     */
    stream.fork()
      .filter((msg) => ['exec', 'notify', 'status'].includes(msg.type))
      .each((msg) => { this.emit(msg.type, { state: msg.state, data: msg.data }) })

    // Exposing streams of raw stream records.

    /**
     * Raw output of GDB/MI console records.
     *
     * @type {Readable<string>}
     */
    this.consoleStream = stream.observe()
      .filter((msg) => msg.type === 'console')
      .map((msg) => msg.data.replace(/<gdbjs:.*?:gdbjs>/g, ''))

    /**
     * Raw output of GDB/MI log records.
     * The log stream contains debugging messages being produced by gdb's internals.
     *
     * @type {Readable<string>}
     */
    this.logStream = stream.observe()
      .filter((msg) => msg.type === 'log')
      .map((msg) => msg.data)

    /**
     * Raw output of GDB/MI target records.
     * The target output stream contains any textual output from the running target.
     * Please, note that it's currently impossible
     * to distinguish the target and the MI output correctly due to a bug in GDB/MI. Thus,
     * it's recommended to use `--tty` option with your GDB process.
     *
     * @type {Readable<string>}
     */
    this.targetStream = stream.observe()
      .filter((msg) => msg.type === 'target')
      .map((msg) => msg.data)

    // Emitting defined events.

    /**
     * This event is emitted when target or one of its threads has stopped due to some reason.
     * Note that `thread` property indicates the thread that caused the stop. In an all-stop mode
     * all threads will be stopped.
     *
     * @event GDB#stopped
     * @type {object}
     * @property {string} reason The reason of why target has stopped (see
     *   {@link https://sourceware.org/gdb/onlinedocs/gdb/GDB_002fMI-Async-Records.html|the official GDB/MI documentation}) for more information.
     * @property {Thread} [thread] The thread that caused the stop.
     * @property {Breakpoint} [breakpoint] Breakpoint is provided if the reason is
     *   `breakpoint-hit`.
     */
    stream.fork()
      .filter((msg) => msg.type === 'exec' && msg.state === 'stopped')
      .each((msg) => {
        let { data } = msg
        let thread = data['thread-id']
        let event = { reason: data.reason }
        if (thread) {
          event.thread = new Thread(toInt(thread), {
            frame: new Frame({
              file: data.frame.fullname,
              line: toInt(data.frame.line)
            }),
            status: 'stopped'
          })
        }
        if (data.reason === 'breakpoint-hit') {
          event.breakpoint = new Breakpoint(toInt(data.bkptno))
        }

        this.emit('stopped', event)
      })

    /**
     * This event is emitted when target changes state to running.
     *
     * @event GDB#running
     * @type {object}
     * @property {Thread} [thread] The thread that has changed its state.
     *   If it's not provided, all threads have changed their states.
     */
    stream.fork()
      .filter((msg) => msg.type === 'exec' && msg.state === 'running')
      .each((msg) => {
        let { data } = msg
        let thread = data['thread-id']
        let event = {}
        if (thread !== 'all') {
          event.thread = new Thread(toInt(thread), { status: 'running' })
        }

        this.emit('running', event)
      })

    /**
     * This event is emitted when new thread spawns.
     *
     * @event GDB#thread-created
     * @type {Thread}
     */

    /**
     * This event is emitted when thread exits.
     *
     * @event GDB#thread-exited
     * @type {Thread}
     */
    stream.fork()
      .filter((msg) => msg.type === 'notify' &&
        ['thread-created', 'thread-exited'].includes(msg.state))
      .each((msg) => {
        let { state, data } = msg

        this.emit(state, new Thread(toInt(data.id), {
          // GDB/MI stores group id as `i<id>` string.
          group: new ThreadGroup(toInt(data['group-id'].slice(1)))
        }))
      })

    /**
     * This event is emitted when thread group starts.
     *
     * @event GDB#thread-group-started
     * @type {ThreadGroup}
     */

    /**
     * This event is emitted when thread group exits.
     *
     * @event GDB#thread-group-exited
     * @type {ThreadGroup}
     */
    stream.fork()
      .filter((msg) => msg.type === 'notify' &&
        ['thread-group-started', 'thread-group-exited'].includes(msg.state))
      .each((msg) => {
        let { state, data } = msg

        this.emit(state, new ThreadGroup(toInt(data.id.slice(1)), {
          pid: data.pid ? toInt(data.pid) : null
        }))
      })

    /**
     * This event is emitted with the full path to executable
     * when the new objfile is added.
     *
     * @event GDB#new-objfile
     * @type {string}
     */
    stream.fork()
      .filter((msg) => msg.type === 'console')
      .flatMap((msg) => msg.data.match(/<gdbjs:event:.*?:event:gdbjs>/g) || [])
      .map((msg) => /<gdbjs:event:([a-z-]+) (.*?) [a-z-]+:event:gdbjs>/g.exec(msg))
      .tap((msg) => debugEvents(msg[1], msg[2]))
      .each((msg) => { this.emit(msg[1], msg[2]) })
  }

  // Public methods.
  // Note, that it's really important to not call public methods
  // inside other public methods, because it may cause blocking!

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
   * (e.g. {@link GDB#context|context}, {@link GDB#execCLI|execCLI}).
   * It also enables custom actions (like {@link GDB#new-objfile|`new-objfile` event}).
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  init () {
    return this._sync(async () => {
      let scripts = [baseCommand, baseEvent, execCommand, contextCommand,
        sourcesCommand, groupCommand, threadCommand, objfileEvent]

      for (let s of scripts) {
        await this._execMI(`-interpreter-exec console "python\\n${escape(s)}"`)
      }
    })
  }

  /**
   * Set internal GDB variable.
   *
   * @param {string} param The name of a GDB variable.
   * @param {string} value The value of a GDB variable.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  set (param, value) {
    return this._sync(() => this._set(param, value))
  }

  /**
   * Enable the `detach-on-fork` option which will automatically
   * attach GDB to any of forked processes. Please, note that it makes
   * sense only for systems that support `fork` and `vfork` calls.
   * It won't work for Windows, for example.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  attachOnFork () {
    return this._sync(() => this._set('detach-on-fork', 'off'))
  }

  /**
   * Enable async and non-stop modes in GDB. This mode is *highly* recommended!
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  enableAsync () {
    return this._sync(async () => {
      try {
        await this._set('mi-async', 'on')
      } catch (e) {
        // For gdb <= 7.7 (which not support `mi-async`).
        await this._set('target-async', 'on')
      }
      await this._set('non-stop', 'on')
      this._async = true
    })
  }

  /**
   * Attach a new target (inferior) to GDB.
   *
   * @param {number} pid The process id or to attach.
   *
   * @returns {Promise<ThreadGroup, GDBError>} A promise that resolves/rejects
   *   with the added thread group.
   */
  attach (pid) {
    return this._sync(() => async () => {
      let res = await this._execCMD('exec add-inferior')
      let id = toInt(/Added inferior (\d+)/.exec(res)[1])
      let group = new ThreadGroup(id)
      await this._execMI('-target-attach ' + pid, group)
      return group
    })
  }

  /**
   * Detache a target (inferior) from GDB.
   *
   * @param {ThreadGroup|number} process The process id or the thread group to detach.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  detach (process) {
    return this._sync(() => this._execMI('-target-detach ' +
      (process instanceof ThreadGroup ? 'i' + process.id : process)))
  }

  /**
   * Interrupt the target. In all-stop mode and in non-stop mode without arguments
   * it interrupts all threads. In non-stop mode it can interrupt only specific thread or
   * a thread group.
   *
   * @param {Thread|ThreadGroup} [scope] The thread or thread-group to interrupt.
   *   If this parameter is omitted, it will interrupt all threads.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  interrupt (scope) {
    return this._sync(() => {
      if (!this._async) {
        this._process.kill('SIGINT')
      } else {
        return this._execMI(scope
          ? '-exec-interrupt' : '-exec-interrupt --all', scope)
      }
    })
  }

  /**
   * Get the information about all the threads or about specific threads.
   *
   * @param {Thread|ThreadGroup} [scope] Get information about threads of the specific
   *   thread group or even about the specific thread (if it doesn't have enough information
   *   or it's outdated). If this parameter is absent, then information about all
   *   threads is returned.
   *
   * @returns {Promise<Thread[]|Thread, GDBError>} A promise that resolves with an array
   *   of threads or a single thread.
   */
  threads (scope) {
    return this._sync(async () => {
      let mapToThread = (t) => {
        let options = { status: t.state }
        if (t.frame) {
          options.frame = new Frame({
            file: t.frame.fullname,
            line: toInt(t.frame.line),
            level: toInt(t.frame.level)
          })
        }

        return new Thread(toInt(t.id), options)
      }

      if (scope instanceof Thread) {
        let { threads } = await this._execMI('-thread-info ' + scope.id)
        return mapToThread(threads[0])
      } else if (scope instanceof ThreadGroup) {
        let { threads } = await this._execMI(`-list-thread-groups i${scope.id}`)
        return threads.map(mapToThread)
      } else {
        let { threads } = await this._execMI('-thread-info')
        return threads.map(mapToThread)
      }
    })
  }

  /**
   * Get the current thread.
   *
   * @returns {Promise<Thread, GDBError>} A promise that resolves with a thread.
   */
  currentThread () {
    return this._sync(() => this._currentThread())
  }

  /**
   * Although you can pass scope to commands, you can also explicitly change
   * the context of command execution. Sometimes it might be slightly faster.
   *
   * @param {Thread} thread The thread that should be selected.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  selectThread (thread) {
    return this._sync(() => this._selectThread(thread))
  }

  /**
   * Get thread groups.
   *
   * @returns {Promise<ThreadGroup[], GDBError>} A promise that resolves with
   *   an array thread groups.
   */
  threadGroups () {
    return this._sync(() => this._threadGroups())
  }

  /**
   * Get the current thread group.
   *
   * @returns {Promise<ThreadGroup, GDBError>} A promise that resolves with the thread group.
   */
  currentThreadGroup () {
    return this._sync(() => this._currentThreadGroup())
  }

  /**
   * Although you can pass scope to commands, you can also explicitly change
   * the context of command execution. Sometimes it might be slightly faster.
   *
   * @param {ThreadGroup} group The thread group that should be selected.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  selectThreadGroup (group) {
    return this._sync(() => this._selectThreadGroup(group))
  }

  /**
   * Insert a breakpoint at the specified position.
   *
   * @param {string} file The full name or just a file name.
   * @param {number|string} pos The function name or a line number.
   * @param {Thread} [thread] The thread where breakpoint should be set.
   *   If this field is absent, breakpoint applies to all threads.
   *
   * @returns {Promise<Breakpoint, GDBError>} A promise that resolves with a breakpoint.
   */
  addBreak (file, pos, thread) {
    return this.addOptionsBreak(`${file}:${pos}`)
  }

  /**
   * Insert a breakpoint at the specified function.
   *
   * @param {string} label The function.
   * @param {Thread} [thread] The thread where breakpoint should be set.
   *   If this field is absent, breakpoint applies to all threads.
   *
   * @returns {Promise<Breakpoint, GDBError>} A promise that resolves with a breakpoint.
   */
  addFunctionBreak (label, thread) {
    return this.addOptionsBreak(`--function ${label}`)
  }

  /**
   * Insert a breakpoint at the specified label.
   *
   * @param {string} label The label.
   * @param {Thread} [thread] The thread where breakpoint should be set.
   *   If this field is absent, breakpoint applies to all threads.
   *
   * @returns {Promise<Breakpoint, GDBError>} A promise that resolves with a breakpoint.
   */
  addLabelBreak (label, thread) {
    return this.addOptionsBreak(`--label ${label}`)
  }

  /**
   * Insert a breakpoint at the specified explicit or address location.
   *
   * @param {string} options: source/function/label/address or line
   *   https://sourceware.org/gdb/onlinedocs/gdb/GDB_002fMI-Breakpoint-Commands.html
   * @param {Thread} [thread] The thread where breakpoint should be set.
   *   If this field is absent, breakpoint applies to all threads.
   *
   * @returns {Promise<Breakpoint, GDBError>} A promise that resolves with a breakpoint.
   */
  addOptionsBreak (options, thread) {
    return this._sync(async () => {
      let opt = thread ? '-p ' + thread.id : ''
      let { bkpt } = await this._execMI(`-break-insert ${opt} ${options}`)
      if (Array.isArray(bkpt)) {
        return new Breakpoint(toInt(bkpt[0].number), {
          file: bkpt[1].fullname,
          line: bkpt[1].line,
          func: bkpt.map((b) => b.func).filter((f) => !!f),
          thread
        })
      } else {
        return new Breakpoint(toInt(bkpt.number), {
          file: bkpt.fullname,
          line: toInt(bkpt.line),
          func: bkpt.func,
          thread
        })
      }
    })
  }

  /**
   * Removes a specific breakpoint.
   *
   * @param {Breakpoint} [bp] The breakpoint.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  removeBreak (bp) {
    return this._sync(() => this._execMI('-break-delete ' + bp.id))
  }

  /**
   * Step in.
   *
   * @param {Thread|ThreadGroup} [scope] The thread or thread group where
   *   the stepping should be done.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  stepIn (scope) {
    return this._sync(() => this._execMI('-exec-step', scope))
  }

  /**
   * Step out.
   *
   * @param {Thread|ThreadGroup} [scope] The thread or thread group where
   *   the stepping should be done.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  stepOut (scope) {
    return this._sync(() => this._execMI('-exec-finish', scope))
  }

  /**
   * Execute to the next line.
   *
   * @param {Thread|ThreadGroup} [scope] The thread or thread group where
   *   the stepping should be done.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  next (scope) {
    return this._sync(() => this._execMI('-exec-next', scope))
  }

  /**
   * Run the current target.
   *
   * @param {ThreadGroup} [group] The thread group to run.
   *   If this parameter is omitted, current thread group will be run.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  run (group) {
    // XXX: seems like MI command `-exec-run` has a bug that makes it
    // run in the foreground mode (although the opposite is stated in the docs).
    // This can cause blocking even in `target-async` mode.
    return this._sync(() => this._async ? this._execCMD('exec run&', group)
      : this._execMI('-exec-run', group))
  }

  /**
   * Continue execution.
   *
   * @param {Thread|ThreadGroup} [scope] The thread or thread group that should be continued.
   *   If this parameter is omitted, all threads are continued.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  proceed (scope) {
    return this._sync(() => this._execMI(scope
      ? '-exec-continue' : '-exec-continue --all', scope))
  }

  /**
   * List all symbols in the current context (i.e. all global, static, local
   * variables and constants in the current file).
   *
   * @param {Thread} [thread] The thread from which the context should be taken.
   *
   * @returns {Promise<Variable[], GDBError>} A promise that resolves with
   *   an array of variables.
   */
  context (thread) {
    return this._sync(async () => {
      let res = await this._execCMD('context', thread)
      return res.map((v) => new Variable(v))
    })
  }

  /**
   * Get the callstack.
   *
   * @param {Thread} [thread] The thread from which the callstack should be taken.
   *
   * @returns {Promise<Frame[], GDBError>} A promise that resolves with an array of frames.
   */
  callstack (thread) {
    return this._sync(async () => {
      let { stack } = await this._execMI('-stack-list-frames', thread)
      return stack.map((f) => new Frame({
        file: f.value.fullname,
        line: toInt(f.value.line),
        level: toInt(f.value.level)
      }))
    })
  }

  /**
   * Get list of source files or a subset of source files that match
   * the regular expression. Please, note that it doesn't return sources.
   *
   * @example
   * let headers = await gdb.sourceFiles({ pattern: '\.h$' })
   *
   * @param {object} [options] The options object.
   * @param {ThreadGroup} [options.group] The thread group (i.e. target) for
   *   which source files are needed. If this parameter is absent, then
   *   source files are returned for all targets.
   * @param {string} [options.pattern] The regular expression (see
   *   {@link https://docs.python.org/2/library/re.html|Python regex syntax}).
   *   This option is useful when the project has a lot of files so that
   *   it's not desirable to send them all in one chunk along the wire.
   *
   * @returns {Promise<string[], GDBError>} A promise that resolves with
   *   an array of source files.
   */
  sourceFiles (options = {}) {
    return this._sync(async () => {
      let files = []
      let group = options.group
      let pattern = options.pattern || ''
      let cmd = 'sources ' + pattern

      if (group) {
        files = await this._execCMD(cmd, group)
      } else {
        let groups = await this._threadGroups()
        for (let g of groups) {
          files = files.concat(await this._execCMD(cmd, g))
        }
        files = files.filter((f, index) => files.indexOf(f) === index)
      }

      return files
    })
  }

  /**
   * Evaluate a GDB expression.
   *
   * @param {string} expr The expression to evaluate.
   * @param {Thread|ThreadGroup} [scope] The thread or thread group where
   *   the expression should be evaluated.
   *
   * @returns {Promise<string, GDBError>} A promise that resolves with the result of expression.
   */
  evaluate (expr, scope) {
    return this._sync(async () => {
      let res = await this._execMI('-data-evaluate-expression ' + expr, scope)
      return res.value
    })
  }

  /**
   * Exit GDB.
   *
   * @returns {Promise<undefined, GDBError>} A promise that resolves/rejects
   *   after completion of a GDB command.
   */
  exit () {
    return this._sync(() => this._execMI('-gdb-exit'))
  }

  /**
   * Execute a custom python script and get the results of its excecution.
   * If your python script is asynchronous and you're interested in its output, you should
   * either define a new event (refer to the *Extending* section in the main page) or
   * read the {@link GDB#consoleStream|console stream}. Here's the example below.
   *
   * By the way, with this method you can define your own CLI commands and then call
   * them via {@link GDB#execCLI|execCLI} method. For more examples, refer to the *Extending*
   * section on the main page and read
   * {@link https://sourceware.org/gdb/current/onlinedocs/gdb/Python-API.html|official GDB Python API}
   * and {@link https://sourceware.org/gdb/wiki/PythonGdbTutorial|PythonGdbTutorial}.
   *
   * @example
   * let script = `
   * import gdb
   * import threading
   *
   *
   * def foo():
   *     sys.stdout.write('bar')
   *     sys.stdout.flush()
   *
   * timer = threading.Timer(5.0, foo)
   * timer.start()
   * `
   * gdb.consoleStream.on('data', (str) => {
   *   if (str === 'bar') console.log('yep')
   * })
   * await gdb.execPy(script)
   *
   * @param {string} src The python script.
   * @param {Thread} [thread] The thread where the script should be executed.
   *
   * @returns {Promise<string, GDBError>} A promise that resolves with the output of
   *   python script execution.
   */
  execPy (src, scope) {
    return this._sync(() => this._execCMD(`exec python\\n${escape(src)}`, scope))
  }

  /**
   * Execute a CLI command.
   *
   * @param {string} cmd The CLI command.
   * @param {Thread|ThreadGroup} [scope] The thread where the command should be executed.
   *
   * @returns {Promise<string, GDBError>} A promise that resolves with
   *   the result of command execution.
   */
  execCLI (cmd, scope) {
    return this._sync(() => this._execCMD(`exec ${cmd}`, scope))
  }

  /**
   * Execute a custom defined command. Refer to the *Extending* section on the main
   * page of the documentation.
   *
   * @param {string} cmd The name of the command.
   * @param {Thread|ThreadGroup} [scope] The thread or thread-group where
   *   the command should be executed. If this parameter is omitted,
   *   it executes in the current thread.
   *
   * @returns {Promise<object, GDBError>} A promise that resolves with
   *   the JSON representation of the result of command execution.
   */
  execCMD (cmd, scope) {
    return this._sync(() => this._execCMD(cmd, scope))
  }

  /**
   * Execute a MI command.
   *
   * @param {string} cmd The MI command.
   * @param {Thread|ThreadGroup} [scope] The thread or thread-group where
   *   the command should be executed. If this parameter is omitted,
   *   it executes in the current thread.
   *
   * @returns {Promise<object, GDBError>} A promise that resolves with
   *   the JSON representation of the result of command execution.
   */
  execMI (cmd, scope) {
    return this._sync(() => this._execMI(cmd, scope))
  }

  // Private methods
  // Note that it's necessary to not call public methods and {@link GDB#_sync}
  // method in these methods since it may cause blocking.

  /**
   * Internal method for setting values. See {@link GDB#set}.
   *
   * @ignore
   */
  async _set (param, value) {
    await this._execMI(`-gdb-set ${param} ${value}`)
  }

  /**
   * Internal method for getting the current thread. See {@link GDB#currentThread}.
   *
   * @ignore
   */
  async _currentThread () {
    let { id, group } = await this._execCMD('thread')
    return id ? new Thread(id, { group }) : null
  }

  /**
   * Internal method for getting the current thread group. See {@link GDB#currentThreadGroup}.
   *
   * @ignore
   */
  async _currentThreadGroup () {
    let { id, pid } = await this._execCMD('group')
    return new ThreadGroup(id, { pid })
  }

  /**
   * Internal method for selecting the thread groups. See {@link GDB#selectThread}.
   *
   * @ignore
   */
  async _selectThread (thread) {
    await this._execMI('-thread-select ' + thread.id)
  }

  /**
   * Internal method for selecting the thread group. See {@link GDB#selectThreadGroup}.
   *
   * @ignore
   */
  async _selectThreadGroup (group) {
    await this._execCMD('exec inferior ' + group.id)
  }

  /**
   * Internal method for getting thread groups. See {@link GDB#threadGroups}.
   *
   * @ignore
   */
  async _threadGroups () {
    let { groups } = await this._execMI('-list-thread-groups')
    return groups.map((g) => new ThreadGroup(toInt(g.id.slice(1)), {
      pid: toInt(g.pid),
      executable: g.executable
    }))
  }

  /**
   * Helps to restore the current thread between operations and avoid side effect.
   *
   * @param {Task} [task] The task to execute.
   *
   * @returns {Promise<any, GDBError>} A promise that resolves with task results.
   *
   * @ignore
   */
  async _preserveThread (task) {
    let thread = await this._currentThread()
    let res = await task()
    if (thread) await this._selectThread(thread)
    return res
  }

  /**
   * Internal method for calling defined Python commands. See {@link GDB#execCMD}.
   *
   * @ignore
   */
  _execCMD (cmd, scope) {
    if (scope instanceof Thread) {
      return this._preserveThread(() =>
        this._selectThread(scope).then(() => this._exec(cmd, 'cli')))
    } else if (scope instanceof ThreadGroup) {
      return this._preserveThread(() =>
        this._selectThreadGroup(scope).then(() => this._exec(cmd, 'cli')))
    } else {
      return this._exec(cmd, 'cli')
    }
  }

  /**
   * Internal method for calling MI commands. See {@link GDB#execMI}.
   *
   * @ignore
   */
  _execMI (cmd, scope) {
    let [, name, options] = /([^ ]+)( .*|)/.exec(cmd)

    if (scope instanceof Thread) {
      return this._exec(`${name} --thread ${scope.id} ${options}`, 'mi')
    } else if (scope instanceof ThreadGroup) {
      // `--thread-group` option changes thread.
      return this._preserveThread(() =>
        this._exec(`${name} --thread-group i${scope.id} ${options}`, 'mi'))
    } else {
      return this._exec(cmd, 'mi')
    }
  }

  /**
   * Internal method that executes a MI command and add it to the queue where it
   * waits for the results of execution.
   *
   * @param {string} cmd The command (eaither a MI or a defined Python command).
   * @param {string} interpreter The interpreter that should execute the command.
   *
   * @returns {Promise<object, GDBError>} A promise that resolves with
   *   the JSON representation of the result of command execution.
   *
   * @ignore
   */
  _exec (cmd, interpreter) {
    if (interpreter === 'mi') {
      debugMIInput(cmd)
    } else {
      debugCLIInput(`gdbjs-${cmd}`)
      cmd = `-interpreter-exec console "gdbjs-${cmd}"`
    }

    this._process.stdin.write(cmd + '\n', { binary: true })

    return new Promise((resolve, reject) => {
      this._queue.write({ cmd, interpreter, resolve, reject })
    })
  }

  /**
   * This routine makes it impossible to run multiple punlic methods
   * simultaneously. Why this matter? It's really important for public
   * methods to not interfere with each other, because they can change
   * the state of GDB during execution. They should be atomic,
   * meaning that calling them simultaneously should produce the same
   * results as calling them in order. One way to ensure that is to block
   * execution of public methods until other methods complete.
   *
   * @param {Task} task The task to execute.
   *
   * @returns {Promise<any, GDBError>} A promise that resolves with task results.
   *
   * @ignore
   */
  _sync (task) {
    this._lock = this._lock.then(task, task)
    return this._lock
  }
}

export { GDB, Thread, ThreadGroup, Breakpoint,
  Frame, Variable, parseMI as _parseMI }
