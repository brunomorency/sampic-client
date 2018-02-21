'use strict'

const https = require('https')
const url = require('url')

const PACKAGE_VERSION = require('../package.json').version
var utils = require('./utils')

class ApiError extends Error {
  constructor(statusCode, headers, message) {
    super(message)
    this.statusCode = statusCode
    this.headers = headers
  }
}

module.exports = (function () {

  const BASE_URL = url.parse('https://api.sampic.cloud')

  function _newRequest({method, path, onComplete}, authToken='default') {
    let options = Object.assign({}, BASE_URL ,{
      method: method || 'GET',
      path: `${BASE_URL.path}${path}`.replace(/^\/\//,'/'),
      headers: {
        'User-Agent': `sampic-cli/${PACKAGE_VERSION}`
      }
    })
    if (authToken !== false) {
      let tokenEntry = (authToken == 'default') ? utils.tokens.getDefault() : utils.tokens.get(authToken)
      if (tokenEntry) {
        options.headers.Authorization = `Token ${tokenEntry.token}`
      } else {
        throw new Error(`No authorization token configured for '${authToken}'.`)
      }
    }
    return https.request(options, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        res.body = (res.headers['content-type'] == 'application/json' && body.length > 0) ? JSON.parse(body) : body
        onComplete(res)
      })
    })
  }

  let CLIENT = {
    executions: {

      getAppCodeUploadUrl: () => {
        return new Promise((resolve, reject) => {
          let _req = _newRequest({
            method: 'POST',
            path: '/executions/app-code-upload',
            onComplete: (res) => {
              if (res.statusCode == 201) {
                resolve(res)
              } else {
                reject(new ApiError(res.statusCode, res.headers, res.body.message || 'Error generating app code upload object'))
              }
            }
          })
          _req.on('error', err => {
            reject(new Error('Error sending request to generate app code upload object'))
          })
          _req.end()
        })
      },

      getCredentialsDataKey: () => {
        return new Promise((resolve, reject) => {
          let _req = _newRequest({
            method: 'POST',
            path: '/executions/credentials-data-key',
            onComplete: (res) => {
              if (res.statusCode == 201) {
                resolve(res)
              } else {
                reject(new ApiError(res.statusCode, res.headers, res.body.message || 'Error generating app code upload object'))
              }
            }
          })
          _req.on('error', err => {
            reject(new Error('Error sending request to obtain data key for credentials encryption'))
          })
          _req.end()
        })
      },

      launchExecution: (bundleId, branchConfig, credentials) => {
        return new Promise((resolve, reject) => {
          let _req = _newRequest({
            method: 'POST',
            path: '/executions',
            onComplete: (res) => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(res)
              } else {
                reject(new ApiError(res.statusCode, res.headers, res.body.message || 'Error launching remote build and deploy'))
              }
            }
          })
          _req.on('error', err => {
            reject(new Error('Error sending request to launch remote build and deploy'))
          })

          let config = {}
          ;[
            'region',
            'template',
            'stackName',
            'stackParameters',
            's3Bucket',
            'capabilities'
          ].forEach(prop => {
            if (prop in branchConfig) config[prop] = branchConfig[prop]
          })
          _req.write(JSON.stringify({ config, credentials, appCode: { source: 'upload', bundleId }}))
          _req.end()
        })
      },

      getByName: (name) => {
        return new Promise((resolve, reject) => {
          let _req = _newRequest({
            method: 'GET',
            path: `/executions/${name}`,
            onComplete: (res) => {
              if (res.statusCode == 200) {
                resolve(res)
              } else {
                reject(new ApiError(res.statusCode, res.headers, res.body.message || 'Error retrieving execution'))
              }
            }
          })
          _req.on('error', err => {
            reject(new Error('Error sending request to retrieve execution'))
          })
          _req.end()
        })
      },

      getLogs: (name) => {
        return new Promise((resolve, reject) => {
          let _req = _newRequest({
            method: 'GET',
            path: `/executions/${name}/logs`,
            onComplete: (res) => {
              if (res.statusCode == 200) {
                resolve(res)
              } else {
                reject(new ApiError(res.statusCode, res.headers, res.body.message || 'Error retrieving execution'))
              }
            }
          })
          _req.on('error', err => {
            reject(new Error('Error sending request to retrieve execution'))
          })
          _req.end()
        })
      }
    },

    users: {

      signup: (email, uuid=null) => {
        return new Promise((resolve, reject) => {
          let _req = _newRequest({
            method: 'POST',
            path: '/users',
            onComplete: (res) => {
              if (res.statusCode == 201) {
                resolve(res)
              } else {
                reject(new ApiError(res.statusCode, res.headers, res.body.message || 'Error signing up'))
              }
            }
          }, false)
          _req.on('error', err => {
            reject(new Error('Error sending request to create an account'))
          })
          let body = { email }
          if (uuid) body.uuid = uuid
          _req.write(JSON.stringify(body))
          _req.end()
        })
      }

    },

    analytics: {

      register: (uuid) => {
        return new Promise((resolve, reject) => {
          let _req = _newRequest({
            method: 'POST',
            path: '/analytics/clients',
            onComplete: (res) => {
              if (res.statusCode == 201) {
                resolve(res)
              } else {
                reject(new ApiError(res.statusCode, res.headers, res.body.message || 'Error registering anonymous client'))
              }
            }
          }, false)
          _req.on('error', err => {
            reject(new Error('Error sending request to register client for anonymous token'))
          })
          _req.write(JSON.stringify({ uuid }))
          _req.end()
        })
      },

      record: (command, opts={}) => {
        if (utils.prefs.get().allowAnonymousUsageAnalytics === false) return Promise.resolve({})
        return new Promise((resolve, reject) => {
          let _req = _newRequest({
            method: 'POST',
            path: '/analytics/events',
            onComplete: (res) => {
              if (res.statusCode == 204) {
                resolve(res)
              } else {
                reject(new ApiError(res.statusCode, res.headers, res.body.message || 'Error recording command'))
              }
            }
          })
          _req.on('error', err => {
            reject(new Error('Error sending request to retrieve execution'))
          })
          _req.write(JSON.stringify([{ command, opts, ts: Date.now() }]))
          _req.end()
        })
      }

    }
  }

  Object.freeze(CLIENT)
  Object.freeze(CLIENT.deployments)
  return CLIENT
})()
