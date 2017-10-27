#! /usr/bin/env node
'use strict'

const AWS = require('aws-sdk')
const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const { diff } = require('deep-diff')

const utils = require('./_utils')
const UPDATE_TYPES = {
  LAMBDA_FNS: 'lambdafns',
  STACK_PARAMS: 'stack_params',
  FULL_DEPLOY: 'full_deploy'
}
const CMD_SUCCESS_STATUSES = [
  'CREATE_COMPLETE',
  'UPDATE_COMPLETE'
]
const OUTPUT_INDENT = ' - '

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
  .then(({awsCF, config, template}) => {
    console.log(`Packaging ${config.template} template`)

    let args = [
      '--region', config.region,
      'cloudformation', 'package',
      '--template-file', config.template,
      '--s3-bucket', config.s3Bucket || `${config.stackName}-lambda-artifacts`,
      '--output-template-file', config._packagedTemplateFile
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
            process.stdout.write(`${OUTPUT_INDENT}${line}`)
          } else if (previousStdOutLine.search(uploadingToRE) === 0) {
            process.stdout.write(`\n`)
          }
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
          packaged: yaml.safeLoad(fs.readFileSync(config._packagedTemplateFile, 'utf8'))
        }
      }
    })

  })
  .then(({awsCF, config, templates}) => {

    let stackChanges = null, updatedStackParams = null

    function _getUpdatedStackParams() {
      return utils.getStackDescription(awsCF, config.stackName)
      .then(stackDescription => {
        return Object.keys(config.stackParameters).filter(cfgParamKey => {
          let currentParam = stackDescription.Parameters.find(p => p.ParameterKey == cfgParamKey)
          return currentParam ? config.stackParameters[cfgParamKey] != currentParam.ParameterValue : true
        })
      })
    }

    return new Promise((resolve, reject) => {

      if (cliOpts.force || templates.current === null) {
        // Need to do a full stack deploy because user forced it or there is no
        // existing stack on CloudFormation with the configured name
        resolve(UPDATE_TYPES.FULL_DEPLOY)
      } else {

        console.log('Comparing current stack template with template to deploy')
        stackChanges = diff(templates.current, templates.packaged)

        if (Array.isArray(stackChanges) && stackChanges.length > 0) {

          // Packaged template is different from current stack template.
          // Check if there are template changes that aren't simply new code
          // bundles for lambda fns

          let notJustLambdas = stackChanges.some(chg => (
            chg.kind !== 'E' ||
            chg.path[0] !== 'Resources' ||
            chg.path[chg.path.length-1] !== 'CodeUri' ||
            templates.current.Resources[chg.path[1]].Type.search(/^AWS::(Serverless|Lambda)::Function$/) === -1
          ))

          if (notJustLambdas) {
            // Need to do a full stack deploy because there have been changes
            // other than lambda code bundles
            resolve(UPDATE_TYPES.FULL_DEPLOY)
          } else if (config.stackParameters) {
            // The only changes between packaged template and current stack are
            // lambda code bundles. However, if stack parameters in config have
            // changed vs. current stack params, we'll do a full deploy anyway
            _getUpdatedStackParams().then(changedParams => {
              updatedStackParams = changedParams
              resolve(updatedStackParams.length > 0 ? UPDATE_TYPES.FULL_DEPLOY : UPDATE_TYPES.LAMBDA_FNS)
            })
          } else {
            // Stack has no parameters and the only changes between packaged
            // template and current stack are lambda code bundles
            resolve(UPDATE_TYPES.LAMBDA_FNS)
          }

        } else {

          // Packaged template is identical to current stack template. Look for
          // possible changes in stack parameters

          if (config.stackParameters) {
            // If stack parameters in config have changed vs. current stack
            // we'll update the stack with those params. Otherwise, there's
            // nothing to do.
            _getUpdatedStackParams().then(changedParams => {
              updatedStackParams = changedParams
              resolve(updatedStackParams.length > 0 ? UPDATE_TYPES.STACK_PARAMS : null)
            })
          } else {
            // Template is identical and stack has no parameters.
            // Nothing to do!
            resolve(null)
          }
        }

      }

    })
    .then(updateType => ({ awsCF, config, updateType, stackChanges, updatedStackParams }))

  })
  .then(({awsCF, config, updateType, stackChanges, updatedStackParams}) => {

    switch (updateType) {

      case UPDATE_TYPES.FULL_DEPLOY: {

        // A full stack update is required since the new stack does more than a
        // simple lambda function code change. Issue and cloudformation deploy
        // command with the packaged template

        console.log(`Deploying template to CloudFormation stack ${config.stackName}`)

        let args = [
          '--region', config.region,
          'cloudformation', 'deploy',
          '--template-file', config._packagedTemplateFile,
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
            lines.forEach(line => { console.log(`${OUTPUT_INDENT}${line}`) })
          }
        })
        .then(stdout => utils.getStackStatus(awsCF, config.stackName))
        .then(status => {
          return [
            CMD_SUCCESS_STATUSES.indexOf(status) != -1,
            config
          ]
        })
      }

      case UPDATE_TYPES.LAMBDA_FNS: {

        // The only changes in the stack template are lambda function code bundles.
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
            stackChanges.findIndex(chg => chg.path[1] === r.LogicalResourceId) >= 0
          )
          if (fnsToUpdate.length < stackChanges.length) {
            // To support super big stacks with templates exceeding 1MB, we'd need
            // to recursively call listStackResources with data.NextToken.
            //  ... some day, maybe :)
            throw new Error('Your CloudFormation stack has too many resources!')
          } else {

            let awsLambda = new AWS.Lambda({
              region: config.region
            })
            return Promise.all(fnsToUpdate.map(fn => {
              let [str, bucket, key] = stackChanges.find(chg => chg.path[1] === fn.LogicalResourceId).rhs.match(/^s3:\/\/(.*)\/(.*)$/)
              let params = {
                FunctionName: fn.PhysicalResourceId,
                Publish: false,
                S3Bucket: bucket,
                S3Key: key
              }
              console.log(`${OUTPUT_INDENT}updating code for lambda function ${fn.PhysicalResourceId}`)
              return awsLambda.updateFunctionCode(params).promise()
            }))
            .then(results => {
              return [
                results.reduce((acc, ufcReqData) => ufcReqData && acc, true),
                config
              ]
            })
            .catch(err => {
              console.log('Failure while updating lambda function code')
              throw err
            })
          }
        })
      }


      case UPDATE_TYPES.STACK_PARAMS: {

        // There are no template changes and all lambda functions have identical
        // code bundle signatures. Only stack parameters have changed. Run a
        // stack update to apply new parameter values

        console.log(`Updating stack with new values for parameters: ${updatedStackParams.join(' ')}`)

        let args = [
          '--region', config.region,
          'cloudformation', 'update-stack',
          '--stack-name', config.stackName,
          '--use-previous-template',
          '--capabilities', ...config.capabilities
        ]
        if (config.profile && config.profile != 'default') {
          args = ['--profile', `${config.profile}`].concat(args)
        }

        args.push('--parameters')
        Object.keys(config.stackParameters).forEach(paramName => {
          if (updatedStackParams.indexOf(paramName) == -1) {
            args.push(`ParameterKey=${paramName},UsePreviousValue=True`)
          } else {
            args.push(`ParameterKey=${paramName},ParameterValue=${config.stackParameters[paramName]}`)
          }
        })

        return utils.run('aws', args)
        .then(stdout => utils.getStackStatus(awsCF, config.stackName))
        .then(status => {
          console.log(`${OUTPUT_INDENT}Stack status: ${status}`)
          return [
            status == 'UPDATE_IN_PROGRESS',
            config
          ]
        })
      }

      default:
      throw new Error(`Looks like there are no changes to deploy for stack ${config.stackName}.\nRun with --force option to deploy anyway.`)
    }

  })
  .then(([success, config]) => {
    if (success) {
      // overwrite deployed template with packaged template
      fs.renameSync(config._packagedTemplateFile, config._deployedTemplateFile)
      return 'Deploy completed'
    }
    return 'Deploy failed'
  })
}
