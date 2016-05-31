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

    this.process = childProcess

    _(this.process.stdout)
      .map((chunk) => chunk.toString())
      .splitBy('\n')
      .each((line) => {
        let parsed = parse(line)
        let handler = this['_' + parsed.type + 'Handler']
        if (handler) handler.call(this, parsed.data)
      })
  }

  async break (func) {
    // TODO: support other options; check for success;
    this._raw('-break-insert ' + func)
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
    // TODO: check for success;
    this._raw('-exec-run')
  }

  async continue () {
    throw new Error('Not implemented')
  }

  _execHandler (data) {
    if (data.frame) {
      let { line, fullname: file } = data.frame
      this._update('frame', { line, file })
    }
  }

  _update (domain, data) {
    if (!deepEqual(this[domain], data)) {
      this[domain] = data
      this.emit('update:' + domain)
      this.emit('update')
    }
  }

  _raw (cmd) {
    this.process.stdin.write(cmd + '\n', { binary: true })
  }
}
