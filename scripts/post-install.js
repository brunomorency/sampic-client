#!/usr/bin/env node
'use strict'

let generateUUID = require('uuid/v1')
const wrap = require('word-wrap')

let core = {
  utils: require(`../core/utils`),
  api: require(`../core/api`)
}

let tokens = core.utils.tokens.get()
let paragraph = `Sampic gathers anonymous usage stats to help improve the tool. You can opt-out by setting 'allowAnonymousUsageAnalytics' to 'false' in ${core.utils.prefs.getFilePath()}`

if (tokens.length == 0) {

  // install has no api tokens configured, set client UUID to be used for
  // anonymous usage stats

  let uuid = generateUUID()
  core.utils.prefs.set({
    uuid,
    allowAnonymousUsageAnalytics: true
  })
  core.utils.stdout(wrap(paragraph, { width: 80, indent: '' }), {mode:core.utils.STDOUT_MODES.PARAGRAPH})

} else {

  // tokens are already present, make sure one is set as default (0.7.0-rc
  // didn't set one)

  if (!core.utils.tokens.getDefault()) {
    // set first identified token as default
    let token = core.utils.tokens.get().find(t => t.email && t.email != null)
    if (token) {
      core.utils.tokens.save(token.email, token.token, true)
    } else {
      let anonymousToken = core.utils.tokens.get().find(t => !t.email)
      core.utils.tokens.save(null, anonymousToken.token, true)
    }
  }

  let prefs = core.utils.prefs.get()
  if (!('allowAnonymousUsageAnalytics' in prefs)) {
    core.utils.prefs.set({
      allowAnonymousUsageAnalytics: true
    })
    core.utils.stdout(wrap(paragraph, { width: 80, indent: '' }), {mode:core.utils.STDOUT_MODES.PARAGRAPH})
  }

}
