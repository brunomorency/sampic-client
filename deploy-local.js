#! /usr/bin/env node
'use strict'

const git = require('nodegit')
const AWS = require('aws-sdk')
const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const { diff } = require('deep-diff')

const packageDir = path.resolve('.sampique')
let runCommand = require('./utils/run-cmd')

try {
  var config = JSON.parse(fs.readFileSync(`${packageDir}/config.json`))
} catch(e) {
  console.log(`Unable to read config from ${packageDir}/config.json\nMake sure the config file is saved and that you run this command from the root of your project.`)
  console.log(`  ${e.message}`)
  process.exit()
}

git.Repository.open(path.resolve('.git'))
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
      cfg._deployableTemplateFile = `${packageDir}/${cfg.stackName}-deployable-template.yaml`
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
    // fetch current template from CloudFormation stack
    let params = {
      StackName: config.stackName,
      TemplateStage: 'Original'
    }
    return awsCF.getTemplate(params).promise()
    .then(data => ({
      awsCF,
      config,
      template: yaml.safeLoad(data.TemplateBody)
    }))
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

  return runCommand('aws', args).then(stdout => {
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
  console.log('Comparing current stack template with template to deploy')

  let changes = diff(templates.current, templates.packaged)
  if (!changes || changes.length === 0) {
    throw new Error(`Looks like there are no changes between ${config.template} and template currently deployed on stack ${config.stackName}.\nNothing left to do!`)
  }

  let stackUpdate = changes.some(chg => (
    chg.kind !== 'E' ||
    chg.path[0] !== 'Resources' ||
    chg.path[chg.path.length-1] !== 'CodeUri' ||
    templates.current.Resources[chg.path[1]].Type.search(/^AWS::(Serverless|Lambda)::Function$/) === -1
  ))

  if (stackUpdate) {

    // A full stack update is required since the new stack does more than a
    // simple lambda function code change. Issue and cloudformation deploy
    // command with the deployable template

    console.log(`Updating CloudFormation stack ${config.stackName} with new template`)

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

    return runCommand('aws', args).then(stdout => {
      return true
    })

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
          console.log(`  updating code for lambda function '${fn.PhysicalResourceId}'`)
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
  if (success) console.log('Deploy completed')
  else console.log('Deploy failed')
})
.catch(err => {
  console.log(err.message)
})
