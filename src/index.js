import { EventEmitter } from 'events'

// Exposed events:
// update, update:breakpoints, update:watch, update:locals,
// update:globals, update:frame, update:callstack

export default class GDB extends EventEmitter {
  constructor (options) {
    super()

    this.options = Object.assign(options, {
      // defaults
    })

    this.stdin = options.stdin
    this.stdout = options.stdout
    this.stderr = options.stderr
    this.breakpoints = []
    this.locals = []
    this.globals = []
    this.callstack = []
    this.frame = {}
  }

  async break () {
    throw new Error('Not implemented')
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
    throw new Error('Not implemented')
  }

  async continue () {
    throw new Error('Not implemented')
  }
}
