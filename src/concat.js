import path from 'path'
import fs from 'fs'

let res = {}

for (let file of fs.readdirSync(path.join(__dirname, 'scripts'))) {
  res[file.slice(0, -3)] = fs.readFileSync(path.join(__dirname, 'scripts', file)).toString()
}

fs.writeFileSync(path.join(__dirname, 'scripts.json'), JSON.stringify(res))
