#!/usr/bin/env node
'use strict'


let commands = ['help', 'init', 'install-deps', 'deploy']
const packageInfo = require('./package.json')

let { command, argv } = require('command-line-commands')([null].concat(commands))
let options = require('command-line-args')([
  {
    name: 'version',
    alias: 'v',
    type: Boolean,
    defaultValue: false
  },
  {
    name: 'force',
    alias: 'f',
    type: Boolean,
    defaultValue: false
  },
  {
    name: 'stack',
    type: String,
    defaultValue: null
  }
], { argv })

if (command === null && options.version) {
  console.log(require('./package.json').version)
} else if (commands.indexOf(command) == -1) {
  console.log(`Usage:\t${packageInfo.name} [<options>] [<command>] [<command-options>]\n\nTo see help text, you can run:\n\tsampique help`)
} else {

  if (command == 'help') {

    const getUsage = require('command-line-usage')
    console.log(getUsage([
      {
        header: packageInfo.name.toUpperCase(),
        content: packageInfo.description
      },
      {
        header: 'Synopsis',
        content: `$ ${packageInfo.name} [<options>] [<command>] [<command-options>]`
      },
      {
        header: 'Options',
        optionList: [
          {
            name: 'version',
            alias: 'v',
            type: Boolean,
            description: 'Output package version and terminate.'
          }
        ]
      },
      {
        header: 'Command List',
        content: [
          { name: 'help', summary: 'Display this help information.' },
          { name: 'init', summary: 'Generate an example config file if none exist.' },
          { name: 'install-deps', summary: 'Runs \'npm install --production\' command for all Lambda functions defined in CloudFormation template file' },
          { name: 'deploy', summary: 'Packages CloudFormtion template and deploys to AWS' }
        ]
      },
      {
        header: 'Command Options: \'deploy\'',
        optionList: [
          {
            name: 'force',
            alias: 'f',
            type: Boolean,
            description: 'Force deployment to CloudFormation even if \'deploy\' command says there are no template changes.'
          },
          {
            name: 'stack',
            typeLabel: '[underline]{stackName}',
            description: 'If your branch\'s config lists multiple stacks, this identifies the stack key to deploy'
          }
        ]
      },
      {
        header: 'Command Options: \'install-deps\'',
        optionList: [
          {
            name: 'stack',
            typeLabel: '[underline]{stackName}',
            description: 'If your branch\'s config lists multiple stack templates, specify which one should sampique search for Lambda functions'
          }
        ]
      }
    ]))

  } else {

    require(`./commands/${command}`)(options)
    .then(message => {
      if (message) console.log(message)
    })
    .catch(err => {
      console.log(`${err.message || err}`)
    })

  }

}
