/* eslint-env mocha */

import { expect } from 'chai'
import { PassThrough } from 'stream'
import Docker from 'dockerode-promise'
import { GDB, Thread, ThreadGroup, Breakpoint,
  Frame, _parseMI as parseMI } from '../lib'

let docker = new Docker({ socketPath: '/var/run/docker.sock' })
let container = docker.getContainer('gdb-js')

/**
 * Create a GDB wrapper instance for the specified example.
 *
 * @param {string} example Name of the folder with example in the Docker container.
 *
 * @returns {GDB} GDB wrapper instance.
 */
async function createGDB (example) {
  let exec = await container.exec({
    // Working directory is necessary for multi-process examples!
    Cmd: ['gdb', '-i=mi', '--tty=/dev/null', '--cd=/examples/' + example, 'main'],
    AttachStdout: true,
    AttachSterr: true,
    AttachStdin: true,
    Tty: false
  })

  let stream = await exec.start({
    stream: true,
    stdin: true,
    stdout: true,
    stderr: true
  })

  let stdout = new PassThrough()
  let stderr = new PassThrough()
  container.modem.demuxStream(stream, stdout, stderr)

  return new GDB({ stdin: stream, stdout, stderr })
}

describe('gdb-js', () => {
  describe('raw commands', () => {
    it('executes mi commands and return results', async () => {
      let gdb = await createGDB('hello-world')
      let { features } = await gdb.execMI('-list-features')
      await gdb.exit()

      expect(features).to.include('python')
    })

    it('executes cli commands and returns results', async () => {
      let gdb = await createGDB('hello-world')
      await gdb.init()
      let res = await gdb.execCLI('echo Hello World!')
      await gdb.exit()

      expect(res).to.equal('Hello World!')
    })

    it('executes custom python code and returns results', async () => {
      let gdb = await createGDB('hello-world')
      await gdb.init()
      let res = await gdb.execPy('print("Hello\\nWorld!")')
      await gdb.exit()

      expect(res).to.equal('Hello\nWorld!\n')
    })
  })

  describe('raw data', () => {
    it('has streams of raw stream records', async (done) => {
      let gdb = await createGDB('hello-world')
      gdb.consoleStream.once('data', (data) => {
        try {
          expect(data).to.equal('GNU gdb (GDB) 7.12.1\n')
          done()
        } catch (e) { done(e) }
      })
      await gdb.run()
      await gdb.exit()
    })

    it('doesn\'n contain internal messages in console output', async (done) => {
      let gdb = await createGDB('hello-world')
      gdb.consoleStream.on('data', (data) => {
        try {
          expect(data).to.not.match(/<gdbjs:.*?:gdbjs>/)
        } catch (e) { done(e) }
      })
      await gdb.init()
      await gdb.run()
      await gdb.execCLI('echo Hi!')
      await gdb.exit()
      done()
    })

    it('emits raw async records', async (done) => {
      let gdb = await createGDB('hello-world')
      let bpModified = false
      gdb.on('notify', (msg) => {
        if (bpModified) return
        if (msg.state === 'breakpoint-modified') {
          bpModified = true
          try {
            expect(msg.data.bkpt.func).to.equal('main')
            done()
          } catch (e) { done(e) }
        }
      })
      await gdb.addBreak('hello.c', 'main')
      await gdb.run()
      await gdb.exit()
    })
  })

  describe('breakpoints', () => {
    it('inserts a breakpoint', async (done) => {
      let gdb = await createGDB('hello-world')
      let bp = await gdb.addBreak('hello.c', 'main')
      gdb.once('stopped', (data) => {
        try {
          expect(data.breakpoint.id).to.equal(bp.id)
          done()
        } catch (e) { done(e) }
      })
      await gdb.run()
      await gdb.exit()
    })

    it('removes a breakpoint', async () => {
      let gdb = await createGDB('hello-world')
      let bp = await gdb.addBreak('hello.c', 'main')
      await gdb.removeBreak(bp)
      await gdb.exit()
    })

    it('supports templates and auto types', async () => {
      let gdb = await createGDB('templates')
      let bp = await gdb.addBreak('templates.cpp', 8)
      expect(bp.func).to.deep.equal([
        'max<char>(char const*, int)',
        'max<int>(int const*, int)'
      ])
      await gdb.exit()
    })
  })

  describe('stack info', () => {
    it('returns callstack', async () => {
      let gdb = await createGDB('factorial')
      await gdb.addBreak('factorial.c', 'factorial')
      await gdb.run()
      let res = await gdb.callstack()
      await gdb.exit()

      expect(res).to.deep.equal([
        new Frame({ level: 0, func: 'factorial', file: '/examples/factorial/factorial.c', line: 23 }),
        new Frame({ level: 1, func: 'main', file: '/examples/factorial/factorial.c', line: 17 })
      ])
    })

    it('returns variables in the current context', async () => {
      let gdb = await createGDB('factorial')
      await gdb.init()
      await gdb.addBreak('factorial.c', 'main')
      await gdb.run()
      let context = await gdb.context()
      let func = context.find((v) => v.name === 'factorial_tail_call')
      await gdb.exit()

      expect(context).to.have.lengthOf(6)
      expect(context).to.deep.include({
        value: '0', name: 'num', scope: 'local', type: 'int'
      })
      expect(func).to.have.property('type', 'long int (int, int)')
    })
  })

  describe('source files', () => {
    it('returns list of source files', async () => {
      let gdb = await createGDB('factorial')
      await gdb.init()
      let res = await gdb.sourceFiles()
      await gdb.exit()

      expect(res).to.include.members(['/examples/factorial/factorial.c'])
    })

    it('searches for source files using regex', async () => {
      let gdb = await createGDB('hello-world')
      await gdb.init()
      let res = await gdb.sourceFiles({ pattern: 'hello.c$' })
      await gdb.exit()

      expect(res).to.include.members(['/examples/hello-world/hello.c'])
    })

    it('returns source files for all thread groups', async () => {
      let gdb = await createGDB('counters')
      await gdb.init()
      await gdb.enableAsync()
      await gdb.attachOnFork()
      let newObjfile = new Promise((resolve, reject) => {
        gdb.on('new-objfile', (data) => {
          if (data === '/examples/counters/counter') resolve()
        })
      })
      await gdb.run()
      await newObjfile
      let res = await gdb.sourceFiles({ pattern: '^/examples' })
      await gdb.exit()

      expect(res).to.include.members([
        '/examples/counters/main.c',
        '/examples/counters/counter.c'
      ])
    })

    it('returns source files for the specified group', async () => {
      let gdb = await createGDB('hello-world')
      await gdb.init()
      await gdb.enableAsync()
      await gdb.execCLI('add-inferior')
      let group = new ThreadGroup(2)
      await gdb.selectThreadGroup(group)
      await gdb.execCLI('file ../factorial/main')
      let res = await gdb.sourceFiles({ group })
      await gdb.exit()

      expect(res).to.include.members(['/examples/factorial/factorial.c'])
    })
  })

  describe('async interaction', () => {
    it('doesn\'t block on sigttin', async () => {
      let gdb = await createGDB('guess-game')
      await gdb.init()
      await gdb.enableAsync()
      // Program now waits for the input.
      await gdb.run()
      // However, we can still interact with GDB.
      await gdb.exit()
    })

    it('can interrupt a specific thread', async (done) => {
      let gdb = await createGDB('tickets')
      await gdb.init()
      await gdb.enableAsync()
      await gdb.run()
      let threads = await gdb.threads()
      gdb.once('stopped', (data) => {
        try {
          expect(data.thread.id).to.equal(threads[0].id)
          gdb.exit().then(() => done())
        } catch (e) { done(e) }
      })
      await gdb.interrupt(threads[0])
    })
  })

  describe('multithreading', () => {
    it('returns info about specific thread', async () => {
      let gdb = await createGDB('hello-world')
      await gdb.addBreak('hello.c', 'main')
      await gdb.run()
      let thread = await gdb.threads(new Thread(1))
      await gdb.exit()

      expect(thread.status).to.equal('stopped')
    })

    it('returns info about all threads', async () => {
      let gdb = await createGDB('factorial')
      await gdb.addBreak('factorial.c', 'factorial')
      let stopped = new Promise((resolve, reject) => {
        gdb.once('stopped', resolve)
      })
      await gdb.run()
      await stopped
      let res = await gdb.threads()
      await gdb.exit()

      expect(res).to.have.lengthOf(1)
      expect(res[0]).to.deep.equal({
        id: 1,
        status: 'stopped',
        group: null,
        frame: { file: '/examples/factorial/factorial.c', func: undefined, line: 23, level: 0 }
      })
    })

    it('can execute commands in the thread scope', async () => {
      let gdb = await createGDB('tickets')
      await gdb.init()
      await gdb.enableAsync()
      await gdb.addBreak('tickets.c', 47)
      let stopped = new Promise((resolve, reject) => {
        gdb.once('stopped', resolve)
      })
      await gdb.run()
      await stopped
      await gdb.interrupt()
      let res = await gdb.execMI('-thread-list-ids', new Thread(2))
      await gdb.exit()

      expect(res['current-thread-id']).to.equal('2')
    })

    it('can change thread scope', async () => {
      let gdb = await createGDB('tickets')
      await gdb.init()
      await gdb.addBreak('tickets.c', 48)
      await gdb.run()
      let threads = await gdb.threads()
      await gdb.selectThread(threads[0])
      let thread = await gdb.currentThread()
      await gdb.exit()

      expect(thread.id).to.equal(threads[0].id)
    })
  })

  describe('multiple process support', () => {
    it('can attach a running target', async () => {
      let game = await container.exec({
        Cmd: ['./guess-game/main'],
        AttachStdin: true
      })
      await game.start({ stdin: true })
      let gdb = await createGDB('hello-world')
      await gdb.init()
      let { groups } = await gdb.execMI('-list-thread-groups --available')
      let ps = groups.find((g) => g.description.match(/guess-game\/main/))
      await gdb.attach(ps.id)
      await gdb.exit()
    })

    it('can detach a thread group', async () => {
      let gdb = await createGDB('hello-world')
      await gdb.init()
      await gdb.addBreak('hello.c', 'main')
      await gdb.run()
      let group = await gdb.currentThreadGroup()
      await gdb.execCLI('add-inferior')
      await gdb.execCLI('inferior 2')
      await gdb.detach(group)
      await gdb.exit()
    })

    it('can execute commands in the thread group scope', async() => {
      let gdb = await createGDB('hello-world')
      await gdb.init()
      await gdb.execCLI('add-inferior')
      let group = new ThreadGroup(2)
      await gdb.selectThreadGroup(group)
      let { files } = await gdb.execMI('-file-list-exec-source-files',
        new ThreadGroup(1))
      await gdb.exit()

      expect(files[0]).to.have.property('file', 'hello.c')
    })

    it('can change thread-group scope', async () => {
      let gdb = await createGDB('hello-world')
      await gdb.init()
      await gdb.execCLI('add-inferior')
      let groups = await gdb.threadGroups()
      await gdb.selectThreadGroup(groups[1])
      let group = await gdb.currentThreadGroup()
      await gdb.exit()

      expect(group.id).to.equal(groups[1].id)
    })
  })

  describe('events', () => {
    it('fires stopped event', async (done) => {
      let gdb = await createGDB('hello-world')
      gdb.once('stopped', (data) => {
        try {
          expect(data.reason).to.equal('exited-normally')
          gdb.exit().then(() => done())
        } catch (e) { done(e) }
      })
      await gdb.run()
    })

    it('adds additional info to the stopped event', async (done) => {
      let gdb = await createGDB('hello-world')
      await gdb.addBreak('hello.c', 'main')
      gdb.once('stopped', (data) => {
        try {
          expect(data).to.deep.equal({
            reason: 'breakpoint-hit',
            thread: new Thread(1, {
              id: 1,
              frame: new Frame({
                file: '/examples/hello-world/hello.c',
                line: 9
              }),
              status: 'stopped'
            }),
            breakpoint: new Breakpoint(1)
          })
          gdb.exit().then(() => done())
        } catch (e) { done(e) }
      })
      await gdb.run()
    })

    it('fires running event', async (done) => {
      let gdb = await createGDB('tickets')
      await gdb.init()
      await gdb.enableAsync()
      await gdb.addBreak('tickets.c', 31)
      gdb.once('stopped', (data) => {
        gdb.interrupt().then(async () => {
          let threads = await gdb.threads()
          gdb.once('running', (data) => {
            try {
              expect(data.thread.id).to.equal(threads[0].id)
              gdb.exit().then(() => done())
            } catch (e) { done(e) }
          })
          await gdb.proceed(threads[0])
        }, done)
      })
      await gdb.run()
    })

    it('fires thread-created and thread-exited events', async (done) => {
      let gdb = await createGDB('hello-world')
      gdb.once('thread-created', (thread0) => {
        gdb.once('thread-exited', (thread1) => {
          try {
            expect(thread0).to.deep.equal(thread1)
            gdb.exit().then(() => done())
          } catch (e) { done(e) }
        })
      })
      await gdb.run()
    })

    it('fires thread-group-started and thread-group-exited events', async (done) => {
      let gdb = await createGDB('hello-world')
      gdb.once('thread-group-started', (group0) => {
        gdb.once('thread-group-exited', (group1) => {
          try {
            expect(group0.id).to.equal(group1.id)
            gdb.exit().then(() => done())
          } catch (e) { done(e) }
        })
      })
      await gdb.run()
    })

    it('fires new-objfile event', async (done) => {
      let gdb = await createGDB('hello-world')
      gdb.once('new-objfile', (file) => {
        try {
          expect(file).to.equal('/examples/hello-world/main')
          gdb.exit().then(() => done())
        } catch (e) { done(e) }
      })
      await gdb.init()
      await gdb.execCLI('file ./main')
    })
  })

  describe('miscellaneous', () => {
    it('can exit gdb', async () => {
      let gdb = await createGDB('hello-world')
      await gdb.exit()
    })

    it('evaluates the expression', async () => {
      let gdb = await createGDB('hello-world')
      let res = await gdb.evaluate('0xdeadbeef')
      await gdb.exit()

      expect(res).to.equal('3735928559')
    })

    it('has atomic methods', async () => {
      let gdb = await createGDB('hello-world')
      let queue = []
      await Promise.all([
        gdb.init().then(() => queue.push(0)),
        gdb.sourceFiles().then(() => queue.push(1)),
        gdb.sourceFiles().then(() => queue.push(2)),
        gdb.execCLI('echo Hi!').then(() => queue.push(3)),
        gdb.exit().then(() => queue.push(4))
      ])

      expect(queue).to.deep.equal([0, 1, 2, 3, 4])
    })

    // XXX: Somehow when executed within a Docker container,
    // the exact same version of GDB MI sometimes prints
    // unicode special characters not as regular octal escapes
    // (e.g. \303\244), but as escaped octal escapes (i.e. \\303\\244)!
    // These extraneous backslashes make this test to fail,
    // so it is disabled. However, it works in the real environment.
    // Why does GDB MI behave differently in Docker?
    // No idea. However, maybe Docker is not the real reason.
    xit('supports unicode special characters', async () => {
      let gdb = await createGDB('encodings')
      await gdb.init()
      await gdb.addBreak('encodings.c', 9)
      let stopped = new Promise((resolve, reject) => {
        gdb.once('stopped', resolve)
      })
      await gdb.run()
      await stopped
      let localsMI = gdb.execMI('-stack-list-variables 1')
      let localsCLI = gdb.execCLI('info locals')
      let context = await gdb.context()
      await gdb.exit()

      expect(localsMI.data.variables[0].value).to.contain('"äÃ¤𩸽"')
      expect(localsCLI.data).to.contain('"äÃ¤𩸽"')
      expect(context[0].value).to.contain('"äÃ¤𩸽"')
    })
  })

  describe('parser', () => {
    it('handles anonymous records', () => {
      let record = '+download,{section=".isr_vector",section-size="776"}'

      expect(parseMI(record)).to.deep.equal({
        type: 'status',
        state: 'download',
        data: {
          unnamed: {
            section: '.isr_vector',
            'section-size': '776'
          }
        }
      })
    })

    it('handles underscores in names', () => {
      let record = '^done,name="v1",numchild="0",value="1",type="int",thread-id="1",has_more="0"'

      expect(parseMI(record)).to.have.deep.property('data.has_more', '0')
    })
  })
})
