---
layout: post
title: "Passing Properties from S3 to Batch via EventBridge"
date: 2024-09-02 08:00:30 +0100
tags: aws IaC s3 batch terraform
published: true
---

# Passing Properties from S3 to Batch via EventBridge

## Table of Contents

1. [Overview of the Workflow](#overview-of-the-workflow)
2. [Prerequisites](#prerequisites)
3. [Step-by-Step Implementation](#step-by-step-implementation)
    1. [S3 Bucket Setup](#1-s3-bucket-setup)
    2. [Create EventBridge Rule](#2-create-eventbridge-rule)
    3. [Define the Input Transformer](#3-define-the-input-transformer)
    4. [Create Batch Job Definition](#4-create-batch-job-definition)
    5. [Finalize and Deploy](#5-finalize-and-deploy)
4. [Conclusion](#conclusion)

In AWS, connecting different services seamlessly is a key to building robust, automated workflows. A common scenario is passing properties from an S3 event to an AWS Batch job using EventBridge. This workflow allows you to trigger a Batch job when a specific event happens in an S3 bucket, passing along important metadata or configurations as part of the job's environment variables.

In this blog post, we'll explore how to implement this architecture using Infrastructure as Code (IaC) with Terraform. This approach ensures your infrastructure is version-controlled, repeatable, and scalable.

## Overview of the Workflow

The basic workflow involves the following steps:

1. **S3 Event**: An object is created or modified in an S3 bucket.
2. **EventBridge Rule**: The event triggers an EventBridge rule.
3. **Input Transformer**: The EventBridge rule uses an Input Transformer to extract and transform specific properties from the S3 event.
4. **AWS Batch**: The transformed properties are passed as environment variables to the AWS Batch job.

### Prerequisites

Before we dive into the setup, ensure you have the following:

- An S3 bucket set up to store your files.
- An AWS Batch compute environment and job queue configured.
- Basic understanding of Terraform and AWS services like S3, EventBridge, and Batch.

## Step-by-Step Implementation

### 1. S3 Bucket Setup

First, you need an S3 bucket where your files will be uploaded. This bucket will emit events that will trigger the AWS Batch jobs.

```hcl
resource "aws_s3_bucket" "example_bucket" {
  bucket = "my-event-trigger-bucket"
}
```

### 2. Create EventBridge Rule

Next, create an EventBridge rule that listens for specific events from the S3 bucket. This rule will filter for events like \`s3:ObjectCreated:*\` and trigger the Batch job.

```hcl
resource "aws_cloudwatch_event_rule" "s3_event_rule" {
  name        = "s3-event-rule"
  event_pattern = <<EOF
{
  "source": ["aws.s3"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventName": ["PutObject", "CompleteMultipartUpload"],
    "requestParameters": {
      "bucketName": ["${aws_s3_bucket.example_bucket.bucket}"]
    }
  }
}
EOF
}
```

### 3. Define the Input Transformer

The Input Transformer in EventBridge allows you to manipulate the event data before passing it to the Batch job. For example, you can extract the S3 bucket name and object key from the event and pass them as environment variables.

```hcl
resource "aws_cloudwatch_event_target" "batch_target" {
  rule = aws_cloudwatch_event_rule.s3_event_rule.name
  arn  = aws_batch_job_queue.my_job_queue.arn

  input_transformer {
    input_paths = {
      "bucket" = "$.detail.requestParameters.bucketName"
      "key"    = "$.detail.requestParameters.key"
    }

    input_template = <<EOF
{
  "jobName": "my-batch-job",
  "jobQueue": "${aws_batch_job_queue.my_job_queue.arn}",
  "jobDefinition": "${aws_batch_job_definition.my_job_definition.arn}",
  "containerOverrides": {
    "environment": [
      {"name": "S3_BUCKET", "value": <bucket>},
      {"name": "S3_KEY", "value": <key>}
    ]
  }
}
EOF
  }
}
```

### 4. Create Batch Job Definition

Finally, define the Batch job that will be triggered. The job definition should include the environment variables that are passed from the EventBridge Input Transformer.

```hcl
resource "aws_batch_job_definition" "my_job_definition" {
  name = "my-batch-job-definition"

  container_properties = jsonencode({
    image      = "my-docker-image"
    vcpus      = 2
    memory     = 2048
    environment = [
      {
        name  = "S3_BUCKET"
        value = "placeholder" // This will be overwritten by EventBridge
      },
      {
        name  = "S3_KEY"
        value = "placeholder" // This will be overwritten by EventBridge
      }
    ]
  })

  type = "container"
}
```

### 5. Finalize and Deploy

With the S3 bucket, EventBridge rule, Input Transformer, and Batch job definition in place, you can deploy your infrastructure using Terraform. Make sure you apply the configuration and monitor the process to ensure everything is working as expected.

## Conclusion

By following this setup, you can efficiently pass properties from S3 events to AWS Batch jobs using EventBridge. This method is powerful for building event-driven architectures that respond dynamically to changes in your S3 buckets. With Terraform, you ensure that your infrastructure is easily manageable and reproducible.

For more detailed information on the specific configurations and additional features, check out the official [AWS documentation on EventBridge and Batch integration](https://docs.aws.amazon.com/batch/latest/userguide/batch-cwe-target.html#cwe-input-transformer).

Happy automating!
