const { spawn } = require('child_process')
const fs = require('fs')
const yaml = require('js-yaml')
const path = require('path')
const git = require('nodegit')
const prompt = require('prompt')

const CONFIG_DIR = '.sampique'

module.exports = _utils = {

  run: (cmd, args=[], opts={}, onData=null) => {

    return new Promise((resolve, reject) => {

      let proc = spawn(cmd, args, opts)
      let stdout = [], stderr = []

      proc.stdout.on('data', data => {
        let lines = data.toString().trim().split('\n')
        stdout = stdout.concat(lines)
        if (onData && onData.stdout) onData.stdout(lines)
      })
      proc.stderr.on('data', data => {
        let lines = data.toString().trim().split('\n')
        stderr = stderr.concat(data.toString().trim().split('\n'))
        if (onData && onData.stderr) onData.stderr(lines)
      })
      proc.on('error', err => {
        reject(new Error(`Error with command: ${err.stack}`));
      });
      proc.on('close', code => {
        if (code !== 0) {
          console.log('Command error:')
          stderr.forEach(line => console.log(`\t${line}`))
          reject(new Error(`command closed with code ${code}`));
        }
        else resolve(stdout)
      })

    })
  },

  getPathToConfig: () => {
    return path.resolve(CONFIG_DIR)
  },

  getCurrentGitBranch: () => {
    return git.Repository.open(path.resolve('.git'))
    .then(repo => repo.getCurrentBranch())
    .then(branchRef => {
      return branchRef.name().replace(/^refs\/heads\//,'')
    })
  },

  getConfig: (cliOpts={}) => {

    const fullPath = path.resolve(CONFIG_DIR)
    const packagedTemplateFileSuffix = 'packaged-template'
    const deployedTemplateFileSuffix = 'deployed-template'
    try {
      var configByBranch = JSON.parse(fs.readFileSync(`${fullPath}/config.json`))
    } catch(e) {
      console.log(`Unable to read config from ${CONFIG_DIR}/config.json\nMake sure you are in the root of your project and run 'sampique init' to generate a sample config file.`)
      return Promise.reject(e)
    }

    return _utils.getCurrentGitBranch()
    .then(branchName => {
      if (branchName in configByBranch) {
        console.log(`Using config for current git branch: ${branchName}`)
        let cfg = configByBranch[branchName]

        if ('stacks' in cfg) {
          // config lists different stacks we can deploy to, make sure the stack keywords
          // has been defined as CLI arg, prompt user if not
          let definedStacks = Object.keys(cfg.stacks)
          if (cliOpts.stack === null) {
            return new Promise((resolve, reject) => {
              prompt.message = `Which stack?\n  ${definedStacks.map((s, i) => `(${i+1}) ${cfg.stacks[s].template} => ${cfg.stacks[s].name}`).join('\n  ')}\n`
              prompt.delimiter = ''
              prompt.start()
              prompt.get({
                properties: {
                  stackIndex: {
                    description: 'Specify stack number: ',
                    type: 'number',
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
                delete cfg.stacks
                resolve(cfg)
              })
            })
          } else {
            if (definedStacks.indexOf(cliOpts.stack) == -1) {
              throw new Error(`Stack key '${cliOpts.stack}' not found in branch config.\nValid stack keys:\n  ${definedStacks.join('\n  ')}`)
            }
            cfg.stackName = cfg.stacks[cliOpts.stack].name
            cfg.stackParameters = cfg.stacks[cliOpts.stack].parameters || null
            cfg.template = cfg.stacks[cliOpts.stack].template
            cfg._packagedTemplateFile = `${fullPath}/${cfg.stackName}-${packagedTemplateFileSuffix}.yaml`
            cfg._deployedTemplateFile = `${fullPath}/${cfg.stackName}-${deployedTemplateFileSuffix}.yaml`
            delete cfg.stacks
            return cfg
          }
        } else {
          cfg._packagedTemplateFile = `${fullPath}/${cfg.stackName}-${packagedTemplateFileSuffix}.yaml`
          cfg._deployedTemplateFile = `${fullPath}/${cfg.stackName}-${deployedTemplateFileSuffix}.yaml`
          return cfg
        }
      }
      else {
        throw new Error(`No deployment configuration set for current git branch (${branchName})`)
      }
    })
  },

  getCurrentStackTemplate: (CFclient, config) => {
    try {
      let template = yaml.safeLoad(fs.readFileSync(config._deployedTemplateFile, 'utf8'))
      return Promise.resolve(template)
    } catch (e) {
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
            if (data.StackSummaries.filter(s => s.StackName == config.stackName).length > 0) {
              // fetch current template for the stack
              CFclient.getTemplate({
                StackName: config.stackName,
                TemplateStage: 'Original'
              }, (err, data) => {
                if (err) reject(err)
                else {
                  resolve(yaml.safeLoad(data.TemplateBody))
                }
              })
            } else if (data.NextToken) {
              // stack not found yet but there are more
              _fetchStackList(_onStackList, data.NextToken)
            } else {
              // the stack doesn't exist on CloudFormation
              resolve(null)
            }
          }
        }

        _fetchStackList(_onStackList)
      })
    }
  },

  getStackDescription: (CFclient, stackName) => {
    return CFclient.describeStacks({ StackName: stackName })
    .promise()
    .then(data => {
      return data.Stacks.find(s => s.StackName == stackName) || null
    })
  },

  getStackStatus: (CFclient, stackName) => {
    return _utils.getStackDescription(CFclient, stackName)
    .then(stackInfo => {
      return (stackInfo && stackInfo.StackStatus) || null
    })
  }
}
