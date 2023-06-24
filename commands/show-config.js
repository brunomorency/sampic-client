'use strict'

const chalk = require('chalk')

module.exports = function run(cmdOpts, core) {

  let NUM_TABS_TO_VALUE = 3
  return core.utils.getConfig(cmdOpts)
  .then(config => {
    Object.keys(config).forEach(k => {
      if (k.substring(0,1) == '_') return false
      let spacer = Array.from(Array(Math.ceil((NUM_TABS_TO_VALUE*8 - k.length - 1)/8)), elm => '\t').join('')
      let paramName = chalk.gray(k + ':')
      switch (k) {

        case 'stackParameters':
        core.utils.stdout(`${paramName}${spacer}`, {mode: core.utils.STDOUT_MODES.START_LINE})
        let params = Object.keys(config.stackParameters)
        let firstParam = params.shift()
        core.utils.stdout(`${firstParam}: ${config.stackParameters[firstParam]}`, {mode: core.utils.STDOUT_MODES.TERMINATE_LINE})
        let prefix = Array.from(Array(NUM_TABS_TO_VALUE), elm => '\t').join('')
        params.forEach(p => {
          core.utils.stdout(`${prefix}${p}: ${config.stackParameters[p]}`, {mode: core.utils.STDOUT_MODES.OWN_LINE})
        })
        break

        case 'capabilities':
        core.utils.stdout(`${paramName}${spacer}${config[k].join(', ')}`, {mode: core.utils.STDOUT_MODES.OWN_LINE})
        break

        default:
        core.utils.stdout(`${paramName}${spacer}${config[k]}`, {mode: core.utils.STDOUT_MODES.OWN_LINE})
      }
    })
    return true
  })

}
