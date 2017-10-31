const { spawn } = require('child_process')
const fs = require('fs')
const yaml = require('js-yaml')
const path = require('path')
const os = require('os')
const prompt = require('prompt')
const chalk = require('chalk')

const CONFIG_DIR = '.sampic'
const TOKEN_DIR = `${os.homedir()}/.sampic`
const TOKEN_FILE_NAME = 'tokens.json'
const CONFIG_DIR_LEGACY = '.sampique'

class RunError extends Error {
  constructor(exitCode, message) {
    super(message)
    this.exitCode = exitCode
  }
}

let _stdoutIsOnNewLine = true
let _customStdout = null
let _stdoutMuted = false
const MANDATORY_STDOUT_METHODS = ['write','clearLine','cursorTo']

module.exports = _utils = {

  UPDATE_TYPES: {
    LAMBDA_FNS: 'LAMBDA_CODE_ONLY',
    STACK_PARAMS: 'CF_STACK_PARAMS_ONLY',
    LAMBDA_AND_STACK_PARAMS: 'LAMBDA_AND_STACK_PARAMS',
    STACK_UPDATE: 'CF_STACK_UPDATE',
    STACK_CREATE: 'CF_STACK_CREATE',
    NO_CHANGES: 'NO_CHANGES'
  },

  STDOUT_MODES: {
    OWN_LINE: 0,
    START_LINE: 1,
    TERMINATE_LINE: 2,
    CONTINUE_LINE: 3,
    OVERWRITE_LINE: 4,
    PARAGRAPH: 5,
    RAW: 6
  },

  stdout: (message, opts={}) => {
    let _opts = Object.assign({
      mode: _utils.STDOUT_MODES.OWN_LINE,
      level: 0
    }, opts)

    let msg = '', prefix = ''
    if (_opts.level == 1) {
      msg = chalk.bold(message)
    } else if (_opts.level > 1) {
      prefix = Array.from(Array(_opts.level - 1), elm => '  ').join('')
      msg = chalk.gray(message)
    } else {
      msg = message
    }

    let _stdout = {}
    if (_customStdout === null) {
      if (_stdoutMuted) {
        _stdout = {
          write: () => {},
          clearLine: () => {},
          cursorTo: () => {},
        }
      }
      else {
        _stdout = process.stdout
      }
    } else {
      _stdout = _customStdout
    }

    switch (_opts.mode) {

      case _utils.STDOUT_MODES.OWN_LINE:
      if (!_stdoutIsOnNewLine) prefix = '\n'+prefix
      _stdout.write(`${prefix}${msg}\n`)
      _stdoutIsOnNewLine = true
      break

      case _utils.STDOUT_MODES.START_LINE:
      if (!_stdoutIsOnNewLine) prefix = '\n'+prefix
      _stdout.write(`${prefix}${msg}`)
      _stdoutIsOnNewLine = false
      break

      case _utils.STDOUT_MODES.TERMINATE_LINE:
      _stdout.write(`${prefix}${msg}\n`)
      _stdoutIsOnNewLine = true
      break

      case _utils.STDOUT_MODES.CONTINUE_LINE:
      // don't apply prefix if continuing previous line
      _stdout.write(msg);
      _stdoutIsOnNewLine = false
      break

      case _utils.STDOUT_MODES.OVERWRITE_LINE:
      _stdout.clearLine();
      _stdout.cursorTo(0);
      _stdout.write(`${prefix}${msg}`);
      _stdoutIsOnNewLine = false
      break

      case _utils.STDOUT_MODES.PARAGRAPH:
      if (!_stdoutIsOnNewLine) prefix = '\n'+prefix
      _stdout.write(`\n${prefix}${msg}\n`)
      _stdoutIsOnNewLine = true
      break

      case _utils.STDOUT_MODES.RAW:
      _stdout.write(msg);
      break
    }
  },

  overrideStdout: (customStdout) => {
    if (typeof customStdout != 'object') {
      throw new Error('Can\'t override stdout with a non-object')
    }
    _customStdout = {}
    MANDATORY_STDOUT_METHODS.forEach(method => {
      if (!(method in customStdout) || typeof customStdout[method] != 'function') {
        throw new Error(`stdout override must implement '${method}'`)
      }
      _customStdout[method] = function () {
        let preventDefault = customStdout[method].apply(null, arguments)
        if (!preventDefault && !_stdoutMuted) {
          process.stdout[method].apply(process.stdout, arguments)
        }
      }
    })
  },

  releaseStdout: (customStdout) => {
    _customStdout = null
  },

  // customStdout handlers passed to overrideStdout are still called
  // but default stdout.write won't be written even if the custom handler
  // returns false
  muteStdout: () => {
    _stdoutMuted = true
  },
  unmuteStdout: () => {
    _stdoutMuted = false
  },

  run: (cmd, args=[], opts={}, onData=null) => {

    return new Promise((resolve, reject) => {

      let proc = spawn(cmd, args, opts)
      let _stdout = '', _stderr = ''

      if (!opts.stdio || opts.stdio == 'pipe' || opts.stdio[1] == 'pipe') {
        proc.stdout.on('data', data => {
          _stdout += data.toString()
          if (onData && onData.stdout) {
            onData.stdout(data.toString().trim().split('\n'))
          }
        })
      }
      if (!opts.stdio || opts.stdio == 'pipe' || opts.stdio[2] == 'pipe') {
        proc.stderr.on('data', data => {
          _stderr += data.toString()
          if (onData && onData.stderr) {
            onData.stderr(data.toString().trim().split('\n'))
          }
        })
      }
      proc.on('error', err => {
        reject(new Error(`Error with command: ${err.stack}`));
      });
      proc.on('close', code => {
        if (code !== 0) {
          if (_stderr.length > 0) {
            _utils.stdout(chalk.bold.red('Command error:'))
            _stderr.split('\n').forEach(line => _utils.stdout(`\t${line}`))
          }
          reject(new RunError(code, `Command '${cmd} ${args.join(' ')}' closed with exit code ${code}`));
        }
        else resolve(_stdout.trim().split('\n'))
      })

    })
  },

  getPathToConfig: (fallbackToLegacy) => {
    if (fallbackToLegacy === false) return CONFIG_DIR
    try {
      fs.accessSync(path.resolve(CONFIG_DIR))
      return CONFIG_DIR
    } catch(e) {
      return CONFIG_DIR_LEGACY
    }
  },

  getCurrentGitBranch: () => {
    return _utils.run('git', ['status','--branch','--porcelain'])
    .then(stdout => {
      return stdout[0].match(/## (.+?)(?:\.{3}|$)/).pop()
    })
  },

  getConfig: (cmdOpts={}) => {

    const fullPath = _utils.getPathToConfig()
    const packagedTemplateFileSuffix = 'packaged-template'
    const deployedTemplateFileSuffix = 'deployed-template'

    _utils.stdout('Loading config ...',{level:0, mode:_utils.STDOUT_MODES.START_LINE})

    function _getBranchConfig() {
      return new Promise((resolve, reject) => {
        if ('config' in cmdOpts) return resolve(cmdOpts.config)

        try {
          var configByBranch = JSON.parse(fs.readFileSync(`${fullPath}/config.json`))
        } catch(e) {
          _utils.stdout(chalk.red('Unable to read sampic config.'), {mode:_utils.STDOUT_MODES.OVERWRITE_LINE})
          _utils.stdout(`Run 'sampic init' from your project root directory to generate a sample config file.`)
          return reject(e)
        }

        _utils.getCurrentGitBranch()
        .then(branchName => {
          _utils.stdout(`Current git branch is ${chalk.bold(branchName)}`,{mode:_utils.STDOUT_MODES.OVERWRITE_LINE})
          if (branchName in configByBranch) {
            resolve(configByBranch[branchName])
          }
          else {
            return reject(new Error(`No deployment configuration set for current git branch`))
          }
        })
      })
    }

    function _initAwsCredentials(cfg) {
      var AWS = require('aws-sdk')
      if ('awsCredentials' in cmdOpts && cmdOpts.awsCredentials.accessKeyId && cmdOpts.awsCredentials.secretAccessKey) {
        return new AWS.Credentials(cmdOpts.awsCredentials.accessKeyId, cmdOpts.awsCredentials.secretAccessKey)
      }
      else if ('profile' in cfg) {
        return new AWS.SharedIniFileCredentials({ profile: cfg.profile })
      } else {
        return null
      }
    }

    return _getBranchConfig()
    .then(cfg => {

      // set default s3Bucket value
      if (!('s3Bucket' in cfg) || typeof cfg.s3Bucket != 'string') {
        cfg.s3Bucket = `${cfg.stackName}-build-artifacts`
      }

      if ('stacks' in cfg) {
        // config lists different stacks we can deploy to, make sure the stack keywords
        // has been defined as CLI arg, prompt user if not
        let definedStacks = Object.keys(cfg.stacks)
        if (cmdOpts.stack === null) {
          return new Promise((resolve, reject) => {
            _utils.stdout(`Config lists multiple stacks, which one should be used?\n  ${definedStacks.map((s, i) => `(${i+1}) ${cfg.stacks[s].template} => ${cfg.stacks[s].name}`).join('\n  ')}\n`)
            prompt.message = ''
            prompt.delimiter = ''
            prompt.start()
            prompt.get({
              properties: {
                stackIndex: {
                  description: `Enter stack number [1-${definedStacks.length}]: `,
                  type: 'number'
                }
              }
            }, (err, promptEntry) => {
              if (promptEntry.stackIndex > definedStacks.length || promptEntry.stackIndex < 1) {
                return reject(new Error(`Stack number ${promptEntry.stackIndex} isn't valid`))
              }
              let stackKey = definedStacks[promptEntry.stackIndex - 1]
              cfg.stackName = cfg.stacks[stackKey].name
              cfg.stackParameters = cfg.stacks[stackKey].parameters || null
              cfg.template = cfg.stacks[stackKey].template
              cfg._packagedTemplateFile = `${fullPath}/${cfg.stackName}-${packagedTemplateFileSuffix}.yaml`
              cfg._deployedTemplateFile = `${fullPath}/${cfg.stackName}-${deployedTemplateFileSuffix}.yaml`
              cfg._awsCredentialsObject = _initAwsCredentials(cfg)
              delete cfg.stacks
              resolve(cfg)
            })
          })
        } else {
          if (definedStacks.indexOf(cmdOpts.stack) == -1) {
            throw new Error(`Stack key '${cmdOpts.stack}' not found in branch config.\nValid stack keys:\n  ${definedStacks.join('\n  ')}`)
          }
          cfg.stackName = cfg.stacks[cmdOpts.stack].name
          cfg.stackParameters = cfg.stacks[cmdOpts.stack].parameters || null
          cfg.template = cfg.stacks[cmdOpts.stack].template
          cfg._packagedTemplateFile = `${fullPath}/${cfg.stackName}-${packagedTemplateFileSuffix}.yaml`
          cfg._deployedTemplateFile = `${fullPath}/${cfg.stackName}-${deployedTemplateFileSuffix}.yaml`
          cfg._awsCredentialsObject = _initAwsCredentials(cfg)
          delete cfg.stacks
          return cfg
        }
      } else {
        cfg._packagedTemplateFile = `${fullPath}/${cfg.stackName}-${packagedTemplateFileSuffix}.yaml`
        cfg._deployedTemplateFile = `${fullPath}/${cfg.stackName}-${deployedTemplateFileSuffix}.yaml`
        cfg._awsCredentialsObject = _initAwsCredentials(cfg)
        return cfg
      }
    })
  },

  getTokens: () => {
    try {
      let tokens = JSON.parse(fs.readFileSync(`${TOKEN_DIR}/${TOKEN_FILE_NAME}`))
      return (Array.isArray(tokens)) ? tokens : []
    } catch(e) {
      return []
    }
  },

  saveToken: (email, token) => {
    let tokens = _utils.getTokens()
    if (tokens.length == 0) {
      // make sure path where tokens are saved exists
      try {
        fs.mkdirSync(TOKEN_DIR)
      } catch(e) { }
    }
    let idx = tokens.findIndex(elm => elm.email == email)
    if (idx >= 0) tokens[idx].token = token
    else tokens.push({ email, token })
    fs.writeFileSync(`${TOKEN_DIR}/${TOKEN_FILE_NAME}`, JSON.stringify(tokens, null, 2))
  },

  getWorkingStackTemplate: (config) => {
    try {
      let template = yaml.safeLoad(
        fs.readFileSync(config.template, 'utf8'),
        { schema: require('cloudformation-schema-js-yaml') }
      )
      return Promise.resolve(template)
    } catch (e) {
      return Promise.reject(e)
    }
  },

  confirmStackExists: (CFclient, stackName) => {
    // Don't have a previous version of deployed template,
    // Check if the stack exists and fetch current template if so
    function _fetchStackList(callback, NextToken=null) {
      let listParams = {
        StackStatusFilter: [
          'CREATE_IN_PROGRESS',
          'CREATE_FAILED',
          'CREATE_COMPLETE',
          'ROLLBACK_IN_PROGRESS',
          'ROLLBACK_FAILED',
          'ROLLBACK_COMPLETE',
          'UPDATE_IN_PROGRESS',
          'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS',
          'UPDATE_COMPLETE',
          'UPDATE_ROLLBACK_IN_PROGRESS',
          'UPDATE_ROLLBACK_FAILED',
          'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS',
          'UPDATE_ROLLBACK_COMPLETE',
          'REVIEW_IN_PROGRESS'
        ]
      }
      if (NextToken) listParams.NextToken = NextToken
      CFclient.listStacks(listParams, callback)
    }

    return new Promise((resolve, reject) => {
      function _onStackList(err, data) {
        if (err) reject(err)
        else {
          if (data.StackSummaries.filter(s => s.StackName == stackName).length > 0) {
            resolve(true)
          } else if (data.NextToken) {
            // stack not found yet but there are more
            _fetchStackList(_onStackList, data.NextToken)
          } else {
            // the stack doesn't exist on CloudFormation
            resolve(false)
          }
        }
      }

      _fetchStackList(_onStackList)
    })
  },

  getCurrentStackTemplate: (CFclient, config, useLocalCopy=false) => {
    try {
      if (useLocalCopy) {
        let template = yaml.safeLoad(
          fs.readFileSync(config._deployedTemplateFile, 'utf8'),
          { schema: require('cloudformation-schema-js-yaml') }
        )
        return Promise.resolve(template)
      } else {
        throw new Error('Not using local of deployed template')
      }
    } catch (e) {
      return new Promise((resolve, reject) => {
        CFclient.getTemplate({
          StackName: config.stackName,
          TemplateStage: 'Original'
        }, (err, data) => {
          if (err && err.statusCode == 400 && err.code == 'ValidationError') {
            // that's the error we get when no stack by this name exist
            resolve(null)
          } else if (err) {
            reject(err)
          } else {
            resolve(yaml.safeLoad(
              data.TemplateBody,
              { schema: require('cloudformation-schema-js-yaml') }
            ))
          }
        })
      })
    }
  },

  getStackDescription: (CFclient, stackName) => {
    return new Promise((resolve, reject) => {
      CFclient.describeStacks({
        StackName: stackName
      }, (err, data) => {
        if (err && err.statusCode == 400 && err.code == 'ValidationError') {
          // that's the error we get when no stack by this name exist
          resolve(null)
        } else if (err) {
          reject(err)
        } else {
          resolve(data.Stacks.find(s => s.StackName == stackName) || null)
        }
      })
    })
  },

  getStackStatus: (CFclient, stackName) => {
    return _utils.getStackDescription(CFclient, stackName)
    .then(stackInfo => {
      return (stackInfo && stackInfo.StackStatus) || null
    })
  },

  getFunctionDependencies: (fnPath) => {
    let packageLockInfo = null, packageInfo = null
    try {
      packageLockInfo = JSON.parse(fs.readFileSync(`${fnPath}/package-lock.json`))
    } catch (e) {}
    try {
      packageInfo = JSON.parse(fs.readFileSync(`${fnPath}/package.json`))
    } catch (e) {}

    if (packageLockInfo || packageInfo) {
      return {
        type: 'npm',
        packages: (packageLockInfo || packageInfo).dependencies || null
      }
    } else {
      return {
        type: null,
        packages: null
      }
    }
  },

  announce: (messageKey, message, noRepeatPeriod = 60*1000, delayUntilFirst = 0) => {
    let announcementsFile = path.normalize(`${__dirname}/..`) + '/.announcements'
    try {
      let timestamps = JSON.parse(fs.readFileSync(announcementsFile))
      let writeFile = false
      if (!(messageKey in timestamps)) {
        timestamps[messageKey] = (delayUntilFirst > 0) ? Date.now() - noRepeatPeriod + delayUntilFirst : 0
        writeFile = true
      }
      if (timestamps[messageKey] + noRepeatPeriod < Date.now()) {
        _utils.stdout(message,{mode:_utils.STDOUT_MODES.PARAGRAPH})
        timestamps[messageKey] = Date.now()
        writeFile = true
      }
      if (writeFile) fs.writeFileSync(announcementsFile, JSON.stringify(timestamps))
    } catch (err) {
      if (err.code === 'ENOENT') {
        fs.writeFileSync(announcementsFile, JSON.stringify({}))
        return _utils.announce(messageKey, message, noRepeatPeriod, delayUntilFirst)
      }
    }
  },

  rmdirSync: (dir) => {

    // Built-in fs.rmdir throws an error if directory isn't empty. This is a
    // solution equivalent to `rm -rf` that avoids using recursive functions
    // that could burst the recursion stack if tree is quite deep.
    // Taken from:
    //   https://gist.github.com/camelaissani/ab4a9e6d69088d6f03a46ee2fd4fd112

    var currentDirToRead,
        directoriesFound,
        nextDirToReadIndex

    if (!fs.existsSync(dir)) {
      return
    }

    currentDirToRead = dir
    directoriesFound = [dir]
    while (true) {
      fs.readdirSync(currentDirToRead).forEach(function(name) {
        var path = currentDirToRead+'/'+name
        var stat = fs.lstatSync(path)
        if (stat.isDirectory()) {
          directoriesFound.push(path)
        } else {
          fs.unlinkSync(path)
        }
      })
      nextDirToReadIndex = directoriesFound.indexOf(currentDirToRead) + 1
      if (nextDirToReadIndex >= directoriesFound.length) {
        break
      }
      currentDirToRead = directoriesFound[nextDirToReadIndex]
    }

    directoriesFound.reverse()
    directoriesFound.forEach(function(path) {
      fs.rmdirSync(path)
    })

  }

}
