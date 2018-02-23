#!/usr/bin/env node
'use strict'

const packageInfo = require('./package.json')
const chalk = require('chalk')

let commands = [
  'help',
  'init',
  'deps-install',
  'deps-outdated',
  'deps-update',
  'deploy',
  'deploy-local',
  'logs',
  'signup',
  'show-config'
]

try {
  var { command, argv } = require('command-line-commands')([null].concat(commands))
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
    typeLabel: '[underline]{stackName}',
    description: 'If your config file lists multiple stacks, this identifies the stack key to work with.',
    group: 'global'
  },
  {
    name: 'force',
    alias: 'f',
    type: Boolean,
    defaultValue: false,
    description: 'Force deployment to CloudFormation even if \'deploy-local\' command says there are no template changes.',
    group: 'deploy-local'
  },
  {
    name: 'staged',
    alias: 's',
    type: Boolean,
    defaultValue: false,
    description: 'Include changes staged in your git index in the bundle uploaded to sampic.cloud',
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
  },
  {
    name: 'execution-name',
    type: String,
    defaultValue: null,
    defaultOption: true,
    description: 'Unique identification of execution to fetch logs for.',
    group: 'logs'
  }
]

if (commands.indexOf(command) >= 0) {

  let core = {
    OPTIONS_DEF: OPTIONS
  }
  ;['deps','package','analyseChanges','utils','api'].forEach(op => {
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
    options = require('command-line-args')(supportedOptions, { argv, camelCase: true })
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

  function _recordCommand(cmd, opts) {
    let prefs = core.utils.prefs.get()
    if (prefs.allowAnonymousUsageAnalytics !== false) {
      let tokens = core.utils.tokens.get()
      if (tokens.length == 0) {
        let uuid = prefs.uuid
        if (!uuid) {
          uuid = require('uuid/v1')()
          core.utils.prefs.set({uuid})
        }
        return core.api.analytics.register(uuid)
        .then(response => {
          core.utils.tokens.save(null,response.body.authorizationToken,true)
          core.api.analytics.record(cmd,opts).then(r => {}).catch(err => {})
        })
      } else {
        core.api.analytics.record(cmd,opts).then(r => {}).catch(err => {})
      }
    }
    return Promise.resolve(true)
  }

  _recordCommand(command, options._all)
  .then(() => {
    return require(`./commands/${command}`)(options._all, core)
  })
  .then(output => {
    if (output && output.message) core.utils.stdout(output.message,{mode:core.utils.STDOUT_MODES.PARAGRAPH})
    if (['deploy-local','deps-install','deps-outdated','deps-update'].indexOf(command) != -1) {
      let timeForRepeat = 45*24*60*60*1000
      let delayUntilFirst = 10*24*60*60*1000
      core.utils.announce(
        'feedback',
        `${String.fromCodePoint(128075)} Hi! Thanks for using sampic, I'm curious to learn more about the type\n   of project you use it for as well as things you wish sampic could do.\n   You can email me at bruno@mopolabs.com.\n   (Don't worry, this won't show up every time)`,
        timeForRepeat,
        delayUntilFirst
      )
    }
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
  let options = require('command-line-args')(OPTIONS.filter(opt => (opt.group == 'nocmd' || opt.group.indexOf('nocmd') >= 0)), { argv })
  if (command === null && options._all.version) {
    console.log(require('./package.json').version)
  } else {
    console.log(`Usage:\t${packageInfo.name} [<options>] [<command>] [<command-options>]\n\nTo see help text, you can run:\n\tsampic help`)
  }
}
