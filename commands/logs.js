'use strict'

const prompt = require('prompt')
const chalk = require('chalk')

module.exports = function run(cmdOpts, core) {

  let executionName = cmdOpts.executionName
  core.utils.stdout(`Loading logs for execution ${executionName} ...`, {level:0, mode:core.utils.STDOUT_MODES.START_LINE})

  return core.api.executions.getLogs(executionName)
  .then(({body}) => {
    if (body.entries && body.entries.length > 0) {
      let firstLine = body.entries.shift()
      core.utils.stdout(firstLine.entry.original, {mode: core.utils.STDOUT_MODES.OVERWRITE_LINE})
      body.entries.forEach(r => {
        if (r.entry.original == r.entry.plainText) {
          core.utils.stdout(r.entry.plainText, {mode: core.utils.STDOUT_MODES.OWN_LINE})
        } else {
          core.utils.stdout(r.entry.original, {mode: core.utils.STDOUT_MODES.RAW})
        }
      })
    }
    return true
  })

}
