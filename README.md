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
`deploy-local` | Packages your CloudFormation template using the `aws cloudformation package` command then deploys it to AWS. If the stack doesn't exist yet, it will create it. If changes since the last deployment only impact lambda function code, it will skip a full CloudFormation deploy and simply update lambda functions code (which is much faster).
`deploy` | Bundles git HEAD commit and uploads it to your sampic.cloud account for remote build and deploy. To include staged changes in the code to deploy, use the `--staged` option. Your Lambda code bundles are always built from dependencies listed in package-lock.json or package.json and installed within an Amazon Linux environment replicating the Lambda exection environment.
`logs` | Get detailed logs from a deploy triggered with the `deploy` command.
`signup` | Creates your sampic.cloud account required for `deploy` and `logs` command to work.

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

## The difference between `deploy` and `deploy-local`

The end result of both commands is pretty much the same: deploys your application on AWS in the fastest way possible depending on the changes that must be deployed. The difference is `deploy` does most of the work on our hosted service while `deploy-local` does it from your computer. It's not an either or type of thing, you can mix both depending on what you want. 

You'll find the detailed steps taken by each command below as well as a a quick rundown of the advantages and disadvantages of either commands.

### What happens when you run `deploy-local`
Sampic goes through the following steps:

1. Get current git branch and look for corresponding settings in `.sampic/config.json`
1. Fetch the currently deployed template for the CloudFormation stack specified in your config
1. Package your template by running `aws cloudformation package`. The output template file is saved as `.sampic/<STACK_NAME>-packaged-template.yaml`
1. If the stack doesn't currently exist on CloudFormation, deploy the packaged template to create it. Otherwise, compare the new packaged template and the current stack template to find differences:
    - If the only differences are code updates for Lambda functions, simply update function code of those Lambdas.
    - If the packaged template is identical to the deployed stack template but stack parameters in your config have changed, run `aws cloudformation update-stack` on the current template with the new stack parameter values.
    - If there are more changes, run `aws cloudformation deploy` to do a full stack update through change sets.
1. If all updates requests sent to AWS succeed, rename `.sampic/<STACK_NAME>-packaged-template.yaml` to `.sampic/<STACK_NAME>-deployed-template.yaml` and we're done.

### What happens when you run `deploy`
Sampic goes through the following steps:

1. Packages your application code and uploads it to sampic.cloud along with your config for the current branch
    - By default, it packages code as found in the latest git HEAD commit. Any changes that aren't committed are excluded. However, you can stage changes you want to deploy and run the command with `--staged` option to include those.
    - The config includes the AWS credentials of the profile so calls to AWS can be made on your behalf. The credentials are encrypted  on your box with a one-time encryption key *before* they're sent.
1. On the hosted service:
    1. Unzip the application code and look in the stack template for NodeJS lambda functions with npm dependencies
    1. Install all NPM dependencies based on package-lock.json or package.json file
    1. Prepare code bundles for all those lambda functions and packages the CloudFormation template using `aws cloudformation package`.
    1. Compare the packaged template and the current stack template to find differences: 
        - If the stack doesn't currently exist on CloudFormation, deploy the packaged template to create it.
        - If the only differences are code updates for Lambda functions, simply update function code of those Lambdas.
        - If the packaged template is identical to the deployed stack template but stack parameters in your config have changed, update the stack with updated parameter values.
        - If there are more changes, create a change set on the stack and execute it.

Steps 2.i-iii happen inside a Docker container running Amazon Linux and that container is used only once. Your build always happens in a fresh container. The service will cache lambda code bundles and their dependencies to speed up future builds. The cached data is stored in the S3 bucket defined in your sampic config so they remain under your control at all times.

### Advantages of running `deploy-local`

- It's a little bit quicker to deploy changes to Lambda functions with `deploy-local`. It just zips the code with dependencies as they are on your machine and uploads that to AWS. However, this has the downside of putting the onus on you to make sure npm packages are always installed and up-to-date locally. See the `deps-*` commands to help you with that.
- Everything happens between your machine and AWS, sampic is just there to help speed things up from your computer.

### Advantages of running `deploy`
- Dependencies for Lambda function are always installed based on what's specified in the package.json file. The code bundles always have all dependencies at the right version
- NPM dependencies of your Lambda functions that are compiled on install are compiled on the same Amazon Linux they'll run on.
- Since it deploys from git HEAD commit or working index (see `--staged` option), you get a finer control of what to deploy by moving changes between the working tree, the index and the repo.
- Get a simple and super fast continuous deployment pipeline by making it build and deploy as changes are pushed to your remote git repo (comming soon)
- It works better when your Lambda functions have soft links to shared code that is in the same repo but not under the function directory. The aws cli commands fails to include softlink targets when zipping the code but the build process of sampic doesn't.

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
