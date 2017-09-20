# SAMPIQUE
Deploy utility for AWS Serverless Application Model (SAM) based projects that significantly speeds up time to deploy updates when the only change is the code of Lambda function and the rest of the stack is the same.

It builds upon `aws cloudformation package` but will figure out if simply updating code of Lambda functions is enough or whether a complete `aws cloudformation deploy` is required.

## Install
Install this package globally.

```shell
npm install -g sampique
```

## usage

**Make sure yo have AWS CLI (version >= 1.11) installed and available in the shell environment.**

Make sure your current working branch is the branch to deploy and simply run the `sampique` command from your project base directory. *Note that changes saved but not yet committed _will be bundled_ in the deployment*.

```shell
sampique [<options>] [<command>] [<command-options>]
```

Three different commands can be executed: `install-deps`, `deploy`, and `help`.

### `install-deps`
This will parse your CloudFormation template file (see configuration below) and look for resources of type `AWS::Serverless::Function` whose runtime is a version of `nodejs` and `CodeUri` isn't an s3 url. For each of these functions, it will execute `npm install --production` in the directory `CodeUri` points to.

This is very useful when checking out a repo and you need to install npm packages on many functions. This does it in one single command.

### `deploy`
Packages your CloudFormation template using the `aws cloudformation package` command then deploys it to AWS. If the stack doesn't exist yet, it will create it. 

Sampique will check if changes since the last deployment only impact lambda function code. If so, it will skip a full CloudFormation deploy and simply update lambda functions code (which is much faster)

### `help`
Launches a bunch of flares pretty high up in the sky to signal you're in distress.

## Configuration Setup
Create a `.sampique` directory at the base of your project and add a `config.json` file under it. CloudFormation templates packaged by the `aws cloudformation package` will also go under this directory. It is a good idea to add it to your `.gitignore`.

The configuration file declares deployment parameters for git branches you want to deploy. For example, the config file defines deployment instructions when your working branch is `master` or `my-dev-branch`:

```json
{
  "master": {
    "profile": "default",
    "region": "us-east-1",
    "template": "app.yaml",
    "stackName": "my-staging-stack",
    "stackParameters": {
      "ParameterKey1": "ParameterValue1",
      "ParameterKey2": "ParameterValue2"
    },
    "s3Bucket": "lambdafns-staging",
    "capabilities": ["CAPABILITY_IAM"]
  },
  "my-dev-branch": {
    "profile": "default",
    "region": "us-east-1",
    "template": "app.yaml",
    "stackName": "my-dev-stack",
    "s3Bucket": "lambdafns-dev",
    "capabilities": ["CAPABILITY_IAM"]
  }
}
```

#### config parameters:
- `profile` (optional) refers to a named profile under `~/.aws/credentials`. No need to define this if you'll use the default AWS profile
- `region` is the AWS region your CloudFormation stack is deployed in
- `template` is your SAM template file
- `stackName` is the name of the CloudFormation stack this branch should be deployed to
- `stackParameters` (optional) passed as template parameters when deploying the template to CloudFormation
- `s3Bucket` is the bucket where artifacts (lambda function code, external swagger files, ...) are uploaded to
- `capabilities` is used when running to the `aws cloudformation deploy` command. See AWS docs for more but usually, deploying SAM templates need at least `CAPABILITY_IAM` listed in there.

### Application with multiple templates/stacks
If your application has more than one template deployed to different stacks, sampique supports that but the configuration is a bit different. 

```json
{
  "master": {
    "profile": "default",
    "region": "us-east-1",
    "template": "app.yaml",
    "stacks": {
      "myStackA": {
        "template": "stackA-template.yaml",
        "name": "stack-A"
      },
      "myStackB": {
        "template": "stackB-template.yaml",
        "name": "stack-A"
        "parameters": {
          "ParameterKey1": "ParameterValue1",
          "ParameterKey2": "ParameterValue2"
        }
      }
    },
    "s3Bucket": "lambdafns-staging",
    "capabilities": ["CAPABILITY_IAM"]
  }
}
```

Once you're config is set up with a `<branch>.stacks` option, `sampique deploy` will list stack names and ask you which template you want to deploy:

```shell
$ sampique deploy
Using config for current git branch: master
Which stack should be deployed?
  (1) stack-A
  (2) stack-B
Specify stack number:  
```

Alternatively, you can use the stack key (`<branch>.stacks.<stackKey>`) from CLI to skip the prompt:

```shell
$ sampique deploy --stack myStackA
```

## How it works
The script goes through the following steps:

1. Read from `.sampique/config.json`, figure out current git branch and look for instructions for that branch
1. Load the curent deployed template, either from a previously package template saved under `.sampique/` or from CloudFormation if none are found locally.
1. Package your app by running `aws cloudformation package`. Output template files can be found under `.sampique` directory.
1. Compare the new packaged template to the current deployed template. If the only changes are `CodeUri` properties for some Lambda functions, directly update the function code for these lambdas. If there are more changes, run `aws cloudformation deploy` to do a full stack update.
