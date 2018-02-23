'use strict'

const prompt = require('prompt')
const chalk = require('chalk')
const getUsage = require('command-line-usage')

module.exports = function run(cmdOpts, core) {

  const packageInfo = require('../package.json')

  console.log(getUsage([
    {
      header: 'SAMPIC CLI',
      content: packageInfo.description
    },
    {
      header: 'Synopsis',
      content: `$ ${packageInfo.name} [<command>] [<command-options>]`
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
        { name: 'deploy-local', summary: 'Packages CloudFormation template and deploys to AWS' },
        { name: 'deploy', summary: 'Bundles git HEAD commit and uploads it to your sampic.cloud account for remote build and deploy.' },
        { name: 'logs [underline]{execution-name}', summary: 'Retrieves detailed logs for a build and deploy execution triggered with the \'deploy\' command.' },
        { name: 'signup', summary: 'Signup to enable `deploy` command' }
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
      header: 'Command Options: \'deploy-local\'',
      optionList: core.OPTIONS_DEF,
      group: 'deploy-local'
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
