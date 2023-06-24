'use strict'

const getUsage = require('command-line-usage')

module.exports = function run(cmdOpts, core) {

  const packageInfo = require('../package.json')
  let cmdName = Object.keys(packageInfo.bin)[0]

  console.log(getUsage([
    {
      header: 'SAMPIC',
      content: packageInfo.description
    },
    {
      header: 'Synopsis',
      content: `$ ${cmdName} [<command>] [<command-options>]`
    },
    {
      header: 'Commands',
      content: [
        { name: 'help', summary: 'Display this help information.' },
        { name: 'init', summary: 'Generate an example config file if none exist.' },
        { name: 'show-config', summary: 'Prints out config applicable to current git branch' },
        { name: 'deps-install', summary: 'Runs \'npm install --production\' command for all nodejs Lambda functions defined in CloudFormation template file' },
        { name: 'deps-outdated', summary: 'Runs \'npm outdated\' command for all nodejs Lambda functions defined in CloudFormation template file' },
        { name: 'deps-update', summary: 'Runs \'npm update --save\' command for all nodejs Lambda functions defined in CloudFormation template file' },
        { name: 'deploy', summary: 'Packages CloudFormation template and deploys to AWS' }
      ]
    },
    {
      header: 'Global Options',
      optionList: core.OPTIONS_DEF,
      group: 'global'
    },
    {
      header: 'Command Options: \'deploy\'',
      optionList: core.OPTIONS_DEF,
      group: 'deploy'
    },
    {
      header: 'Command Options: \'deps-install\'',
      optionList: core.OPTIONS_DEF,
      group: 'deps-install'
    },
    {
      header: 'Command Options: \'deps-update\'',
      optionList: core.OPTIONS_DEF,
      group: 'deps-update'
    }
  ]))

  return Promise.resolve(true)

}
