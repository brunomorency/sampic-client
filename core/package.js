'use strict'

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { fromIni } = require("@aws-sdk/credential-providers")
const path = require('path')
const fs = require('fs')
const utils = require('./utils')
const chalk = require('chalk')

module.exports = function run(config) {

  utils.stdout(`Packaging template ${config.template}`, {level:1})

  let args = [
    '--region', config.region,
    'cloudformation', 'package',
    '--template-file', config.template,
    '--s3-bucket', config.s3Bucket,
    '--output-template-file', config._packagedTemplateFile
  ]

  let opts = {}

  if (config.profile && config.profile != 'default') {
    args = ['--profile', `${config.profile}`].concat(args)
  } else if ('_awsCredentialsObject' in config && config._awsCredentialsObject !== null) {
    opts.env = {
      AWS_ACCESS_KEY_ID: config._awsCredentialsObject.accessKeyId,
      AWS_SECRET_ACCESS_KEY: config._awsCredentialsObject.secretAccessKey
    }
  }

  let previousStdOutLine = ''
  let uploadingToRE = new RegExp('^Uploading to ')
  let showUploadProgress = (process.stdout && process.stdout.clearLine && typeof process.stdout.clearLine == 'function')
  function _isAboutSameResource(lineA, lineB) {
    let lineAParts = lineA.split(' ')
    let lineBParts = lineB.split(' ')
    return (lineAParts[2] == lineBParts[2])
  }

  return utils.run('aws', args, opts, {
    stdout: (lines) => {
      lines.forEach(line => {
        if (showUploadProgress) {
          if (line.search(uploadingToRE) === 0) {
            // printing out line about uploading resource to S3
            if (previousStdOutLine.search(uploadingToRE) === 0 && _isAboutSameResource(line, previousStdOutLine)) {
              // Previous line was also about upload progress on same resource
              utils.stdout(line, {level:2, mode:utils.STDOUT_MODES.OVERWRITE_LINE})
            } else {
              // first progress info on a resource
              utils.stdout(line, {level:2, mode:utils.STDOUT_MODES.START_LINE})
            }
          }
        } else {
          // only print a single line about the package being uploaded
          if (line.search(uploadingToRE) === 0) {
            // printing out line about uploading resource to S3
            if (previousStdOutLine.search(uploadingToRE) == -1 || !_isAboutSameResource(line, previousStdOutLine)) {
              // first progress info on a resource
              utils.stdout(`${line.replace(/([a-f0-9]{16,}).*$/i,'$1')}`, {level:2})
            }
          }
        }
        previousStdOutLine = line
      })
    }
  })
  .then(stdout => {

    // upload deployable template to S3 bucket

    let s3Config = {
      region: config.region
    }
    if (config.profile) {
      s3Config.credentials = fromIni({profile: config.profile})
    }

    let s3 = new S3Client(s3Config)
    let params = {
      Bucket: config.s3Bucket,
      Key: `templates/${(new Date()).toISOString().replace(/[^\d]/gi,'')}-${path.basename(config.template)}`,
      Body: fs.readFileSync(config._packagedTemplateFile)
    }

    utils.stdout(`Uploading deployable template to ${chalk.yellow(`s3://${params.Bucket}/${params.Key}`)}`, {level:2})

    let s3Cmd = new PutObjectCommand(params)
    return s3.send(s3Cmd)
    .then(s3Response => ({
      bucket: params.Bucket,
      key: params.Key
    }))

  })

}
