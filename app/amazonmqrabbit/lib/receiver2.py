import io
import json
import os
import ssl
import time
from datetime import datetime

import boto3
import dateutil.tz
import pika
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
    print(secret)
    rabbitmq_host = secret["hostname"]
    queue_name = secret["queuename"]
    username = secret["ruser"]  
    password = secret["rpassword"] 
    failed_messages = 'FailMessage.Q'
    # Set S3 bucket name and file name 
    S3_BUCKET_NAME = secret["s3Txt"]
    connection = None
    # Create SSL context
    ssl_context = ssl.create_default_context()
    messages_processed = 0
    messages_nacked = 0
    #SNS topic ARN
    sns_topic = os.environ['SNS_TOPIC']
    sns = boto3.client('sns')
    try:
        # Connect to RabbitMQ with SSL and credentials
        credentials = pika.PlainCredentials(username, password)
        parameters = pika.ConnectionParameters(
            host=rabbitmq_host,
            port=5671,  # AMQPS port
            virtual_host='/',
            credentials=credentials,
            ssl_options=pika.SSLOptions(ssl_context)  # Enable SSL/TLS
        )
        connection = pika.BlockingConnection(parameters)
        channel = connection.channel()
        # Get the current date to create a unique S3 file key for each day
        local_timezone = dateutil.tz.gettz('Australia/Sydney')  # Replace with the appropriate time zone
        current_local_time = datetime.now(tz = local_timezone)
        current_date = current_local_time.strftime('%Y-%m-%d')
        file_name = current_local_time.strftime('%Y-%m-%d %H:%M:%S')
        s3_file_key = f'{current_date}/{file_name}.txt'
        # Create in-memory buffer to hold the temporary text file contents
        buffer = io.StringIO()
        s3 = boto3.client('s3')
        # Consume messages from the existing queue
        batch = []
        try:
            start_time = time.time()
            while True:
                method, header, body = channel.basic_get(queue=queue_name, auto_ack=False) #messages are received one at a timem here
                if not body:  #check if there are any messages on the queue
                    print("No messages on queue")
                    break
                else:
                    decoded_message = body.decode().strip()
                    batch.append(method)              
                    # Append the message to the in-memory buffer
                    buffer.write(decoded_message + "\n")
                    #Counter to keep track of how many messages have been received
                    messages_processed += 1
            buffer.seek(0)  # Move the buffer cursor to the beginning
            end_time = time.time()
            total_time = end_time - start_time
            print(f'Total time it took to process {messages_processed} is {total_time}')
            try:
                s3.put_object(Bucket=S3_BUCKET_NAME, Key=s3_file_key, Body=buffer.getvalue())
                print(f"Total messages uploaded: {messages_processed}")
                nack_time_start = time.time()
                for method in batch:
                    channel.basic_ack(delivery_tag=method.delivery_tag, multiple=False)
                    messages_nacked +=1
                print(f"Total messages acked: {messages_nacked}")
                nack_time_end = time.time()
                nack_total_time = nack_time_end - nack_time_start
                print(f"Total time to ack {messages_processed} is {nack_total_time}")
                channel.close()
                connection.close()
            except Exception as e:
                m2 = 'Error encountered while uploading messages to S3. Please check S3 bucket to ensure the txt file is there and go to RabbitMQ queue to check if messages have been ACKed successfully' + '\n' + str(e)
                # Either loop through the messages and NACK 'em or REQUEUE?
                # Or just send an email of the body of those failed messages ?
                sns.publish(TopicArn=sns_topic,Message=m2,)
                raise e
                # for method in batch:
                #     channel.basic_nack(delivery_tag=method.delivery_tag, multiple=False)
            else:
                m1 = f'Messages have been consumed from RabbitMQ queue and uploaded to S3 successfully. Total time to ack {messages_processed} is {nack_total_time}'  
                # Either loop through the messages and NACK 'em or REQUEUE?
                # Or just send an email of the body of those failed messages ?
                sns.publish(TopicArn=sns_topic,Message=m1,)
                return {
                    'statusCode': 200,
                    'body': json.dumps('Messages uploaded to S3')
                }
        except Exception as e:
            m3 = 'Error encountered while reading messages from RabbitMQ queue. Please check lambda memory size and check the error below' + '\n' + str(e)
            # Either loop through the messages and NACK 'em or REQUEUE?
            # Or just send an email of the body of those failed messages ?
            sns.publish(TopicArn=sns_topic,Message=m3,)
            raise e
            
    except Exception as e:
        raise e
