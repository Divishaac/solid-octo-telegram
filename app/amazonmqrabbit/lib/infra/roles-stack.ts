import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { CfnAccessKey } from 'aws-cdk-lib/aws-iam';
import { ConfigReader } from '../util/configreader';
import { env } from 'process';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';


export class RolesStack extends cdk.Stack {

    private deployEnv: string;
    private prefix: string;
    private s3UploadBucket: s3.Bucket;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        let _deployEnv: string = process.env["DEPLOYENV"] || " ";

        if ( _deployEnv === " " ) {
            throw new Error( "DEPLOYENV environment variable has not been set" );
        }

        this.deployEnv = _deployEnv;

        const cfgReader = new ConfigReader('/config/app.yml');
        const prefix = cfgReader.get('prefix') || " ";

        if (prefix === " ") {
            throw new Error("Missing prefix in /config/app.yml");
        }

        this.prefix = prefix;

        //this.createBitBucketUser();
        console.log('Creating the ecr policy');
        this.getEcrGlobalPolicy();
        this.createPipelineinfra();
    }

    //  ---------------------------------------------

    private getEcrGlobalPolicy(): void {

        const s3UploadBucket = new s3.Bucket( this, 'amazonmqrabbit-bitbucket-s3-upload-artifacts-bucket', {
            versioned: true,
            publicReadAccess: false,
        });

        this.s3UploadBucket = s3UploadBucket;

        const ecrPolicy = iam.ManagedPolicy.fromManagedPolicyName(
            this,
            'bitbucket-pipeline-cdk-build-ecr',
            'bitbucket-pipeline-cdk-build-ecr',
        );

        const s3UploadPolicy = new iam.Policy(this, 's3-upload-policy', {
            statements: [
                new iam.PolicyStatement({
                    resources: [ s3UploadBucket.bucketArn + "/*" ],
                    effect: iam.Effect.ALLOW,
                    actions: [ "s3:PutObject",
                               "s3:PutObjectAcl",
                               "s3:GetObject",
                               "s3:GetObjectAcl",
                               "s3:ListMultipartUploadParts",
                               "s3:AbortMultipartUpload"]
                }),
                new iam.PolicyStatement({
                    resources: [ s3UploadBucket.bucketArn ],
                    effect: iam.Effect.ALLOW,
                    actions: [ "s3:ListBucketMultipartUploads",
                               "s3:ListBucket",
                               "s3:GetBucketLocation" ]
                }),
            ],
        });


        console.log(" policy is " + ecrPolicy.managedPolicyArn);


        const identityProvider = "arn:aws:iam::437863366236:oidc-provider/api.bitbucket.org/2.0/workspaces/bxbts/pipelines-config/identity/oidc";
        const conditions = { "StringEquals": { "api.bitbucket.org/2.0/workspaces/bxbts/pipelines-config/identity/oidc:aud": "ari:cloud:bitbucket::workspace/e7e3371e-d618-4085-991f-79e5a4d927b4"} };

        const bitbucketIdentity = new iam.WebIdentityPrincipal(identityProvider, conditions );

         const role = new iam.Role(this, 'bitbucket-iam-role', {
             assumedBy: bitbucketIdentity,
             description: 'An example IAM role in AWS CDK'
         });

         role.addManagedPolicy( ecrPolicy);
         role.attachInlinePolicy( s3UploadPolicy);

        new cdk.CfnOutput( this, "bitbucketRole", {
            value: role.roleArn,
            description: 'The role for deploying the application from Bitbucket',
            exportName: 'amazonmqrabbit-bitbucket-role'
        });

        new cdk.CfnOutput( this, "bitbucketS3Bucket", {
            value: s3UploadBucket.bucketName,
            description: 'The S3 bucket for uploading artifacts from Bitbucket',
            exportName: 'amazonmqrabbit-bitbucket-s3-upload-artifacts-bucket'
        });
    }

    //  ---------------------------------------------

    private createBitBucketUser(): void {

        // The code that defines your stack goes here
        const group = new iam.Group(this, 'bitbucket-group', {
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
            ],
        });

        // Create User
        const user = new iam.User(this, 'bitbucket-user', {
        userName: 'bitbucket-' + this.prefix,
            groups: [group]
        });

        new cdk.CfnOutput( this, "userName", {
            value: user.userName,
            description: 'The bitbucket pipelines user deploying the application',
            exportName: 'amazonmqrabbit-bitbucket-user'
        });
    }

    // ------------------------------------------------

    private createPipelineinfra(): void {

        const topic = new sns.Topic(this, 'amazonmqrabbit-PipelineResultNotification', {
            displayName: 'Pipeline results notification'
        });

        topic.addToResourcePolicy(new iam.PolicyStatement({
            actions: ['SNS:Publish'],
            resources: [topic.topicArn],
            principals: [ new iam.ServicePrincipal('codestar-notifications.amazonaws.com')],
            conditions: {"StringEquals": {"aws:SourceAccount": cdk.Stack.of(this).account}},
          }));

        const queue = new sqs.Queue(this, 'amazonmqrabbit-pipelineresults');

        const bitbucketStatusFunction = new lambda.Function(this, 'bitbucket-status', {
            memorySize: 1024,
            timeout: cdk.Duration.seconds(5),
            runtime: lambda.Runtime.PYTHON_3_9,
            handler: 'bitbucket-status.main',
            code: lambda.Code.fromAsset('lib/src/status'),
            environment: {
                "source_bucket_name": this.s3UploadBucket.bucketName
            }
        });

        topic.addSubscription(new subs.SqsSubscription(queue));
        topic.addSubscription(new subs.LambdaSubscription(bitbucketStatusFunction));
        this.s3UploadBucket.grantReadWrite(bitbucketStatusFunction);

        //  Central BitBucket 'username' and 'app-password' will automatically retrieve from AWS SecretsManager( no need to modify ) 

        const app_password = secretsmanager.Secret.fromSecretNameV2(this, "bitbucket-app-password", "aws-network-resources/bitbucket-app-password-bx-bts" )

        const bitbucketTrigger = new lambda.Function(this, 'bitbucket-trigger', {
            memorySize: 1024,
            timeout: cdk.Duration.seconds(10),
            runtime: lambda.Runtime.PYTHON_3_9,
            handler: 'bitbucket-trigger.main',
            code: lambda.Code.fromAsset('lib/src/trigger/trigger.zip'),
            environment: {
                "app_password_arn": app_password.secretArn
            }
        });

        app_password.grantRead( bitbucketTrigger );
        this.s3UploadBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(bitbucketTrigger))
        this.s3UploadBucket.grantReadWrite( bitbucketTrigger );

        new cdk.CfnOutput( this, "sns-topic-output", {
            value: topic.topicArn,
            description: 'The SNS topic for pipeline notifications',
            exportName: 'amazonmqrabbit-PipelineResultNotification'
        });
    }

}