'use strict'

const prompt = require('prompt')
const wrap = require('word-wrap')
const emailValidator = require('email-validator')
const chalk = require('chalk')

module.exports = function run(cmdOpts, core) {

  return new Promise((resolve, reject) => {
    // ask for email address
    let intro = []
    intro.push(chalk.bold.underline('SIGNUP FOR A SAMPIC ACCOUNT'))
    intro.push(`SamPic is a hosted service which installs npm dependencies then packages and deploys your SAM application from an isolated environment replicating the execution environment of your Lambda functions.`)
    intro.push(`With npm dependencies installed (and compiled when necessary) in an Amazon Linux environment, you can trust the resulting code bundle to always contain the correct package versions and run well when executed in AWS Lambda.`)
    intro.push(`${chalk.underline('The service is in beta and offered free of charge during this time')}. If you have any questions, please do not hesitate to reach out and ask (email: bruno@mopolabs.com, twitter: @brunomorency).`)
    intro.forEach(paragraph => {
      core.utils.stdout(wrap(paragraph, { width: 80, indent: '' }), {mode:core.utils.STDOUT_MODES.PARAGRAPH})
    })
    core.utils.stdout('')

    prompt.message = ''
    prompt.delimiter = ''
    prompt.start()
    prompt.get({
      properties: {
        email: {
          name: 'email',
          description: 'Email address for your account: ',
          type: 'string',
          required: true,
          conform: emailValidator.validate,
          message: 'Please enter a valid email address to register'
        }
      }
    }, (err, promptEntry) => {
      if (err) {
        return reject(err)
      }
      resolve(promptEntry.email.toLowerCase())
    })
  })

  .then(email => {
    core.utils.stdout('Creating your account ...', {level:1, mode:core.utils.STDOUT_MODES.OWN_LINE})
    core.utils.stdout('Submitting email address', {level:2, mode:core.utils.STDOUT_MODES.TERMINATE_LINE})
    return core.api.users.signup(email, core.utils.prefs.get().uuid)
  })

  .then(({body: account}) => {
    core.utils.stdout('Saving authentication token under home dir', {level:2, mode:core.utils.STDOUT_MODES.TERMINATE_LINE})
    core.utils.tokens.save(account.email, account.authorizationToken, true)

    core.utils.stdout(`${String.fromCodePoint(127881)} Your account is ready!`, {level:0, mode:core.utils.STDOUT_MODES.OWN_LINE})
    core.utils.stdout(chalk.underline.bold('USAGE:'), {level:1, mode:core.utils.STDOUT_MODES.OWN_LINE})
    core.utils.stdout(`${chalk.bold.yellow('sampic deploy         ')} Bundles git HEAD commit then builds and deploys that according to config for current git branch`, {mode:core.utils.STDOUT_MODES.TERMINATE_LINE})
    core.utils.stdout(`${chalk.bold.yellow('sampic deploy --staged')} Same as above but app bundle includes changes staged in git index`, {mode:core.utils.STDOUT_MODES.TERMINATE_LINE})
    return true
  })

}
