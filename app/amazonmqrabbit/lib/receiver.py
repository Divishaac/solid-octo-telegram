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
        # Consume messages from the existing queue
        def callback(ch, method, properties, body):
            try:
                #Receive messages
                received_message = body.decode().strip()
                #Counter to keep track of how many messages have been received
                nonlocal messages_processed
                messages_processed += 1
                #print('Received message:', received_message, end=' ')
                # Append the message to the in-memory buffer
                buffer.write(received_message + "\n")
                #Ack the messages
                channel.basic_ack(delivery_tag=method.delivery_tag)
            except Exception as e:
                print (e)
                #Nack the messages
                channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                #Send it to another queue (only failed messages)
                channel.basic_publish(exchange='', routing_key=failed_messages, body=body)
                print("Failed message sent to DLQ:", e)

        # Record the start time for 15-minute duration
        start_time = time.time()
        # Start consuming messages from the existing queue
        channel.basic_consume(queue=queue_name, on_message_callback=callback, auto_ack=False)
        
        #channel.basic_nack
        print('Waiting for messages. Will consume for 1 minute.')
        # Consume messages in a loop until 15 minutes have elapsed
        while time.time() < start_time + 5:  # 900 seconds = 15 minutes
            connection.process_data_events(time_limit=1.0)  # Process events for 1 second
            #channel.start_consuming()
        # Upload the buffered contents to S3 with the new unique file key
        buffer.seek(0)  # Move the buffer cursor to the beginning
        s3 = boto3.client('s3')
        try:
            print(s3_file_key)
            existing_content = s3.get_object(Bucket=S3_BUCKET_NAME, Key=s3_file_key)['Body'].read().decode()
            print("E1")
            updated_content = existing_content + buffer.getvalue()
            print("E2")
            try:
                s3.put_object(Bucket=S3_BUCKET_NAME, Key=s3_file_key, Body=updated_content)
                print("E3")
                print(f"Total messages uploaded: {messages_processed}")
            except:
                print("Messages failed to upload to S3")
                # Use SES to send an email with messages in txt file attachment?
        except:
            print("CHECKPOINT")
            try:
                s3.put_object(Bucket=S3_BUCKET_NAME, Key=s3_file_key, Body= buffer.getvalue())
                print(f"Total messages uploaded: {messages_processed}")
            except:
                print("Messages failed to upload to S3")
                # Use SES to send an email with messages in txt file attachment?
        # Stop consuming 
        # channel.stop_consuming()
        connection.close()
        
    except Exception as e:
            print("Error:", str(e))