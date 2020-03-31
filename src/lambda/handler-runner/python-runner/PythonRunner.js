import { EOL, platform } from 'os'
import { delimiter, join, relative, resolve } from 'path'
import { spawn } from 'child_process'
import extend from 'extend'

const { parse, stringify } = JSON
const { cwd } = process
const { has } = Reflect

export default class PythonRunner {
  #env = null
  #handlerName = null
  #handlerPath = null
  #runtime = null

  constructor(funOptions, env) {
    const { handlerName, handlerPath, runtime } = funOptions

    this.#env = env
    this.#handlerName = handlerName
    this.#handlerPath = handlerPath
    this.#runtime = runtime

    this.handlerProcess = spawn(
      pythonExecutable,
      [
        '-u',
        resolve(__dirname, 'invoke.py'),
        relative(cwd(), this.#handlerPath),
        this.#handlerName,
      ],
      {
        env: extend(process.env, this.#env),
        shell: true
      },
    )

    process.on('exit', () => {
      this.handlerProcess.kill();
    })
  }

  removeListeners() {
    this.handlerProcess.stdout.removeAllListeners();
    this.handlerProcess.stderr.removeAllListeners();
  }

  // no-op
  // () => void
  cleanup() {}

  _parsePayload(value) {
    let payload

    for (const item of value.split(EOL)) {
      let json

      // first check if it's JSON
      try {
        json = parse(item)
        // nope, it's not JSON
      } catch (err) {
        // no-op
      }

      // now let's see if we have a property __offline_payload__
      if (
        json &&
        typeof json === 'object' &&
        has(json, '__offline_payload__')
      ) {
        payload = json.__offline_payload__
        // everything else is print(), logging, ...
      } else {
        console.log(item)
      }
    }

    return payload
  }

  // invokeLocalPython, loosely based on:
  // https://github.com/serverless/serverless/blob/v1.50.0/lib/plugins/aws/invokeLocal/index.js#L410
  // invoke.py, based on:
  // https://github.com/serverless/serverless/blob/v1.50.0/lib/plugins/aws/invokeLocal/invoke.py
  async run(event, context) {
    return new Promise((accept, reject) => {
      const runtime = platform() === 'win32' ? 'python.exe' : this.#runtime

      const input = stringify({
        context,
        event,
      })

      if (process.env.VIRTUAL_ENV) {
        const runtimeDir = platform() === 'win32' ? 'Scripts' : 'bin'
        process.env.PATH = [
          join(process.env.VIRTUAL_ENV, runtimeDir),
          delimiter,
          process.env.PATH,
        ].join('')
      }

      this.handlerProcess.stdout.on('data', data => {
        this.removeListeners()

        try {
          return accept(this._parsePayload(data.toString()))
        } catch (err) {
          // TODO
          console.log('No JSON')

          // TODO return or re-throw?
          return reject(err)
        }
      })

      this.handlerProcess.stderr.on('data', data => {
        // TODO
        console.log(data.toString())
      })

      process.nextTick(() => {
        this.handlerProcess.stdin.write(input);
        this.handlerProcess.stdin.write('\n')
      })
    })
  }
}
