# SAMPIC
Deploy utility for AWS Serverless Application Model (AWS-SAM) based projects that significantly speeds up time to deploy updates when the only change is the code of Lambda function and the rest of the stack is the same.

It builds upon `aws cloudformation package` but will figure out if simply updating code of Lambda functions or updating stack parameters is enough or whether a full `aws cloudformation deploy` is required.

## Why?

I prefer running my development work directly on AWS; you don't need to attempt to replicate all those AWS services locally, dev runs on exactly the same constraint as prod will, and switching between different computers is a breeze (I can even code from my iPad Pro while on the go!). That being said, while I love how AWS-SAM extends some aspects of CloudFormation, pushing tiny changes to a Lambda function with the recommended aws cli commands still needs to go through the whole change set routine is often waaaay too slow.

That's why I built sampic: make deploying updates to my dev environment as fast as possible and eventually get some sort of continuous deployment system that is fast enough to be used for dev environments, not just for staging and production.

The name sampic actually refers to scratching your own itch. In French, it reads as *ça me pique* which means *I have an itch*.

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


## Usage

**Make sure you have AWS CLI (version >= 1.11) and git installed and available in the shell environment when running sampic.**

Make sure your current working branch is the branch to deploy and simply run the `sampic` command from your project base directory. *Note that changes saved but not yet committed _will be bundled_ in the deployment*.

```shell
sampic [<options>] [<command>] [<command-options>]
```

The utility supports the following set of commands:

### Deploy updates

Command | Description
------- | -----------
`deploy` | Packages your CloudFormation template using the `aws cloudformation package` command then deploys it to AWS. If the stack doesn't exist yet, it will create it. If changes since the last deployment only impact lambda function code, it will skip a full CloudFormation deploy and simply update lambda functions code (which is much faster).

### Manage npm dependencies

Command | Description
------- | -----------
`deps-install` | Runs `npm install --production` for all NodeJS Lambda functions defined in your CloudFormation template. More precisely, it looks for `AWS::Serverless::Function` resource whose runtime is a version of `nodejs` and `CodeUri` is a local path. Use `--include-dev` to install all deve dependencies as well.
`deps-outdated` | Lists outdated npm packages for all NodeJS Lambda functions found in your CloudFormation template.
`deps-update` | Runs `npm update --save` for all NodeJS Lambda function defined in your CloudFormation template.

### Other commands
Command | Description
------- | -----------
`help` | Lists all commands with available options.
`show-config` | Prints out config option as defined in `.sampic/config.json` for the current git branch.
`init` | Creates a sample `.sampic/config.json` file in the present directory (unless it already exists).

### What happens when you run `deploy`
Sampic goes through the following steps:

1. Get current git branch and look for corresponding settings in `.sampic/config.json`
1. Fetch the currently deployed template for the CloudFormation stack specified in your config
1. Package your template by running `aws cloudformation package`. The output template file is saved as `.sampic/<STACK_NAME>-packaged-template.yaml`
1. If the stack doesn't currently exist on CloudFormation, deploy the packaged template to create it. Otherwise, compare the new packaged template and the current stack template to find differences:
    - If the only differences are code updates for Lambda functions, simply update function code of those Lambdas.
    - If the packaged template is identical to the deployed stack template but stack parameters in your config have changed, run `aws cloudformation update-stack` on the current template with the new stack parameter values.
    - If there are more changes, run `aws cloudformation deploy` to do a full stack update through change sets.
1. If all updates requests sent to AWS succeed, rename `.sampic/<STACK_NAME>-packaged-template.yaml` to `.sampic/<STACK_NAME>-deployed-template.yaml` and we're done.

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
