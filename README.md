# SAMPIC
Deploy utility for AWS Serverless Application Model (SAM) based projects that significantly speeds up time to deploy updates when the only change is the code of Lambda function and the rest of the stack is the same.

It builds upon `aws cloudformation package` but will figure out if simply updating code of Lambda functions or updating stack parameters is enough or whether a full `aws cloudformation deploy` is required.

## Install
Install this package globally.

```shell
npm install -g sampic
```

Generate a sample config file for your current git working branch:

```shell
cd <project_directory>
sampic init
```


## usage

**Make sure you have AWS CLI (version >= 1.11) and git installed and available in the shell environment when running sampic.**

Make sure your current working branch is the branch to deploy and simply run the `sampic` command from your project base directory. *Note that changes saved but not yet committed _will be bundled_ in the deployment*.

```shell
sampic [<options>] [<command>] [<command-options>]
```

The utility supports the following set of commands:

### Manage npm dependencies

Command | Description 
------- | -----------
`deps-install` | Parses your CloudFormation template file (see configuration below) looking for resources of type `AWS::Serverless::Function` whose runtime is a version of `nodejs` and `CodeUri` isn't an s3 url. For each of these functions, it will execute `npm install --production` in the directory `CodeUri` points to.
`deps-outdated` | Lists outdated npm packages for all nodejs functions found in your CLoudFormation template
`deps-update` | Parses your CloudFormation template file (see configuration below) looking for resources of type `AWS::Serverless::Function` whose runtime is a version of `nodejs` and `CodeUri` isn't an s3 url. For each of these functions, it will execute `npm update --save` in the directory `CodeUri` points to.

### Deploy updates

Command | Description 
------- | -----------
`deploy-local` | Packages your CloudFormation template using the `aws cloudformation package` command then deploys it to AWS. If the stack doesn't exist yet, it will create it. If changes since the last deployment only impact lambda function code, it will skip a full CloudFormation deploy and simply update lambda functions code (which is much faster).
`deploy` | Bundles git HEAD commit and uploads it to your sampic.cloud account for remote build and deploy. Your Lambda code bundles are always built from dependencies listed in package-lock.json or package.json and installed within an Amazon Linux environment replicating the Lambda exection environment.
`logs` | Get detailed logs from a deploy triggered with the `deploy` command
`signup` | Creates your sampic.cloud account required for `deploy` and `logs` command to work

### Other commands
Command | Description 
------- | -----------
`help` | Launches a bunch of flares pretty high up in the sky to signal you're in distress.
`init` | Creates a sample `.sampic/config.json` file in the present directory (unless it already exists).

## Configuration Setup
Create a `.sampic` directory at the base of your project and add a `config.json` file under it. CloudFormation templates packaged by the `aws cloudformation package` will also go under this directory. It is a good idea to add it to your `.gitignore`.

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
If your application has more than one template deployed to different stacks, sampic supports that but the configuration is a bit different.

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

Once you're config is set up with a `<branch>.stacks` option, commands parsing your CloudFormation template will list stack names and ask you which template you want to work with:

```
$ sampic deploy
Using config for current git branch: master
Which stack?
  (1) stackA-template.yaml => stack-A
  (2) stackB-template.yaml => stack-B
Specify stack number:  
```

Alternatively, you can use the stack key (`<branch>.stacks.<key>`) from CLI to skip the prompt:

```shell
$ sampic deploy --stack myStackA
```

## What actually happens when you run `deploy-local`
The script goes through the following steps:

1. Gets current git working branch and looks for corresponding settings in `.sampic/config.json`
1. Based on the configured stack name, load the currently deployed template.
1. Package your template by running `aws cloudformation package`. The output template file is saved as `.sampic/<STACK_NAME>-packaged-template.yaml`
1. If no corresponding stack was found in CloudFormation, deploy the packaged template to create it. Otherwise, compare the new packaged template to the current stack template:
    - If the only difference is code updates for Lambda functions (stack parameters defined in the config haven't changed), simply update function code of those Lambdas.
    - If the packaged template is identical to the deployed stack template but stack parameters in the config are different, run `aws cloudformation update-stack` using the current template and specifying new parameter values.
    - If there are more changes, run `aws cloudformation deploy` to do a full stack update.
1. If all went well, rename `.sampic/<STACK_NAME>-packaged-template.yaml` as `.sampic/<STACK_NAME>-deployed-template.yaml` and we're done.
