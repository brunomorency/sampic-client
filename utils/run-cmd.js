const { spawn } = require('child_process')

module.exports = (cmd, args=[], opts={}, quiet=false) => {
  return new Promise((resolve, reject) => {
    let proc = spawn(cmd, args, opts)
    let stdout = [], stderr = []
    let previousStdOutLine = ''
    let uploadingToRE = new RegExp('^Uploading to ')
    proc.stdout.on('data', data => {
      let lines = data.toString().trim().split("\n")
      if (!quiet) {
        function printProgress(progress) {
            process.stdout.write(progress + '%');
        }
        lines.forEach(line => {
          if (line.search(uploadingToRE) === 0) {
            if (previousStdOutLine.search(uploadingToRE) === 0) {
              let lineParts = line.split(' ')
              let prevLineParts = previousStdOutLine.split(' ')
              if (lineParts[2] == prevLineParts[2]) {
                process.stdout.clearLine();
                process.stdout.cursorTo(0);
              } else {
                process.stdout.write(`\n`)
              }
            }
            process.stdout.write(`  ${line}`)
          } else if (previousStdOutLine.search(uploadingToRE) === 0) {
            process.stdout.write(`\n`)
          } else {
            console.log(`  ${line}`)
          }
          previousStdOutLine = line
        })
      }
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
