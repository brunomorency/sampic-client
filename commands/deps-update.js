'use strict'

module.exports = function run(cmdOpts, core) {

  core.api.analytics.record('deps-update',cmdOpts).then(r => {}).catch(err => {})

  return core.utils.getConfig(cmdOpts)
  .then(config => {
    core.utils.stdout('Loading stack template')
    return core.utils.getWorkingStackTemplate(config)
    .then(template => {
      return { config, template }
    })
  })
  .then(({config, template}) => {
    return core.deps.update(template, null, {parallel:cmdOpts.parallel})
    .then(success => ({config, template}))
  })
  .then(({config}) => {
    return true
  })

}
