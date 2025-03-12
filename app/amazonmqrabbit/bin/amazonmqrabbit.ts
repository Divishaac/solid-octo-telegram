#!/usr/bin/env node

import * as cdk from 'aws-cdk-lib';
import { AmazonmqrabbitStack } from '../lib/amazonmqrabbit-stack';
import { RolesStack } from '../lib/infra/roles-stack';
import { ConfigReader } from '../lib/util/configreader';
import { AlphaPipelineStack } from '../pipeline/infra/alpha-pipeline-stack';
import { BetaPipelineStack } from '../pipeline/infra/beta-pipeline-stack';
import { ProdPipelineStack } from '../pipeline/infra/prod-pipeline-stack';


const deployEnv = process.env['DEPLOYENV'] || " ";

if ( deployEnv === " " ) {
    throw new Error("DEPLOYENV environment variable has not been set");
}

const cfgReader = new ConfigReader('/config/app.yml');
const prefix = cfgReader.get('prefix') || " ";

if (prefix === " ") {
    throw new Error("Missing prefix in /config/app.yml");
}

const account_ids = JSON.parse(JSON.stringify(cfgReader.get('accountids')));
const tooling_env = { account: account_ids['tooling'], region: cfgReader.get('region') };
const alpha_env = { account: account_ids['alpha'], region: cfgReader.get('region') };
//const beta_env = { account: account_ids['beta'], region: cfgReader.get('region') };
//const prod_env = { account: account_ids['prod'], region: cfgReader.get('region') };

const app = new cdk.App();
new AmazonmqrabbitStack(app, 'amazonmqrabbit-' + deployEnv, { env: alpha_env } );
// new AmazonmqrabbitStack(app, 'amazonmqrabbit-alpha', { env: alpha_env} );
// new AmazonmqrabbitStack(app, 'amazonmqrabbit-beta', { env: beta_env } );
// new AmazonmqrabbitStack(app, 'amazonmqrabbit-prod', { env: prod_env } );

const project_details = JSON.parse(JSON.stringify(cfgReader.get('tags')));

const infraTags: any = {
    PROJECT: prefix,
    BUSINESS_UNIT: project_details['BUSINESS_UNIT'],
    BUSINESS_CONTACT: project_details['BUSINESS_CONTACT'],
};

new RolesStack(app, 'amazonmqrabbit-bitbucketrole', { env: tooling_env, tags: infraTags } );
new AlphaPipelineStack(app, 'amazonmqrabbit-alpha-pipeline', { env: tooling_env, tags: infraTags });
new BetaPipelineStack(app, 'amazonmqrabbit-beta-pipeline', { env: tooling_env, tags: infraTags }); 
new ProdPipelineStack(app, 'amazonmqrabbit-prod-pipeline', { env: tooling_env, tags: infraTags });