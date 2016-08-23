# gdb-js [![Build Status](https://travis-ci.org/taskcluster/gdb-js.svg?branch=master)](https://travis-ci.org/taskcluster/gdb-js)

Seamless GDB wrapper for Node.js (>= 0.12) and the browser.  
It can be used to build different kinds of frontends for GDB.

## Documentation
[Documentation is availabe here](https://taskcluster.github.io/gdb-js).  
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

## Usage
```javascript
import { spawn } from 'child-process'
import { GDB } from 'gdb-js'

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
let { groups } = await gdb.execMI('-list-thread-groups --available')
let bash = groups.find((p) => p.description === 'bash')
// bash.id is just a pid, it can be any other pid
await gdb.attach(bash.id)
```

## Extending
Although **gdb-js** supports all CLI and MI commands, you may be interested in extending its functionality usging GDB's [Python API](https://sourceware.org/gdb/current/onlinedocs/gdb/Python-API.html). It's possible to add new functionality even without forking **gdb-js**. 

### Implementation details
In order to understand how to extend the functionality, it may be useful to know a little about internals of **gdb-js**. It distinguishes MI and CLI commands. For MI commands the logic is pretty straightforward: every result record of GDB/MI [output syntax](https://sourceware.org/gdb/onlinedocs/gdb/GDB_002fMI-Output-Syntax.html) is parsed, turned to JSON and returned as a result of `execMI` method. However, it's not possible to do the same for CLI commands since their output is exposed to console stream. What **gdb-js** does is defining custom CLI commands with Python API that are framed into `<gdbjs:cmd:[command_name] [JSON] [command_name]:cmd:gdbjs>` where `[command_name]` is the command name obviously and `[JSON]` is the valid JSON string. This way we can extract results of such commands and return them as a result of `execCMD` method. One of such commands that **gdb-js** defines is `gdbjs-exec` CLI command that executes whatever you pass to it and prints `<gdbjs:cmd:exec [results] exec:cmd:gdbjs>` where `[results]` is everything that was written to console during the execution of your command (remember that string is a valid JSON). That's how it's possible to get the results of CLI commands with `execCLI` method. `execCLI(cmd)` is essentially `execCMD('exec ' + cmd)`. And `execPy(script)` is just `execCMD('exec python\\n' + escape(script))` (we need to escape quotes and other stuff). Also **gdb-js** uses events from Python API and it writes them to console stream as `<gdbjs:event:[event_name] [JSON] [event_name]:event:gdbjs>` where `[event_name]` is the name of the event and `[JSON]` is the contents of the event. All of these internal **gdb-js** messages are stripped from the `consoleStream` property of this wrapper. It's possible to define your own events and commands and here's how.

### Defining a new command
```python
import gdb


class ThreadIDCommand(BaseCommand):
    """Returns the ID of the thread as assigned by OS."""

    def __init__(self):
        super(ThreadIDCommand, self).__init__("thread-id")

    def action(self, arg, from_tty):
        thread = gdb.selected_thread()
        (pid, lwpid, tid) = thread.ptid
        return { "pid": pid, "lwpid": lwpid, "tid": tid }

threadIDCommand = ThreadIDCommand()
```

```javascript
let script = fs.readFileSync('thread-id.py', { encoding: 'utf8' })

await gdb.execPy(script)

let { pid, lwpid, tid } = await gdb.execCMD('thread-id')
```

It's even possible to use defined commands in other defined commands.

```python
class JustPIDCommand(BaseCommand):
    """Returns just the PID of the thread."""

    def __init__(self):
        super(JustPIDCommand, self).__init__("thread-pid")

    def action(self, arg, from_tty):
        thread = threadIDCommand.action()
        return thread.pid

justPIDCommand = JustPIDCommand()
```

### Defining a new CLI command
If you want, you can use the bare Python API to define new CLI commands.

```python
import gdb
import sys


class GreetCommand(gdb.Command):
    """My shiny CLI command."""

    def __init__(self, name):
        super(BaseCommand, self).__init__("greet" + name, gdb.COMMAND_USER)

    def invoke(self, arg, from_tty):
        sys.stdout.write("Hello {}!".format(arg))
        sys.stdout.flush()

GreetCommand()
```

```javascript
let script = fs.readFileSync('greet.py', { encoding: 'utf8' })

await gdb.execPy(script)

let greetings = await gdb.execCLI('greet World') // 'Hello World!'
```

### Defining a new event
```python
from threading import Timer


def hour_passed_handler(arg_1, arg_2)
    """Handle the time."""
    
    base_event_handler("hour-passed", "{} {}, pal...".format(arg_1, arg_2))

Timer(3600.0, hour_passed_handler, ("That's", "sad")).start()
```

```javascript
let script = fs.readFileSync('hour.py', { encoding: 'utf8' })

await gdb.execPy(script)

gdb.on('hour-passed', (data) => console.log(data)) // 'That's sad, pal...''
```

## Running tests
```
$ npm install
$ npm run docker-pull
$ npm test
```
Tests require Docker to be installed.

## Generating documentation
```
$ npm run docs
```
It will generate static pages in the `/docs` folder. It's also convinient to have the repository cloned into `/docs` folder with the `gh-pages` branch checked out. This way deploying the documentation is really easy:
```
$ npm run docs
$ cd docs
$ git commit -a -m "update"
$ git push
```
