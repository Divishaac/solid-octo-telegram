import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as notifications from 'aws-cdk-lib/aws-codestarnotifications';
import { ConfigReader } from '../../lib/util/configreader';
import { AmazonmqrabbitPipelineStage } from '../pipeline-stage';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, CodeBuildStep, ManualApprovalStep } from 'aws-cdk-lib/pipelines';
import iam = require("aws-cdk-lib/aws-iam");

export class ProdPipelineStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Pipeline code goes here
        const sourceBucketName = cdk.Fn.importValue( 'amazonmqrabbit-bitbucket-s3-upload-artifacts-bucket');

        const sourceBucket = s3.Bucket.fromBucketName(
            this,
            'source-bucket',
            sourceBucketName
        );

        const topicArn = cdk.Fn.importValue( 'amazonmqrabbit-PipelineResultNotification');

        const topic = sns.Topic.fromTopicArn( this, 'sns-topic', topicArn );

        const prod_source = CodePipelineSource.s3( sourceBucket, 'pipeline-prod.zip' );

        const prod_pipeline = new CodePipeline(this, 'prod-Pipeline', {
            crossAccountKeys: true,
            pipelineName: 'amazonmqrabbit-prod-pipeline',
            synth: new CodeBuildStep('SynthStep', {
                    input: prod_source,
                    installCommands: [
                        'npm install -g aws-cdk'
                    ],
                    commands: [
                        'cd app/amazonmqrabbit',
                        'export DEPLOYENV=prod',
                        'npm ci',
                        'npm run build',
                        'npx cdk synth'
                    ],
                    rolePolicyStatements: [
                      new iam.PolicyStatement({
                        actions: ['sts:AssumeRole'],
                        resources: ['arn:aws:iam::*:role/cdk-*'],
                      }),
                    ],
                    primaryOutputDirectory: 'app/amazonmqrabbit/cdk.out',
                }
            )
        });

        const cfgReader = new ConfigReader('/config/app.yml');
        const account_ids = JSON.parse(JSON.stringify(cfgReader.get('accountids')));
        const prod_env = { account: account_ids['prod'], region: cfgReader.get('region') };
        
        //===== Pipeline Stages code goes here to deploy application in to different environments=====//
        //===== Customize below stages and pipeline-stage.ts as per application requirements     =====//
        //===== Note: Before adding any stages to pipelines env_accounts needs to be bootstrapped ======//
        //===== Note: Contact Project Admins before uncommenting below stages                   ======// 

        //const prod_stage = new AmazonmqrabbitPipelineStage(this, 'Deploy_to_prod', { env: prod_env}, 'prod');
        //prod_pipeline.addStage(prod_stage, {pre: [ new ManualApprovalStep('Deploy to Prod')]}); 


        prod_pipeline.buildPipeline();

        const prod_rule = new notifications.NotificationRule(this, 'prod-NotificationRule', {
            source: prod_pipeline.pipeline,
            events: [
                'codepipeline-pipeline-pipeline-execution-started',
                'codepipeline-pipeline-pipeline-execution-failed',
                'codepipeline-pipeline-pipeline-execution-succeeded'
            ],
            targets: [topic],
         });
    }
}
