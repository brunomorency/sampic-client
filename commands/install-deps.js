#! /usr/bin/env node
'use strict'

const AWS = require('aws-sdk')
const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const { diff } = require('deep-diff')

const utils = require('./_utils')
const cfYamlSchema = require('cloudformation-schema-js-yaml')

module.exports = function run(cliOpts) {

  return utils.getConfig(cliOpts)
  .then(config => {
    if ('profile' in config) {
      AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: config.profile })
    }
    console.log('Retrieving current stack template')
    let awsCF = new AWS.CloudFormation({
      region: config.region
    })
    return utils.getCurrentStackTemplate(awsCF, config)
    .then(template => {
      return { awsCF, config, template }
    })
  })
  .then(({config, deployedTemplate}) => {
    let template = yaml.safeLoad(
      fs.readFileSync(config.template, 'utf8'),
      { schema: cfYamlSchema }
    )
    return ({template, config})
  })
  .then(({config, template}) => {
    let pathToNodeLambdas = Object.keys(template.Resources)
    .filter(resourceLogicalId => {
      return (
        template.Resources[resourceLogicalId].Type.search(/^AWS::Serverless::Function$/) === 0 &&
        template.Resources[resourceLogicalId].Properties.Runtime.search(/^nodejs/) === 0 &&
        template.Resources[resourceLogicalId].Properties.CodeUri.substr(0,5) != 's3://'
      )
    })
    .map(logicalId => {
      return template.Resources[logicalId].Properties.CodeUri
    })

    return pathToNodeLambdas.reduce((p, aPath) => p.then(() => {
      console.log(`Installing npm production packages for ${aPath}`)
      return utils.run('npm',['install','--production'], {cwd: aPath}, {
        stdout: (lines) => {
          lines.forEach(line => { console.log(`\t${line}`) })
        }
      })
    }), Promise.resolve())
    .then(() => {
      return `All production packages installed on lambda functions defined in ${config.template}`
    })

  })
}
