import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { aws_amazonmq as amazonmq } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class AmazonmqrabbitStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
        ManagedPolicy.fromAwsManagedPolicyName("SecretsManagerReadWrite")
      ]
    });
    // Create an SNS Topic
    const snsTopic = new sns.Topic(this, 'EmailForIncFeed', {
      displayName: 'IncFeedEmails',
    });
    snsTopic.addSubscription(new subs.EmailSubscription('divisha.chaturvedi@customerservice.nsw.gov.au'))
    // Create an Amazon MQ broker
    // const cfnBroker = new amazonmq.CfnBroker(this, 'BatmanBroker', {
    //   autoMinorVersionUpgrade: true,
    //   brokerName: 'Gotham',
    //   deploymentMode: 'SINGLE_INSTANCE',
    //   engineType: 'RABBITMQ',
    //   engineVersion: '3.10.20',
    //   hostInstanceType: 'mq.t3.micro',
    //   publiclyAccessible: true,
    //   users: [{
    //     password: 'rabbit123456', // should be 12-15 char long
    //     username: 'admin',
    //   }],
    // });

    // Define the Lambda Layer with 'pika' dependency
    const pikaLayer = new lambda.LayerVersion(this, 'PikaLayer', {
      code: lambda.Code.fromAsset('layer.zip'), // Replace with the path to your layer code (directory containing 'pika')
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_9], // Replace with the appropriate runtime if needed
    });

    const receive = new lambda.Function(this, 'Receive-from-MQ', {
      runtime: lambda.Runtime.PYTHON_3_9,
      role: lambdaRole,
      code: lambda.Code.fromAsset("lib"),
      memorySize: 5000,
      layers: [pikaLayer],
      timeout: cdk.Duration.minutes(15),
      handler: "receiver2.handler",
      environment:{
        SNS_TOPIC : snsTopic.topicArn
      }
    });
    const zip = new lambda.Function(this, 'Zip-Messages', {
      runtime: lambda.Runtime.PYTHON_3_9,
      role: lambdaRole,
      code: lambda.Code.fromAsset("lib"),
      memorySize: 1000,
      timeout: cdk.Duration.minutes(5),
      handler: "zip.handler",
      environment:{
        SNS_TOPIC : snsTopic.topicArn
      }
    });

    const policy = new iam.Policy(this, 'LambdaAccessPolicy', {
      policyName: 'LambdaAccessPolicy',
      statements: [
        // new iam.PolicyStatement({
        //   actions: ['mq:DescribeBroker'],
        //   resources: [cfnBroker.attrArn],
        // }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction', 'lambda:InvokeFunctionUrl'],
          resources: [receive.functionArn, zip.functionArn]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject', 's3:ListBucket'],
          resources: ["*"]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sns:Publish'],
          resources: [snsTopic.topicArn]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["mq:ListQueues", "mq:CreateQueue", "mq:DeleteMessage", "mq:GetQueueAttributes", "mq:PurgeQueue"],
          resources: [receive.functionArn, zip.functionArn]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["secretsmanager:GetSecretValue"],
          resources: [receive.functionArn, zip.functionArn]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ec2:CreateNetworkInterface', 'ec2:DeleteNetworkInterface', 'ec2:DescribeNetworkInterfaces', 'ec2:DescribeSecurityGroups', 'ec2:DescribeSubnets', 'ec2:DescribeVpcs'],
          resources: [receive.functionArn, zip.functionArn]
        }),
      ]
    });
    lambdaRole.attachInlinePolicy(policy);

    //Cloudwatch for scheduling lambda every hour
    // const rule1 = new events.Rule(this, 'BatIncFeedHourlyRule', {
    //   schedule: events.Schedule.rate( cdk.Duration.hours(1) ),
    // });
    // rule1.addTarget(new targets.LambdaFunction(receive));

    // const zipRule = new events.Rule(this, 'BatIncFeedZipRule', {
    //   schedule: events.Schedule.cron({ minute: '01', hour: '00' }), //11:30pm
    // });
    // zipRule.addTarget(new targets.LambdaFunction(zip));
  }
}
