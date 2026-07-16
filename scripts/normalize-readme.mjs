import {readFile, writeFile} from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const readmeUrl = new URL('../README.md', import.meta.url)
const readme = await readFile(readmeUrl, 'utf8')
const versionPrefix = `${packageJson.name}/${packageJson.version}`
const normalized = readme.replace(
  new RegExp(`^${escapeRegExp(versionPrefix)}\\s+\\S+-\\S+\\s+node-v\\S+$`, 'm'),
  versionPrefix,
)
await writeFile(readmeUrl, normalized, 'utf8')

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}
