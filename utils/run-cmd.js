const { spawn } = require('child_process')

module.exports = (cmd, args=[], opts={}, quiet=false) => {
  return new Promise((resolve, reject) => {
    let proc = spawn(cmd, args, opts)
    let stdout = [], stderr = []
    proc.stdout.on('data', data => {
      let lines = data.toString().trim().split("\n")
      if (!quiet) lines.forEach(line => console.log(`  ${line}`))
      stdout = stdout.concat(lines)
    })
    proc.stderr.on('data', data => {
      let lines = data.toString().trim().split("\n")
      if (!quiet) lines.forEach(line => console.log(`  ${line}`))
      stderr = stderr.concat(data.toString().trim().split("\n"))
    })
    proc.on('error', err => {
      reject(`Error with command: ${err.stack}`);
    });
    proc.on('close', code => {
      if (code !== 0) {
        stderr.forEach(line => console.log(`  stderr: ${line}`))
        reject(`command closed with code ${code}:`);
      }
      else resolve(stdout)
    })

  })
}
