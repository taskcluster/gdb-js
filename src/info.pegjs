Output
  = "All defined " [a-z]* ":\n" files:("\n" file:File { return file })* (.*) {
    return files.reduce((prev, next) => prev.concat(next))
  }

File
  = "File " name:[^\n]* "\n" vars:(type:String " " name:String ";\n" { return { type, name } })+ {
    let filename = name.slice(0, -1).join('')
    return vars.map((v) => {
        v.file = filename
        return v
      })
  }

String
  = [a-zA-Z0-9_]* { return text() }
