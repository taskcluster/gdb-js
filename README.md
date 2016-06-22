# gdb-js [![Build Status](https://travis-ci.org/baygeldin/gdb-js.svg?branch=master)](https://travis-ci.org/baygeldin/gdb-js)

Seamless GDB wrapper for Node.js (>= 0.12) and browser.  
It can be used to build different kinds of frontends for GDB.

## Documentation
[Documentation is availabe here](https://baygeldin.github.io/gdb-js).  
Reading the sources of tests is also useful.

## Features
* Support of multithreaded targets.
* All methods return Promises.
* All MI & CLI commands are supported.
* Support of custom Python scripts execution.
* Support of multiple targets.

## Considerations
* GDB >= 7.3 is required.
* GDB should support Python.
* Although it's possible to use **gdb-js** in `all-stop` mode of GDB, it makes much more sense for a frontend to work within `non-stop` mode (together with `target-async`). So, it's recommended that `enableAsync` method should be called.
* Execution of all CLI commands is possible only after calling `init` method which defines some custom supportive commands in GDB. However, you can load them (`scripts` folder in this repository) manually with `.gdbinit` for example.
* **gdb-js** is a seamless wrapper. It means that it doesn't have any assumptions about your goals and doesn't do anything behind the scenes. So, if something is going wrong it's probably a problem with your GDB usage (i.e. the same problem can be reproduced within a bare console). Also, the results of any method is just a JSON representation of GDB/MI output or a string (if it's a CLI command). Any event has a one-to-one correspondance to GDB/MI events.
* It's currently not posible to distingish target output and GDB output correctly. Thus, it's recommended to use `--tty` option with your GDB.
* For browsers it makes sense to make use of utilities that expose process streams (i.e. stdin/stdout/stderr) through WebSockets.
* All methods (where it makes sense) accepts thread id as the last parameter. So, you can step/continue/interrupt/inspect any thread you want.
* If you're debugging a target that spawns new processes with `fork`, just call `attachOnFork` method and you're done. If not and you still need to debug multiple targets you should attach them manually (see [the official GDB documentation](https://sourceware.org/gdb/onlinedocs/gdb/Forks.html)).

## Install
```
$ npm install gdb-js
```
:warning: Note, that **gdb-js** is still under development. Use to your own risk.

## Examples
General example:
```javascript
import GDB from 'gdb-js'

// Get the `gdb_process` somehow.
let gdb = new GDB(gdb_process)

gdb.on('stopped', (data) => {
  if (data.reason === 'breakpoint-hit') {
    console.log(data.func + 'bar') // foobar
  }
})

(function async () {
  await gdb.break('main.c', 'foo')
  await gdb.run()
})()
```
Multithreading:
```javascript
await gdb.init()
await gdb.enableAsync()
await gdb.run()
// stop all the threads
await gdb.interrupt()
// get info about threads
let threads = await gdb.threads()
// continue execution of the first thread
await gdb.continue(threads[1])
```
Multiple targets:
```javascript
// Get all available thread groups (i.e. processes)
let processes = await gdb.threadGroups(true)
let bash = processes.find((p) => p.description === 'bash')
// bash.id is just a pid, it can be any other pid
await gdb.attach(bash.id)
```

## Running tests
```
$ npm install
$ docker pull baygeldin/gdb-examples
$ npm test
```
