#!/usr/bin/env node
'use strict'

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
    name: 'cmd',
    type: String,
    defaultOption: true
  }
])

if (options.version) {

  console.log(require('./package.json').version)

} else {

  let commands = ['install-deps', 'deploy']

  if (options.cmd == 'help') {

    const getUsage = require('command-line-usage')
    const packageInfo = require('./package.json')
    console.log(getUsage([
      {
        header: packageInfo.name.toUpperCase(),
        content: packageInfo.description
      },
      {
        header: 'Synopsis',
        content: `$ ${packageInfo.name} [<options>] <command>`
      },
      {
        header: 'Options',
        optionList: [
          {
            name: 'version',
            alias: 'v',
            type: Boolean,
            description: 'Output package version and terminate.'
          },
          {
            name: 'force',
            alias: 'f',
            type: Boolean,
            description: 'Force deployment to CloudFormation even if \'deploy\' command says there are no template changes.'
          }
        ]
      },
      {
        header: 'Command List',
        content: [
          { name: 'help', summary: 'Display this help information.' },
          { name: 'install-deps', summary: 'Runs \'npm install\' command for all Lambda functions defined in CloudFormation template file' },
          { name: 'deploy', summary: 'Packages CloudFormtion template and deploys to AWS' }
        ]
      }
    ]))

  }
  else if (commands.indexOf(options.cmd) == -1) {

    console.log(`Usage:\tsampique [options] <command>\n\nTo see help text, you can run:\n\tsampique help`)

  } else {

    require(`./commands/${options.cmd}`)(options)
    .then(message => {
      if (message) console.log(message)
    })
    .catch(err => {
      console.log(`${err.message}`)
    })

  }

}
