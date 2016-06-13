Output
  = "All defined " [a-z]* ":\n" files:("\n" file:File { return file })* (.*) {
    return files.reduce((prev, next) => prev.concat(next))
  }

File
  = "File " name:[^\n]* "\n" vars:(type:String " " name:String ";\n" { return { type, name } })+ {
    return vars.map((v) => {
        v.file = name.slice(0, -1).join('')
        return v
      })
  }

String
  = [a-zA-Z0-9_]* { return text() }
