import json
import os
import boto3

def set_status( status ):
    s3 = boto3.resource('s3')
    source_bucket_name = os.environ['source_bucket_name']

    obj = s3.Object( source_bucket_name, 'amazonmqrabbit-pipeline-status' )
    obj.put(Body = status )

def main(event, context): 
    print( event )

    if 'Records' in event:
        for record in event['Records']:
            if 'Sns' in record and 'Message' in record['Sns']:
                message = json.loads( record['Sns']['Message'] )
                
                if message['detailType'] ==  'CodePipeline Pipeline Execution State Change':
                    if message['detail']['state'] == 'FAILED':
                        print( "Pipeline has failed" )
                        set_status( 'FAILED' )
 
                    elif message['detail']['state'] == 'SUCCEEDED':
                        print( "Pipeline has been successful" )
                        set_status( 'SUCCEEDED' )
                    
