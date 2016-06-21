import path from 'path'
import fs from 'fs'

// This util is needed for concatenating all python files to a single JSON
// file. It's possible to use `fs` module directly, but it's slower and
// makes it impossible to use this library in the browser.

let res = []

for (let file of fs.readdirSync(process.argv[2])) {
  let name = file.slice(0, -3)
  let src = fs.readFileSync(path.join(process.argv[2], file)).toString()
  res.push({ name, src })
}

fs.writeFileSync(path.join(process.argv[3]), JSON.stringify(res))
