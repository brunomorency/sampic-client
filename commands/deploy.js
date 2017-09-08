#! /usr/bin/env node
'use strict'

const git = require('nodegit')
const AWS = require('aws-sdk')
const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const { diff } = require('deep-diff')

const packageConfigDir = '.sampique'
const packageFullPath = path.resolve(packageConfigDir)
const utils = require('./_utils')

module.exports = function run(cliOpts) {

  try {
    var config = JSON.parse(fs.readFileSync(`${packageFullPath}/config.json`))
  } catch(e) {
    console.log(`Unable to read config from ${packageConfigDir}/config.json\nMake sure the config file is saved and that you run this command from the root of your project.`)
    return Promise.reject(e)
  }

  return git.Repository.open(path.resolve('.git'))
  .then(repo => repo.getCurrentBranch())
  .then(branchRef => {
    return new Promise((resolve, reject) => {

      let branchName = branchRef.name().replace(/^refs\/heads\//,'')
      if (branchName in config) {
        console.log(`Using deploy config for current git branch (${branchName})`)
        if ('profile' in config[branchName]) {
          AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: config[branchName].profile})
        }
        let cfg = config[branchName]
        cfg._deployableTemplateFile = `${packageFullPath}/${cfg.stackName}-deployable-template.yaml`
        resolve(cfg)
      }
      else reject(new Error(`No deployment configuration set for current git branch (${branchName})`))

    })
  })
  .then(config => {
    console.log('Retrieving current stack template')
    let awsCF = new AWS.CloudFormation({
      region: config.region
    })

    try {
      let template = yaml.safeLoad(fs.readFileSync(config._deployableTemplateFile, 'utf8'))
      return { awsCF, config, template }
    } catch (e) {
      // Don't have a previous version of deployed template,
      // Check if the stack exists and fetch current template if so
      return new Promise((resolve, reject) => {
        let nextToken = null
        do {
          awsCF.listStacks({ NextToken: nextToken }, (err, data) => {
            if (err) reject(err)
            else {
              if (data.StackSummaries.filter(s => s.StackName == config.StackName).length > 0) {
                // fetch current template for the stack
                awsCF.getTemplate({
                  StackName: config.stackName,
                  TemplateStage: 'Original'
                }, (err, data) => {
                  if (err) reject(err)
                  else {
                    resolve({
                      awsCF,
                      config,
                      template: yaml.safeLoad(data.TemplateBody)
                    })
                  }
                })
              } else if (data.NextToken) {
                nextToken = data.NextToken
              } else {
                // the stack doesn't exist on CloudFormation
                resolve({ awsCF, config, template: null })
              }
            }
          })
        } while (nextToken !== null)
      })
    }

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
      stdout: (data) => {
        let lines = data.toString().trim().split("\n")
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
            if (options.verbose) console.log(`\t${line}`)
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
      if ((!changes || changes.length === 0) && !options.force) {
        throw new Error(`Looks like there are no changes between ${config.template} and template currently deployed on stack ${config.stackName}.\nNothing left to do!`)
      }

      stackUpdate = changes.some(chg => (
        chg.kind !== 'E' ||
        chg.path[0] !== 'Resources' ||
        chg.path[chg.path.length-1] !== 'CodeUri' ||
        templates.current.Resources[chg.path[1]].Type.search(/^AWS::(Serverless|Lambda)::Function$/) === -1
      ))
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

      return utils.run('aws', args, {}, {
        stdout: (data) => {
          let lines = data.toString().trim().split("\n")
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
            console.log(`\tupdating code for lambda function '${fn.PhysicalResourceId}'`)
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
