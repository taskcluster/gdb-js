{
  function makeResults (arr) {
    return arr.reduce((prev, r) => (prev[r.variable] = r.value, prev), {})
  }
}

Line
  = AsyncRecord / StreamRecord / ResultRecord / "(gdb) "
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
  = "~" data:String { return { type: 'console', data } }

TargetStreamOutput
  = "@" data:String { return { type: 'target', data } }

LogStreamOutput
  = "&" data:String { return { type: 'log', data } }

AsyncOutput
  = state:AsyncClass results:ResultsList {
      return { state, data: makeResults(results) }
    }

ResultsList
  = ("," result:Result { return result })*

ValuesList
  = ("," v:Value { return v })*

Result
  = variable:String "=" value:Value { return { variable, value } }

Value
  = Const / Tuple / List

Tuple
  = "{}" { return {}; } / "{" result:Result results:ResultsList "}" {
      return makeResults([result, ...results])
    }

List
  = "[]" / "[" value:Value values:ValuesList "]" { return [value, ...values] }
  / "[" result:Result results:ResultsList "]" { return makeResults([result, ...results]) }

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
  = ("\"" / "\\") / ("b" / "f" / "n" / "r" / "t") { return '\\' + text() }

String "string"
  = [a-z-]+ { return text() }

Token "token"
  = [0-9]+ { return parseInt(text(), 10) }
