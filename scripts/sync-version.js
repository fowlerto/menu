import { readFileSync, writeFileSync } from 'fs'

const app = JSON.parse(readFileSync('app.json', 'utf8'))
app.name = `Smart Menu ${app.version}`
writeFileSync('app.json', JSON.stringify(app, null, 2) + '\n')
console.log(`name → "${app.name}"`)
