import { EventEmitter } from 'events'
import _ from 'highland'
import { parse } from './parser'

export default class GDB extends EventEmitter {
  constructor (childProcess) {
    super()

    this._process = childProcess
    this._queue = _()

    let cliOutput = []

    let stream = _(this._process.stdout)
      .map((chunk) => chunk.toString())
      .splitBy('\n')
      .map(parse)

    stream.fork()
      .filter((msg) => msg.type === 'result')
      .zip(this._queue)
      .each((msg) => {
        let { state, data } = msg[0]
        let { cmd, resolve, reject, cli } = msg[1]
        if (state === 'error') {
          let msg = `Error while executing "${cmd}". ${data.msg}`
          let err = new Error(msg)
          err.code = data.code
          err.cmd = cmd
          reject(err)
        } else {
          resolve(cli ? cliOutput.reduce((prev, next) => prev + next) : data)
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
    let res = await this.exec(`-break-insert ${file}:${pos}`)
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
    await this.exec('-exec-next')
  }

  async run () {
    await this.exec('-exec-run')
  }

  async continue () {
    await this.exec('-exec-continue')
  }

  async locals () {
    let res = await this.exec('-stack-list-variables 1')
    return res.variables
  }

  async globals () {
    if (!this._globals) {
      let res = await this.exec('info variables', 'cli')

      // Monkey parsing :)
      this._globals = res
        .slice(0, res.indexOf('\\n\\nNon-debugging'))
        .split('\\n')
        .filter((str) => str.slice(-1) === ';')
        .map((str) => {
          let arr = str.split(' ')
          return { type: arr[0], name: arr[1].slice(0, -1) }
        })
    }

    let res = []

    for (let v of this._globals) {
      let value = await this.eval(v.name)
      res.push({ value, name: v.name })
    }

    return res
  }

  async callstack () {
    let res = await this.exec('-stack-list-frames')
    return res.stack.map((frame) => frame.value)
  }

  async sourceFiles () {
    let res = await this.exec('-file-list-exec-source-files')
    return res.files
  }

  async eval (expr) {
    let res = await this.exec('-data-evaluate-expression ' + expr)
    return res.value
  }

  async exit () {
    await this.exec('-gdb-exit')
  }

  async exec (cmd, interpreter) {
    if (interpreter === 'cli') {
      let command = `-interpreter-exec console "${cmd}"\n`
      this._process.stdin.write(command, { binary: true })
      return await new Promise((resolve, reject) => {
        this._queue.write({ cmd, resolve, reject, cli: true })
      })
    } else {
      this._process.stdin.write(cmd + '\n', { binary: true })
      return await new Promise((resolve, reject) => {
        this._queue.write({ cmd, resolve, reject })
      })
    }
  }
}
