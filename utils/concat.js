import path from 'path'
import fs from 'fs'

let res = []

for (let file of fs.readdirSync(process.argv[2])) {
  let name = [file.slice(0, -3)]
  let src = fs.readFileSync(path.join(process.argv[2], file)).toString()
  res.push({ name, src })
}

fs.writeFileSync(path.join(process.argv[3]), JSON.stringify(res))
