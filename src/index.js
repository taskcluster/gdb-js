import { EventEmitter } from 'events'
import _ from 'highland'
import deepEqual from 'deep-equal'
import { parse } from './parser'

// Exposed events:
// update, update:breakpoints, update:watch, update:locals,
// update:globals, update:frame, update:callstack

export default class GDB extends EventEmitter {
  constructor (childProcess) {
    super()

    this.breakpoints = []
    this.locals = []
    this.globals = []
    this.callstack = []
    this.frame = {}

    this._process = childProcess
    this._queue = _()

    let stream = _(this._process.stdout)
      .map((chunk) => chunk.toString())
      .splitBy('\n')
      .map(parse)

    stream.fork()
      .filter((msg) => msg.type === 'result')
      .zip(this._queue)
      .each((msg) => this._resultHandler(...msg))

    stream.fork()
      .filter((msg) => ['exec'].includes(msg.type))
      .each((msg) => this[`_${msg.type}Handler`](msg))
  }

  async break (func) {
    // TODO: support other options;
    try {
      let result = await this._raw('-break-insert ' + func)
      this._update('breakpoints', { /* some obj that represents a bp */ })
      return result
    } catch (e) {
      throw new Error('Error while inserting a breakpoint', e)
    }
  }

  async stepIn () {
    throw new Error('Not implemented')
  }

  async stepOut () {
    throw new Error('Not implemented')
  }

  async next () {
    throw new Error('Not implemented')
  }

  async run () {
    try {
      await this._raw('-exec-run')
    } catch (e) {
      throw new Error('Error while running a program', e)
    }
  }

  async continue () {
    throw new Error('Not implemented')
  }

  _execHandler ({ state, data }) {
    if (data.frame) {
      let { line, fullname: file } = data.frame
      this._update('frame', { line, file })
    }
  }

  _resultHandler (res, req) {
    res.state !== 'error' ? req.resolve(res) : req.reject(res)
  }

  _update (domain, data) {
    if (!deepEqual(this[domain], data)) {
      this[domain] = data
      this.emit('update:' + domain)
      this.emit('update')
    }
  }

  _raw (cmd) {
    this._process.stdin.write(cmd + '\n', { binary: true })
    return new Promise((resolve, reject) => {
      this._queue.write({ cmd, resolve, reject })
    })
  }
}
