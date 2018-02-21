'use strict'

const AWS = require('aws-sdk')
const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const { diff } = require('deep-diff')
const chalk = require('chalk')

const CMD_SUCCESS_STATUSES = [
  'CREATE_COMPLETE',
  'UPDATE_COMPLETE'
]

module.exports = function run(cmdOpts, core) {

  core.api.analytics.record('deploy-local',cmdOpts).then(r => {}).catch(err => {})

  return core.utils.getConfig(cmdOpts)
  .then(config => {

    let cfConfig = {
      region: config.region
    }
    if (config._awsCredentialsObject) {
      cfConfig.credentials = config._awsCredentialsObject
    }
    core.utils.stdout(`Retrieving template currently deployed on stack ${chalk.bold(config.stackName)}`)
    let awsCF = new AWS.CloudFormation(cfConfig)
    return core.utils.getCurrentStackTemplate(awsCF, config)
    .then(template => {
      return { awsCF, config, template }
    })

  })
  .then(({awsCF, config, template}) => {

    return core.package(config)
    .then(templateS3Location => {
      config._packagedTemplateS3Location = templateS3Location
      return {
        awsCF,
        config,
        templates: {
          current: template,
          packaged: yaml.safeLoad(
            fs.readFileSync(config._packagedTemplateFile, 'utf8'),
            { schema: require('cloudformation-schema-js-yaml') }
          )
        }
      }
    })

  })
  .then(({awsCF, config, templates}) => {

    if (templates.current === null) {
      // Need to do a full stack deploy because there is no
      // existing stack on CloudFormation with the configured name
      return Promise.resolve({
        awsCF,
        config,
        stackChanges: null,
        updatedStackParams: [],
        updateType: core.utils.UPDATE_TYPES.STACK_CREATE
      })
    } else if (cmdOpts.force) {
      // User forced stack deploy to happen
      return Promise.resolve({
        awsCF,
        config,
        stackChanges: null,
        updatedStackParams: [],
        updateType: core.utils.UPDATE_TYPES.STACK_UPDATE
      })
    } else {
      return core.analyseChanges(config, templates)
      .then(analysis => ({
        awsCF,
        config,
        updateType: analysis.updateType,
        stackChanges: analysis.stackChanges,
        updatedStackParams: analysis.updatedStackParams
      }))
    }

  })
  .then(({awsCF, config, updateType, stackChanges, updatedStackParams}) => {

    switch (updateType) {

      case core.utils.UPDATE_TYPES.STACK_CREATE:
      case core.utils.UPDATE_TYPES.STACK_UPDATE:
      case core.utils.UPDATE_TYPES.LAMBDA_AND_STACK_PARAMS: {

        // A full stack create/update is required since the new stack does more than a
        // simple lambda function code change. Issue a cloudformation deploy
        // command with the packaged template to create/update the stack

        core.utils.stdout(`Deploying template to CloudFormation stack ${config.stackName}`,{level:1})

        let args = [
          '--region', config.region,
          'cloudformation', 'deploy',
          '--template-file', config._packagedTemplateFile,
          '--stack-name', config.stackName,
          '--capabilities', ...config.capabilities
        ]

        let opts = {}
        if (config.profile && config.profile != 'default') {
          args = ['--profile', `${config.profile}`].concat(args)
        }

        if (config.stackParameters) {
          args.push('--parameter-overrides')
          args.push(...Object.keys(config.stackParameters).map(key => `${key}=${config.stackParameters[key]}`))
        }

        return core.utils.run('aws', args, opts, {
          stdout: (lines) => {
            lines.forEach(line => { core.utils.stdout(line,{level:2}) })
          }
        })
        .then(stdout => core.utils.getStackStatus(awsCF, config.stackName))
        .then(status => {
          return [
            CMD_SUCCESS_STATUSES.indexOf(status) != -1,
            config
          ]
        })
      }

      case core.utils.UPDATE_TYPES.LAMBDA_FNS: {

        // The only changes in the stack template are lambda function code bundles.
        // We'll find physical uri of those lambda functions and issue a code update
        // request pointing them to the bundle uploaded in S3 when we ran
        // `aws cloudformation package`

        core.utils.stdout(`Updating Lambda functions`,{level:1})
        core.utils.stdout(`Retrieving information on stack resources`,{level:2})

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

            let lambdaConfig = {
              region: config.region
            }
            if (config._awsCredentialsObject) {
              lambdaConfig.credentials = config._awsCredentialsObject
            }
            let lambda = new AWS.Lambda(lambdaConfig)
            return Promise.all(fnsToUpdate.map(fn => {
              let [str, bucket, key] = stackChanges.find(chg => chg.path[1] === fn.LogicalResourceId).rhs.match(/^s3:\/\/(.*)\/(.*)$/)
              let params = {
                FunctionName: fn.PhysicalResourceId,
                Publish: false,
                S3Bucket: bucket,
                S3Key: key
              }
              core.utils.stdout(`Setting ${chalk.yellow(`s3://${bucket}/${key}`)} as code bundle for lambda function ${chalk.cyan(fn.PhysicalResourceId)}`,{level:2})
              return lambda.updateFunctionCode(params).promise()
            }))
            .then(results => {
              return [
                results.reduce((acc, ufcReqData) => ufcReqData && acc, true),
                config
              ]
            })
            .catch(err => {
              core.utils.stdout(chalk.red('Updating function code failed'),{level:2})
              throw err
            })
          }
        })
      }


      case core.utils.UPDATE_TYPES.STACK_PARAMS: {

        // There are no template changes and all lambda functions have identical
        // code bundle signatures. Only stack parameters have changed. Run a
        // stack update to apply new parameter values

        core.utils.stdout(`Updating stack with new values for parameters: ${updatedStackParams.join(' ')}`, {level:1})

        let updateParams = {
          StackName: config.stackName,
          Capabilities: config.capabilities,
          UsePreviousTemplate: true,
          Parameters: Object.keys(config.stackParameters).map(paramName => {
            if (updatedStackParams.indexOf(paramName) == -1) {
              return {
                ParameterKey: paramName,
                UsePreviousValue: true
              }
            } else {
              return {
                ParameterKey: paramName,
                ParameterValue: config.stackParameters[paramName]
              }
            }
          })
        }

        return awsCF.updateStack(updateParams).promise()
        .then(data => core.utils.getStackStatus(awsCF, config.stackName))
        .then(status => {
          core.utils.stdout(`Stack status: ${status}`,{level:2})
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
      return {
        message: 'Deploy completed'
      }
    }
    return {
      message: 'Deploy failed'
    }

  })
}
