import { AmazonmqrabbitStack } from '../lib/amazonmqrabbit-stack';
import { Stage, StageProps } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import { ConfigReader } from '../lib/util/configreader';
import { Construct } from 'constructs';

export class AmazonmqrabbitPipelineStage extends Stage {
    constructor(scope: Construct, id: string, props?: StageProps, deployEnv?: string) {
        super(scope, id, props);
        //const deployEnv = process.env['DEPLOYENV'] || " ";

        if ( deployEnv === " " ) {
            throw new Error("DEPLOYENV environment variable has not been set");
        }

        const cfgReader = new ConfigReader('/config/app.yml');
        const prefix = cfgReader.get('prefix') || " ";

        if (prefix === " ") {
            throw new Error("Missing prefix in /config/app.yml");
        }

        const project_details = JSON.parse(JSON.stringify(cfgReader.get('tags')));
        
        const tags: any = {
                            PROJECT: project_details['PROJECT'],
                            BUSINESS_UNIT: project_details['BUSINESS_UNIT'],
                            BUSINESS_CONTACT: project_details['BUSINESS_CONTACT'],
                            TIER: `${deployEnv}`,
                            Environment: `${prefix}-${deployEnv}`,
                };

        const stackName: string = `${prefix}-${deployEnv}`;

        const stackProps: cdk.StackProps = {tags, stackName};

        new AmazonmqrabbitStack(this, prefix, stackProps);

    }
}