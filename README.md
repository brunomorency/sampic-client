# sampique
Deploy utility for AWS Serverless Application Model (SAM) based projects that significantly speeds up time to deploy updates when the only change is the code of Lambda function and the rest of the stack is the same. 

It builds upon `aws cloudformation package` but will figure out if simply updating code of Lambda functions is enough or whether a complete `aws cloudformation deploy` is required.

## install
Install this package globally.

```shell
npm install -g sampique
```

You need to have AWS CLI installed and available in the shell environment when you run this

## setup
Create a `.sampique` directory at the base of your project and add a `config.json` file under it. CloudFormation templates packaged by the `aws cloudformation package` will also go under this directory. It is a good idea to add it to your `.gitignore`.

The configuration file declares deployment parameters for git branches you want to deploy. For example, the config file defines deployment instructions when your working branch is `master` or `my-dev-branch`:

```json
{
  "master": {
    "profile": "default",
    "region": "us-east-1",
    "template": "app.yaml",
    "stackName": "my-staging-stack",
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

### config parameters:
- `profile` refers to a named profile under `~/.aws/credentials`. No need to define this if you'll use the default AWS profile
- `region` is the AWS region your CloudFormation stack is deployed in
- `template` is yous SAM template file
- `stackName` is the name of the CloudFormation stack this branch should be deployed to
- `s3Bucket` is the bucket where artifacts (lambda function code, external swagger files, ...) are uploaded to
- `capabilities` is used when running to the `aws cloudformation deploy` command. See AWS docs for more but usually, deploying SAM templates need at least `CAPABILITY_IAM` listed in there.

## usage
Make sure your current working branch is the branch to deploy and simply run the `sampique` command from your project base directory. **Note that changes that aren't committed are included in the package/deploy process**.

### How it works
The script goes through the following steps:

1. Read from `.sampique/config.json`, figure out current git branch and look for instructions for that branch
1. Load the curent deployed template, either from a previously package template saved under `.sampique/` or from CloudFormation if none are found locally.
1. Package your app by running `aws cloudformation package`. Output template files can be found under `.sampique` directory.
1. Compare the new packaged template to the current deployed template. If the only changes are `CodeUri` properties for some Lambda functions, directly update the function code for these lambdas. If there are more changes, run `aws cloudformation deploy`
