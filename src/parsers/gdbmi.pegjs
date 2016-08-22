{
  function makeResults (arr) {
    // XXX: sometimes GDB/MI results don't have name (e.g.
    // `=breakpoint-modified` when `addr` property is `<MULTIPLE>`).
    // Below code helps to turn such records into the array.

    for (let i = 0; i < arr.length; i++) {
      if (!arr[i].name) arr[i].name = arr[i - 1].name
    }

    let res = arr.reduce((acc, r) => {
      if (!acc[r.name]) acc[r.name] = []
      acc[r.name].push(r.value)
      return acc
    }, {})

    for (let name in res) {
      if (res[name].length === 1) res[name] = res[name][0]
    }

    return res
  }
}

Line
  = AsyncRecord / StreamRecord / ResultRecord
  / "(gdb) " { return { type: 'prompt' } }
  / (.*) { return { type: 'target', data: text() } }

AsyncRecord
  = ExecAsyncOutput / StatusAsyncOutput / NotifyAsyncOutput

StreamRecord
  = ConsoleStreamOutput / TargetStreamOutput / LogStreamOutput

ResultRecord
  = Token? "^" state:ResultClass results:ResultsList {
      return { type: 'result', state, data: makeResults(results) }
    }

ExecAsyncOutput
  = Token? "*" obj:AsyncOutput {
      return { type: 'exec', state: obj.state, data: obj.data }
    }

StatusAsyncOutput
  = Token? "+" obj:AsyncOutput {
      return { type: 'status', state: obj.state, data: obj.data }
    }

NotifyAsyncOutput
  = Token? "=" obj:AsyncOutput {
      return { type: 'notify', state: obj.state, data: obj.data }
    }

ConsoleStreamOutput
  = "~" data:Const { return { type: 'console', data } }

TargetStreamOutput
  = "@" data:Const { return { type: 'target', data } }

LogStreamOutput
  = "&" data:Const { return { type: 'log', data } }

AsyncOutput
  = state:AsyncClass results:ResultsList {
      return { state, data: makeResults(results) }
    }

ResultsList
  = ("," result:Result { return result })*

ValuesList
  = ("," value:Value { return value })*

Result
  = name:String ? ("=" / "") value:Value { return { name, value } }

Value
  = Const / Tuple / List

Tuple
  = "{}" { return {}; } / "{" result:Result results:ResultsList "}" {
      return makeResults([result, ...results])
    }

List
  = "[]" { return []; } / "[" value:Value values:ValuesList "]" { return [value, ...values] }
  / "[" result:Result results:ResultsList "]" { return [result, ...results] }

ResultClass
  = "done" / "running" / "connected" / "error" / "exit"

AsyncClass
  = "stopped" / String

Const "c-string"
  = "\"" chars:Char* "\"" { return chars.join('') }

Char "char"
  = [\x20-\x21\x23-\x5B\x5D-\u10FFFF]
  / "\\" seq:Escaped { return seq }

Escaped "escaped"
  = ("\"" / "\\")
  / "b" { return '\b' }
  / "f" { return '\f' }
  / "n" { return '\n' }
  / "r" { return '\r' }
  / "t" { return '\t' }

String "string"
  = [a-z-]+ { return text() }

Token "token"
  = [0-9]+ { return parseInt(text(), 10) }
