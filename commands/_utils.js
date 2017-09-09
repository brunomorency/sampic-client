const { spawn } = require('child_process')
const fs = require('fs')
const yaml = require('js-yaml')
const path = require('path')
const git = require('nodegit')

module.exports = {

  run: (cmd, args=[], opts={}, onData=null) => {

    return new Promise((resolve, reject) => {

      let proc = spawn(cmd, args, opts)
      let stdout = [], stderr = []

      proc.stdout.on('data', data => {
        let lines = data.toString().trim().split("\n")
        stdout = stdout.concat(lines)
        if (onData && onData.stdout) onData.stdout(lines)
      })
      proc.stderr.on('data', data => {
        let lines = data.toString().trim().split("\n")
        stderr = stderr.concat(data.toString().trim().split("\n"))
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

  getConfig: (configDir) => {

    const fullPath = path.resolve(configDir)
    try {
      var configByBranch = JSON.parse(fs.readFileSync(`${fullPath}/config.json`))
    } catch(e) {
      console.log(`Unable to read config from ${configDir}/config.json\nMake sure the config file is saved and that you run this command from the root of your project.`)
      return Promise.reject(e)
    }

    return git.Repository.open(path.resolve('.git'))
    .then(repo => repo.getCurrentBranch())
    .then(branchRef => {
      let branchName = branchRef.name().replace(/^refs\/heads\//,'')
      if (branchName in configByBranch) {
        console.log(`Using config for current git branch: ${branchName}`)
        let cfg = configByBranch[branchName]
        cfg._deployableTemplateFile = `${fullPath}/${cfg.stackName}-deployable-template.yaml`
        return cfg
      }
      else {
        throw new Error(`No deployment configuration set for current git branch (${branchName})`)
      }
    })
  },

  getCurrentStackTemplate: (CFclient, config) => {
    try {
      let template = yaml.safeLoad(fs.readFileSync(config._deployableTemplateFile, 'utf8'))
      return Promise.resolve(template)
    } catch (e) {
      // Don't have a previous version of deployed template,
      // Check if the stack exists and fetch current template if so
      return new Promise((resolve, reject) => {
        let nextToken = null
        do {
          CFclient.listStacks({ NextToken: nextToken }, (err, data) => {
            if (err) reject(err)
            else {
              if (data.StackSummaries.filter(s => s.StackName == config.StackName).length > 0) {
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
                nextToken = data.NextToken
              } else {
                // the stack doesn't exist on CloudFormation
                resolve(null)
              }
            }
          })
        } while (nextToken !== null)
      })
    }

  }

}
