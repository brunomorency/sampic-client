#! /usr/bin/env node
'use strict'

const AWS = require('aws-sdk')
const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const { diff } = require('deep-diff')

const packageConfigDir = '.sampique'
const utils = require('./_utils')

module.exports = function run(cliOpts) {

  return utils.getConfig(packageConfigDir, cliOpts)
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
  .then(({awsCF, config, template}) => {
    console.log(`Packaging ${config.template} to a deployable template`)

    let args = [
      '--region', config.region,
      'cloudformation', 'package',
      '--template-file', config.template,
      '--s3-bucket', config.s3Bucket || `${config.stackName}-lambda-artifacts`,
      '--output-template-file', config._deployableTemplateFile
    ]
    if (config.profile && config.profile != 'default') {
      args = ['--profile', `${config.profile}`].concat(args)
    }

    let previousStdOutLine = ''
    let uploadingToRE = new RegExp('^Uploading to ')
    return utils.run('aws', args, {}, {
      stdout: (lines) => {
        lines.forEach(line => {
          if (line.search(uploadingToRE) === 0) {
            // printing out line about uploading resource to S3
            if (previousStdOutLine.search(uploadingToRE) === 0) {
              // Previous line was also abot such progress, see if it's
              // about the same resources
              let lineParts = line.split(' ')
              let prevLineParts = previousStdOutLine.split(' ')
              if (lineParts[2] == prevLineParts[2]) {
                // progress on same resource as previous line
                process.stdout.clearLine();
                process.stdout.cursorTo(0);
              } else {
                // first progress info on a resource
                process.stdout.write(`\n`)
              }
            }
            process.stdout.write(`\t${line}`)
          } else if (previousStdOutLine.search(uploadingToRE) === 0) {
            process.stdout.write(`\n`)
          } /*else {
            if (cliOpts.verbose) console.log(`\t${line}`)
          }*/
          previousStdOutLine = line
        })
      }
    })
    .then(stdout => {
      return {
        awsCF,
        config,
        templates: {
          current: template,
          packaged: yaml.safeLoad(fs.readFileSync(config._deployableTemplateFile, 'utf8'))
        }
      }
    })

  })
  .then(({awsCF, config, templates}) => {

    let stackUpdate = true
    let changes

    if (templates.current) {
      console.log('Comparing current stack template with template to deploy')

      changes = diff(templates.current, templates.packaged)
      if (!changes || changes.length === 0) {
        if (!cliOpts.force) {
          throw new Error(`Looks like there are no changes between ${config.template} and template currently deployed on stack ${config.stackName}.\nRun with --force option to deploy anyway.`)
        }
      } else {
        stackUpdate = changes.some(chg => (
          chg.kind !== 'E' ||
          chg.path[0] !== 'Resources' ||
          chg.path[chg.path.length-1] !== 'CodeUri' ||
          templates.current.Resources[chg.path[1]].Type.search(/^AWS::(Serverless|Lambda)::Function$/) === -1
        ))
      }
    }

    if (stackUpdate) {

      // A full stack update is required since the new stack does more than a
      // simple lambda function code change. Issue and cloudformation deploy
      // command with the deployable template

      console.log(`Deploying template to CloudFormation stack ${config.stackName}`)

      let args = [
        '--region', config.region,
        'cloudformation', 'deploy',
        '--template-file', config._deployableTemplateFile,
        '--stack-name', config.stackName,
        '--capabilities', ...config.capabilities
      ]
      if (config.profile && config.profile != 'default') {
        args = ['--profile', `${config.profile}`].concat(args)
      }
      if (config.stackParameters) {
        args.push('--parameter-overrides')
        args.push(...Object.keys(config.stackParameters).map(key => `${key}=${config.stackParameters[key]}`))
      }

      return utils.run('aws', args, {}, {
        stdout: (lines) => {
          lines.forEach(line => { console.log(`\t${line}`) })
        }
      })
      .then(stdout => true)

    } else {

      // The only changes in the stack template are lambda functions code bundles.
      // We'll find physical uri of those lambda functions and issue a code update
      // request pointing them to the bundle uploaded in S3 when we ran
      // `aws cloudformation package`

      console.log(`New template only has updates to Lambda function code. Retrieving resource information.`)

      let params = {
        StackName: config.stackName
      }
      return awsCF.listStackResources(params).promise()
      .then(data => {
        let fnsToUpdate = data.StackResourceSummaries.filter(r =>
          changes.findIndex(chg => chg.path[1] === r.LogicalResourceId) >= 0
        )
        if (fnsToUpdate.length < changes.length) {
          // To support super big stacks with templates exceeding 1MB, we'd need
          // to recursively call listStackResources with data.NextToken.
          //  ... some day, maybe :)
          throw new Error('Your CloudFormation stack has too many resources!')
        } else {

          let awsLambda = new AWS.Lambda({
            region: config.region
          })
          return Promise.all(fnsToUpdate.map(fn => {
            let [str, bucket, key] = changes.find(chg => chg.path[1] === fn.LogicalResourceId).rhs.match(/^s3:\/\/(.*)\/(.*)$/)
            let params = {
              FunctionName: fn.PhysicalResourceId,
              Publish: false,
              S3Bucket: bucket,
              S3Key: key
            }
            console.log(`\tupdating code for lambda function ${fn.PhysicalResourceId}`)
            return awsLambda.updateFunctionCode(params).promise()
          }))
          .then(results => {
            return results.reduce((acc, r) => r && acc, true)
          })
          .catch(err => {
            console.log('Failed to update lambda function code:')
            console.error(err)
          })
        }
      })

    }

  })
  .then(success => {
    return (success) ? 'Deploy completed' : 'Deploy failed'
  })
}
