
import json
import os
from botocore.exceptions import ClientError
import boto3
from atlassian.bitbucket.cloud import Cloud
#from git import Repo
import sys
import requests
import logging
from http.client import HTTPConnection  # 

def get_secret( secret_arn ):

    # Create a Secrets Manager client
    session = boto3.session.Session()
    #client = session.client( service_name='secretsmanager', region_name=region_name )
    client = session.client( service_name='secretsmanager' )

    try:
        get_secret_value_response = client.get_secret_value( SecretId = secret_arn )

        if 'SecretString' in get_secret_value_response:
            secret = get_secret_value_response['SecretString']
            return secret
        else:
            decoded_binary_secret = base64.b64decode(get_secret_value_response['SecretBinary'])

    except ClientError as e:
        if e.response['Error']['Code'] == 'DecryptionFailureException':
            # Secrets Manager can't decrypt the protected secret text using the provided KMS key.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'InternalServiceErrorException':
            # An error occurred on the server side.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'InvalidParameterException':
            # You provided an invalid value for a parameter.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'InvalidRequestException':
            # You provided a parameter value that is not valid for the current state of the resource.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'ResourceNotFoundException':
            # We can't find the resource that you asked for.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        else:
            raise e
            
def trigger_step( workspace, project_name, repo_slug, build_number ):
    app_password_arn = os.environ["app_password_arn"]
    secret = get_secret( app_password_arn )

    jsonstring = json.loads(secret)

    # Central BitBucket 'username' and 'app-password' will automatically retrieve from AWS SecretsManager( no need to modify )

    username = jsonstring["username"]
    app_password = jsonstring["app-password"]

    cloud = Cloud( username = username, password = app_password, cloud = True )

    bxbts = cloud.workspaces.get( workspace )
    proj = bxbts.projects.get( project_name )

    repo = proj.repositories.get( repo_slug )

    for pl in repo.pipelines.each():
        if ( pl.build_number == build_number ): break

    for step in pl.steps():
        if ( step.data['name'].startswith( 'Check AWS') ):

            url = 'https://api.bitbucket.org/internal/repositories/%s/%s/pipelines/%s/steps/%s/start_step' % ( bxbts.slug, repo.slug, pl.uuid, step.uuid )
            print( url )
            response = cloud._session.post( url, json = {} )
            print( response )
            print(response.text)


def trigger_pipeline_step( bucket_name ):
    s3 = boto3.client('s3')
    obj = s3.get_object(Bucket=bucket_name, Key='bitbucket_details.txt')
    bitbucket_details = json.loads(obj['Body'].read())
    
    trigger_step( bitbucket_details['BITBUCKET_WORKSPACE'],
                  bitbucket_details['BITBUCKET_PROJECT_KEY'],
                  bitbucket_details['BITBUCKET_REPO_SLUG'],
                  bitbucket_details['BITBUCKET_BUILD_NUMBER'] )
    
def main(event, context): 
    print( event )

    if 'Records' in event:
        for record in event['Records']:
            if 's3' in record and 'object' in record['s3']:
                if record['s3']['object']['key'] == 'amazonmqrabbit-pipeline-status':
                    trigger_pipeline_step( record['s3']['bucket']['name'] )
                 
