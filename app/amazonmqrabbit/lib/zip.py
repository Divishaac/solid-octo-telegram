import io
import json
import os
import tempfile
import zipfile
from datetime import datetime, timedelta

import boto3
import dateutil.tz
from botocore.exceptions import ClientError


def handler(event, context):
    secret_name = "RabbitCreds"
    region_name = "ap-southeast-2"
    # Create a Secrets Manager client
    session = boto3.session.Session()
    client = session.client(
        service_name='secretsmanager',
        region_name=region_name
    )

    try:
        get_secret_value_response = client.get_secret_value(
            SecretId=secret_name
        )
    except ClientError as e:
        raise e

    # Decrypts secret using the associated KMS key.
    secret = json.loads(get_secret_value_response['SecretString'])

    # Retrieve bucket and key from the event
    source_bucket = secret["s3Txt"]

    # Get the current date to zip S3 file key for each day
    # Replace with the appropriate time zone
    local_timezone = dateutil.tz.gettz('Australia/Sydney')  #UTC
    last_day = datetime.now(tz=local_timezone) - timedelta(1)
    last_date = last_day.strftime('%Y-%m-%d')
    s3_file_key = f'{last_date}/'
    print(s3_file_key)
    # Destination bucket to upload the zip file
    destination_bucket = secret["s3Zip"]

    # Create a new S3 client
    s3 = boto3.client('s3')
    #SNS topic ARN
    sns_topic = os.environ['SNS_TOPIC']
    sns = boto3.client('sns')
    try:
        # Download the source file from S3
        #response = s3.get_object(Bucket=source_bucket, Key=s3_file_key)
        response = s3.list_objects_v2(Bucket=source_bucket, Prefix=s3_file_key)
        contents = response.get('Contents', [])
        if not contents:
            print("No objects found for this date")
            return

        #In memory zip file
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for content in contents:
                obj_key = content['Key']
                obj_filename = os.path.basename(obj_key)
                obj_data = s3.get_object(Bucket = source_bucket, Key = obj_key)['Body'].read()
                zipf.writestr(obj_filename, obj_data)
        #Upload to zip S3
        zip_buffer.seek(0)
        destination_key = f'{last_date}.zip'
        s3.upload_fileobj(zip_buffer, destination_bucket, destination_key)
        # Delete the original file from the source bucket
        # s3.delete_object(Bucket=source_bucket, Key=source_key)
        print("Zipped")
        m1 = 'Messages have been zipped and sent to S3 successfully.'  
        # Either loop through the messages and NACK 'em or REQUEUE?
        # Or just send an email of the body of those failed messages ?
        sns.publish(TopicArn=sns_topic,Message=m1,)
        return {
            'statusCode': 200,
            'body': 'Zip file created and uploaded successfully.'
        }
    except Exception as e:
        m2 = 'Error encountered while zipping message files. Please check the error below \n' +str(e)
        sns.publish(TopicArn=sns_topic,Message=m2,)
        return {
            'statusCode': 400,
            'body': str(e)
        }
