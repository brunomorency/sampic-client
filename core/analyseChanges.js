'use strict'

const utils = require('./utils')
const { diff } = require('deep-diff')
const { CloudFormationClient } = require("@aws-sdk/client-cloudformation")
const { fromIni } = require("@aws-sdk/credential-providers")

module.exports = function run(config, templates) {

  utils.stdout(`Analysing changes with template currently deployed on stack ${config.stackName}`, {level:1})

  let cfConfig = {
    region: config.region
  }
  if (config.profile) {
    cfConfig.credentials = fromIni({profile: config.profile})
  }

  let cf = new CloudFormationClient(cfConfig)

  function _getUpdatedStackParams() {
    utils.stdout('Retrieving current stack parameters', {level:2})
    return utils.getStackDescription(cf, config.stackName)
    .then(stackDescription => {
      return Object.keys(config.stackParameters).filter(cfgParamKey => {
        let currentParam = stackDescription.Parameters.find(p => p.ParameterKey == cfgParamKey)
        return currentParam ? config.stackParameters[cfgParamKey] != currentParam.ParameterValue : true
      })
    })
  }

  let stackChanges = null

  return new Promise((resolve, reject) => {

    utils.stdout('Comparing current stack template with template to deploy', {level:2})
    stackChanges = diff(templates.current, templates.packaged)

    if (Array.isArray(stackChanges) && stackChanges.length > 0) {

      // Packaged template is different from current stack template.
      // Check if there are template changes that aren't simply new code
      // bundles for lambda fns

      let notJustLambdas = stackChanges.some(chg => (
        chg.kind !== 'E' ||
        chg.path[0] !== 'Resources' ||
        chg.path[chg.path.length-1] !== 'CodeUri' ||
        templates.current.Resources[chg.path[1]].Type.search(/^AWS::(Serverless|Lambda)::Function$/) === -1
      ))

      if (notJustLambdas) {
        // Need to do a full stack deploy because there have been changes
        // other than lambda code bundles
        utils.stdout(`Result: changes in stack, full cloudformation update required`,{level:2})
        resolve({
          updateType: utils.UPDATE_TYPES.STACK_UPDATE,
          stackChanges
        })
      } else if (config.stackParameters) {
        // The only changes between packaged template and current stack are
        // lambda code bundles. However, if stack parameters in config have
        // changed vs. current stack params, we'll also need to update the
        // stack with those new params
        _getUpdatedStackParams().then(updatedStackParams => {
          let updateType = null
          if (updatedStackParams.length > 0) {
            utils.stdout(`Result: changes in lambda functions and stack parameters`,{level:2})
            updateType = utils.UPDATE_TYPES.LAMBDA_AND_STACK_PARAMS
          } else {
            utils.stdout(`Result: changes limited to lambda functions`,{level:2})
            updateType = utils.UPDATE_TYPES.LAMBDA_FNS
          }
          resolve({
            updateType,
            stackChanges,
            updatedStackParams
          })
        })
      } else {
        // Stack has no parameters and the only changes between packaged
        // template and current stack are lambda code bundles
        utils.stdout(`Result: changes limited to lambda functions`,{level:2})
        resolve({
          updateType: utils.UPDATE_TYPES.LAMBDA_FNS,
          stackChanges
        })
      }

    } else {

      // Packaged template is identical to current stack template. Look for
      // possible changes in stack parameters

      if (config.stackParameters) {
        // If stack parameters in config have changed vs. current stack
        // we'll update the stack with those params. Otherwise, there's
        // nothing to do.
        _getUpdatedStackParams().then(updatedStackParams => {
          let updateType = null
          if (updatedStackParams.length > 0) {
            utils.stdout(`Result: changes limited to stack parameters`,{level:2})
            updateType = utils.UPDATE_TYPES.STACK_PARAMS
          } else {
            utils.stdout(`Result: no changes detected`,{level:2})
            updateType = utils.UPDATE_TYPES.NO_CHANGES
          }
          resolve({
            updateType,
            updatedStackParams
          })
        })
      } else {
        // Template is identical and stack has no parameters.
        // Nothing to do!
        utils.stdout(`Result: no changes detected`,{level:2})
        resolve({
          updateType: utils.UPDATE_TYPES.NO_CHANGES
        })
      }
    }

  })
}
