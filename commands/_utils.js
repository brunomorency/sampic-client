const { spawn } = require('child_process')

module.exports = {

  run: (cmd, args=[], opts={}, onData=null) => {

    return new Promise((resolve, reject) => {

      let proc = spawn(cmd, args, opts)
      let stdout = [], stderr = []

      proc.stdout.on('data', data => {
        let lines = data.toString().trim().split("\n")
        stdout = stdout.concat(lines)
        if (onData && onData.stdout) onData.stdout(lines)
      })
      proc.stderr.on('data', data => {
        let lines = data.toString().trim().split("\n")
        stderr = stderr.concat(data.toString().trim().split("\n"))
        if (onData && onData.stderr) onData.stderr(lines)
      })
      proc.on('error', err => {
        reject(new Error(`Error with command: ${err.stack}`));
      });
      proc.on('close', code => {
        if (code !== 0) {
          console.log('Command error:')
          stderr.forEach(line => console.log(`\t${line}`))
          reject(new Error(`command closed with code ${code}`));
        }
        else resolve(stdout)
      })

    })
  }

}
