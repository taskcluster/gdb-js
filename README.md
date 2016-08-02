# gdb-js [![Build Status](https://travis-ci.org/baygeldin/gdb-js.svg?branch=master)](https://travis-ci.org/baygeldin/gdb-js)

Seamless GDB wrapper for Node.js (>= 0.12) and the browser.  
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
* GDB should be used in MI mode (i.e. `gdb -i=mi`).
* Although it's possible to use **gdb-js** in the `all-stop` mode, it makes much more sense for a frontend to work with the `non-stop` mode (together with `target-async`). So, it's recommended that `enableAsync` method should be called.
* Execution of all CLI commands is possible only after calling `init` method which defines some custom supportive commands in GDB. However, you can load them (`scripts` folder in the project repository) manually with `.gdbinit` for example.
* **gdb-js** is a seamless wrapper. It means that it doesn't have any assumptions about your goals and doesn't do anything behind the scenes. So, if something is going wrong it's probably a problem with your GDB usage (i.e. the same problem can be reproduced within a bare console).
* **gdb-js** has a defined API that should be convinient to use. But if it's not enough for you, it also makes it easy to use low-level stuff. You can execute any GDB/MI command with a `execMI` method and get a parsed JSON representation of the result. You can execute any CLI command of GDB and get a string as a result. You can also listen to events that emit raw records of GDB/MI interface.
* It's currently not posible to distingish target output and GDB output correctly. Thus, it's recommended to use `--tty` option with your GDB.
* For browsers it makes sense to make use of utilities that expose process streams (i.e. stdin/stdout/stderr) through WebSockets.
* All methods (where it makes sense) accept thread as the last parameter. So, you can step/continue/interrupt/inspect any thread you want.
* If you're debugging a target that spawns new processes with `fork`, just call `attachOnFork` method and you're done. If not and you still need to debug multiple targets you should attach them manually (see [the official GDB documentation](https://sourceware.org/gdb/onlinedocs/gdb/Forks.html)).
* **gdb-js** needs `babel-polyfill` to work, or if you're heading to ES6 environment, just `regenerator runtime`.

## Install
```
$ npm install gdb-js
```
:warning: Note, that **gdb-js** is still under development. Use to your own risk.

## Usage
```javascript
import { spawn } from 'child-process'
import GDB from 'gdb-js'

let child = spawn('gdb', ['-i=mi', 'main'])
let gdb = new GDB(child)
```
Note that the argument shouldn't necesserily be a Node.js child process. It can be
any object that has stdin/stdout/stderr streams. 

## Examples
General example:
```javascript
gdb.on('stopped', (data) => {
  if (data.reason === 'breakpoint-hit') {
    console.log(data.breakpoint.id + 'is hit!')
  }
})

await gdb.break('main.c', 'foo')
await gdb.run()
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
$ npm run docker-pull
$ npm test
```
