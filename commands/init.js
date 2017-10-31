'use strict'

const AWS = require('aws-sdk')
const path = require('path')
const fs = require('fs')

module.exports = function run(cliOpts, core) {

  return new Promise((resolve, reject) => {
    let cfgPath = core.utils.getPathToConfig(false)
    let cfgFileName = `${cfgPath}/config.json`

    try {
      fs.accessSync(cfgPath, fs.constants.W_OK)
    } catch (err) {
      core.utils.stdout(`Creating ${cfgPath}`)
      if (err.code === 'ENOENT') fs.mkdirSync(cfgPath, 0o755)
      else reject(err)
    }

    fs.open(cfgFileName, 'wx', (err, fd) => {
      if (err) {
        if (err.code === 'EEXIST') reject(`${cfgFileName} already exists.`)
        else reject(err)
        return null
      }

      resolve(core.utils.getCurrentGitBranch().then(branchName => {
        let sampleConfig = {
          master: {
            profile: 'default',
            region: 'us-east-1',
            template: 'my-template.yaml',
            stackName: 'my-prod-stack-name',
            stackParameters: {
              ParameterKey1: 'ParameterValue1',
              ParameterKey2: 'ParameterValue2'
            },
            s3Bucket: 'prod-stack-lambda-code-bundles',
            capabilities: ['CAPABILITY_IAM']
          }
        }

        if (branchName != 'master') {
          sampleConfig[branchName] = {
            profile: 'default',
            region: 'us-east-1',
            template: 'my-template.yaml',
            stackName: 'my-dev-stack-name',
            stackParameters: {
              ParameterKey1: 'ParameterValue1',
              ParameterKey2: 'ParameterValue2'
            },
            s3Bucket: 'dev-stack-lambda-code-bundles',
            capabilities: ['CAPABILITY_IAM']
          }
        }

        fs.writeSync(fd, JSON.stringify(sampleConfig,null,2))
        return {
          message: `Sample config file created: ${cfgFileName}`
        }
      }))
    })
  })
}
