import { EventEmitter } from 'events'
import streamSplitter from 'stream-splitter'

function splitArgs (str) {
  // split a string by _outermost_ comma
}

function parseMI (args) {
  let result = {}

  for (let arg of args) {
    arg = arg.split(/=(.+)/)
    let data = arg[1].slice(1, -1)

    switch (arg[1][0]) {
      case '{':
        result[arg[0]] = parseMI(splitArgs(data))
        break
      case '[':
        result[arg[0]] = data.split(',') // should it be recursive?
        break
      case '"'
        break
      default:
        result[arg[0]] = arg[1]
    }
  }

  return result
}

// Exposed events:
// update, update:breakpoints, update:watch, update:locals,
// update:globals, update:frame, update:callstack

export default class GDB extends EventEmitter {
  constructor (options) {
    super()

    this.options = Object.assign(options, {
      // defaults
    })

    this.breakpoints = []
    this.locals = []
    this.globals = []
    this.callstack = []
    this.frame = {}

    this.stdin = options.stdin
    this.stdout = options.stdout
    this.stderr = options.stderr

    let processHandler = (data) => {
      this.frame.line = data.args.frame.line
      this.frame.file = data.args.frame.fullname
    }

    const handler = {
     '~': outputHandler,
     '&': commandHandler,
     '*': processHandler,
     '=': eventHandler,
     '^': statusHandler
    }

    this.stdout.pipe(streamSplitter('\n')).on('token', (line) => {
      let type = line[0]
      let buffer = splitArgs(line.slice(1).replace('\\n', ''))
      let data = { value: buffer[0], args: parseMI(buffer.slice(1)) }
      handler[type](data)
    })
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
