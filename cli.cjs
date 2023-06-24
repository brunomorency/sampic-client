#!/usr/bin/env node
'use strict'

const packageInfo = require('./package.json')
const chalk = require('chalk')
const commandLineCommands = require('command-line-commands')
const commandLineArgs = require('command-line-args')

let commands = [
  'help',
  'init',
  'deps-install',
  'deps-outdated',
  'deps-update',
  'deploy',
  'show-config'
]

try {
  var { command, argv } = commandLineCommands([null].concat(commands))
} catch (e) {
  if (e.name == 'INVALID_COMMAND') {
    console.log(`Unknown command '${e.command}'`)
  }
  process.exit(1)
}

const OPTIONS = [
  {
    name: 'version',
    alias: 'v',
    type: Boolean,
    defaultValue: false,
    group: 'nocmd'
  },
  {
    name: 'stack',
    type: String,
    defaultValue: null,
    typeLabel: '{underline stackName}',
    description: 'If your config file lists multiple stacks, this identifies the stack key to work with.',
    group: 'global'
  },
  {
    name: 'force',
    alias: 'f',
    type: Boolean,
    defaultValue: false,
    description: 'Force deployment to CloudFormation even if \'deploy\' command says there are no template changes.',
    group: 'deploy'
  },
  {
    name: 'include-dev',
    alias: 'd',
    type: Boolean,
    defaultValue: false,
    description: 'Install all dependencies, not just production (i.e. runs `npm install`, not `npm install --production`)',
    group: 'deps-install'
  },
  {
    name: 'parallel',
    alias: 'p',
    type: Boolean,
    defaultValue: false,
    description: 'Run command for all paths in parallel. Faster but output doesn\'t have as much info',
    group: ['deps-install','deps-update']
  }
]

if (commands.indexOf(command) >= 0) {

  let core = {
    OPTIONS_DEF: OPTIONS
  }
  ;['deps','package','analyseChanges','utils'].forEach(op => {
    core[op] = require(`./core/${op}`)
  })

  let supportedOptions = OPTIONS.filter(opt => {
    return  opt.group == command ||
            opt.group == 'global' ||
            (Array.isArray(opt.group) && opt.group.indexOf(command) >= 0) ||
            (Array.isArray(opt.group) && opt.group.indexOf('global') >= 0)
  })
  let options
  try {
    options = commandLineArgs(supportedOptions, { argv, camelCase: true })
  } catch (e) {
    switch (e.name) {
      case 'UNKNOWN_OPTION':
      console.log(`Unknown option '${e.optionName}'`)
      break

      case 'UNKNOWN_VALUE':
      console.log(`Unknown value '${e.value}'`)
      break

      case 'ALREADY_SET':
      console.log(`Option '${e.optionName}' is set more than once`)
      break

      default:
      console.log(`${e.name} error`)
    }
    process.exit(1)
  }

  require(`./commands/${command}`)(options._all, core)
  .then(output => {
    if (output && output.message) core.utils.stdout(output.message,{mode:core.utils.STDOUT_MODES.PARAGRAPH})
  })
  .catch(err => {
    if (err.message) {
      _utils.stdout(`${chalk.red('ERROR:')} ${err.message}`)
    } else {
      _utils.stdout(`${chalk.red('ERROR:')}`,{mode:_utils.STDOUT_MODES.OWN_LINE})
      _utils.stdout(err,{mode:_utils.STDOUT_MODES.OWN_LINE})
    }
  })

} else {
  let options = commandLineArgs(OPTIONS.filter(opt => (opt.group == 'nocmd' || opt.group.indexOf('nocmd') >= 0)), { argv })
  if (command === null && options._all.version) {
    console.log(require('./package.json').version)
  } else {
    let cmdName = Object.keys(packageInfo.bin)[0]
    console.log(`Usage:\t${cmdName} [<options>] [<command>] [<command-options>]\n\nTo see help text, you can run:\n\t${cmdName} help`)
  }
}
