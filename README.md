# SAMPIQUE
Deploy utility for AWS Serverless Application Model (SAM) based projects that significantly speeds up time to deploy updates when the only change is the code of Lambda function and the rest of the stack is the same.

It builds upon `aws cloudformation package` but will figure out if simply updating code of Lambda functions or updating stack parameters is enough or whether a full `aws cloudformation deploy` is required.

## Install
Install this package globally.

```shell
npm install -g sampique
```

Generate a sample config file for your current git working branch:

```shell
cd <project_directory>
sampique init
```


## usage

**Make sure you have AWS CLI (version >= 1.11) and git installed and available in the shell environment when running sampique.**

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

### `init`
Creates a sample `.sampique/config.json` file in the present directory (unless it already exists).

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
    "stacks": {
      "myStackA": {
        "template": "stackA-template.yaml",
        "name": "stack-A"
      },
      "myStackB": {
        "template": "stackB-template.yaml",
        "name": "stack-A",
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

```
$ sampique deploy
Using config for current git branch: master
Which stack?
  (1) stackA-template.yaml => stack-A
  (2) stackB-template.yaml => stack-B
Specify stack number:  
```

Alternatively, you can use the stack key (`<branch>.stacks.<key>`) from CLI to skip the prompt:

```shell
$ sampique deploy --stack myStackA
```

## What actually happens when you run `sampique deploy`
The script goes through the following steps:

1. Gets current git working branch and looks for corresponding settings in `.sampique/config.json`
1. Based on the configured stack name, load the currently deployed template.
1. Package your template by running `aws cloudformation package`. The output template file is saved as `.sampique/<STACK_NAME>-packaged-template.yaml`
1. If no corresponding stack was found in CloudFormation, deploy the packaged template to create it. Otherwise, compare the new packaged template to the current stack template: 
    - If the only difference is code updates for Lambda functions (stack parameters defined in the config haven't changed), simply update function code of those Lambdas. 
    - If the packaged template is identical to the deployed stack template but stack parameters in the config are different, run `aws cloudformation update-stack` using the current template and specofying new parameter values.
    - If there are more changes, run `aws cloudformation deploy` to do a full stack update.
1. If all went well, rename `.sampique/<STACK_NAME>-packaged-template.yaml` as `.sampique/<STACK_NAME>-deployed-template.yaml` and we're done.
