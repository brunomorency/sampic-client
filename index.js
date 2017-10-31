'use strict'

let exp = {}

;['utils','deps','analyseChanges','package'].forEach(op => {
  exp[op] = require(`./core/${op}`)
})

module.exports = exp
