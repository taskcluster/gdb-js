/* eslint-disable no-undef */

import { expect } from 'chai'
import { Readable, Writable } from 'stream'
import GDB from '../lib'

describe('state consistency', () => {
  let stdout
  let stderr
  let stdin
  let debug

  function emulate (stream) {
    for (let chunk of stream) {
      switch (chunk) {
        case 'stdin':
          stdin.write(chunk)
          break
        case 'stdout':
          stdout.push(chunk)
          break
        case 'stderr':
          stderr.push(chunk)
          break
        default:
          throw new Error('Unsupported stream type')
      }
    }
  }

  beforeEach(() => {
    stdout = new Readable()
    stderr = new Readable()
    stdin = new Writable()
    debug = new GDB({ stdin, stdout, stderr })
  })

  describe('frame state (i.e. file and line of code)', () => {
    it('saves frame', () => {
      let stream = require('./data/frame-state-01')
      emulate(stream)
      expect(debug.frame).to.deep.equal({
        file: 'hello.c',
        line: '6'
      })
    })

    it('saves frame', () => {
      let stream = require('./data/frame-state-02')
      emulate(stream)
      expect(debug.frame).to.deep.equal({
        file: 'guess.c',
        line: '6'
      })
    })
  })
})
