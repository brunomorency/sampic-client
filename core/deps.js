'use strict'

const path = require('path')
const utils = require('./utils')
const chalk = require('chalk')

function _deps(cmdArgs, template, hooks={}, parallel=false, onError=null, stdioMode=null) {

  // Get list of unique local paths with code for lambda functions
  let pathToNodeLambdas = Array.from(
    Object.keys(template.Resources)
    .filter(resourceLogicalId => {
      return (
        template.Resources[resourceLogicalId].Type.search(/^AWS::Serverless::Function$/) === 0 &&
        template.Resources[resourceLogicalId].Properties.Runtime.search(/^nodejs/) === 0 &&
        template.Resources[resourceLogicalId].Properties.CodeUri.substr(0,5) != 's3://'
      )
    })
    .map(logicalId => {
      return template.Resources[logicalId].Properties.CodeUri
    })
    .reduce((acc, p) => acc.add(p), new Set())
  )

  function _install(inPath, dependencies) {
    let prettyPath = path.relative(process.cwd(), inPath)
    let _stdioMode = (stdioMode) ? stdioMode : (parallel) ? 'pipe' : 'inherit'
    let _lineOpts = (_stdioMode == 'inherit') ? {
      mode: utils.STDOUT_MODES.PARAGRAPH,
      level: 0,
    } : {
      mode: utils.STDOUT_MODES.OWN_LINE,
      level: 2,
    }
    utils.stdout(`Running 'npm ${cmdArgs.join(' ')}' in ${chalk.cyan(prettyPath)}`, _lineOpts)
    return utils.run('npm', cmdArgs, {
      cwd: inPath,
      stdio: _stdioMode,
      // Not running npm install in its own shell failed when installing
      // packages from git urls. At some point, npm is running
      // `git rev-list -n1 <commit-ish>` and it seemed that not running in a shell
      // ran that command under inPath which fails because it needs to run in
      // the directory when the package code has been cloned
      shell: (cmdArgs[0] == 'install')
    })
    .then(output => {
      if (_stdioMode != 'inherit' && output.filter(l => l.trim().length > 0).length > 0) {
        utils.stdout(`Results for ${chalk.cyan(prettyPath)}:`,{level:2})
        output.forEach(l => utils.stdout(l,{level:3}))
      }
      if (hooks && typeof hooks.post == 'function') {
        return hooks.post(inPath, dependencies, output).then(() => output)
      }
    })
    .catch(err => {
      if (onError && typeof onError == 'function') return onError(err)
      else throw err
    })
  }

  function _runInPath(inPath) {
    let dependencies = utils.getFunctionDependencies(inPath)
    if (hooks && typeof hooks.pre == 'function') {
      return hooks.pre(inPath, dependencies)
      .then(installConfirmed => {
        return (installConfirmed) ? _install(inPath, dependencies) : Promise.resolve()
      })
    } else {
      return _install(inPath, dependencies)
    }
  }

  if (parallel) {
    return Promise.all(pathToNodeLambdas.map(aPath => _runInPath(path.resolve(aPath))))
    .then(() => {
      return true
    })
  } else {
    return pathToNodeLambdas.reduce((p, aPath) => p.then(() => _runInPath(path.resolve(aPath))), Promise.resolve())
    .then(() => {
      return true
    })

  }

}

module.exports = {

  install: function (template, hooks={}, opts={}) {
    let {parallel, includeDev, stdioMode} = Object.assign({parallel:false, includeDev:false, stdioMode:null},opts)
    let args = ['install']
    if (!includeDev) args.push('--production')
    return _deps(args, template, hooks, parallel, null, stdioMode)
  },

  update: function (template, hooks={}, opts={}) {
    let {parallel, stdioMode} = Object.assign({parallel:false, stdioMode:null},opts)
    return _deps(['update','--save'], template, hooks, parallel, null, stdioMode)
  },

  outdated: function (template, hooks={}, opts={}) {
    let {parallel, stdioMode} = Object.assign({parallel:false, stdioMode:null},opts)
    let onError = (err) => {
      if (err.exitCode && err.exitCode === 1) {
        // npm outdated command return exit code 1 if there are packages to
        // update. This should not be considered an error so we ignore it
        return true
      }
      else throw err
    }
    return _deps(['outdated'], template, hooks, parallel, onError, stdioMode)
  }

}
