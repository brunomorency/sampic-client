'use strict'

const path = require('path')
const https = require('https')
const url = require('url')
const fs = require('fs')
const crypto = require('crypto')
const filesize = require('filesize')
const wrap = require('word-wrap')
const chalk = require('chalk')

module.exports = function run(cmdOpts, core) {

  let sampicTokens = core.utils.tokens.get()

  if (sampicTokens.length == 0) {
    let intro = []
    intro.push(chalk.bold.underline('INTRODUCING SAMPIC.CLOUD'))
    intro.push(`Since v0.7.0, the 'deploy' command triggers a build and deploy process on sampic.cloud, a hosted deployment service designed specifically for the AWS Serverless Application Model platform. Run 'sampic signup' for more information and to create an account.`)
    intro.push(`Use the new 'deploy-local' command to do what 'deploy' did in prior versions.`)
    intro.forEach(paragraph => {
      core.utils.stdout(wrap(paragraph, { width: 80, indent: '' }), {mode:core.utils.STDOUT_MODES.PARAGRAPH})
    })
    return Promise.resolve(false)
  }

  return core.utils.getConfig(cmdOpts)

  .then(config => {
    core.utils.stdout('Packaging application',{level:1})
    core.utils.stdout('Zipping code for upload',{level:2})
    return _getCodeBundle(cmdOpts, core)
    .then(bundleFile => ({ config, bundleFile }))
  })

  .then(({ config, bundleFile }) => {
    // get remote bundle id along with pre-signed url to upload app code
    core.utils.stdout('Getting upload destination',{level:2})
    return core.api.executions.getAppCodeUploadUrl()
    .then(({body:uploadInfo}) => ({config, bundleFile, uploadInfo}))
  })

  .then(({ config, bundleFile, uploadInfo }) => {
    let bundleSize = fs.statSync(bundleFile).size
    core.utils.stdout(`Uploading application code (${filesize(bundleSize)})`,{level:2})

    return new Promise((resolve, reject) => {
      // upload code bundle to signed url returned by api
      let _url = url.parse(uploadInfo.uploadUrl)
      let options = {
        hostname: _url.hostname,
        path: _url.path,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': bundleSize
        }
      }
      let req = https.request(options, res => {
        let body = ''
        res.on('data', chunk => { body += chunk })
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.statusCode)
          } else {
            reject(new Error(`Failed to upload application code`))
          }
        })
      })
      req.on('error', reject)

      let stream = fs.ReadStream(bundleFile)
      stream.on('data', data => {
        return req.write(data)
      })
      stream.on('end', () => req.end())
      stream.on('error', reject)
    })
    .then(statusCode => {
      fs.unlinkSync(bundleFile)
      return { config, uploadInfo }
    })
  })

  .then(({ config, uploadInfo }) => {
    // get data key to encrypt AWS credentials of profile to be used for deployment
    core.utils.stdout(`Preparing deploy config`,{level:2})
    return core.api.executions.getCredentialsDataKey()
    .then(({body:dataKey}) => {
      let iv = crypto.randomBytes(16)
      let cipher = crypto.createCipheriv('aes-256-ctr', Buffer.from(dataKey.plaintext,'base64'), iv)

      let credentials = { accessKeyId: '', secretAccessKey: '' }

      if ('_awsCredentialsObject' in config && config._awsCredentialsObject !== null) {
        credentials.accessKeyId = config._awsCredentialsObject.accessKeyId,
        credentials.secretAccessKey = config._awsCredentialsObject.secretAccessKey
      } else {
        // get default Credentials
        let AWS = require('aws-sdk')
        if (AWS.config.credentials == null) {
          // no default AWS credentials and no profile defined in sampic config
          throw new Error(`Can't find AWS credentials to use for deploy command`)
        } else {
          credentials.accessKeyId = AWS.config.credentials.accessKeyId,
          credentials.secretAccessKey = AWS.config.credentials.secretAccessKey
        }
      }

      let encrypted = cipher.update(JSON.stringify(credentials))
      encrypted = Buffer.concat([encrypted, cipher.final()])

      return [
        dataKey.ciphertext,
        iv.toString('base64'),
        encrypted.toString('base64')
      ].join(':')
    })
    .then(credentials => ({ config, uploadInfo, credentials }))
  })

  .then(({ config, uploadInfo, credentials }) => {
    // POST branch config to API to initiate deployment with application
    // code bundle that has just been uploaded
    core.utils.stdout(`Launching remote build and deploy`,{level:2})
    return core.api.executions.launchExecution(uploadInfo.bundleId, config, credentials)
  })

  .then(({body:exec}) => {
    core.utils.stdout(`Executing build and deploy`,{level:1})
    let _printQueuedInfo = exec.queued
    if (_printQueuedInfo) {
      core.utils.stdout('Max concurrent execution reached, waiting for running executions to complete ...',{
        level: 2,
        mode: core.utils.STDOUT_MODES.START_LINE
      })
    }
    return new Promise((resolve, reject) => {
      let _progress = []
      let _executionCompleted = false
      let _stagePrettyNames = {
        'build':
          'Building lambda code bundles and packaging template',
        'change-analysis':
          'Comparing packaged template to template currently deployed on stack',
        'update-lambda-functions':
          'Updating code of Lambda functions',
        'update-stack-parameters':
          'Updating stack parameters',
        'create-stack-change-set':
          'Creating stack change set',
        'execute-stack-change-set':
          'Executing stack change set',
      }
      let _markStageAsComplete = (stage, updates) => {
        // check if stage completed or failed and calculate time span
        let stageStart = updates.find(u => u.stage == stage && u.status == 'started')
        let stageEnd = updates.find(u => u.stage == stage && ['failed','completed'].indexOf(u.status) != -1)
        let state = (stageEnd.status == 'completed') ? chalk.green('\u2714') : chalk.red('\u2716')
        let timespan = ((stageEnd.time - stageStart.time) / 1000).toFixed(2)
        core.utils.stdout(`${_stagePrettyNames[stage]} ${state} (${timespan}s)`, {level:2, mode:core.utils.STDOUT_MODES.OVERWRITE_LINE})
        return stageEnd.status
      }
      let _interval = setInterval(() => {
        core.api.executions.getByName(exec.name)
        .then(({body:info}) => {
          if (_printQueuedInfo && info.started) {
            _printQueuedInfo = false
            core.utils.stdout(' ready',{
              level:2,
              mode: core.utils.STDOUT_MODES.CONTINUE_LINE
            })
          }
          if (info.statusUpdates && !_executionCompleted) {
            info.statusUpdates.forEach(u => {
              if (u.stage === null && u.status == 'completed') {
                clearInterval(_interval)
                _executionCompleted = true
                let endStatus = (_progress.length > 0) ? _markStageAsComplete(_progress.slice(-1),info.statusUpdates) : null
                core.utils.stdout(`Deploy completed`)
                core.utils.stdout(`For complete logs, run ${chalk.magenta(`sampic logs ${exec.name}`)}`)
                resolve(true)
              } else if (_progress.indexOf(u.stage) == -1) {
                let endStatus = (_progress.length > 0) ? _markStageAsComplete(_progress.slice(-1),info.statusUpdates) : null
                if (endStatus == 'failed') {
                  clearInterval(_interval)
                  _executionCompleted = true
                  core.utils.stdout(`Deploy failed`)
                  core.utils.stdout(`For complete logs, run ${chalk.magenta(`sampic logs ${exec.name}`)}`)
                  resolve(true)
                } else {
                  _progress.push(u.stage)
                  core.utils.stdout(_stagePrettyNames[u.stage] + ' ...', {level:2, mode:core.utils.STDOUT_MODES.START_LINE})
                }
              }
            })
          }
        })
        .catch(err => {
          clearInterval(_interval)
          reject(err)
        })
      }, 2000)
    })

  })
}

function _getCodeBundle(cmdOpts, core) {

  let cmdArgs = []
  let buildId = Math.floor(Math.random() * Math.pow(16,6)).toString(16)
  let bundleFile = path.resolve(`./.sampic/builds/${buildId}.zip`)

  if (cmdOpts.staged) {

    let _checkoutPrefix = `.sampic/builds/${buildId}/`

    return core.utils.run('git', [
      'checkout-index',
      '-a',
      `--prefix=${_checkoutPrefix}`
    ])
    .then(stdout => {
      return core.utils.run(
        'zip',
        [ '-r', bundleFile, '.' ],
        { cwd: path.resolve(`./${_checkoutPrefix}`) }
      )
    })
    .then(stdout => {
      return core.utils.rmdirSync(path.resolve(`./${_checkoutPrefix}`))
    })
    .then(stdout => bundleFile)

  } else {
    try {
      fs.mkdirSync(path.resolve('.sampic/builds'))
    } catch(e) { }
    return core.utils.run('git', [
      'archive',
      '--format=zip',
      `--output=.sampic/builds/${buildId}.zip`,
      'HEAD'
    ])
    .then(stdout => bundleFile)

  }
}
